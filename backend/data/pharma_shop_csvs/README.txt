Pharma Inventory synthetic CSV dataset

Files:
- medical_shops.csv: shared shop lookup (5 shops)
- medicine_master.csv: shared medicine catalog (80 medicines)
- shop_XX_sales_history.csv: sales history for one shop, split from the provided dataset
- shop_XX_inventory_batches.csv: synthetic batch-level stock for one shop

Relationships:
- shop_id references medical_shops.shop_id
- medicine_id references medicine_master.medicine_id
- Each sales row represents a shop/medicine/date quantity.
- Each inventory row represents one stock batch. A medicine can have multiple batches per shop.
- quantity is current batch stock; zero-quantity rows are included for CRUD/low-stock testing.
- expiry_date is batch-specific and generated in the future relative to 2026-10-24.
- Forecasts should be calculated from sales history rather than loaded from a separate forecast CSV.

Note:
The supplied medicine_master.csv contains a product-level expiry_date column with dates in the past.
For inventory tracking, use the generated inventory batch expiry_date column, which is batch-specific.
If the app treats expiry as batch-only, consider removing expiry_date from medicine_master in your database schema.
