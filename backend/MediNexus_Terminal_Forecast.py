#!/usr/bin/env python3
"""
MediNexus - Terminal Forecast & Prediction App
Phase 1: Federated Learning for Medical-Shop Demand Forecasting

This file loads the trained models/results from the Phase 1 notebook and lets the
user select a medicine from the terminal. It then:
  1. Forecasts the next 30 days of demand.
  2. Predicts total 30-day demand.
  3. Estimates stockout/overstock/expiry risk.
  4. Recommends a purchase quantity.
  5. Shows a short FEFO batch view.

If the notebook has not been executed yet, the script trains the required
XGBoost models automatically from the packaged CSV files.

Important:
- This is a Phase 1 terminal application/demo.
- The XGBoost "federated" model is the weighted prediction ensemble described
  in the notebook, not strict neural-network parameter-level FedAvg.
"""

from pathlib import Path
import sys
import json
import warnings
import subprocess
import shutil

warnings.filterwarnings("ignore")

try:
    import joblib
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "joblib"])
    import joblib

try:
    import pandas as pd
    import numpy as np
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas", "numpy"])
    import pandas as pd
    import numpy as np

try:
    from xgboost import XGBRegressor
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "xgboost"])
    from xgboost import XGBRegressor


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
MODELS = ROOT / "models"
RESULTS = ROOT / "results"

SALES_FILE = DATA / "synthetic_shop_sales_2024_2025.csv"
MEDICINE_FILE = DATA / "medicine_master.csv"
SHOP_FILE = DATA / "medical_shops.csv"
INVENTORY_FILE = DATA / "synthetic_shop_inventory_batches.csv"

# Model filenames produced by the Phase 1 notebook.
NOTEBOOK_CENTRAL_MODEL = MODELS / "centralized_xgboost_benchmark.joblib"

CENTRAL_MODEL = MODELS / "centralized_xgboost.joblib"
LOCAL_DIR = MODELS / "local_models"
GLOBAL_DIR = MODELS / "federated"
METADATA_FILE = MODELS / "model_metadata.json"


def load_data():
    required = [SALES_FILE, MEDICINE_FILE, SHOP_FILE, INVENTORY_FILE]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise FileNotFoundError(
            "Required dataset file(s) are missing:\n" + "\n".join(missing)
        )

    sales = pd.read_csv(SALES_FILE, parse_dates=["date"])
    medicines = pd.read_csv(MEDICINE_FILE)
    shops = pd.read_csv(SHOP_FILE)
    inventory = pd.read_csv(INVENTORY_FILE, parse_dates=["expiry_date"])
    return sales, medicines, shops, inventory


def feature_engineer(sales):
    df = sales.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["shop_id", "medicine_id", "date"]).reset_index(drop=True)

    group = df.groupby(["shop_id", "medicine_id"])["sales_quantity"]

    for lag in [1, 7, 14, 30]:
        df[f"lag_{lag}"] = group.shift(lag)

    shifted = group.shift(1)
    df["rolling_mean_7"] = (
        shifted.groupby([df["shop_id"], df["medicine_id"]])
        .rolling(7, min_periods=1).mean()
        .reset_index(level=[0, 1], drop=True)
    )
    df["rolling_std_7"] = (
        shifted.groupby([df["shop_id"], df["medicine_id"]])
        .rolling(7, min_periods=2).std()
        .reset_index(level=[0, 1], drop=True)
        .fillna(0)
    )
    df["rolling_mean_30"] = (
        shifted.groupby([df["shop_id"], df["medicine_id"]])
        .rolling(30, min_periods=1).mean()
        .reset_index(level=[0, 1], drop=True)
    )
    df["rolling_std_30"] = (
        shifted.groupby([df["shop_id"], df["medicine_id"]])
        .rolling(30, min_periods=2).std()
        .reset_index(level=[0, 1], drop=True)
        .fillna(0)
    )

    df["day_of_week"] = df["date"].dt.dayofweek
    df["month"] = df["date"].dt.month
    df["week_of_year"] = df["date"].dt.isocalendar().week.astype(int)
    df["quarter"] = df["date"].dt.quarter
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)

    df["shop_code"] = df["shop_id"].astype("category").cat.codes
    df["medicine_code"] = df["medicine_id"].astype("category").cat.codes
    return df


