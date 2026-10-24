import hashlib
import hmac
import secrets
import sqlite3
import time
import re
from datetime import date, timedelta
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from pathlib import Path
import sys
import json
import os

# Add backend dir to path
BACKEND_DIR = Path(__file__).parent
SHOP_DATABASE_DIRECTORY = BACKEND_DIR / 'data' / 'shop_databases'
sys.path.insert(0, str(BACKEND_DIR))

from MediNexus_Terminal_Forecast import (
    load_data,
    train_models_if_needed,
    load_models,
    find_medicine,
    analyze_medicine,
)

app = FastAPI(title='MediNexus API', version='1.0.0')
bearer_scheme = HTTPBearer(auto_error=False)
LOGIN_PASSWORD = os.environ.get('MEDINEXUS_LOGIN_PASSWORD', 'Test@123')
SESSION_DURATION_SECONDS = 8 * 60 * 60
SHOP_ID_PATTERN = re.compile(r'SHOP_0[1-5]\Z')


class LoginRequest(BaseModel):
    email: str
    password: str

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Global state
state = {}

@app.on_event('startup')
async def startup_event():
    try:
        sales, medicines, shops, inventory = load_data()
        train_models_if_needed(sales)
        central, local_models, metadata = load_models()
        state['sales'] = sales
        state['medicines'] = medicines
        state['shops'] = shops
        state['inventory'] = inventory
        state['central'] = central
        state['local_models'] = local_models
        state['metadata'] = metadata
        users = {}
        for _, row in shops.drop_duplicates(subset=['shop_id']).iterrows():
            shop_id = str(row['shop_id'])
            email = f'{shop_id.lower()}@medinexus.local'
            salt = secrets.token_bytes(16)
            password_hash = hashlib.scrypt(
                LOGIN_PASSWORD.encode('utf-8'),
                salt=salt,
                n=2**14,
                r=8,
                p=1,
            )
            users[email] = {
                'email': email,
                'shop_id': shop_id,
                'shop_name': str(row.get('shop_name', shop_id)),
                'password_salt': salt,
                'password_hash': password_hash,
            }
        state['users'] = users
        state['sessions'] = {}
        print('MediNexus data and models loaded')
    except Exception as e:
        print(f'Error loading: {e}')
        raise

@app.get('/health')
def health():
    return {'status': 'ok', 'loaded': bool(state)}


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is None:
        raise HTTPException(status_code=401, detail='Sign in to continue')

    sessions = state.get('sessions', {})
    session = sessions.get(credentials.credentials)
    if session is None or session['expires_at'] <= time.time():
        sessions.pop(credentials.credentials, None)
        raise HTTPException(status_code=401, detail='Session expired. Please sign in again.')

    return session['user']


@app.post('/login')
def login(request: LoginRequest):
    email = request.email.strip().lower()
    user = state.get('users', {}).get(email)
    if user is None:
        raise HTTPException(status_code=401, detail='Invalid email or password')

    password_hash = hashlib.scrypt(
        request.password.encode('utf-8'),
        salt=user['password_salt'],
        n=2**14,
        r=8,
        p=1,
    )
    if not hmac.compare_digest(password_hash, user['password_hash']):
        raise HTTPException(status_code=401, detail='Invalid email or password')

    access_token = secrets.token_urlsafe(32)
    session_user = {
        'email': user['email'],
        'shop_id': user['shop_id'],
        'shop_name': user['shop_name'],
    }
    state['sessions'][access_token] = {
        'user': session_user,
        'expires_at': time.time() + SESSION_DURATION_SECONDS,
    }
    return {'access_token': access_token, 'token_type': 'bearer', **session_user}


@app.get('/me')
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user


@app.post('/logout')
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is None:
        raise HTTPException(status_code=401, detail='Sign in to continue')
    state.get('sessions', {}).pop(credentials.credentials, None)
    return {'status': 'ok'}


@app.get('/shops')
def get_shops(current_user: dict = Depends(get_current_user)):
    return [{'shop_id': current_user['shop_id'], 'shop_name': current_user['shop_name']}]


