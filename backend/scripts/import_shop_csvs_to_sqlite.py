#!/usr/bin/env python3
"""Import each shop's CSV data into its own local SQLite database file."""

from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_DIRECTORY = REPOSITORY_ROOT / "backend" / "data" / "pharma_shop_csvs"
DATABASE_DIRECTORY = REPOSITORY_ROOT / "backend" / "data" / "shop_databases"
SCHEMA_FILE = REPOSITORY_ROOT / "backend" / "database" / "schema.sql"
SHOP_ID_PATTERN = re.compile(r"SHOP_0[1-5]\Z")


@dataclass
class ShopData:
    shop: dict[str, str]
    medicines: list[tuple[Any, ...]]
    sales: list[tuple[Any, ...]]
    inventory_batches: list[tuple[Any, ...]]


def read_csv(filename: str) -> list[dict[str, str]]:
    path = DATA_DIRECTORY / filename
    if not path.is_file():
        raise FileNotFoundError(f"Required CSV file not found: {path}")
    with path.open(encoding="utf-8-sig", newline="") as csv_file:
        return list(csv.DictReader(csv_file))


def parse_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"Invalid {field} date: {value!r}") from error


def parse_optional_date(value: str, field: str) -> date | None:
    return parse_date(value, field) if value else None


def parse_integer(value: str, field: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"Invalid {field} integer: {value!r}") from error
    if parsed < 0:
        raise ValueError(f"{field} cannot be negative: {parsed}")
    return parsed


def parse_decimal(value: str, field: str) -> str:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise ValueError(f"Invalid {field} decimal: {value!r}") from error
    if not parsed.is_finite() or parsed < 0:
        raise ValueError(f"{field} must be a finite non-negative number: {value!r}")
    return format(parsed, "f")


def load_shop_data(shop_id: str) -> ShopData:
    if not SHOP_ID_PATTERN.fullmatch(shop_id):
        raise ValueError(f"Unsupported shop ID: {shop_id}")

    shops = read_csv("medical_shops.csv")
    shop_matches = [row for row in shops if row["shop_id"] == shop_id]
    if len(shop_matches) != 1:
        raise ValueError(f"Expected exactly one profile for {shop_id}")

    medicines: list[tuple[Any, ...]] = []
    medicine_ids: set[str] = set()
    medicine_prices: dict[str, str] = {}
    for row in read_csv("medicine_master.csv"):
        medicine_id = row["medicine_id"]
        if medicine_id in medicine_ids:
            raise ValueError(f"Duplicate medicine ID in catalog: {medicine_id}")
        medicine_ids.add(medicine_id)
        unit_price = parse_decimal(row["price"], "medicine price")
        medicines.append(
            (
                medicine_id,
                row["medicine_name"],
                row["category"],
                row["manufacturer"],
                unit_price,
                row["expiry_date"] or None,
            )
        )
        medicine_prices[medicine_id] = unit_price

    sales: list[tuple[Any, ...]] = []
    sales_keys: set[tuple[date, str]] = set()
    for row in read_csv(f"{shop_id.lower()}_sales_history.csv"):
        if row["shop_id"] != shop_id:
            raise ValueError(f"Sales CSV contains a record for another shop: {row['shop_id']}")
        medicine_id = row["medicine_id"]
        if medicine_id not in medicine_ids:
            raise ValueError(f"Sales record references unknown medicine: {medicine_id}")
        sale_date = parse_date(row["date"], "sale")
        sale_key = (sale_date, medicine_id)
        if sale_key in sales_keys:
            raise ValueError(f"Duplicate sale record for {sale_date} and {medicine_id}")
        sales_keys.add(sale_key)
        sales.append(
            (
                sale_date.isoformat(),
                medicine_id,
                parse_integer(row["sales_quantity"], "sales quantity"),
                medicine_prices[medicine_id],
            )
        )

    inventory_batches: list[tuple[Any, ...]] = []
    batch_ids: set[str] = set()
    for row in read_csv(f"{shop_id.lower()}_inventory_batches.csv"):
        if row["shop_id"] != shop_id:
            raise ValueError(f"Inventory CSV contains a record for another shop: {row['shop_id']}")
        medicine_id = row["medicine_id"]
        if medicine_id not in medicine_ids:
            raise ValueError(f"Inventory batch references unknown medicine: {medicine_id}")
        batch_id = row["batch_id"]
        if batch_id in batch_ids:
            raise ValueError(f"Duplicate inventory batch ID: {batch_id}")
        batch_ids.add(batch_id)
        inventory_batches.append(
            (
                batch_id,
                medicine_id,
                row["batch_number"],
                parse_integer(row["quantity"], "inventory quantity"),
                parse_date(row["purchase_date"], "purchase").isoformat(),
                parse_date(row["expiry_date"], "batch expiry").isoformat(),
                parse_decimal(row["unit_cost"], "unit cost"),
                parse_decimal(row["selling_price"], "selling price"),
                parse_integer(row["reorder_level"], "reorder level"),
                row["supplier"],
            )
        )

    return ShopData(shop_matches[0], medicines, sales, inventory_batches)


