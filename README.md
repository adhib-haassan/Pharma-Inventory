# MediNexus

MediNexus is a research prototype for exploring daily medicine-demand forecasting and inventory planning across five simulated medical shops. It includes a Jupyter notebook for data analysis and model evaluation, and a command line application for selecting a shop and medicine and viewing a 30-day forecast.

For step-by-step instructions to install and run the web application after cloning, see [INSTALLATION.md](INSTALLATION.md).

## Contents

- `MediNexus_Terminal_Forecast.py`: interactive command-line forecast application.
- `notebooks/MediNexus_Phase1_Federated_Learning.ipynb`: exploratory analysis, training, evaluation, forecast, and inventory-analysis notebook.
- `data/medicine_master.csv`: medicine catalog with IDs, names, categories, manufacturers, prices, and catalog expiry fields.
- `data/medical_shops.csv`: five simulated shop IDs and profiles.
- `data/synthetic_shop_sales_2024_2025.csv`: synthetic daily sales by date, shop, and medicine from 2024-01-01 through 2025-12-31.
- `data/synthetic_shop_inventory_batches.csv`: synthetic medicine batch records, opening stock, purchase quantity, and expiry date.
- `data/raw_kaggle_data.js`: source catalog file supplied with the project.
- `models/`: serialized trained models and model metadata.
- `results/`: generated forecasts, comparison metrics, FEFO, expiry-risk, and purchase-recommendation reports.
- `dataset_summary.csv`: summary of the packaged experiment data.
- `notebook_execution_report.json`: status note for the included notebook run.

## Requirements

- Windows 10/11, macOS, or Linux.
- Python 3.10 to 3.13 recommended. Use a 64-bit Python installation.
- Internet access for the first dependency installation.
- Approximately 2 GB or more of free memory is recommended for notebook training. Pretrained model files are included, so running the CLI normally does not require retraining.

Python packages are listed in `backend/requirements.txt`. It contains the application packages and the extra notebook dependencies.

| Package | Used for |
| --- | --- |
| `numpy` | Numeric operations and forecast calculations |
| `pandas` | Reading CSV data, feature engineering, and reports |
| `joblib` | Loading and saving trained models |
| `xgboost` | Demand regression models |
| `matplotlib` | Notebook charts |
| `scikit-learn` | Notebook evaluation metrics |
| `jupyter` | Running the notebook locally |

## Run the web application

Follow [INSTALLATION.md](INSTALLATION.md) for the complete setup, including
Python and Node.js prerequisites, local SQLite database creation, environment
configuration, and starting the backend and frontend in separate terminals.
For production, configure persistent authentication and deployment-specific
settings; the demo app uses in-memory sessions.

## Store shop data in local databases

No database server is required. Python's built-in SQLite support stores the shop data in local files under `backend/data/shop_databases/`. The importer creates one database file per shop (`medinexus_shop_01.sqlite3` through `medinexus_shop_05.sqlite3`), each with the same normalized tables:

- `shop_profile`: the local shop identity.
- `medicines`: the shop's medicine catalog.
- `sales_history`: daily sales quantities by date and medicine.
- `inventory_batches`: current quantity and expiry details for each batch.

The medicine catalog is copied into each database so shops can operate independently. Each sales row stores the sale-time unit price as well as units sold, so later catalog price changes do not rewrite historical revenue. The CSV has no discount or return fields, so dashboard sales revenue is an estimate of units sold multiplied by the recorded unit price, not accounting net revenue. Batch expiry dates are the source of inventory expiry information; the medicine catalog's older `expiry_date` is retained only as `catalog_expiry_date`.

Validate all CSVs, then create/populate the local database files:

```powershell
python backend\scripts\import_shop_csvs_to_sqlite.py --validate-only
python backend\scripts\import_shop_csvs_to_sqlite.py
```

To import just one shop, pass `--shop SHOP_01`. An import into an already populated database fails rather than overwriting data. To deliberately replace all existing rows for the selected shop or shops with the CSV contents, pass `--replace`. The importer upgrades an older database schema to add sale-time prices; reloading that shop's CSV data after the upgrade requires `--replace`. The schema is in `backend/database/schema.sql`.

