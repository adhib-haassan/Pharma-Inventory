import { useState, useEffect, type FormEvent } from 'react'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity, Package, AlertTriangle, ShoppingCart, Calendar, LogOut, Pill, ShieldCheck, LayoutDashboard, ChartNoAxesCombined, ChevronLeft, ChevronRight, Boxes, ReceiptText } from 'lucide-react'

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

interface DashboardSummary {
  medicine_count: number
  available_units: number
  low_stock_medicines: number
  expiring_batches: number
  sales_units: number
  sales_revenue: number
  period_start: string
  period_end: string
  shop_id: string
  shop_name: string
  currency: string
  sales_revenue_basis: string
}

interface DailySalesPoint {
  sale_date: string
  units_sold: number
  sales_revenue: number
}

interface SalesHistoryRow {
  sale_date: string
  medicine_id: string
  medicine_name: string
  category: string
  units_sold: number
  unit_price: number
  sales_revenue: number
}

interface Batch {
  batch_id: string
  batch_number: string
  medicine_id: string
  medicine_name: string
  category: string
  quantity: number
  purchase_date: string
  expiry_date: string
  unit_cost: number
  selling_price: number
  reorder_level: number
  supplier: string
  stock_status: string
  medicine_available_quantity: number
}

interface ForecastBatch {
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
  batches: ForecastBatch[]
}