def validate_all_shops() -> list[tuple[str, ShopData]]:
    shops = read_csv("medical_shops.csv")
    shop_ids = [row["shop_id"] for row in shops]
    if len(shop_ids) != len(set(shop_ids)):
        raise ValueError("Shop catalog contains duplicate shop IDs")
    if any(not SHOP_ID_PATTERN.fullmatch(shop_id) for shop_id in shop_ids):
        raise ValueError("Shop catalog contains an unsupported shop ID")
    return [(shop_id, load_shop_data(shop_id)) for shop_id in shop_ids]


def insert_many(connection: sqlite3.Connection, query: str, rows: list[tuple[Any, ...]]) -> None:
    batch_size = 2_000
    for start in range(0, len(rows), batch_size):
        connection.executemany(query, rows[start : start + batch_size])


def import_shop(shop_id: str, shop_data: ShopData, replace_existing: bool) -> None:
    database_path = DATABASE_DIRECTORY / f"medinexus_{shop_id.lower()}.sqlite3"
    DATABASE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=30)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))

        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(sales_history)")
        }
        if "unit_price" not in columns:
            connection.execute(
                "ALTER TABLE sales_history ADD COLUMN unit_price NUMERIC NOT NULL DEFAULT 0"
            )
            connection.execute(
                """
                UPDATE sales_history
                SET unit_price = (
                    SELECT medicines.unit_price
                    FROM medicines
                    WHERE medicines.medicine_id = sales_history.medicine_id
                )
                """
            )

        existing_rows = sum(
            connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("shop_profile", "medicines", "sales_history", "inventory_batches")
        )
        if existing_rows and not replace_existing:
            raise FileExistsError(
                f"{database_path} already contains shop data. Use --replace to replace it."
            )

        connection.execute("BEGIN IMMEDIATE")
        if replace_existing:
            connection.execute("DELETE FROM sales_history")
            connection.execute("DELETE FROM inventory_batches")
            connection.execute("DELETE FROM medicines")
            connection.execute("DELETE FROM shop_profile")

        connection.execute(
            """
            INSERT INTO shop_profile (singleton_id, shop_id, shop_name, shop_profile)
            VALUES (1, ?, ?, ?)
            """,
            (
                shop_data.shop["shop_id"],
                shop_data.shop["shop_name"],
                shop_data.shop["shop_profile"],
            ),
        )
        insert_many(
            connection,
            """
            INSERT INTO medicines
                (medicine_id, medicine_name, category, manufacturer, unit_price, catalog_expiry_date)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            shop_data.medicines,
        )
        insert_many(
            connection,
            """
            INSERT INTO sales_history (sale_date, medicine_id, quantity, unit_price)
            VALUES (?, ?, ?, ?)
            """,
            shop_data.sales,
        )
        insert_many(
            connection,
            """
            INSERT INTO inventory_batches
                (batch_id, medicine_id, batch_number, quantity, purchase_date, expiry_date,
                 unit_cost, selling_price, reorder_level, supplier)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            shop_data.inventory_batches,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shop", choices=[f"SHOP_0{number}" for number in range(1, 6)])
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="validate all shop CSV files without creating or changing databases",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="replace existing data for each selected shop",
    )
    args = parser.parse_args()
    if args.validate_only and args.replace:
        parser.error("--replace cannot be used with --validate-only")

    try:
        shop_data = validate_all_shops()
        selected_shops = (
            [(shop_id, data) for shop_id, data in shop_data if shop_id == args.shop]
            if args.shop
            else shop_data
        )
        for shop_id, data in selected_shops:
            print(
                f"{shop_id}: {len(data.medicines)} medicines, "
                f"{len(data.sales)} sales rows, "
                f"{len(data.inventory_batches)} inventory batches validated"
            )

        if args.validate_only:
            print("CSV validation succeeded; no databases were changed.")
            return 0

        for shop_id, data in selected_shops:
            import_shop(shop_id, data, args.replace)
            print(f"Imported {shop_id} into {DATABASE_DIRECTORY / f'medinexus_{shop_id.lower()}.sqlite3'}.")
    except Exception as error:
        print(f"Import failed: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