The authenticated API uses the signed-in account's shop ID to select that shop's database file; clients cannot request another shop's data by changing a query parameter. Start the API as usual; no database credentials or server variables are needed:

```powershell
cd backend
python -m uvicorn main:app --reload --port 8000
```

The API routes are:

- `GET /dashboard/summary`: catalog and available-stock counts, low-stock/expiring batch counts, and total batch count.
- `GET /dashboard/sales/daily?days=30`: optional daily sales aggregates for future sales views.
- `GET /dashboard/sales?limit=100&offset=0`: optional paginated sale history API. Optional `start_date` and `end_date` must be supplied together in `YYYY-MM-DD` format.
- `GET /dashboard/inventory?limit=200&offset=0`: batch stock, expiry, supplier, and stock status.
- `POST /dashboard/chat`: stream an inventory-grounded chatbot response for the signed-in shop.
- `POST /forecast/pdf`: create a PDF of the current forecast for download.
- `POST /forecast/email`: email the current forecast PDF to a validated recipient using configured SMTP.
- `POST /dashboard/inventory`: add a supply batch to the signed-in shop's database.
- `PUT /dashboard/inventory/{batch_id}`: update a batch in the signed-in shop's database.
- `DELETE /dashboard/inventory/{batch_id}`: delete a batch from the signed-in shop's database.

Inventory changes are validated and saved only to the signed-in shop's local SQLite database. The Dashboard focuses on stock levels and expiring/low-stock items, with a paginated inventory table and controls to add, edit, or delete batches. Forecasting is a separate sidebar section and continues to use the project's forecasting CSV/model pipeline for demand history, while using current batch inventory from the shop database.


## Run the notebook

### Locally

With the virtual environment active and requirements installed, start Jupyter:

```powershell
jupyter notebook
```

Open `notebooks/MediNexus_Phase1_Federated_Learning.ipynb` in the browser and run the cells from top to bottom. If using VS Code, install the Microsoft Python and Jupyter extensions, open the notebook, select the `.venv` Python kernel, and run all cells.

The notebook expects `data/`, `models/`, and `results/` relative to the project directory. If a notebook is opened with a different working directory, set the working directory to the project root or adjust the notebook's `BASE` path logic.

### Google Colab

Upload the notebook and the project data files to the Colab session, keeping the `data/` directory next to the notebook's expected project root. The notebook's first code cell installs `xgboost` and `joblib`; Colab commonly supplies the remaining scientific Python packages. If a package import fails, install the missing package in a notebook cell with `%pip install package-name`, then restart the runtime if requested.

## Data formats

The application expects these files in `data/`:

- `medicine_master.csv`: must include `medicine_id` and `medicine_name`; `category` is displayed when present.
- `medical_shops.csv`: must include `shop_id`; `shop_name` is displayed when present.
- `synthetic_shop_sales_2024_2025.csv`: must include `date`, `shop_id`, `medicine_id`, and `sales_quantity`. There should be daily records for each shop/medicine pair for dependable feature generation.
- `synthetic_shop_inventory_batches.csv`: must include `shop_id`, `medicine_id`, `opening_stock`, and `expiry_date`. Optional batch identifiers are shown in the FEFO table. The CLI treats `opening_stock` as the available batch quantity when no explicit `current_stock` field exists; `purchase_quantity` is not added to stock because it does not indicate how many purchased units remain.

The medicine catalog's `expiry_date` values are separate from the inventory batch expiry dates. Batch expiry dates are used for the CLI's FEFO and expiry calculations.

If you replace the sample CSVs with shop data, preserve the column names or update the corresponding file-loading and calculation logic. Use data that you are authorized to process, remove personal/customer identifiers, and follow applicable privacy, pharmacy, and data-retention requirements.

## Models and results

The project includes serialized models under `models/`. The CLI prefers a local model for the selected shop and falls back to a centralized model where available. If the expected trained models are absent, the script trains models from the supplied sales CSV; that first training run can take several minutes.

