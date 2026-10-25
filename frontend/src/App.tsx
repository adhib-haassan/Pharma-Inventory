import { useState, useEffect, type FormEvent, type ReactNode } from 'react'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity, Package, AlertTriangle, ShoppingCart, Calendar, LogOut, Pill, ShieldCheck, LayoutDashboard, ChartNoAxesCombined, ChevronLeft, ChevronRight, Boxes, Plus, Pencil, Trash2, X, MessageCircle, Send, Download, Mail, Bell } from 'lucide-react'

const API_BASE = 'http://localhost:8000'

interface AuthenticatedUser {
  email: string
  shop_id: string
  shop_name: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatThread {
  id: string
  title: string
  messages: ChatMessage[]
  updatedAt: string
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key} className='font-semibold text-slate-900'>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key} className='rounded bg-slate-200 px-1 py-0.5 font-mono text-[0.9em]'>{part.slice(1, -1)}</code>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    return <span key={key}>{part}</span>
  })
}

function renderChatMarkdown(content: string): ReactNode[] {
  const lines = content.split(/\r?\n/)
  const blocks: ReactNode[] = []
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
  const isTableDivider = (line: string) => cells(line).length > 1 && cells(line).every(cell => /^:?-{3,}:?$/.test(cell))

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim()
    if (!line) { index += 1; continue }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = cells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(cells(lines[index]))
        index += 1
      }
      blocks.push(
        <div key={`table-${index}`} className='my-3 max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white'>
          <table className='w-full border-collapse text-left text-xs sm:text-sm'>
            <thead className='bg-slate-200/70 text-slate-700'>
              <tr>{headers.map((cell, column) => <th key={column} className='whitespace-nowrap border-b border-slate-200 px-3 py-2 font-semibold'>{renderInlineMarkdown(cell, `th-${index}-${column}`)}</th>)}</tr>
            </thead>
            <tbody className='divide-y divide-slate-100'>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className='odd:bg-white even:bg-slate-50'>
                  {headers.map((_, column) => <td key={column} className='whitespace-nowrap px-3 py-2 text-slate-700'>{renderInlineMarkdown(row[column] ?? '', `td-${index}-${rowIndex}-${column}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      const HeadingTag = heading[1].length === 1 ? 'h3' : 'h4'
      blocks.push(<HeadingTag key={`heading-${index}`} className='mb-2 mt-3 font-semibold text-slate-900'>{renderInlineMarkdown(heading[2], `heading-${index}`)}</HeadingTag>)
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''))
        index += 1
      }
      blocks.push(<ul key={`list-${index}`} className='my-2 list-disc space-y-1 pl-5'>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}</li>)}</ul>)
      continue
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ''))
        index += 1
      }
      blocks.push(<ol key={`ordered-${index}`} className='my-2 list-decimal space-y-1 pl-5'>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item, `ordered-${index}-${itemIndex}`)}</li>)}</ol>)
      continue
    }

    const paragraph = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !/^\s*(#{1,3}\s+|[-*]\s+|\d+[.)]\s+)/.test(lines[index])
      && !(lines[index].includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1]))) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`} className='my-1.5 leading-6'>{renderInlineMarkdown(paragraph.join(' '), `paragraph-${index}`)}</p>)
  }
  return blocks
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
  batch_count: number
  available_units: number
  low_stock_medicines: number
  expiring_batches: number
  shop_id: string
  shop_name: string
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

interface InventoryNotification {
  key: string
  signature: string
  kind: 'low_stock' | 'expiring'
  title: string
  detail: string
}

interface InventoryBatchForm {
  medicine_id: string
  batch_number: string
  quantity: string
  purchase_date: string
  expiry_date: string
  unit_cost: string
  selling_price: string
  reorder_level: string
  supplier: string
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

function emptyInventoryBatchForm(): InventoryBatchForm {
  const now = new Date()
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  return {
    medicine_id: '',
    batch_number: '',
    quantity: '',
    purchase_date: today,
    expiry_date: '',
    unit_cost: '',
    selling_price: '',
    reorder_level: '0',
    supplier: '',
  }
}

function App() {
  const [dashboardSection, setDashboardSection] = useState<'dashboard' | 'forecasting' | 'chat'>('dashboard')
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
  const [inventory, setInventory] = useState<Batch[]>([])
  const [notificationInventory, setNotificationInventory] = useState<Batch[]>([])
  const [seenNotifications, setSeenNotifications] = useState<Record<string, string>>({})
  const [notificationOwner, setNotificationOwner] = useState<string | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventoryPage, setInventoryPage] = useState(0)
  const [hasMoreInventory, setHasMoreInventory] = useState(false)
  const [inventoryModalOpen, setInventoryModalOpen] = useState(false)
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null)
  const [inventoryForm, setInventoryForm] = useState<InventoryBatchForm>(emptyInventoryBatchForm())
  const [inventorySaving, setInventorySaving] = useState(false)
  const [inventoryMessage, setInventoryMessage] = useState('')
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [chatOwner, setChatOwner] = useState<string | null>(null)
  const [chatDraft, setChatDraft] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [forecastEmail, setForecastEmail] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailSent, setEmailSent] = useState('')
  const tablePageSize = 8
  const chatMessages = chatThreads.find(thread => thread.id === activeChatId)?.messages ?? []
  const chatStorageKey = user ? `medinexus_ai_chats:${user.email.toLowerCase()}` : null
  const notificationStorageKey = user ? `medinexus_inventory_notifications:${user.email.toLowerCase()}` : null
  const localToday = new Date()
  const todayIso = new Date(localToday.getTime() - localToday.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  const cutoffDate = new Date(localToday)
  cutoffDate.setDate(cutoffDate.getDate() + 30)
  const cutoffIso = new Date(cutoffDate.getTime() - cutoffDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  const lowStockByMedicine = new Map<string, Batch>()
  for (const batch of notificationInventory) {
    if (batch.stock_status === 'LOW STOCK') {
      const existing = lowStockByMedicine.get(batch.medicine_id)
      lowStockByMedicine.set(batch.medicine_id, existing
        ? { ...existing, reorder_level: Math.max(existing.reorder_level, batch.reorder_level) }
        : batch)
    }
  }
  const currentNotifications: InventoryNotification[] = [
    ...[...lowStockByMedicine.values()].map(batch => ({
      key: `low-stock:${batch.medicine_id}`,
      signature: `${batch.medicine_available_quantity}:${batch.reorder_level}`,
      kind: 'low_stock' as const,
      title: `${batch.medicine_name} is low on stock`,
      detail: `${batch.medicine_available_quantity.toLocaleString('en-IN')} available · reorder level ${batch.reorder_level.toLocaleString('en-IN')}`,
    })),
    ...notificationInventory
      .filter(batch => batch.quantity > 0 && batch.expiry_date >= todayIso && batch.expiry_date <= cutoffIso)
      .map(batch => ({
        key: `expiring:${batch.batch_id}`,
        signature: `${batch.expiry_date}:${batch.quantity}`,
        kind: 'expiring' as const,
        title: `${batch.medicine_name} expires soon`,
        detail: `Batch ${batch.batch_number} · ${batch.quantity.toLocaleString('en-IN')} units · ${batch.expiry_date}`,
      })),
  ]
  const unseenNotifications = currentNotifications.filter(notification => (
    seenNotifications[notification.key] !== notification.signature
  ))

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
    if (user && accessToken) fetchInventoryPage(accessToken, inventoryPage)
  }, [user, accessToken, inventoryPage])

  useEffect(() => {
    setNotificationOwner(null)
    setSeenNotifications({})
    setNotificationInventory([])
    setNotificationsOpen(false)
    if (!user || !notificationStorageKey) return

    try {
      const saved = localStorage.getItem(notificationStorageKey)
      const parsed = saved ? JSON.parse(saved) as Record<string, string> : {}
      setSeenNotifications(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
    } catch {
      localStorage.removeItem(notificationStorageKey)
    }
    setNotificationOwner(user.email.toLowerCase())
  }, [user?.email])

  useEffect(() => {
    setChatOwner(null)
    setChatThreads([])
    setActiveChatId(null)
    if (!user || !chatStorageKey) return

    try {
      const saved = localStorage.getItem(chatStorageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as { threads?: ChatThread[]; activeChatId?: string | null }
        const threads = Array.isArray(parsed.threads)
          ? parsed.threads.filter(thread => thread && typeof thread.id === 'string'
            && typeof thread.title === 'string' && Array.isArray(thread.messages))
            .slice(-20)
          : []
        setChatThreads(threads)
        setActiveChatId(threads.some(thread => thread.id === parsed.activeChatId)
          ? parsed.activeChatId ?? null
          : threads.at(-1)?.id ?? null)
      }
    } catch {
      localStorage.removeItem(chatStorageKey)
    }
    setChatOwner(user.email.toLowerCase())
  }, [user?.email])

  useEffect(() => {
    if (!chatStorageKey || chatOwner !== user?.email.toLowerCase()) return
    const timeout = window.setTimeout(() => {
      try {
        const recentThreads = [...chatThreads]
          .sort((first, second) => first.updatedAt.localeCompare(second.updatedAt))
          .slice(-20)
        localStorage.setItem(chatStorageKey, JSON.stringify({ threads: recentThreads, activeChatId }))
      } catch {
        setChatError('Could not save chat history in this browser.')
      }
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [chatThreads, activeChatId, chatStorageKey, chatOwner, user?.email])

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
      setDashboardSection('dashboard')
      setInventory([])
      setDashboardSummary(null)
      setInventoryPage(0)
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
    setInventory([])
    setDashboardSummary(null)
    setDashboardError('')
    setInventoryMessage('')
    setInventoryPage(0)
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
      const [summaryResponse, inventoryResponse] = await Promise.all([
        axios.get<DashboardSummary>(`${API_BASE}/dashboard/summary`, { headers }),
        axios.get<Batch[]>(`${API_BASE}/dashboard/inventory`, { headers, params: { limit: 500, offset: 0 } }),
      ])
      setDashboardSummary(summaryResponse.data)
      setNotificationInventory(inventoryResponse.data)
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

  const toggleNotifications = () => {
    const opening = !notificationsOpen
    setNotificationsOpen(opening)
    if (!opening || !notificationStorageKey || notificationOwner !== user?.email.toLowerCase()) return

    const nextSeen = { ...seenNotifications }
    for (const notification of currentNotifications) {
      nextSeen[notification.key] = notification.signature
    }
    setSeenNotifications(nextSeen)
    try {
      localStorage.setItem(notificationStorageKey, JSON.stringify(nextSeen))
    } catch {
      // Keep the panel usable even if browser storage is unavailable.
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

  const openAddInventoryBatch = () => {
    setEditingBatchId(null)
    setInventoryForm({ ...emptyInventoryBatchForm(), medicine_id: medicines[0]?.medicine_id ?? '' })
    setInventoryMessage('')
    setInventoryModalOpen(true)
  }

  const openEditInventoryBatch = (batch: Batch) => {
    setEditingBatchId(batch.batch_id)
    setInventoryForm({
      medicine_id: batch.medicine_id,
      batch_number: batch.batch_number,
      quantity: String(batch.quantity),
      purchase_date: batch.purchase_date,
      expiry_date: batch.expiry_date,
      unit_cost: String(batch.unit_cost),
      selling_price: String(batch.selling_price),
      reorder_level: String(batch.reorder_level),
      supplier: batch.supplier,
    })
    setInventoryMessage('')
    setInventoryModalOpen(true)
  }

  const handleInventorySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!accessToken) return
    setInventorySaving(true)
    setInventoryMessage('')
    const payload = {
      ...inventoryForm,
      quantity: Number(inventoryForm.quantity),
      unit_cost: Number(inventoryForm.unit_cost),
      selling_price: Number(inventoryForm.selling_price),
      reorder_level: Number(inventoryForm.reorder_level),
    }
    try {
      if (editingBatchId) {
        await axios.put(`${API_BASE}/dashboard/inventory/${encodeURIComponent(editingBatchId)}`, payload, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        setInventoryMessage('Inventory batch updated.')
      } else {
        await axios.post(`${API_BASE}/dashboard/inventory`, payload, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        setInventoryMessage('Supply added to inventory.')
      }
      setInventoryModalOpen(false)
      setDashboardError('')
      await Promise.all([
        fetchDashboard(accessToken),
        fetchInventoryPage(accessToken, inventoryPage),
      ])
    } catch (e) {
      console.error(e)
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        localStorage.removeItem('medinexus_access_token')
        setAccessToken(null)
        setUser(null)
        setInventoryModalOpen(false)
        setLoginError('Your session expired. Please sign in again.')
        return
      }
      setInventoryMessage(axios.isAxiosError(e) && typeof e.response?.data?.detail === 'string'
        ? e.response.data.detail
        : 'Could not save this inventory batch.')
    } finally {
      setInventorySaving(false)
    }
  }

  const handleDeleteInventoryBatch = async (batch: Batch) => {
    if (!accessToken || !window.confirm(`Delete batch ${batch.batch_number} of ${batch.medicine_name}?`)) return
    setDashboardError('')
    try {
      await axios.delete(`${API_BASE}/dashboard/inventory/${encodeURIComponent(batch.batch_id)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      setInventoryMessage(`Batch ${batch.batch_number} deleted.`)
      const nextPage = inventory.length === 1 && inventoryPage > 0 ? inventoryPage - 1 : inventoryPage
      setInventoryPage(nextPage)
      await Promise.all([
        fetchDashboard(accessToken),
        fetchInventoryPage(accessToken, nextPage),
      ])
    } catch (e) {
      console.error(e)
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        localStorage.removeItem('medinexus_access_token')
        setAccessToken(null)
        setUser(null)
        setLoginError('Your session expired. Please sign in again.')
        return
      }
      setDashboardError(axios.isAxiosError(e) && typeof e.response?.data?.detail === 'string'
        ? e.response.data.detail
        : 'Could not delete this inventory batch.')
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

  const handleDownloadForecast = async () => {
    if (!result || !accessToken) return
    setPdfLoading(true)
    setError('')
    try {
      const response = await axios.post(`${API_BASE}/forecast/pdf`, result, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `forecast_${result.medicine_id}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        await handleLogout()
        setLoginError('Your session expired. Please sign in again.')
        return
      }
      setError(axios.isAxiosError(e) && typeof e.response?.data?.detail === 'string'
        ? e.response.data.detail
        : 'Could not export the forecast PDF.')
    } finally {
      setPdfLoading(false)
    }
  }

  const handleEmailForecast = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!result || !accessToken) return
    setEmailSending(true)
    setEmailError('')
    setEmailSent('')
    try {
      await axios.post(`${API_BASE}/forecast/email`, { email: forecastEmail.trim(), forecast: result }, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      setEmailSent(`Forecast PDF sent to ${forecastEmail.trim()}.`)
      setEmailModalOpen(false)
      setForecastEmail('')
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        await handleLogout()
        setLoginError('Your session expired. Please sign in again.')
        return
      }
      setEmailError(axios.isAxiosError(e) && typeof e.response?.data?.detail === 'string'
        ? e.response.data.detail
        : 'Could not send the forecast email.')
    } finally {
      setEmailSending(false)
    }
  }

  const startNewChat = () => {
    if (chatLoading) return
    const thread: ChatThread = {
      id: globalThis.crypto.randomUUID(),
      title: 'New chat',
      messages: [],
      updatedAt: new Date().toISOString(),
    }
    setChatThreads(current => [...current, thread].slice(-20))
    setActiveChatId(thread.id)
    setChatDraft('')
    setChatError('')
  }

  const deleteChatThread = (threadId: string) => {
    const remaining = chatThreads.filter(thread => thread.id !== threadId)
    setChatThreads(remaining)
    if (activeChatId === threadId) setActiveChatId(remaining.at(-1)?.id ?? null)
  }

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const question = chatDraft.trim()
    if (!question || !accessToken || chatLoading) return

    const threadId = activeChatId ?? globalThis.crypto.randomUUID()
    const existingThread = chatThreads.find(thread => thread.id === threadId)
    const history = [...(existingThread?.messages ?? []), { role: 'user' as const, content: question }].slice(-12)
    const pendingMessages: ChatMessage[] = [...history, { role: 'assistant', content: '' }]
    const updatedThread: ChatThread = {
      id: threadId,
      title: existingThread && existingThread.title !== 'New chat'
        ? existingThread.title
        : question.slice(0, 48),
      messages: pendingMessages,
      updatedAt: new Date().toISOString(),
    }
    setChatThreads(current => current.some(thread => thread.id === threadId)
      ? current.map(thread => thread.id === threadId ? updatedThread : thread)
      : [...current, updatedThread].slice(-20))
    setActiveChatId(threadId)
    setChatDraft('')
    setChatError('')
    setChatLoading(true)
    try {
      const response = await fetch(`${API_BASE}/dashboard/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: history }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        if (response.status === 401) {
          await handleLogout()
          setLoginError('Your session expired. Please sign in again.')
          return
        }
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not get a response from the AI chatbot.')
      }
      if (!response.body) throw new Error('Streaming is not available in this browser.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const appendAnswer = (part: string) => {
        if (!part) return
        setChatThreads(current => current.map(thread => thread.id === threadId
          ? {
            ...thread,
            updatedAt: new Date().toISOString(),
            messages: thread.messages.map((message, index) => index === thread.messages.length - 1
              ? { ...message, content: message.content + part }
              : message),
          }
          : thread))
      }
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        appendAnswer(decoder.decode(value, { stream: true }))
      }
      appendAnswer(decoder.decode())
    } catch (error) {
      setChatThreads(current => current.map(thread => thread.id === threadId
        && thread.messages.at(-1)?.role === 'assistant' && !thread.messages.at(-1)?.content
        ? { ...thread, messages: thread.messages.slice(0, -1) }
        : thread))
      setChatError(error instanceof Error ? error.message : 'Could not get a response from the AI chatbot.')
    } finally {
      setChatLoading(false)
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
              ['chat', 'AI Chatbot', MessageCircle],
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
        {inventoryMessage && !inventoryModalOpen && (
          <div role='status' className='mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800'>
            {inventoryMessage}
          </div>
        )}

        {dashboardSection === 'dashboard' && (
          <>
            <section className='mb-6'>
              <div className='mb-4 flex flex-wrap items-end justify-between gap-2'>
                <div>
                  <h1 className='text-2xl font-bold text-slate-900'>Inventory dashboard</h1>
                  <p className='mt-1 text-sm text-slate-500'>
                    {user.shop_name} · {user.shop_id}
                  </p>
                </div>
                <div className='relative'>
                  <button
                    type='button'
                    onClick={toggleNotifications}
                    aria-label={`Inventory notifications${unseenNotifications.length ? `, ${unseenNotifications.length} new` : ''}`}
                    aria-expanded={notificationsOpen}
                    aria-haspopup='dialog'
                    className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white shadow-sm transition hover:bg-slate-50 ${notificationsOpen ? 'border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600'}`}
                  >
                    <Bell className='h-5 w-5 translate-y-[-2px]' />
                    {unseenNotifications.length > 0 && (
                      <span className='absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white'>
                        {unseenNotifications.length > 9 ? '9+' : unseenNotifications.length}
                      </span>
                    )}
                  </button>
                  {notificationsOpen && (
                    <section role='dialog' aria-label='Inventory notifications' className='absolute right-0 top-12 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl'>
                      <div className='flex items-center justify-between border-b border-slate-100 px-4 py-3'>
                        <h2 className='text-sm font-semibold text-slate-900'>Inventory alerts</h2>
                        <button type='button' onClick={() => setNotificationsOpen(false)} aria-label='Close notifications' className='rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700'>
                          <X className='h-4 w-4' />
                        </button>
                      </div>
                      <div className='max-h-80 overflow-y-auto p-2'>
                        {currentNotifications.length === 0 ? (
                          <p className='px-3 py-6 text-center text-sm text-slate-500'>No active low-stock or near-expiry alerts.</p>
                        ) : currentNotifications.map(notification => (
                          <div key={notification.key} className='flex gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50'>
                            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${notification.kind === 'low_stock' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                              {notification.kind === 'low_stock' ? <AlertTriangle className='h-4 w-4' /> : <Calendar className='h-4 w-4' />}
                            </span>
                            <div className='min-w-0 flex-1'>
                              <p className='text-xs font-semibold text-slate-800'>{notification.title}</p>
                              <p className='mt-0.5 text-[11px] leading-4 text-slate-500'>{notification.detail}</p>
                            </div>
                            {seenNotifications[notification.key] !== notification.signature && <span className='mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600' aria-label='New alert' />}
                          </div>
                        ))}
                      </div>
                      <p className='border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400'>Alerts are saved as seen for this signed-in user on this device.</p>
                    </section>
                  )}
                </div>
              </div>
              {dashboardLoading && !dashboardSummary ? (
                <div className='rounded-xl bg-white p-6 text-sm text-slate-500 shadow-sm'>Loading shop data...</div>
              ) : dashboardSummary ? (
                  <div className='grid grid-cols-2 gap-4 lg:grid-cols-5'>
                    {[
                      { label: 'Available units', value: dashboardSummary.available_units.toLocaleString('en-IN'), detail: 'Unexpired inventory', tone: 'text-blue-700' },
                      { label: 'Inventory batches', value: dashboardSummary.batch_count.toLocaleString('en-IN'), detail: 'Across all pages', tone: 'text-slate-900' },
                      { label: 'Medicines', value: dashboardSummary.medicine_count.toLocaleString('en-IN'), detail: 'In shop catalog', tone: 'text-violet-700' },
                      { label: 'Low stock', value: dashboardSummary.low_stock_medicines.toLocaleString('en-IN'), detail: 'Medicines at reorder level', tone: 'text-amber-700' },
                      { label: 'Expiring batches', value: dashboardSummary.expiring_batches.toLocaleString('en-IN'), detail: 'Within 30 days', tone: 'text-rose-700' },
                    ].map(card => (
                      <div key={card.label} className='rounded-xl border border-slate-100 bg-white p-4 shadow-sm'>
                        <p className='text-sm font-medium text-slate-500'>{card.label}</p>
                        <p className={`mt-2 truncate text-xl font-bold ${card.tone}`}>{card.value}</p>
                        <p className='mt-1 text-xs text-slate-400'>{card.detail}</p>
                      </div>
                    ))}
                  </div>
              ) : (
                <div className='rounded-xl bg-white p-6 text-sm text-slate-500 shadow-sm'>
                  Shop dashboard data is not available. Confirm the local SQLite database for this shop has been imported.
                  {dashboardLoading && <span className='ml-2'>Loading...</span>}
                </div>
              )}
            </section>

            <section className='grid grid-cols-1 gap-5'>
              <div className='overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm'>
                <div className='flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3'>
                  <div className='flex items-center gap-2'>
                    <Boxes className='h-4 w-4 text-blue-700' />
                    <h2 className='font-semibold text-slate-900'>Inventory batches</h2>
                  </div>
                  <div className='flex items-center gap-3'>
                    <span className='text-xs text-slate-500'>Page {inventoryPage + 1}</span>
                    <button
                      type='button'
                      onClick={openAddInventoryBatch}
                      disabled={medicinesLoading || medicines.length === 0}
                      title={medicines.length === 0 ? 'No medicines are available in this shop catalog' : 'Add a supply batch'}
                      className='inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      <Plus className='h-4 w-4' />
                      Add supply
                    </button>
                  </div>
                </div>
                <div className='h-[330px] overflow-auto'>
                  <table className='min-w-full divide-y divide-slate-100 text-xs'>
                    <thead className='sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-500'>
                      <tr>
                        <th className='px-3 py-2.5 font-medium'>Medicine / batch</th>
                        <th className='px-3 py-2.5 text-right font-medium'>Qty</th>
                        <th className='px-3 py-2.5 font-medium'>Expiry</th>
                        <th className='px-3 py-2.5 font-medium'>Status</th>
                        <th className='px-3 py-2.5 text-right font-medium'>Actions</th>
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
                          <td className='whitespace-nowrap px-3 py-2.5 text-right'>
                            <button
                              type='button'
                              onClick={() => openEditInventoryBatch(batch)}
                              aria-label={`Edit ${batch.batch_number}`}
                              title='Edit batch'
                              className='rounded-md p-1.5 text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                            >
                              <Pencil className='h-4 w-4' />
                            </button>
                            <button
                              type='button'
                              onClick={() => handleDeleteInventoryBatch(batch)}
                              aria-label={`Delete ${batch.batch_number}`}
                              title='Delete batch'
                              className='rounded-md p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-700'
                            >
                              <Trash2 className='h-4 w-4' />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {inventoryLoading && inventory.length === 0 && (
                        <tr><td colSpan={5} className='px-3 py-10 text-center text-slate-400'>Loading inventory...</td></tr>
                      )}
                      {!inventoryLoading && inventory.length === 0 && (
                        <tr><td colSpan={5} className='px-3 py-10 text-center text-slate-400'>No inventory batches available. Add a supply to get started.</td></tr>
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

        {inventoryModalOpen && (
          <div className='fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/40 p-4'>
            <section
              role='dialog'
              aria-modal='true'
              aria-labelledby='inventory-form-title'
              className='my-auto w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6'
            >
              <div className='mb-5 flex items-start justify-between gap-4'>
                <div>
                  <h2 id='inventory-form-title' className='text-xl font-semibold text-slate-900'>
                    {editingBatchId ? 'Update inventory batch' : 'Add supply'}
                  </h2>
                  <p className='mt-1 text-sm text-slate-500'>Enter the batch details for {user.shop_name}.</p>
                </div>
                <button
                  type='button'
                  onClick={() => setInventoryModalOpen(false)}
                  aria-label='Close inventory form'
                  className='rounded-lg p-2 text-slate-500 hover:bg-slate-100'
                >
                  <X className='h-5 w-5' />
                </button>
              </div>
              <form onSubmit={handleInventorySubmit} className='space-y-4'>
                <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                  <label className='text-sm font-medium text-slate-700 sm:col-span-2'>
                    Medicine
                    <select
                      required
                      value={inventoryForm.medicine_id}
                      onChange={event => setInventoryForm(form => ({ ...form, medicine_id: event.target.value }))}
                      className='mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal'
                    >
                      <option value='' disabled>Select medicine</option>
                      {medicines.map(medicine => (
                        <option key={medicine.medicine_id} value={medicine.medicine_id}>
                          {medicine.medicine_name} ({medicine.medicine_id})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className='text-sm font-medium text-slate-700'>
                    Batch number
                    <input
                      required
                      maxLength={64}
                      value={inventoryForm.batch_number}
                      onChange={event => setInventoryForm(form => ({ ...form, batch_number: event.target.value }))}
                      className='mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal'
                    />
                  </label>
                  <label className='text-sm font-medium text-slate-700'>
                    Supplier
                    <input
                      required
                      maxLength={255}
                      value={inventoryForm.supplier}
                      onChange={event => setInventoryForm(form => ({ ...form, supplier: event.target.value }))}
                      className='mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal'
                    />
                  </label>
                  <label className='text-sm font-medium text-slate-700'>
                    Quantity
                    <input
                      required
                      type='number'
                      min='0'
                      step='1'
                      value={inventoryForm.quantity}
                      onChange={event => setInventoryForm(form => ({ ...form, quantity: event.target.value }))}
                      className='mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal'
                    />
                  </label>
                  <label className='text-sm font-medium text-slate-700'>
                    Reorder level
                    <input
                      required
                      type='number'
                      min='0'
                      step='1'
                      value={inventoryForm.reorder_level}
                      onChange={event => setInventoryForm(form => ({ ...form, reorder_level: event.target.value }))}
                      className='mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal'
                    />
                  </label>
                  <label className='text-sm font-medium text-slate-700'>
                    Purchase date
                    <input
                      required
                      type='date'
                      max={inventoryForm.expiry_date || undefined}
                      value={inventoryForm.purchase_date}
                      onChange={event => setInventoryForm(form => ({ ...form, purchase_date: event.target.value }))}
                      className='mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal'
                    />
                  </label>
                  <label className='text-sm font-medium text-slate-700'>
                    Expiry date
                    <input
                      required
                      type='date'
                      min={inventoryForm.purchase_date}
                      value={inventoryForm.expiry_date}
                      onChange={event => setInventoryForm(form => ({ ...form, expiry_date: event.target.value }))}
                      className='mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal'
                    />
                  </label>
                  <label className='text-sm font-medium text-slate-700'>
                    Unit cost
                    <input
                      required
                      type='number'
                      min='0'
                      step='0.01'
                      value={inventoryForm.unit_cost}
                      onChange={event => setInventoryForm(form => ({ ...form, unit_cost: event.target.value }))}
                      className='mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal'
                    />
                  </label>
                  <label className='text-sm font-medium text-slate-700'>
                    Selling price
                    <input
                      required
                      type='number'
                      min='0'
                      step='0.01'
                      value={inventoryForm.selling_price}
                      onChange={event => setInventoryForm(form => ({ ...form, selling_price: event.target.value }))}
                      className='mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal'
                    />
                  </label>
                </div>
                {inventoryMessage && (
                  <p role='alert' className='rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>{inventoryMessage}</p>
                )}
                <div className='flex justify-end gap-3 border-t border-slate-100 pt-4'>
                  <button
                    type='button'
                    onClick={() => setInventoryModalOpen(false)}
                    className='rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50'
                  >
                    Cancel
                  </button>
                  <button
                    type='submit'
                    disabled={inventorySaving || medicines.length === 0}
                    className='inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60'
                  >
                    {inventorySaving ? 'Saving...' : editingBatchId ? 'Save changes' : 'Add supply'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {dashboardSection === 'chat' && (
          <section className='mx-auto flex h-full max-w-6xl flex-col gap-5'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div>
                <div className='flex items-center gap-2'>
                  <MessageCircle className='h-6 w-6 text-blue-700' />
                  <h1 className='text-2xl font-bold text-slate-900'>AI Chatbot</h1>
                </div>
                <p className='mt-1 text-sm text-slate-500'>Ask about stock, expiry, suppliers, and inventory for {user.shop_name}.</p>
              </div>
              <button
                type='button'
                onClick={startNewChat}
                disabled={chatLoading || chatOwner !== user.email.toLowerCase()}
                className='inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50'
              ><Plus className='h-4 w-4' />New chat</button>
            </div>

            <div className='grid min-h-[480px] flex-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]'>
              <aside className='flex min-h-32 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'>
                <div className='border-b border-slate-100 px-4 py-3'>
                  <h2 className='text-sm font-semibold text-slate-800'>Your chats</h2>
                  <p className='mt-0.5 text-xs text-slate-400'>Saved on this device</p>
                </div>
                <div className='max-h-44 flex-1 space-y-1 overflow-y-auto p-2 md:max-h-none'>
                  {chatThreads.length === 0 ? (
                    <p className='px-2 py-4 text-xs text-slate-400'>No saved chats yet.</p>
                  ) : [...chatThreads].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)).map(thread => (
                    <div key={thread.id} className={`group flex items-center gap-1 rounded-lg ${activeChatId === thread.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <button
                        type='button'
                        onClick={() => { setActiveChatId(thread.id); setChatDraft(''); setChatError('') }}
                        disabled={chatLoading}
                        className={`min-w-0 flex-1 px-2.5 py-2 text-left disabled:opacity-60 ${activeChatId === thread.id ? 'text-blue-800' : 'text-slate-700'}`}
                      >
                        <span className='block truncate text-xs font-medium'>{thread.title}</span>
                        <span className='mt-0.5 block text-[10px] text-slate-400'>{new Date(thread.updatedAt).toLocaleDateString()}</span>
                      </button>
                      <button
                        type='button'
                        onClick={() => deleteChatThread(thread.id)}
                        disabled={chatLoading}
                        aria-label={`Delete chat ${thread.title}`}
                        title='Delete chat'
                        className='mr-1 rounded p-1.5 text-slate-400 opacity-100 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100'
                      ><Trash2 className='h-3.5 w-3.5' /></button>
                    </div>
                  ))}
                </div>
              </aside>

            <div className='flex min-h-[480px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'>
              {chatMessages.length > 0 && (
                <div className='border-b border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-500'>
                  {chatThreads.find(thread => thread.id === activeChatId)?.title}
                </div>
              )}
              <div className='flex-1 space-y-4 overflow-y-auto p-4 sm:p-6' aria-live='polite'>
                {chatMessages.length === 0 ? (
                  <div className='mx-auto flex h-full max-w-xl flex-col items-center justify-center py-10 text-center'>
                    <span className='mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700'>
                      <MessageCircle className='h-7 w-7' />
                    </span>
                    <h2 className='text-lg font-semibold text-slate-900'>Ask about your inventory</h2>
                    <p className='mt-2 text-sm leading-6 text-slate-500'>Answers use current stock, batch expiry, and supplier records from your shop.</p>
                    <p className='mt-1 text-xs text-slate-400'>Purchase orders are not stored in this app, so the chatbot can’t report existing order status.</p>
                    <div className='mt-6 flex flex-wrap justify-center gap-2'>
                      {['Which medicines are low on stock?', 'What expires in the next 30 days?', 'Which suppliers have the most stock?'].map(question => (
                        <button
                          key={question}
                          type='button'
                          onClick={() => setChatDraft(question)}
                          className='rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                        >{question}</button>
                      ))}
                    </div>
                  </div>
                ) : chatMessages.map((message, index) => (
                  <div key={`${index}-${message.role}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 sm:max-w-[80%] ${
                      message.role === 'user' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-800'
                    }`}>
                      {message.content
                        ? <div className='min-w-0 break-words'>{renderChatMarkdown(message.content)}</div>
                        : <p className='text-slate-500'>{chatLoading ? 'Thinking…' : 'No response received.'}</p>}
                    </div>
                  </div>
                ))}
              </div>

              {chatError && <p role='alert' className='mx-4 mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>{chatError}</p>}
              <form onSubmit={handleChatSubmit} className='flex items-stretch gap-2 border-t border-slate-100 p-3 sm:p-4'>
                <label className='sr-only' htmlFor='inventory-chat-input'>Ask the inventory chatbot</label>
                <textarea
                  id='inventory-chat-input'
                  value={chatDraft}
                  onChange={event => setChatDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                  maxLength={4000}
                  rows={1}
                  placeholder='Ask about stock, expiry, or suppliers…'
                  className='max-h-36 min-h-12 flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm leading-5 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
                />
                <button
                  type='submit'
                  disabled={!chatDraft.trim() || chatLoading}
                  className='inline-flex min-h-12 shrink-0 self-stretch items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50'
                ><Send className='h-4 w-4' /><span className='hidden sm:inline'>{chatLoading ? 'Replying' : 'Send'}</span></button>
              </form>
              <p className='px-4 pb-3 text-center text-[11px] text-slate-400'>AI can make mistakes. Verify inventory decisions against the batch records.</p>
            </div>
            </div>
          </section>
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
              <div className='mb-3 flex flex-wrap items-start justify-between gap-3'>
                <h2 className='text-lg font-semibold text-slate-900'>{result.medicine_name} <span className='text-sm font-medium text-slate-500'>({result.medicine_id})</span></h2>
                <div className='flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={handleDownloadForecast}
                    disabled={pdfLoading}
                    className='inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50'
                  ><Download className='h-4 w-4' />{pdfLoading ? 'Preparing PDF…' : 'Save PDF'}</button>
                  <button
                    type='button'
                    onClick={() => { setForecastEmail(''); setEmailError(''); setEmailModalOpen(true) }}
                    className='inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800'
                  ><Mail className='h-4 w-4' />Email PDF</button>
                </div>
              </div>
              {emailSent && <p role='status' className='mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800'>{emailSent}</p>}
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

        {emailModalOpen && result && (
          <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4'>
            <section role='dialog' aria-modal='true' aria-labelledby='forecast-email-title' className='w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl'>
              <div className='mb-4 flex items-start justify-between gap-3'>
                <div>
                  <h2 id='forecast-email-title' className='text-lg font-semibold text-slate-900'>Email forecast PDF</h2>
                  <p className='mt-1 text-sm text-slate-500'>Send the {result.medicine_name} report as a PDF attachment.</p>
                </div>
                <button type='button' onClick={() => setEmailModalOpen(false)} disabled={emailSending} aria-label='Close email dialog' className='rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50'>
                  <X className='h-5 w-5' />
                </button>
              </div>
              <form onSubmit={handleEmailForecast} className='space-y-4'>
                <label className='block text-sm font-medium text-slate-700' htmlFor='forecast-recipient-email'>Recipient email
                  <input
                    id='forecast-recipient-email'
                    type='email'
                    required
                    maxLength={254}
                    autoComplete='email'
                    value={forecastEmail}
                    onChange={event => setForecastEmail(event.target.value)}
                    placeholder='name@example.com'
                    className='mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
                  />
                </label>
                {emailError && <p role='alert' className='rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>{emailError}</p>}
                <div className='flex justify-end gap-2 border-t border-slate-100 pt-4'>
                  <button type='button' onClick={() => setEmailModalOpen(false)} disabled={emailSending} className='rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50'>Cancel</button>
                  <button type='submit' disabled={emailSending || !forecastEmail.trim()} className='inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50'>
                    <Mail className='h-4 w-4' />{emailSending ? 'Sending…' : 'Send PDF'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

      </main>
    </div>
  )
}

export default App
