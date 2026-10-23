import { useState, useEffect } from 'react'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity, Package, AlertTriangle, ShoppingCart, Calendar } from 'lucide-react'

const API_BASE = 'http://localhost:8000'

interface Shop {
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
  const [shops, setShops] = useState<Shop[]>([])
  const [medicines, setMedicines] = useState<Medicine[]>([])
  const [selectedShop, setSelectedShop] = useState('')
  const [medicineQuery, setMedicineQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ForecastResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchShops()
    fetchMedicines()
  }, [])

  const fetchShops = async () => {
    try {
      const res = await axios.get(`${API_BASE}/shops`)
      setShops(res.data)
      if (res.data.length > 0) setSelectedShop(res.data[0].shop_id)
    } catch (e) {
      console.error(e)
    }
  }

  const fetchMedicines = async () => {
    try {
      const res = await axios.get(`${API_BASE}/medicines?limit=100`)
      setMedicines(res.data)
    } catch (e) {
      console.error(e)
    }
  }

  const handleForecast = async () => {
    if (!selectedShop || !medicineQuery) {
      setError('Please select a shop and enter a medicine name/ID')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await axios.get(`${API_BASE}/forecast`, {
        params: { shop_id: selectedShop, medicine_query: medicineQuery }
      })
      setResult(res.data)
    } catch (e: any) {
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

  return (
    <div className='min-h-screen bg-gray-50'>
      <header className='bg-white shadow-sm border-b'>
        <div className='max-w-7xl mx-auto px-4 py-6'>
          <h1 className='text-3xl font-bold text-gray-900 flex items-center gap-2'>
            <Activity className='w-8 h-8 text-blue-600' />
            MediNexus - Demand Forecast & Prediction
          </h1>
          <p className='text-gray-600 mt-1'>Phase 1: Federated Learning for Medical-Shop Demand Forecasting</p>
        </div>
      </header>

      <main className='max-w-7xl mx-auto px-4 py-6'>
        <div className='bg-white rounded-lg shadow-sm p-6 mb-6'>
          <h2 className='text-xl font-semibold mb-4 flex items-center gap-2'>
            <Package className='w-5 h-5' />
            Forecast Configuration
          </h2>
          <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-2'>Medical Shop</label>
              <select
                value={selectedShop}
                onChange={(e) => setSelectedShop(e.target.value)}
                className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
              >
                {shops.map(shop => (
                  <option key={shop.shop_id} value={shop.shop_id}>{shop.shop_id} - {shop.shop_name}</option>
                ))}
              </select>
            </div>
            <div className='md:col-span-2'>
              <label className='block text-sm font-medium text-gray-700 mb-2'>Medicine (Name or ID)</label>
              <input
                type='text'
                value={medicineQuery}
                onChange={(e) => setMedicineQuery(e.target.value)}
                placeholder='e.g., Paracetamol or MED_001'
                className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                onKeyPress={(e) => e.key === 'Enter' && handleForecast()}
              />
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