The CLI's model discovery checks for existing notebook-generated model files. Replacing the sales CSV does **not** automatically retrain those existing models. To refresh the models after changing sales data, execute the notebook's training cells and save the resulting models, or move the old model artifacts out of `models/` before launching the CLI so its automatic training path can run. Keep a backup before moving or replacing model files.

The notebook generates or updates files in `results/`, including:

- `30_day_demand_forecast.csv`
- `model_comparison.csv`
- `federated_round_metrics.csv`
- `expiry_wastage_stockout_analysis.csv`
- `purchase_recommendations.csv`
- `fefo_batch_priority.csv`

These CSVs are experiment outputs. The files already present in the project may reflect an earlier notebook run and are not refreshed just by launching the CLI.

## Forecast and federated-learning notes

- Daily forecasts are estimates, not guaranteed sales. The current terminal forecast combines XGBoost estimates with recent weekday averages to reduce recursive forecast collapse.
- The forecast horizon begins on the current date. This changes the dates displayed; it does not make old sales or stock records current.
- The notebook demonstrates a weighted prediction ensemble over local XGBoost models. It is a FedAvg-style demonstration, not parameter-level federated averaging of XGBoost trees and not a production privacy guarantee.
- Because the supplied sales history is synthetic and ends in 2025, the sample predictions and purchase recommendations are for demonstrating the workflow only.

## Concept and problem

A medical shop needs to decide how much of each medicine to keep on hand. Too little stock can lead to shortages; too much can tie up cash and increase expiry-related waste. Daily demand varies by product, shop, weekday, and season, so a fixed reorder quantity may not fit every medicine or location.

MediNexus demonstrates a data workflow for this planning problem. It estimates daily demand for a selected shop and medicine, sums those daily estimates over 30 days, and compares the result with batch-level stock and expiry dates. The output is intended to support a human review of inventory, not to make purchasing or clinical decisions automatically.

The prototype has two related paths:

- **Notebook experiment:** prepares historical features, trains and evaluates centralized and shop-local XGBoost regressors, builds a weighted prediction ensemble, and writes forecast and inventory analysis CSVs.
- **Terminal application:** loads the packaged data and saved models, forecasts a selected shop/medicine for the next 30 calendar days, then displays demand and batch-inventory indicators.

## End-to-end flow

1. **Load the catalog and shop data.** Medicine IDs and shop IDs provide stable keys to join sales and inventory records.
2. **Load daily sales.** Each training example represents a shop/medicine/date row, with `sales_quantity` as the target to predict.
3. **Prepare time-series features.** Rows are sorted by shop, medicine, and date. Lag and rolling features are computed separately for each shop/medicine pair to avoid mixing one shop's demand with another's.
4. **Split by time.** The notebook reserves the latest 90 days as a holdout test period; earlier rows are used for training. This tests on later dates instead of randomly mixing future rows into training.
5. **Train models.** A centralized benchmark trains on pooled training rows. Local models train on each shop's training partition.
6. **Aggregate and evaluate.** The federated-style demonstration combines predictions from local models using weights based on each shop's number of training rows. The predictions are compared with local and centralized models.
7. **Forecast future demand.** The notebook produces a 30-day forecast using the ensemble. The CLI instead uses the selected shop's local model where available, blends the per-day model estimate with recent mean sales for the same weekday, and anchors the displayed horizon to the current date.
8. **Assess stock and expiry.** Available, unexpired batch stock is compared with forecast demand. The app shows the nearest unexpired batch expiry and a FEFO-sorted batch view.
9. **Show a planning recommendation.** Forecast demand, a small safety-stock allowance, current usable stock, and expiry risk feed a suggested purchase amount and explanation.

## Forecasting and training concepts

### Prediction target

The supervised-learning target is `sales_quantity`: the number of units recorded as sold for a particular medicine at a particular shop on a particular date. The model predicts a numeric value, so this is a regression problem. The code clips negative predictions to zero because negative sales are not meaningful for inventory demand.

### Time-series features

The feature set combines recent demand with calendar information:

