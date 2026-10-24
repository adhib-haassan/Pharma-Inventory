import { useState, useEffect, type FormEvent } from 'react'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity, Package, AlertTriangle, ShoppingCart, Calendar, LogOut } from 'lucide-react'

const API_BASE = 'http://localhost:8000'

interface AuthenticatedUser {
  email: string
  shop_id: string
  shop_name: string
}

interface Medicine {
  medicine_id: string
  medicine_name: string
  category: string
}

interface ForecastPoint {
  date: string
  forecast_units: number
}

interface Batch {
  batch_id: string
  current_stock: number
  expiry_date: string
  days_to_expiry: number
}

interface ForecastResult {
  medicine_id: string
  medicine_name: string
  category: string
  shop_id: string
  model: string
  sales_history_through: string
  current_stock: number
  forecast_30d: number
  avg_daily_demand: number
  nearest_expiry_days: number
  forecast_before_expiry: number
  potential_excess: number
  expiry_risk: string
  stockout_risk: string
  recommended_purchase: number
  recommendation: string
  forecast: ForecastPoint[]
  batches: Batch[]
}

function App() {
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem('medinexus_access_token'))
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [medicines, setMedicines] = useState<Medicine[]>([])
  const [medicineQuery, setMedicineQuery] = useState('')
  const [medicinesLoading, setMedicinesLoading] = useState(false)
  const [medicinesError, setMedicinesError] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ForecastResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!accessToken) {
      setAuthChecking(false)
      return
    }

    axios.get<AuthenticatedUser>(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    }).then(res => {
      setUser(res.data)
    }).catch(e => {
      console.error(e)
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        localStorage.removeItem('medinexus_access_token')
        setAccessToken(null)
        setLoginError('Your session expired. Please sign in again.')
      } else {
        setLoginError('Could not verify your sign-in. Check that the Python API is running, then sign in again.')
      }
    }).finally(() => {
      setAuthChecking(false)
    })
  }, [])

  useEffect(() => {
    if (user && accessToken) fetchMedicines(accessToken)
  }, [user, accessToken])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    try {
      const res = await axios.post(`${API_BASE}/login`, { email, password })
      localStorage.setItem('medinexus_access_token', res.data.access_token)
      setAccessToken(res.data.access_token)
      setUser({
        email: res.data.email,
        shop_id: res.data.shop_id,
        shop_name: res.data.shop_name,
      })
      setMedicineQuery('')
      setResult(null)
    } catch (e: any) {
      setLoginError(e.response?.data?.detail || 'Could not sign in. Check that the Python API is running.')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = async () => {
    if (accessToken) {
      try {
        await axios.post(`${API_BASE}/logout`, null, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
      } catch (e) {
        console.error(e)
      }
    }
    localStorage.removeItem('medinexus_access_token')
    setAccessToken(null)
    setUser(null)
    setMedicines([])
    setMedicineQuery('')
    setResult(null)
    setError('')
  }

  const fetchMedicines = async (token: string) => {
    setMedicinesLoading(true)
    setMedicinesError('')
    try {
      const res = await axios.get(`${API_BASE}/medicines?limit=500`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setMedicines(res.data)
    } catch (e) {
      console.error(e)
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        localStorage.removeItem('medinexus_access_token')
        setAccessToken(null)
        setUser(null)
        setLoginError('Your session expired. Please sign in again.')
        return
      }
      setMedicinesError('Could not load medicines. Check that the Python API is running, then refresh.')
    } finally {
      setMedicinesLoading(false)
    }
  }

  const handleForecast = async () => {
    if (!medicineQuery || !accessToken) {
      setError('Please select a medicine')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await axios.get(`${API_BASE}/forecast`, {
        params: { medicine_query: medicineQuery },
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      setResult(res.data)
    } catch (e: any) {
      if (e.response?.status === 401) {
        await handleLogout()
        setLoginError('Your session expired. Please sign in again.')
        return
      }
      setError(e.response?.data?.detail || 'Failed to get forecast')
    } finally {
      setLoading(false)
    }
  }

  const getRiskColor = (risk: string) => {
    if (risk === 'HIGH') return 'text-red-600 bg-red-50'
    if (risk === 'MEDIUM') return 'text-yellow-600 bg-yellow-50'
    return 'text-green-600 bg-green-50'
  }

  if (authChecking) {
    return <div className='min-h-screen flex items-center justify-center text-gray-600'>Checking your session...</div>
  }

  if (!user || !accessToken) {
    return (
      <div className='min-h-screen bg-gray-50'>
        <header className='bg-white shadow-sm border-b'>
          <div className='max-w-7xl mx-auto px-4 py-6'>
            <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2'>
              <Activity className='w-8 h-8 text-blue-600' />
              MediNexus - Demand Forecast & Prediction
            </h1>
            <p className='text-gray-600 mt-1'>Sign in to view your shop's inventory forecasts</p>
          </div>
        </header>
        <main className='max-w-md mx-auto px-4 py-12'>
          <form onSubmit={handleLogin} className='bg-white rounded-lg shadow-sm p-6'>
            <h2 className='text-xl font-semibold mb-5'>Sign in</h2>
            <label htmlFor='email' className='block text-sm font-medium text-gray-700 mb-2'>Email</label>
            <input
              id='email'
              type='email'
              autoComplete='username'
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4'
            />
            <label htmlFor='password' className='block text-sm font-medium text-gray-700 mb-2'>Password</label>
            <input
              id='password'
              type='password'
              autoComplete='current-password'
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            {loginError && <p role='alert' className='mt-3 text-red-600 text-sm'>{loginError}</p>}
            <button
              type='submit'
              disabled={loginLoading}
              className='mt-5 w-full px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
            >
              {loginLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </main>
      </div>
    )
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <header className='bg-white shadow-sm border-b'>
        <div className='max-w-7xl mx-auto px-4 py-5 flex flex-wrap items-center justify-between gap-4'>
          <div>
            <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2'>
              <Activity className='w-8 h-8 text-blue-600' />
              MediNexus - Demand Forecast & Prediction
            </h1>
            <p className='text-gray-600 mt-1'>Phase 1: Federated Learning for Medical-Shop Demand Forecasting</p>
          </div>
          <div className='flex items-center gap-4'>
            <div className='text-right'>
              <p className='font-medium text-gray-900'>{user.shop_name}</p>
              <p className='text-sm text-gray-600'>{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className='inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50'
            >
              <LogOut className='w-4 h-4' />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className='max-w-7xl mx-auto px-4 py-6'>
        <div className='bg-white rounded-lg shadow-sm p-6 mb-6'>
          <h2 className='text-xl font-semibold mb-4 flex items-center gap-2'>
            <Package className='w-5 h-5' />
            Forecast Configuration
          </h2>
          <div className='grid grid-cols-1 gap-4'>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-2'>Medicine</label>
              <select
                value={medicineQuery}
                onChange={(e) => setMedicineQuery(e.target.value)}
                disabled={medicinesLoading || medicines.length === 0}
                className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
              >
                <option value=''>
                  {medicinesLoading ? 'Loading medicines...' : medicines.length === 0 ? 'No medicines available' : 'Select a medicine'}
                </option>
                {medicines.map(medicine => (
                  <option key={medicine.medicine_id} value={medicine.medicine_id}>
                    {medicine.medicine_name} ({medicine.medicine_id})
                  </option>
                ))}
              </select>
              {medicinesError && <p className='mt-2 text-red-600 text-sm'>{medicinesError}</p>}
            </div>
          </div>
          <button
            onClick={handleForecast}
            disabled={loading}
            className='mt-4 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {loading ? 'Generating Forecast...' : 'Generate Forecast'}
          </button>
          {error && <p className='mt-2 text-red-600 text-sm'>{error}</p>}
        </div>

        {result && (
          <>
            <div className='bg-white rounded-lg shadow-sm p-6 mb-6'>
              <h2 className='text-xl font-semibold mb-4'>{result.medicine_name} ({result.medicine_id})</h2>
              <div className='grid grid-cols-2 md:grid-cols-4 gap-4 text-sm'>
                <div><span className='text-gray-600'>Category:</span> <span className='font-medium'>{result.category}</span></div>
                <div><span className='text-gray-600'>Shop:</span> <span className='font-medium'>{result.shop_id}</span></div>
                <div><span className='text-gray-600'>Model:</span> <span className='font-medium'>{result.model}</span></div>
                <div><span className='text-gray-600'>Data Through:</span> <span className='font-medium'>{result.sales_history_through}</span></div>
              </div>
            </div>

            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6'>
              <div className='bg-white rounded-lg shadow-sm p-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-sm text-gray-600'>Current Stock</p>
                    <p className='text-2xl font-bold'>{result.current_stock.toFixed(0)}</p>
                  </div>
                  <Package className='w-8 h-8 text-blue-600' />
                </div>
              </div>
              <div className='bg-white rounded-lg shadow-sm p-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-sm text-gray-600'>30-Day Forecast</p>
                    <p className='text-2xl font-bold'>{result.forecast_30d.toFixed(1)}</p>
                    <p className='text-xs text-gray-500'>{result.avg_daily_demand.toFixed(2)} / day</p>
                  </div>
                  <Activity className='w-8 h-8 text-green-600' />
                </div>
              </div>
              <div className='bg-white rounded-lg shadow-sm p-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-sm text-gray-600'>Stockout Risk</p>
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold mt-1 ${getRiskColor(result.stockout_risk)}`}>
                      {result.stockout_risk}
                    </span>
                  </div>
                  <AlertTriangle className='w-8 h-8 text-yellow-600' />
                </div>
              </div>
              <div className='bg-white rounded-lg shadow-sm p-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-sm text-gray-600'>Expiry Risk</p>
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold mt-1 ${getRiskColor(result.expiry_risk)}`}>
                      {result.expiry_risk}
                    </span>
                  </div>
                  <Calendar className='w-8 h-8 text-orange-600' />
                </div>
              </div>
            </div>

            <div className='bg-white rounded-lg shadow-sm p-6 mb-6'>
              <h2 className='text-xl font-semibold mb-4 flex items-center gap-2'>
                <ShoppingCart className='w-5 h-5' />
                Purchase Recommendation
              </h2>
              <div className='grid grid-cols-1 md:grid-cols-3 gap-4 mb-4'>
                <div>
                  <p className='text-sm text-gray-600'>Recommended Purchase</p>
                  <p className='text-3xl font-bold text-blue-600'>{result.recommended_purchase} units</p>
                </div>
                <div>
                  <p className='text-sm text-gray-600'>Nearest Expiry</p>
                  <p className='text-2xl font-bold'>{result.nearest_expiry_days} days</p>
                </div>
                <div>
                  <p className='text-sm text-gray-600'>Potential Excess</p>
                  <p className='text-2xl font-bold'>{result.potential_excess.toFixed(1)} units</p>
                </div>
              </div>
              <div className='bg-blue-50 border-l-4 border-blue-400 p-4'>
                <p className='text-sm text-blue-800'>{result.recommendation}</p>
              </div>
            </div>

            <div className='bg-white rounded-lg shadow-sm p-6 mb-6'>
              <h2 className='text-xl font-semibold mb-4'>30-Day Demand Forecast</h2>
              <ResponsiveContainer width='100%' height={300}>
                <LineChart data={result.forecast}>
                  <CartesianGrid strokeDasharray='3 3' />
                  <XAxis dataKey='date' tick={{ fontSize: 12 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type='monotone' dataKey='forecast_units' stroke='#2563eb' strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className='bg-white rounded-lg shadow-sm p-6'>
              <h2 className='text-xl font-semibold mb-4'>FEFO Batch View (Earliest Expiry First)</h2>
              {result.batches.length > 0 ? (
                <div className='overflow-x-auto'>
                  <table className='min-w-full divide-y divide-gray-200'>
                    <thead className='bg-gray-50'>
                      <tr>
                        <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Batch ID</th>
                        <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Stock</th>
                        <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Expiry Date</th>
                        <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>Days to Expiry</th>
                      </tr>
                    </thead>
                    <tbody className='bg-white divide-y divide-gray-200'>
                      {result.batches.map((batch, idx) => (
                        <tr key={idx}>
                          <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900'>{batch.batch_id}</td>
                          <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>{batch.current_stock}</td>
                          <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>{batch.expiry_date}</td>
                          <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-500'>{batch.days_to_expiry}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className='text-gray-600'>No inventory batch data available</p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default App
