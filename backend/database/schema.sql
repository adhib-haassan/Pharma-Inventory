CREATE TABLE IF NOT EXISTS shop_profile (
    singleton_id INTEGER NOT NULL DEFAULT 1 CHECK (singleton_id = 1),
    shop_id VARCHAR(32) NOT NULL,
    shop_name VARCHAR(255) NOT NULL,
    shop_profile VARCHAR(100) NOT NULL,
    PRIMARY KEY (singleton_id),
    UNIQUE (shop_id)
);

CREATE TABLE IF NOT EXISTS medicines (
    medicine_id VARCHAR(32) NOT NULL,
    medicine_name VARCHAR(255) NOT NULL,
    category VARCHAR(120) NOT NULL,
    manufacturer VARCHAR(255) NOT NULL,
    unit_price NUMERIC NOT NULL,
    catalog_expiry_date TEXT NULL,
    PRIMARY KEY (medicine_id),
    CHECK (unit_price >= 0)
);
CREATE INDEX IF NOT EXISTS idx_medicines_name ON medicines (medicine_name);
CREATE INDEX IF NOT EXISTS idx_medicines_category ON medicines (category);

CREATE TABLE IF NOT EXISTS sales_history (
    sale_date TEXT NOT NULL,
    medicine_id VARCHAR(32) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (sale_date, medicine_id),
    FOREIGN KEY (medicine_id) REFERENCES medicines (medicine_id)
);
CREATE INDEX IF NOT EXISTS idx_sales_medicine_date ON sales_history (medicine_id, sale_date);

CREATE TABLE IF NOT EXISTS inventory_batches (
    batch_id VARCHAR(64) NOT NULL,
    medicine_id VARCHAR(32) NOT NULL,
    batch_number VARCHAR(64) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    purchase_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
    selling_price NUMERIC NOT NULL CHECK (selling_price >= 0),
    reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    supplier VARCHAR(255) NOT NULL,
    PRIMARY KEY (batch_id),
    FOREIGN KEY (medicine_id) REFERENCES medicines (medicine_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_medicine_expiry ON inventory_batches (medicine_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_inventory_quantity ON inventory_batches (quantity);