def get_feature_columns(model=None):
    # Matches the notebook's feature engineering.
    return [
        "shop_code",
        "medicine_code",
        "day_of_week",
        "month",
        "week_of_year",
        "quarter",
        "is_weekend",
        "lag_1",
        "lag_7",
        "lag_14",
        "lag_30",
        "rolling_mean_7",
        "rolling_std_7",
        "rolling_mean_30",
        "rolling_std_30",
    ]


def prepare_training_data(sales):
    df = feature_engineer(sales)
    features = get_feature_columns()
    df = df.dropna(subset=features + ["sales_quantity"]).copy()
    return df, features


def train_models_if_needed(sales):
    MODELS.mkdir(exist_ok=True)
    LOCAL_DIR.mkdir(exist_ok=True)
    GLOBAL_DIR.mkdir(exist_ok=True)

    notebook_models_ready = (
        NOTEBOOK_CENTRAL_MODEL.exists()
        and any(MODELS.glob("local_model_*.joblib"))
        and (MODELS / "federated_model_metadata.joblib").exists()
    )
    if notebook_models_ready or (CENTRAL_MODEL.exists() and any(LOCAL_DIR.glob("*.joblib"))):
        return

    print("\n[INFO] Trained model files were not found.")
    print("[INFO] Training the Phase 1 XGBoost models from the packaged dataset...\n")

    df, features = prepare_training_data(sales)

    # Same time-based split used by the notebook: last 90 days as test.
    cutoff = df["date"].max() - pd.Timedelta(days=90)
    train = df[df["date"] < cutoff].copy()

    params = dict(
        n_estimators=250,
        max_depth=8,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=2,
    )

    central = XGBRegressor(**params)
    central.fit(train[features], train["sales_quantity"])
    joblib.dump(central, CENTRAL_MODEL)

    shop_models = {}
    for shop_id, shop_df in train.groupby("shop_id"):
        model = XGBRegressor(**params)
        model.fit(shop_df[features], shop_df["sales_quantity"])
        path = LOCAL_DIR / f"{shop_id}.joblib"
        joblib.dump(model, path)
        shop_models[shop_id] = model

    # Store a compact global weighted-ensemble definition.
    weights = {}
    total = sum(len(g) for g in train.groupby("shop_id"))
    for shop_id, g in train.groupby("shop_id"):
        weights[shop_id] = len(g) / total

    metadata = {
        "feature_columns": features,
        "cutoff_date": str(cutoff.date()),
        "shops": sorted(shop_models.keys()),
        "weights": weights,
        "model_type": "XGBoost weighted prediction ensemble (FedAvg-style demonstration)",
    }
    METADATA_FILE.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    # Save a JSON-compatible global model definition. Individual local models
    # remain private client models in this Phase 1 simulation.
    (GLOBAL_DIR / "ensemble_metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )

    # Save the most recent model copies used by the terminal runner.
    for shop_id in shop_models:
        target = GLOBAL_DIR / f"{shop_id}.joblib"
        shutil.copy2(LOCAL_DIR / f"{shop_id}.joblib", target)

    print("[OK] Models trained and saved under:", MODELS)


def load_models():
    central_path = CENTRAL_MODEL if CENTRAL_MODEL.exists() else NOTEBOOK_CENTRAL_MODEL
    central = joblib.load(central_path) if central_path.exists() else None

    local_models = {}
    # Prefer models saved by the notebook; also support the runner's own directory.
    for path in MODELS.glob("local_model_*.joblib"):
        local_models[path.stem.replace("local_model_", "")] = joblib.load(path)
    for path in LOCAL_DIR.glob("*.joblib"):
        local_models[path.stem] = joblib.load(path)

    metadata = {}
    if METADATA_FILE.exists():
        metadata = json.loads(METADATA_FILE.read_text(encoding="utf-8"))

    return central, local_models, metadata


def make_maps(sales):
    # Stable category maps matching the feature-engineering approach.
    shop_ids = sorted(sales["shop_id"].astype(str).unique())
    medicine_ids = sorted(sales["medicine_id"].astype(str).unique())
    shop_code = {v: i for i, v in enumerate(shop_ids)}
    medicine_code = {v: i for i, v in enumerate(medicine_ids)}
    return shop_code, medicine_code


def build_history(sales, shop_id, medicine_id):
    h = sales[
        (sales["shop_id"].astype(str) == str(shop_id)) &
        (sales["medicine_id"].astype(str) == str(medicine_id))
    ].copy()
    return h.sort_values("date").reset_index(drop=True)


def predict_one_day(model, history, shop_id, medicine_id, next_date, shop_code, medicine_code):
    history = history.copy()
    y = history["sales_quantity"].astype(float).tolist()

    def lag(n):
        return float(y[-n]) if len(y) >= n else float(np.mean(y[-7:])) if y else 0.0

    last_30 = np.array(y[-30:], dtype=float) if y else np.array([0.0])
    last_7 = np.array(y[-7:], dtype=float) if y else np.array([0.0])

    # For recursive forecasting, purchase/opening stock is estimated from
    # the most recent observed record. Demand prediction remains the target.
    last_row = history.iloc[-1]
    dow = next_date.dayofweek

    x = pd.DataFrame([{
        "shop_code": int(shop_code[str(shop_id)]),
        "medicine_code": int(medicine_code[str(medicine_id)]),
        "day_of_week": dow,
        "month": next_date.month,
        "week_of_year": int(next_date.isocalendar().week),
        "quarter": int((next_date.month - 1) // 3 + 1),
        "is_weekend": int(dow >= 5),
        "lag_1": lag(1),
        "lag_7": lag(7),
        "lag_14": lag(14),
        "lag_30": lag(30),
        "rolling_mean_7": float(np.mean(last_7)),
        "rolling_std_7": float(np.std(last_7, ddof=1)) if len(last_7) >= 2 else 0.0,
        "rolling_mean_30": float(np.mean(last_30)),
        "rolling_std_30": float(np.std(last_30, ddof=1)) if len(last_30) >= 2 else 0.0,
    }])

    return max(0.0, float(model.predict(x)[0]))


def recursive_forecast(model, history, shop_id, medicine_id, days, shop_code, medicine_code, start_date=None):
    h = history.copy()
    forecasts = []
    forecast_start = (
        pd.Timestamp(start_date).normalize()
        if start_date is not None
        else pd.Timestamp.today().normalize()
    )
    recent = h[h["date"] >= h["date"].max() - pd.Timedelta(days=55)]
    weekday_means = recent.groupby(recent["date"].dt.dayofweek)["sales_quantity"].mean()
    fallback_mean = float(recent["sales_quantity"].mean())

    for offset in range(days):
        next_date = forecast_start + pd.Timedelta(days=offset)
        model_prediction = predict_one_day(
            model, h, shop_id, medicine_id, next_date, shop_code, medicine_code
        )
        seasonal_baseline = float(weekday_means.get(next_date.dayofweek, fallback_mean))
        pred = max(0.0, 0.5 * model_prediction + 0.5 * seasonal_baseline)
        forecasts.append({"date": next_date, "forecast_units": pred})

    return pd.DataFrame(forecasts)


def get_medicine_options(medicines):
    cols = [c for c in ["medicine_id", "medicine_name", "category"] if c in medicines.columns]
    return medicines[cols].drop_duplicates().sort_values(cols[1] if len(cols) > 1 else cols[0])


def find_medicine(medicines, query):
    q = query.strip().lower()
    m = medicines.copy()

    for col in ["medicine_id", "medicine_name"]:
        if col in m.columns:
            exact = m[m[col].astype(str).str.lower() == q]
            if not exact.empty:
                return exact.iloc[0]

    for col in ["medicine_id", "medicine_name"]:
        if col in m.columns:
            partial = m[m[col].astype(str).str.lower().str.contains(q, na=False)]
            if not partial.empty:
                return partial.iloc[0]

    return None


def risk_level(stock, demand_30, days_to_expiry):
    if demand_30 <= 0:
        return "HIGH" if stock > 0 else "LOW"
    excess = stock - demand_30

    if days_to_expiry <= 30 and excess > 0:
        return "HIGH"
    if days_to_expiry <= 60 and excess > 0:
        return "MEDIUM"
    if excess > max(10, demand_30 * 0.50):
        return "MEDIUM"
    return "LOW"


def analyze_medicine(medicines, sales, inventory, shop_id, medicine_row, local_models, central):
    medicine_id = str(medicine_row["medicine_id"])
    medicine_name = str(medicine_row.get("medicine_name", medicine_id))

    history = build_history(sales, shop_id, medicine_id)
    if history.empty:
        raise ValueError(f"No sales history found for {medicine_name} at {shop_id}.")

    # Prefer the local model for the selected shop. Fall back to centralized.
    model = local_models.get(str(shop_id), central)
    model_label = f"Local model — {shop_id}" if str(shop_id) in local_models else "Centralized model"

    shop_code, medicine_code = make_maps(sales)

    forecast = recursive_forecast(
        model, history, shop_id, medicine_id, 30, shop_code, medicine_code
    )

    total_30 = float(forecast["forecast_units"].sum())
    avg_daily = total_30 / 30.0

    inv = inventory[
        (inventory["shop_id"].astype(str) == str(shop_id)) &
        (inventory["medicine_id"].astype(str) == medicine_id)
    ].copy()

    if not inv.empty:
        if "current_stock" not in inv.columns:
            inv["current_stock"] = inv.get(
                "opening_stock", pd.Series(0, index=inv.index)
            ).fillna(0)
        forecast_start = forecast["date"].min()
        inv["days_to_expiry"] = (
            inv["expiry_date"] - forecast_start
        ).dt.days.fillna(9999).astype(int)
        usable_batches = inv[inv["days_to_expiry"] >= 0]
        current_stock = float(usable_batches["current_stock"].sum())
        usable_stock = current_stock
        nearest_expiry = (
            int(usable_batches["days_to_expiry"].min())
            if not usable_batches.empty else 9999
        )
        forecast_before_expiry = 0.0
        if nearest_expiry != 9999:
            forecast_before_expiry = float(
                forecast.head(min(nearest_expiry + 1, len(forecast)))["forecast_units"].sum()
            )
        potential_excess = max(0.0, usable_stock - forecast_before_expiry)
    else:
        current_stock = float(history.iloc[-1].get("closing_stock", 0))
        nearest_expiry = 9999
        usable_stock = current_stock
        forecast_before_expiry = 0.0
        potential_excess = 0.0

    expiry_risk = risk_level(usable_stock, forecast_before_expiry, nearest_expiry)
    stockout_risk = "HIGH" if current_stock < total_30 * 0.50 else (
        "MEDIUM" if current_stock < total_30 else "LOW"
    )

    safety_stock = max(1.0, avg_daily * 7 * 0.15)
    purchase_qty = max(0, int(np.ceil(total_30 + safety_stock - current_stock)))

    if expiry_risk == "HIGH":
        purchase_qty = 0

    if purchase_qty == 0:
        recommendation = "Do not purchase now; use existing stock first."
        if expiry_risk == "HIGH":
            recommendation += " Expiry/wastage risk is HIGH."
    else:
        recommendation = f"Consider purchasing about {purchase_qty} units for the next 30 days."

    return {
        "medicine_id": medicine_id,
        "medicine_name": medicine_name,
        "category": medicine_row.get("category", "N/A"),
        "shop_id": shop_id,
        "model": model_label,
        "sales_history_through": history["date"].max().strftime("%Y-%m-%d"),
        "current_stock": current_stock,
        "forecast_30d": total_30,
        "avg_daily_demand": avg_daily,
        "nearest_expiry_days": nearest_expiry,
        "forecast_before_expiry": forecast_before_expiry,
        "potential_excess": potential_excess,
        "expiry_risk": expiry_risk,
        "stockout_risk": stockout_risk,
        "recommended_purchase": purchase_qty,
        "recommendation": recommendation,
        "forecast_table": forecast,
        "inventory": inv,
    }


def print_header():
    print("\n" + "=" * 72)
    print(" MediNexus — Medicine Demand Forecast & Prediction")
    print("=" * 72)


def print_medicine_list(medicines, limit=None):
    opts = get_medicine_options(medicines)
    if limit:
        opts = opts.head(limit)

    print("\nAvailable medicines:")
    for i, (_, row) in enumerate(opts.iterrows(), 1):
        name = row.get("medicine_name", row.get("medicine_id", "Unknown"))
        mid = row.get("medicine_id", "")
        category = row.get("category", "")
        print(f"  {i:>3}. {name}  [{mid}]  ({category})")


def print_result(result):
    print("\n" + "-" * 72)
    print(f"Medicine           : {result['medicine_name']}")
    print(f"Category           : {result['category']}")
    print(f"Medical shop       : {result['shop_id']}")
    print(f"Model used         : {result['model']}")
    print(f"Sales data through : {result['sales_history_through']}")
    history_end = pd.Timestamp(result["sales_history_through"])
    if history_end < pd.Timestamp.today().normalize() - pd.Timedelta(days=30):
        print("WARNING: Sales history is over 30 days old; forecast uses stale historical demand.")
    print("-" * 72)
    print(f"Usable batch stock : {result['current_stock']:.0f} units")
    print(f"30-day forecast    : {result['forecast_30d']:.1f} units")
    print(f"Average daily      : {result['avg_daily_demand']:.2f} units/day")
    print(f"Stockout risk      : {result['stockout_risk']}")
    print(f"Nearest expiry     : {result['nearest_expiry_days']} days")
    print(f"Demand before exp. : {result['forecast_before_expiry']:.1f} units")
    print(f"Potential excess   : {result['potential_excess']:.1f} units")
    print(f"Expiry risk        : {result['expiry_risk']}")
    print(f"Purchase quantity  : {result['recommended_purchase']} units")
    print(f"Recommendation     : {result['recommendation']}")

    print("\nNext 30-day forecast:")
    print(forecast_table_to_text(result["forecast_table"]))

    inv = result["inventory"]
    if not inv.empty:
        print("\nFEFO batch view (earliest expiry first):")
        cols = [c for c in ["batch_id", "current_stock", "expiry_date", "days_to_expiry"] if c in inv.columns]
        print(inv.sort_values("expiry_date")[cols].head(10).to_string(index=False))


def forecast_table_to_text(df):
    x = df.copy()
    x["date"] = x["date"].dt.strftime("%Y-%m-%d")
    x["forecast_units"] = x["forecast_units"].round(2)
    return x.to_string(index=False)


def main():
    print_header()

    try:
        sales, medicines, shops, inventory = load_data()
        train_models_if_needed(sales)
        central, local_models, metadata = load_models()
    except Exception as exc:
        print(f"\n[ERROR] {exc}")
        sys.exit(1)

    if central is None and not local_models:
        print("[ERROR] No trained model could be loaded.")
        sys.exit(1)

    print(f"\nLoaded {len(medicines)} medicines, {len(shops)} shops and {len(sales):,} sales rows.")
    print("Models loaded successfully.")

    while True:
        print("\n" + "=" * 72)
        print("1. Select medicine and run forecast")
        print("2. List medicines")
        print("3. Exit")
        choice = input("\nChoose an option: ").strip()

        if choice == "3":
            print("\nExiting MediNexus.")
            break

        if choice == "2":
            print_medicine_list(medicines)
            continue

        if choice != "1":
            print("Invalid option.")
            continue

        # Shop selection
        print("\nAvailable medical shops:")
        shop_rows = shops.drop_duplicates(subset=["shop_id"])
        for i, (_, row) in enumerate(shop_rows.iterrows(), 1):
            sid = row["shop_id"]
            sname = row.get("shop_name", sid)
            print(f"  {i}. {sid} — {sname}")

        shop_input = input("\nEnter shop ID (e.g. SHOP_01): ").strip()
        shop_match = shop_rows[shop_rows["shop_id"].astype(str).str.lower() == shop_input.lower()]
        if shop_match.empty:
            print("Shop not found.")
            continue
        shop_id = str(shop_match.iloc[0]["shop_id"])

        medicine_input = input(
            "\nEnter medicine name or medicine ID (partial name is allowed): "
        ).strip()

        medicine_row = find_medicine(medicines, medicine_input)
        if medicine_row is None:
            print("Medicine not found.")
            print_medicine_list(medicines, limit=20)
            continue

        try:
            result = analyze_medicine(
                medicines, sales, inventory, shop_id, medicine_row,
                local_models, central
            )
            print_result(result)
        except Exception as exc:
            print(f"\n[ERROR] Could not generate prediction: {exc}")

        again = input("\nRun another prediction? [Y/n]: ").strip().lower()
        if again == "n":
            print("\nExiting MediNexus.")
            break


if __name__ == "__main__":
    main()