function App() {
  const [dashboardSection, setDashboardSection] = useState<'dashboard' | 'forecasting'>('dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null)
  const [dailySales, setDailySales] = useState<DailySalesPoint[]>([])
  const [salesHistory, setSalesHistory] = useState<SalesHistoryRow[]>([])
  const [inventory, setInventory] = useState<Batch[]>([])
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [salesLoading, setSalesLoading] = useState(false)
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [salesPage, setSalesPage] = useState(0)
  const [inventoryPage, setInventoryPage] = useState(0)
  const [hasMoreSales, setHasMoreSales] = useState(false)
  const [hasMoreInventory, setHasMoreInventory] = useState(false)
  const tablePageSize = 8

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
    if (user && accessToken) {
      fetchMedicines(accessToken)
      fetchDashboard(accessToken)
    }
  }, [user, accessToken])

  useEffect(() => {
    if (user && accessToken) fetchSalesPage(accessToken, salesPage)
  }, [user, accessToken, salesPage])

  useEffect(() => {
    if (user && accessToken) fetchInventoryPage(accessToken, inventoryPage)
  }, [user, accessToken, inventoryPage])

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

  const fetchDashboard = async (token: string) => {
    setDashboardLoading(true)
    setDashboardError('')
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [summaryResponse, dailySalesResponse] = await Promise.all([
        axios.get<DashboardSummary>(`${API_BASE}/dashboard/summary`, { headers }),
        axios.get<DailySalesPoint[]>(`${API_BASE}/dashboard/sales/daily`, { headers, params: { days: 30 } }),
      ])
      setDashboardSummary(summaryResponse.data)
      setDailySales(dailySalesResponse.data)
    } catch (e) {
      console.error(e)
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        localStorage.removeItem('medinexus_access_token')
        setAccessToken(null)
        setUser(null)
        setLoginError('Your session expired. Please sign in again.')
      } else {
        setDashboardError(axios.isAxiosError(e) && e.response?.data?.detail
          ? e.response.data.detail
          : 'Could not load dashboard data. Check the Python API and this shop database file.')
      }
    } finally {
      setDashboardLoading(false)
    }
  }

  const fetchSalesPage = async (token: string, page: number) => {
    setSalesLoading(true)
    try {
      const response = await axios.get<SalesHistoryRow[]>(`${API_BASE}/dashboard/sales`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: tablePageSize + 1, offset: page * tablePageSize },
      })
      setSalesHistory(response.data.slice(0, tablePageSize))
      setHasMoreSales(response.data.length > tablePageSize)
    } catch (e) {
      console.error(e)
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        localStorage.removeItem('medinexus_access_token')
        setAccessToken(null)
        setUser(null)
        setLoginError('Your session expired. Please sign in again.')
      } else {
        setDashboardError(axios.isAxiosError(e) && e.response?.data?.detail
          ? e.response.data.detail
          : 'Could not load more sales history.')
      }
    } finally {
      setSalesLoading(false)
    }
  }

  const fetchInventoryPage = async (token: string, page: number) => {
    setInventoryLoading(true)
    try {
      const response = await axios.get<Batch[]>(`${API_BASE}/dashboard/inventory`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: tablePageSize + 1, offset: page * tablePageSize },
      })
      setInventory(response.data.slice(0, tablePageSize))
      setHasMoreInventory(response.data.length > tablePageSize)
    } catch (e) {
      console.error(e)
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        localStorage.removeItem('medinexus_access_token')
        setAccessToken(null)
        setUser(null)
        setLoginError('Your session expired. Please sign in again.')
      } else {
        setDashboardError(axios.isAxiosError(e) && e.response?.data?.detail
          ? e.response.data.detail
          : 'Could not load inventory data.')
      }
    } finally {
      setInventoryLoading(false)
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

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount)

  if (authChecking) {
    return <div className='min-h-screen flex items-center justify-center text-gray-600'>Checking your session...</div>
  }

  if (!user || !accessToken) {
    return (
      <div className='relative min-h-screen overflow-hidden bg-slate-50'>
        <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-cyan-100 via-slate-50 to-blue-100' />
        <div className='absolute -left-32 -top-32 h-96 w-96 rounded-full bg-cyan-200/40 blur-3xl' />
        <div className='absolute -bottom-40 -right-20 h-[32rem] w-[32rem] rounded-full bg-blue-200/50 blur-3xl' />
        <main className='relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-2 lg:gap-20'>
          <section className='mx-auto w-full max-w-lg text-center lg:text-left'>
            <div className='mx-auto mb-8 flex h-40 max-w-sm items-center justify-center rounded-3xl border border-white/80 bg-white/80 p-5 shadow-xl shadow-blue-900/5 backdrop-blur lg:mx-0'>
              <img src='/medinexus-logo.png' alt='MediNexus' className='h-full w-full object-contain' />
            </div>
            <div className='mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/70 px-4 py-2 text-sm font-medium text-cyan-900 shadow-sm'>
              <Pill className='h-4 w-4' />
              Pharmacy inventory intelligence
            </div>
            <h1 className='text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl'>
              Better visibility for every shelf.
            </h1>
            <p className='mx-auto mt-5 max-w-md text-lg leading-8 text-slate-600 lg:mx-0'>
              Sign in to view medicine demand forecasts, stock levels, and expiry insights for your pharmacy.
            </p>
            <div className='mt-8 flex items-center justify-center gap-3 text-sm font-medium text-slate-600 lg:justify-start'>
              <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-white text-blue-700 shadow-sm'>
                <ShieldCheck className='h-5 w-5' />
              </span>
              Secure, shop-specific access
            </div>
          </section>

          <section className='mx-auto w-full max-w-md'>
            <form onSubmit={handleLogin} className='rounded-3xl border border-white bg-white/95 p-8 shadow-2xl shadow-blue-950/10 sm:p-10'>
              <div className='mb-8'>
                <p className='text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700'>Welcome back</p>
                <h2 className='mt-2 text-3xl font-bold tracking-tight text-slate-900'>Sign in to MediNexus</h2>
                <p className='mt-2 text-sm text-slate-500'>Use your pharmacy account to continue.</p>
              </div>
              <label htmlFor='email' className='mb-2 block text-sm font-semibold text-slate-700'>Email address</label>
              <input
                id='email'
                type='email'
                autoComplete='username'
                required
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder='you@pharmacy.com'
                className='mb-5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-500/10'
              />
              <label htmlFor='password' className='mb-2 block text-sm font-semibold text-slate-700'>Password</label>
              <input
                id='password'
                type='password'
                autoComplete='current-password'
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder='Enter your password'
                className='w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-500/10'
              />
              {loginError && <p role='alert' className='mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700'>{loginError}</p>}
              <button
                type='submit'
                disabled={loginLoading}
                className='mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-700 to-blue-700 px-6 py-3.5 font-semibold text-white shadow-lg shadow-blue-900/20 transition hover:-translate-y-0.5 hover:from-cyan-800 hover:to-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60'
              >
                <Pill className='h-5 w-5' />
                {loginLoading ? 'Signing in...' : 'Sign in securely'}
              </button>
              <p className='mt-6 text-center text-xs text-slate-400'>Authorized pharmacy staff only</p>
            </form>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className='flex min-h-screen flex-col bg-slate-50 lg:h-screen lg:min-h-0 lg:flex-row lg:overflow-hidden'>
      <aside className={`flex w-full shrink-0 flex-col border-b border-slate-200 bg-white px-4 py-3 transition-[width] duration-200 lg:h-screen lg:min-h-0 lg:overflow-hidden lg:border-b-0 lg:border-r lg:py-6 ${
        sidebarCollapsed ? 'lg:w-20 lg:px-3' : 'lg:w-64 lg:px-5'
      }`}>
        <div className={`mb-4 flex items-center lg:mb-8 ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
          <span className={`whitespace-nowrap text-lg font-bold tracking-wide text-blue-700 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
            MEDINEXUS
          </span>
          <button
            type='button'
            onClick={() => setSidebarCollapsed(collapsed => !collapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className='inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          >
            {sidebarCollapsed ? <ChevronRight className='h-5 w-5' /> : <ChevronLeft className='h-5 w-5' />}
          </button>
        </div>
        <nav aria-label='Main navigation' className={`flex gap-2 lg:flex-col ${sidebarCollapsed ? 'lg:items-center' : ''}`}>
            {([
              ['dashboard', 'Dashboard', LayoutDashboard],
              ['forecasting', 'Forecasting', ChartNoAxesCombined],
            ] as const).map(([section, label, Icon]) => (
              <button
                key={section}
                type='button'
                onClick={() => setDashboardSection(section)}
                aria-current={dashboardSection === section ? 'page' : undefined}
                title={sidebarCollapsed ? label : undefined}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition lg:flex-none ${
                  sidebarCollapsed ? 'lg:w-12 lg:px-0' : 'lg:justify-start'
                } ${
                  dashboardSection === section
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className='h-4 w-4' />
                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>{label}</span>
              </button>
            ))}
        </nav>
        <div className={`mt-3 flex items-center border-t border-slate-100 pt-3 lg:mt-auto lg:pt-5 ${
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        }`}>
          <div className={`min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`} title={`${user.shop_name} · ${user.email}`}>
            <p className='truncate text-sm font-medium text-gray-900'>{user.shop_name}</p>
            <p className='truncate text-xs text-gray-600'>{user.email}</p>
          </div>
          <button
            onClick={handleLogout}
            aria-label='Sign out'
            title='Sign out'
            className={`inline-flex shrink-0 items-center justify-center rounded-md border border-gray-300 p-2 text-gray-700 hover:bg-gray-50 ${
              sidebarCollapsed ? '' : 'ml-2'
            }`}
          >
            <LogOut className='w-4 h-4' />
          </button>
        </div>
      </aside>

      <main className='min-h-0 min-w-0 flex-1 px-4 py-6 sm:px-6 lg:h-screen lg:overflow-y-auto lg:px-8'>
        {dashboardError && (
          <div role='alert' className='mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'>
            {dashboardError}
          </div>
        )}

        {dashboardSection === 'dashboard' && (
          <>
            <section className='mb-6'>
              <div className='mb-4 flex flex-wrap items-end justify-between gap-2'>
                <div>
                  <h1 className='text-2xl font-bold text-slate-900'>Shop dashboard</h1>
                  <p className='mt-1 text-sm text-slate-500'>
                    {user.shop_name} · {user.shop_id}
                  </p>
                </div>
                {dashboardSummary && (
                  <p className='text-xs text-slate-500'>
                    Sales overview: {dashboardSummary.period_start} to {dashboardSummary.period_end}
                  </p>
                )}
              </div>
              {dashboardLoading && !dashboardSummary ? (
                <div className='rounded-xl bg-white p-6 text-sm text-slate-500 shadow-sm'>Loading shop data...</div>
              ) : dashboardSummary ? (
                <>
                  <div className='grid grid-cols-2 gap-4 lg:grid-cols-5'>
                    {[
                      { label: 'Available units', value: dashboardSummary.available_units.toLocaleString('en-IN'), detail: 'Unexpired inventory', tone: 'text-blue-700' },
                      { label: 'Sales revenue', value: formatCurrency(dashboardSummary.sales_revenue), detail: `${dashboardSummary.sales_units.toLocaleString('en-IN')} units sold`, tone: 'text-emerald-700' },
                      { label: 'Medicines', value: dashboardSummary.medicine_count.toLocaleString('en-IN'), detail: 'In shop catalog', tone: 'text-slate-900' },
                      { label: 'Low stock', value: dashboardSummary.low_stock_medicines.toLocaleString('en-IN'), detail: 'Medicines at reorder level', tone: 'text-amber-700' },
                      { label: 'Expiring soon', value: dashboardSummary.expiring_batches.toLocaleString('en-IN'), detail: 'Batches within 30 days', tone: 'text-rose-700' },
                    ].map(card => (
                      <div key={card.label} className='rounded-xl border border-slate-100 bg-white p-4 shadow-sm'>
                        <p className='text-sm font-medium text-slate-500'>{card.label}</p>
                        <p className={`mt-2 truncate text-xl font-bold ${card.tone}`}>{card.value}</p>
                        <p className='mt-1 text-xs text-slate-400'>{card.detail}</p>
                      </div>
                    ))}
                  </div>
                  <div className='mt-6 rounded-xl border border-slate-100 bg-white p-5 shadow-sm'>
                    <div className='mb-4 flex flex-wrap items-start justify-between gap-2'>
                      <div>
                        <h2 className='text-lg font-semibold text-slate-900'>Daily sales revenue</h2>
                        <p className='text-sm text-slate-500'>30 days through the latest recorded sale · units sold × recorded unit price</p>
                      </div>
                      <button
                        type='button'
                        onClick={() => setDashboardSection('forecasting')}
                        className='text-sm font-medium text-blue-700 hover:text-blue-900'
                      >
                        Open forecasting
                      </button>
                    </div>
                    {dailySales.length > 0 ? (
                      <ResponsiveContainer width='100%' height={280}>
                        <LineChart data={dailySales}>
                          <CartesianGrid strokeDasharray='3 3' />
                          <XAxis dataKey='sale_date' tick={{ fontSize: 11 }} tickFormatter={value => String(value).slice(5)} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={value => `₹${Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(0)}k` : value}`} />
                          <Tooltip formatter={value => [formatCurrency(Number(value)), 'Sales revenue']} />
                          <Line type='monotone' dataKey='sales_revenue' stroke='#0f766e' strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className='py-12 text-center text-sm text-slate-500'>No sales recorded in the last 30 days.</p>
                    )}
                    <p className='mt-2 text-xs text-slate-400'>{dashboardSummary.sales_revenue_basis}</p>
                  </div>
                </>
              ) : (
                <div className='rounded-xl bg-white p-6 text-sm text-slate-500 shadow-sm'>
                  Shop dashboard data is not available. Confirm the local SQLite database for this shop has been imported.
                  {dashboardLoading && <span className='ml-2'>Loading...</span>}
                </div>
              )}
            </section>

            <section className='grid grid-cols-1 gap-5 xl:grid-cols-2'>
              <div className='overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm'>
                <div className='flex items-center justify-between border-b border-slate-100 px-4 py-3'>
                  <div className='flex items-center gap-2'>
                    <ReceiptText className='h-4 w-4 text-emerald-700' />
                    <h2 className='font-semibold text-slate-900'>Recent sales</h2>
                  </div>
                  <span className='text-xs text-slate-500'>Page {salesPage + 1}</span>
                </div>
                <div className='h-[330px] overflow-auto'>
                  <table className='min-w-full divide-y divide-slate-100 text-xs'>
                    <thead className='sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-500'>
                      <tr>
                        <th className='px-3 py-2.5 font-medium'>Date</th>
                        <th className='px-3 py-2.5 font-medium'>Medicine</th>
                        <th className='px-3 py-2.5 text-right font-medium'>Units</th>
                        <th className='px-3 py-2.5 text-right font-medium'>Revenue*</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-slate-50'>
                      {salesHistory.map((sale, index) => (
                        <tr key={`${sale.sale_date}-${sale.medicine_id}-${index}`} className='hover:bg-slate-50'>
                          <td className='whitespace-nowrap px-3 py-2.5 text-slate-500'>{sale.sale_date}</td>
                          <td className='max-w-36 truncate px-3 py-2.5 font-medium text-slate-800' title={sale.medicine_name}>{sale.medicine_name}</td>
                          <td className='px-3 py-2.5 text-right text-slate-600'>{sale.units_sold.toLocaleString('en-IN')}</td>
                          <td className='whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-800'>{formatCurrency(sale.sales_revenue)}</td>
                        </tr>
                      ))}
                      {salesLoading && salesHistory.length === 0 && (
                        <tr><td colSpan={4} className='px-3 py-10 text-center text-slate-400'>Loading sales...</td></tr>
                      )}
                      {!salesLoading && salesHistory.length === 0 && (
                        <tr><td colSpan={4} className='px-3 py-10 text-center text-slate-400'>No sales history available.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className='flex h-12 items-center justify-between border-t border-slate-100 px-3'>
                  <span className='text-xs text-slate-400'>*Estimated from units × unit price</span>
                  <div className='flex items-center gap-1'>
                    <button
                      type='button'
                      onClick={() => setSalesPage(page => Math.max(0, page - 1))}
                      disabled={salesPage === 0 || salesLoading}
                      aria-label='Previous sales page'
                      className='rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35'
                    >
                      <ChevronLeft className='h-4 w-4' />
                    </button>
                    <button
                      type='button'
                      onClick={() => setSalesPage(page => page + 1)}
                      disabled={!hasMoreSales || salesLoading}
                      aria-label='Next sales page'
                      className='rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35'
                    >
                      <ChevronRight className='h-4 w-4' />
                    </button>
                  </div>
                </div>
              </div>

              <div className='overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm'>
                <div className='flex items-center justify-between border-b border-slate-100 px-4 py-3'>
                  <div className='flex items-center gap-2'>
                    <Boxes className='h-4 w-4 text-blue-700' />
                    <h2 className='font-semibold text-slate-900'>Inventory batches</h2>
                  </div>
                  <span className='text-xs text-slate-500'>Page {inventoryPage + 1}</span>
                </div>
                <div className='h-[330px] overflow-auto'>
                  <table className='min-w-full divide-y divide-slate-100 text-xs'>
                    <thead className='sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-500'>
                      <tr>
                        <th className='px-3 py-2.5 font-medium'>Medicine / batch</th>
                        <th className='px-3 py-2.5 text-right font-medium'>Qty</th>
                        <th className='px-3 py-2.5 font-medium'>Expiry</th>
                        <th className='px-3 py-2.5 font-medium'>Status</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-slate-50'>
                      {inventory.map(batch => (
                        <tr key={batch.batch_id} className='hover:bg-slate-50'>
                          <td className='max-w-40 px-3 py-2.5'>
                            <p className='truncate font-medium text-slate-800' title={batch.medicine_name}>{batch.medicine_name}</p>
                            <p className='truncate text-slate-400'>{batch.batch_number}</p>
                          </td>
                          <td className='whitespace-nowrap px-3 py-2.5 text-right text-slate-700'>{batch.quantity.toLocaleString('en-IN')}</td>
                          <td className='whitespace-nowrap px-3 py-2.5 text-slate-500'>{batch.expiry_date}</td>
                          <td className='whitespace-nowrap px-3 py-2.5'>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                              batch.stock_status === 'IN STOCK' ? 'bg-emerald-50 text-emerald-700'
                                : batch.stock_status === 'LOW STOCK' ? 'bg-amber-50 text-amber-700'
                                  : 'bg-rose-50 text-rose-700'
                            }`}>{batch.stock_status}</span>
                          </td>
                        </tr>
                      ))}
                      {inventoryLoading && inventory.length === 0 && (
                        <tr><td colSpan={4} className='px-3 py-10 text-center text-slate-400'>Loading inventory...</td></tr>
                      )}
                      {!inventoryLoading && inventory.length === 0 && (
                        <tr><td colSpan={4} className='px-3 py-10 text-center text-slate-400'>No inventory batches available.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className='flex h-12 items-center justify-between border-t border-slate-100 px-3'>
                  <span className='text-xs text-slate-400'>Batch-level quantities</span>
                  <div className='flex items-center gap-1'>
                    <button
                      type='button'
                      onClick={() => setInventoryPage(page => Math.max(0, page - 1))}
                      disabled={inventoryPage === 0 || inventoryLoading}
                      aria-label='Previous inventory page'
                      className='rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35'
                    >
                      <ChevronLeft className='h-4 w-4' />
                    </button>
                    <button
                      type='button'
                      onClick={() => setInventoryPage(page => page + 1)}
                      disabled={!hasMoreInventory || inventoryLoading}
                      aria-label='Next inventory page'
                      className='rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35'
                    >
                      <ChevronRight className='h-4 w-4' />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {dashboardSection === 'forecasting' && (
          <>
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
          </>
        )}

      </main>
    </div>
  )
}

export default App