def query_shop_database(shop_id: str, query: str, params: tuple = ()):
    if not SHOP_ID_PATTERN.fullmatch(shop_id):
        raise HTTPException(status_code=403, detail='No shop database is assigned to this account')

    database_path = SHOP_DATABASE_DIRECTORY / f'medinexus_{shop_id.lower()}.sqlite3'
    if not database_path.is_file():
        raise HTTPException(
            status_code=503,
            detail=f'The local {shop_id} database has not been created. Import the shop CSV data first.',
        )
    try:
        connection = sqlite3.connect(
            f'file:{database_path.as_posix()}?mode=ro',
            uri=True,
            timeout=5,
        )
        connection.row_factory = sqlite3.Row
        cursor = connection.cursor()
        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]
    except sqlite3.Error as error:
        raise HTTPException(
            status_code=503,
            detail=f'Could not read the local {shop_id} database. Check the schema and re-import its data.',
        ) from error
    finally:
        if 'connection' in locals():
            connection.close()


def get_latest_sale_date(shop_id: str) -> date:
    rows = query_shop_database(
        shop_id,
        'SELECT MAX(sale_date) AS latest_sale_date FROM sales_history',
    )
    latest_sale_date = rows[0]['latest_sale_date']
    if isinstance(latest_sale_date, date):
        return latest_sale_date
    return date.fromisoformat(latest_sale_date) if latest_sale_date else date.today()


@app.get('/dashboard/summary')
def get_dashboard_summary(
    days: int = Query(30, ge=1, le=365),
    current_user: dict = Depends(get_current_user),
):
    latest_sale_date = get_latest_sale_date(current_user['shop_id'])
    start_date = latest_sale_date - timedelta(days=days - 1)
    rows = query_shop_database(
        current_user['shop_id'],
        """
        SELECT
            (SELECT COUNT(*) FROM medicines) AS medicine_count,
            (SELECT COALESCE(SUM(quantity), 0)
             FROM inventory_batches
             WHERE expiry_date >= date('now')) AS available_units,
            (SELECT COUNT(*)
             FROM (
                 SELECT medicine_id
                 FROM inventory_batches
                 WHERE expiry_date >= date('now')
                 GROUP BY medicine_id
                 HAVING SUM(quantity) <= MAX(reorder_level)
             ) AS low_stock) AS low_stock_medicines,
            (SELECT COUNT(*)
             FROM inventory_batches
             WHERE quantity > 0
               AND expiry_date BETWEEN date('now')
                                   AND date('now', '+30 days')) AS expiring_batches,
            (SELECT COALESCE(SUM(quantity), 0)
             FROM sales_history
             WHERE sale_date BETWEEN ? AND ?) AS sales_units,
            (SELECT COALESCE(SUM(quantity * unit_price), 0)
             FROM sales_history
             WHERE sale_date BETWEEN ? AND ?) AS sales_revenue
        """,
        (
            start_date.isoformat(),
            latest_sale_date.isoformat(),
            start_date.isoformat(),
            latest_sale_date.isoformat(),
        ),
    )
    summary = rows[0]
    summary['shop_id'] = current_user['shop_id']
    summary['shop_name'] = current_user['shop_name']
    summary['period_start'] = start_date
    summary['period_end'] = latest_sale_date
    summary['currency'] = 'INR'
    summary['sales_revenue_basis'] = 'sales quantity multiplied by recorded unit price; discounts and returns are not in the source data'
    return summary


@app.get('/dashboard/sales/daily')
def get_daily_sales(
    days: int = Query(30, ge=1, le=365),
    current_user: dict = Depends(get_current_user),
):
    end_date = get_latest_sale_date(current_user['shop_id'])
    start_date = end_date - timedelta(days=days - 1)
    return query_shop_database(
        current_user['shop_id'],
        """
        SELECT
            sale_date,
            SUM(quantity) AS units_sold,
            SUM(quantity * unit_price) AS sales_revenue
        FROM sales_history
        WHERE sale_date BETWEEN ? AND ?
        GROUP BY sale_date
        ORDER BY sale_date
        """,
        (start_date.isoformat(), end_date.isoformat()),
    )


@app.get('/dashboard/sales')
def get_sales_history(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    start_date: date | None = None,
    end_date: date | None = None,
    current_user: dict = Depends(get_current_user),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail='start_date must be on or before end_date')
    if (start_date is None) != (end_date is None):
        raise HTTPException(status_code=422, detail='Provide both start_date and end_date')

    date_filter = ''
    params: tuple = ()
    if start_date and end_date:
        date_filter = 'WHERE s.sale_date BETWEEN ? AND ?'
        params = (start_date.isoformat(), end_date.isoformat())
    params += (limit, offset)
    return query_shop_database(
        current_user['shop_id'],
        f"""
        SELECT
            s.sale_date,
            s.medicine_id,
            m.medicine_name,
            m.category,
            s.quantity AS units_sold,
            s.unit_price,
            s.quantity * s.unit_price AS sales_revenue
        FROM sales_history AS s
        JOIN medicines AS m ON m.medicine_id = s.medicine_id
        {date_filter}
        ORDER BY s.sale_date DESC, m.medicine_name
        LIMIT ? OFFSET ?
        """,
        params,
    )


