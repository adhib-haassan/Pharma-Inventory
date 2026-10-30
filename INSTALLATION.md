# MediNexus Installation and Run Guide

This guide explains how to set up and run the web application on Windows. The
application has a React/Vite frontend, a FastAPI backend, and local SQLite
databases for shop inventory. No database server is needed.

## 1. Install prerequisites

Install the following:

- **64-bit Python 3.10-3.13**, with the Python Launcher enabled. Check it in
  PowerShell with `py --version`.
- **Node.js 20.19 or newer, or 22.12 or newer** (npm is included). Check with
  `node --version` and `npm --version`.

Open PowerShell in the project folder (the folder containing `backend` and
`frontend`). The following commands assume that folder is the current directory.

## 2. Create and activate the Python environment

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
```

If PowerShell prevents environment activation, either allow scripts for the
current PowerShell session with
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, then activate
again, or call the environment's Python directly:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

If Python 3.13 is not installed, replace `-3.13` with an installed supported
version, such as `-3.12`.

## 3. Create and fill in the `.env` file

The backend reads a file named `.env` from the project folder. Create your
local copy of the example file from PowerShell:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Then open `.env` in a text editor, such as Visual Studio Code:

```powershell
code .env
```

If the `code` command is unavailable, open the project folder in VS Code and
select the `.env` file in the Explorer. Edit the values to the right of `=`.
Keep the `NAME=value` format: do not remove the variable names, and do not add
spaces around `=`. Leave an optional value blank if you do not use that feature.

| Variable | What to enter |
| --- | --- |
| `MEDINEXUS_LOGIN_PASSWORD` | Optional replacement for the shared demo login password. Leave blank to use `Test@123`. |
| `GROQ_API_KEY` | Optional API key from your Groq account. Needed only for the AI inventory chatbot. |
| `SMTP_HOST` | Optional SMTP server hostname from your email provider. Needed to email forecast reports. |
| `SMTP_PORT` | SMTP port from your provider. Keep `587` for STARTTLS, or use `465` if the provider requires implicit SSL. |
| `SMTP_USERNAME` | Optional SMTP account username, usually provided by your email provider. |
| `SMTP_PASSWORD` | Optional SMTP account password or app-specific password. |
| `SMTP_FROM_EMAIL` | Email address configured as the sender with your SMTP provider. |
| `SMTP_USE_SSL` | Use `false` with port `587` (STARTTLS), or `true` with port `465` (implicit SSL). |

For example, the default template should look like this before you add any
optional credentials:

```dotenv
MEDINEXUS_LOGIN_PASSWORD=
GROQ_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_USE_SSL=false
```

Save the file. The dashboard, forecasting, and demo sign-in work without Groq
or SMTP settings; those integrations will be unavailable until configured.
Never share `.env` because it can contain passwords and API keys.

If you change `MEDINEXUS_LOGIN_PASSWORD` later, use that password when signing
in. Otherwise the demo password is `Test@123`.

## 4. Validate and import the sample shop data

The web dashboard reads each shop's data from a local SQLite file. Validate
the packaged CSV files and create the five shop databases from the project
root:

```powershell
python backend\scripts\import_shop_csvs_to_sqlite.py --validate-only
python backend\scripts\import_shop_csvs_to_sqlite.py
```

The generated files are placed in `backend\data\shop_databases\`. The import
command does not overwrite an existing populated database; use `--replace` only
when you intentionally want to replace its data.

## 5. Start the backend API

Keep the Python environment active. In the first PowerShell window:

```powershell
cd backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Leave this window running. Check that the API started by opening
`http://localhost:8000/health`; a healthy response includes
`"status": "ok"`. Interactive API documentation is available at
`http://localhost:8000/docs`.

If model files are missing, the backend may train them from the included sample
sales data at startup. The initial start can then take several minutes.

## 6. Start the frontend

Open a second PowerShell window and navigate to the project root, then install
the locked Node dependencies:

```powershell
cd frontend
npm ci
npm run dev
```

Open the local address printed by Vite, normally
`http://localhost:5173`. Keep this terminal running while using the app.

## 7. Sign in

Choose a shop account. For example:

| Shop | Email |
| --- | --- |
| SHOP_01 | `shop_01@medinexus.local` |
| SHOP_02 | `shop_02@medinexus.local` |
| SHOP_03 | `shop_03@medinexus.local` |
| SHOP_04 | `shop_04@medinexus.local` |
| SHOP_05 | `shop_05@medinexus.local` |

The default demo password is `Test@123`, unless it was changed with
`MEDINEXUS_LOGIN_PASSWORD` in `.env`. The `.local` addresses are demo login
names, not email inboxes.

## Optional: run the terminal forecasting demo

With the Python environment activated, run this from the project root:

```powershell
python backend\MediNexus_Terminal_Forecast.py
```

Follow the menu to choose a shop and medicine. Model training can take several
minutes if pretrained model files are not present.

## Troubleshooting

- **`py` is not recognized:** install Python from
  [python.org](https://www.python.org/downloads/) and enable the Python
  Launcher, then reopen PowerShell.
- **`npm` is not recognized or Vite reports an unsupported Node version:**
  install a supported Node.js version and reopen the terminal.
- **The dashboard reports that a shop database is missing:** rerun the CSV
  validation and import commands in step 5 from the project root.
- **The frontend cannot reach the API:** make sure the backend terminal is
  still running on port 8000 and that the health URL responds.
- **AI chat or email features are unavailable:** configure the corresponding
  optional values in the root `.env` file and restart the backend.