- **Identifiers:** encoded `shop_code` and `medicine_code` let the model learn systematic differences between shops and products.
- **Calendar features:** day of week, month, ISO week of year, quarter, and weekend indicator represent recurring weekly and seasonal patterns.
- **Lag features:** `lag_1`, `lag_7`, `lag_14`, and `lag_30` provide past demand at selected offsets.
- **Rolling features:** 7-day and 30-day means and standard deviations summarize recent demand level and variability. These are calculated from prior observations, not the target row itself.

For example, lag-7 captures demand from approximately the same weekday one week earlier. Rolling means smooth day-to-day noise; rolling standard deviations provide a measure of how variable recent demand has been. These signals help the regressor use recent history as well as calendar context.

### XGBoost regression

XGBoost builds an ensemble of decision trees. Each additional tree is fitted to reduce the errors of the trees already built. It can learn nonlinear interactions, such as a medicine having different weekend patterns from another medicine, without requiring the relationships to be specified as linear equations. The notebook uses squared-error regression and evaluates predictions on held-out dates.

The notebook's evaluation metrics are:

- **MAE (Mean Absolute Error):** average absolute difference between predicted and observed units; lower is better and is directly measured in units sold.
- **RMSE (Root Mean Squared Error):** square root of mean squared error; lower is better and larger misses receive more penalty.
- **R-squared (`R2`):** the proportion of target variation explained relative to a mean baseline; closer to 1 is generally better, while a negative value can indicate performance worse than that baseline.

Metrics are only meaningful relative to the data split and dataset. Good results on the synthetic holdout do not establish accuracy on real shops or future periods.

## Federated-learning concept in this prototype

Federated learning is a family of approaches in which multiple data owners train collaboratively while avoiding the routine central collection of their raw training data. In a common FedAvg setup for neural networks, clients train model parameters locally and a coordinator averages compatible parameter tensors.

This project uses **local XGBoost models and weighted prediction aggregation**, not that parameter-averaging procedure:

1. Sales rows are partitioned by `shop_id` into local client datasets.
2. Each shop trains its own XGBoost model on its local training rows.
3. For a shared evaluation row, each local model generates a prediction.
4. The predictions are combined with a weighted sum. A shop's weight is its share of training rows, so `global_prediction = sum(shop_weight * shop_prediction)` and all shop weights sum to 1.
5. The resulting ensemble is evaluated against observed test demand.

This allows the notebook to compare local, centralized, and combined prediction behavior while keeping the federated-learning explanation honest about tree models. The notebook's demonstration rounds retrain local models and recompute the weighted predictions; they do not average XGBoost tree structures or neural-network parameters. Also, this packaged notebook is an experiment and is not a security-hardened federated system: it does not implement secure aggregation, differential privacy, authenticated clients, or networked client/server deployment.

## Inventory decision concepts

The forecasting layer estimates demand; a separate deterministic layer turns it into inventory indicators:

- **30-day demand:** sum of the 30 daily demand estimates.
- **Usable stock:** sum of batch quantities whose expiry date has not passed, based on the current forecast start. In the bundled inventory file, `opening_stock` is used as available stock because the data does not record remaining stock after the listed purchases. `purchase_quantity` is not assumed to still be on hand.
- **Demand before expiry:** portion of the forecast horizon that falls before the nearest usable batch expiry. The terminal app sums the daily forecast through that point, up to 30 days.
- **Potential excess:** usable stock minus estimated demand before expiry, floored at zero. This is a rough risk indicator, not an expiry prediction.
- **FEFO:** First-Expire-First-Out sorts batches by expiry date so earlier-expiring batches can be reviewed first, subject to applicable pharmacy rules.
- **Stockout and expiry-risk labels:** rule-based categories comparing forecast demand, usable stock, excess stock, and expiry timing. They are heuristics, not probabilities.
- **Purchase quantity:** the CLI adds a modest safety-stock allowance to 30-day demand, subtracts usable stock, and floors the result at zero. A high expiry-risk result suppresses a new purchase recommendation.

Inventory calculations are only as accurate as the inventory snapshot. For operational use, batch records should contain actual current quantities and authoritative expiry dates; `opening_stock` from a synthetic dataset is not a live on-hand count.