@app.get('/dashboard/inventory')
def get_inventory(
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    return query_shop_database(
        current_user['shop_id'],
        """
        SELECT
            i.batch_id,
            i.batch_number,
            i.medicine_id,
            m.medicine_name,
            m.category,
            i.quantity,
            i.purchase_date,
            i.expiry_date,
            i.unit_cost,
            i.selling_price,
            i.reorder_level,
            i.supplier,
            CASE
                WHEN i.expiry_date < date('now') THEN 'EXPIRED'
                WHEN i.quantity = 0 THEN 'OUT OF STOCK'
                WHEN COALESCE(stock.available_quantity, 0) = 0 THEN 'OUT OF STOCK'
                WHEN stock.available_quantity <= stock.reorder_level THEN 'LOW STOCK'
                ELSE 'IN STOCK'
            END AS stock_status,
            COALESCE(stock.available_quantity, 0) AS medicine_available_quantity
        FROM inventory_batches AS i
        JOIN medicines AS m ON m.medicine_id = i.medicine_id
        LEFT JOIN (
            SELECT
                medicine_id,
                SUM(CASE WHEN expiry_date >= date('now') THEN quantity ELSE 0 END) AS available_quantity,
                MAX(reorder_level) AS reorder_level
            FROM inventory_batches
            GROUP BY medicine_id
        ) AS stock ON stock.medicine_id = i.medicine_id
        ORDER BY
            CASE WHEN i.expiry_date < date('now') THEN 0 ELSE 1 END,
            i.expiry_date,
            m.medicine_name
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    )


@app.get('/medicines')
def get_medicines(
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    return query_shop_database(
        current_user['shop_id'],
        """
        SELECT medicine_id, medicine_name, category
        FROM medicines
        ORDER BY medicine_name
        LIMIT ?
        """,
        (limit,),
    )

@app.get('/forecast')
def get_forecast(
    medicine_query: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        medicines = state['medicines']
        sales = state['sales']
        inventory = state['inventory']
        local_models = state['local_models']
        central = state['central']
        
        medicine_row = find_medicine(medicines, medicine_query)
        if medicine_row is None:
            raise HTTPException(status_code=404, detail='Medicine not found')
        
        result = analyze_medicine(
            medicines,
            sales,
            inventory,
            current_user['shop_id'],
            medicine_row,
            local_models,
            central,
        )
        
        # Convert forecast table to serializable format
        forecast_df = result['forecast_table']
        forecast_list = []
        for _, row in forecast_df.iterrows():
            forecast_list.append({
                'date': row['date'].strftime('%Y-%m-%d'),
                'forecast_units': float(round(row['forecast_units'], 2))
            })
        
        # Convert inventory batches
        inv_df = result['inventory']
        batches = []
        if not inv_df.empty:
            inv_sorted = inv_df.sort_values('expiry_date')
            for _, row in inv_sorted.head(10).iterrows():
                batches.append({
                    'batch_id': str(row.get('batch_id', '')),
                    'current_stock': float(row.get('current_stock', 0)),
                    'expiry_date': row['expiry_date'].strftime('%Y-%m-%d') if hasattr(row['expiry_date'], 'strftime') else str(row['expiry_date']),
                    'days_to_expiry': int(row.get('days_to_expiry', 0))
                })
        
        return {
            'medicine_id': result['medicine_id'],
            'medicine_name': result['medicine_name'],
            'category': result['category'],
            'shop_id': result['shop_id'],
            'model': result['model'],
            'sales_history_through': result['sales_history_through'],
            'current_stock': float(result['current_stock']),
            'forecast_30d': float(round(result['forecast_30d'], 1)),
            'avg_daily_demand': float(round(result['avg_daily_demand'], 2)),
            'nearest_expiry_days': int(result['nearest_expiry_days']),
            'forecast_before_expiry': float(round(result['forecast_before_expiry'], 1)),
            'potential_excess': float(round(result['potential_excess'], 1)),
            'expiry_risk': result['expiry_risk'],
            'stockout_risk': result['stockout_risk'],
            'recommended_purchase': int(result['recommended_purchase']),
            'recommendation': result['recommendation'],
            'forecast': forecast_list,
            'batches': batches
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
