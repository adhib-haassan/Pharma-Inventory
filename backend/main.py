import hashlib
import hmac
import secrets
import time
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
sys.path.insert(0, str(BACKEND_DIR))

from MediNexus_Terminal_Forecast import (
    load_data,
    train_models_if_needed,
    load_models,
    get_medicine_options,
    find_medicine,
    analyze_medicine,
)

app = FastAPI(title='MediNexus API', version='1.0.0')
bearer_scheme = HTTPBearer(auto_error=False)
LOGIN_PASSWORD = os.environ.get('MEDINEXUS_LOGIN_PASSWORD', 'Test@123')
SESSION_DURATION_SECONDS = 8 * 60 * 60


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

@app.get('/medicines')
def get_medicines(
    limit: int = Query(100, ge=1, le=500),
    _: dict = Depends(get_current_user),
):
    medicines = state['medicines']
    opts = get_medicine_options(medicines).head(limit)
    result = []
    for _, row in opts.iterrows():
        result.append({
            'medicine_id': str(row.get('medicine_id', '')),
            'medicine_name': str(row.get('medicine_name', row.get('medicine_id', ''))),
            'category': str(row.get('category', 'N/A'))
        })
    return result

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
