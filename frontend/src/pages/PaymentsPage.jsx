import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import QRCode from 'qrcode'
import { paymentApi, invoiceApi, paymentScheduleApi } from '../services/api'
import { useDebounce } from '../hooks/useDebounce'
import { getTodayDate } from '../utils/constants'
import { money, formatDate } from '../utils/formatters'
import Pagination from '../components/common/Pagination'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Modal from '../components/common/Modal'
import PaymentReceiptModal from '../components/payments/PaymentReceiptModal'

export default function PaymentsPage() {
  const { companySettings, currentUser, setError, setSuccess } = useOutletContext()

  // Transactions list state
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [methodFilter, setMethodFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const debouncedSearch = useDebounce(searchTerm, 300)

  // KPI Summary
  const [summary, setSummary] = useState(null)

  // Payment Recording Modal
  const [showPayModal, setShowPayModal] = useState(false)
  const [invoices, setInvoices] = useState([])
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [activeChannelTab, setActiveChannelTab] = useState('UPI') // 'UPI' | 'Card' | 'Cash' | 'Cheque'
  const [saving, setSaving] = useState(false)

  // Multi-channel Form state
  const [payAmount, setPayAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(getTodayDate())
  const [notes, setNotes] = useState('')

  // UPI Channel fields
  const [upiReference, setUpiReference] = useState('')
  const [upiVerifiedDirect, setUpiVerifiedDirect] = useState(true) // true: verified bank credit; false: pending customer UTR
  const [modalQrCodeUrl, setModalQrCodeUrl] = useState('')
  const [modalUpiUri, setModalUpiUri] = useState('')
  const [copiedKey, setCopiedKey] = useState('')
  const [autoConfirmedUpiPayment, setAutoConfirmedUpiPayment] = useState(null)
  const [showManualUpi, setShowManualUpi] = useState(false)

  // Card Channel fields
  const [cardConfig, setCardConfig] = useState({ is_configured: false })
  const [cardOrder, setCardOrder] = useState(null)
  const [creatingCardOrder, setCreatingCardOrder] = useState(false)

  // Cheque Channel fields
  const [chequeNumber, setChequeNumber] = useState('')
  const [chequeBankName, setChequeBankName] = useState('')
  const [chequeDate, setChequeDate] = useState(getTodayDate())

  // Status Action Modal (for bouncing cheque or rejecting UPI)
  const [actionModal, setActionModal] = useState({ open: false, payment: null, targetStatus: '', reason: '' })
  const [statusUpdating, setStatusUpdating] = useState(false)

  // View mode & Scheduled Payments State
  const [activeViewTab, setActiveViewTab] = useState('records') // 'records' | 'schedules'
  const [schedules, setSchedules] = useState([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState('ALL')

  // Receipt Modal
  const [selectedReceipt, setSelectedReceipt] = useState(null)

  // Fetch pending invoices for the modal dropdown
  const loadInvoices = useCallback(async () => {
    try {
      const res = await invoiceApi.list({ limit: 100, page: 1 })
      const list = res?.items || res?.invoices || (Array.isArray(res) ? res : [])
      setInvoices(list.filter((inv) => Number(inv.balance_due) > 0))
    } catch {
      // Handled silently
    }
  }, [])

  const loadSummary = useCallback(async () => {
    try {
      const data = await paymentApi.getSummary()
      setSummary(data)
    } catch {
      // Handled silently
    }
  }, [])

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    try {
      const data = await paymentApi.list({
        page,
        limit,
        search: debouncedSearch,
        payment_method: methodFilter !== 'ALL' ? methodFilter : undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      })
      const list = data?.items || data?.payments || (Array.isArray(data) ? data : [])
      setPayments(list)
      setTotal(data?.total ?? list.length)
      setTotalPages(data?.total_pages ?? 1)
    } catch (err) {
      setError(`Failed to fetch payments: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, limit, debouncedSearch, methodFilter, statusFilter, startDate, endDate, setError])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchPayments()
        loadSummary()
        loadInvoices()
        paymentApi.getCardConfig().then((cfg) => {
          if (!ignore) setCardConfig(cfg || { is_configured: false })
        }).catch(() => {})
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchPayments, loadSummary, loadInvoices])

  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true)
    try {
      const params = {}
      if (scheduleStatusFilter && scheduleStatusFilter !== 'ALL') {
        params.status = scheduleStatusFilter
      }
      const data = await paymentScheduleApi.list(params)
      setSchedules(data || [])
    } catch (err) {
      setError(`Failed to load payment schedules: ${err.message}`)
    } finally {
      setSchedulesLoading(false)
    }
  }, [scheduleStatusFilter, setError])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore && activeViewTab === 'schedules') {
        loadSchedules()
      }
    })
    return () => {
      ignore = true
    }
  }, [activeViewTab, loadSchedules])

  async function handleCompleteSchedule(scheduleId) {
    if (!window.confirm('Mark this payment schedule as completed? Note: Please ensure the actual payment has also been recorded.')) return
    try {
      await paymentScheduleApi.complete(scheduleId)
      setSuccess('Payment schedule marked as completed.')
      loadSchedules()
    } catch (err) {
      setError(err.message || 'Failed to complete schedule.')
    }
  }

  async function handleCancelSchedule(scheduleId) {
    if (!window.confirm('Are you sure you want to cancel this scheduled payment reminder?')) return
    try {
      await paymentScheduleApi.cancel(scheduleId)
      setSuccess('Payment schedule cancelled.')
      loadSchedules()
    } catch (err) {
      setError(err.message || 'Failed to cancel schedule.')
    }
  }

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        setPage(1)
      }
    })
    return () => {
      ignore = true
    }
  }, [debouncedSearch, methodFilter, statusFilter, startDate, endDate])

  // Handle invoice change inside Record Payment modal
  function handleSelectInvoice(invId) {
    const inv = invoices.find((i) => i.id === invId)
    setSelectedInvoice(inv || null)
    setAutoConfirmedUpiPayment(null)
    setShowManualUpi(false)
    if (inv) {
      const bal = Number(inv.balance_due) || 0
      setPayAmount(bal > 0 ? bal.toFixed(2) : '')
      setCardOrder(null)
    } else {
      setPayAmount('')
      setCardOrder(null)
    }
  }

  // Real-time polling for UPI QR auto-confirmation
  useEffect(() => {
    if (!showPayModal || !selectedInvoice || activeChannelTab !== 'UPI' || autoConfirmedUpiPayment) {
      return
    }

    const invoiceId = selectedInvoice.id
    const initialPaid = Number(selectedInvoice.amount_paid) || 0
    let isCancelled = false

    const pollInterval = setInterval(async () => {
      try {
        const res = await invoiceApi.getPaymentStatus(invoiceId)
        if (isCancelled) return

        if (res && (res.is_paid || Number(res.amount_paid) > initialPaid)) {
          setAutoConfirmedUpiPayment(
            res.latest_payment || {
              receipt_number: `REC-${Date.now().toString().slice(-6)}`,
              amount: Number(payAmount) || res.amount_paid,
              payment_method: 'UPI',
              reference: 'UPI-AUTO-CONFIRMED',
            }
          )
          setSuccess(`🎉 Payment confirmed automatically by bank!`)
          fetchPayments()
          loadSummary()
          loadInvoices()
        }
      } catch {
        // Silently retry
      }
    }, 2000)

    return () => {
      isCancelled = true
      clearInterval(pollInterval)
    }
  }, [showPayModal, selectedInvoice, activeChannelTab, autoConfirmedUpiPayment, payAmount, fetchPayments, loadSummary, loadInvoices, setSuccess])

  // Generate dynamic QR code when invoice and UPI tab are active
  useEffect(() => {
    let active = true
    const vpa = companySettings?.upi_id || ''
    const compName = companySettings?.company_name || 'Viora Bills'
    const amt = Number(payAmount) || 0

    if (selectedInvoice && vpa && amt > 0 && activeChannelTab === 'UPI') {
      const invRef = selectedInvoice.invoice_number || selectedInvoice.id
      const uri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(
        compName
      )}&am=${amt.toFixed(2)}&tr=${encodeURIComponent(selectedInvoice.id)}&tn=${encodeURIComponent(
        `Bill_${invRef}`
      )}&cu=INR`

      QRCode.toDataURL(uri, {
        width: 170,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
        .then((url) => {
          if (active) {
            setModalQrCodeUrl(url)
            setModalUpiUri(uri)
          }
        })
        .catch(() => {
          if (active) {
            setModalQrCodeUrl('')
            setModalUpiUri('')
          }
        })
    } else {
      Promise.resolve().then(() => {
        if (active) {
          setModalQrCodeUrl('')
          setModalUpiUri('')
        }
      })
    }
    return () => {
      active = false
    }
  }, [selectedInvoice, payAmount, companySettings, activeChannelTab])

  function handleCopy(text, key) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(''), 2500)
    }
  }

  // Initiate Card Gateway Order
  async function handleInitCardOrder() {
    if (!selectedInvoice) {
      setError('Please select an invoice first.')
      return
    }
    if (!cardConfig?.is_configured) {
      setError('Payment gateway credentials (Razorpay) are not configured on the server. Online card payments are unavailable.')
      return
    }
    const amt = Number(payAmount)
    if (isNaN(amt) || amt <= 0) {
      setError('Please specify a valid payment amount.')
      return
    }

    setCreatingCardOrder(true)
    setError('')
    try {
      const res = await paymentApi.createCardOrder({
        invoice_id: selectedInvoice.id,
        amount: amt,
      })
      setCardOrder(res)
      setSuccess(`Card order ${res.order_id} generated. Connect customer to gateway checkout to complete.`)
    } catch (err) {
      setError(`Card order initiation failed: ${err.message}`)
    } finally {
      setCreatingCardOrder(false)
    }
  }

  // Record Manual Cash, Cheque, or UPI Payment
  async function handleSubmitPayment(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!selectedInvoice) {
      setError('Please select an invoice to apply payment.')
      return
    }

    const amt = Number(payAmount)
    if (isNaN(amt) || amt <= 0) {
      setError('Payment amount must be greater than zero.')
      return
    }

    const bal = Number(selectedInvoice.balance_due) || 0
    if (amt > bal) {
      setError(`Payment amount of ${money(amt)} exceeds the balance due of ${money(bal)}.`)
      return
    }

    setSaving(true)
    try {
      const payload = {
        invoice_id: selectedInvoice.id,
        amount: amt,
        payment_method: activeChannelTab,
        payment_date: paymentDate || getTodayDate(),
        notes: notes.trim() || null,
      }

      if (activeChannelTab === 'UPI') {
        payload.reference = upiReference.trim() || null
        payload.is_verified = upiVerifiedDirect
      } else if (activeChannelTab === 'Cheque') {
        if (!chequeNumber.trim()) {
          setError('Cheque number is required.')
          setSaving(false)
          return
        }
        if (!chequeBankName.trim()) {
          setError('Bank name is required for cheque payments.')
          setSaving(false)
          return
        }
        payload.cheque_number = chequeNumber.trim()
        payload.bank_name = chequeBankName.trim()
        payload.cheque_date = chequeDate || getTodayDate()
      }

      const res = await paymentApi.create(payload)

      setSuccess(
        activeChannelTab === 'Cheque'
          ? `Cheque payment recorded as PENDING. Receipt: ${res.payment?.receipt_number || 'Generated'}`
          : `Payment of ${money(amt)} recorded successfully. Receipt: ${res.payment?.receipt_number || 'Generated'}`
      )

      setShowPayModal(false)
      setSelectedInvoice(null)
      setPayAmount('')
      setUpiReference('')
      setChequeNumber('')
      setChequeBankName('')
      setNotes('')

      await fetchPayments()
      await loadSummary()
      await loadInvoices()
    } catch (err) {
      setError(`Could not record payment: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Handle status update (e.g. Clear cheque, Bounce cheque, Verify UPI)
  async function handleConfirmStatusUpdate() {
    if (!actionModal.payment || !actionModal.targetStatus) return
    setStatusUpdating(true)
    setError('')
    try {
      await paymentApi.updateStatus(actionModal.payment.id, {
        new_status: actionModal.targetStatus,
        reason: actionModal.reason?.trim() || null,
      })
      setSuccess(`Payment status transitioned to ${actionModal.targetStatus}.`)
      setActionModal({ open: false, payment: null, targetStatus: '', reason: '' })
      await fetchPayments()
      await loadSummary()
      await loadInvoices()
    } catch (err) {
      setError(`Status update failed: ${err.message}`)
    } finally {
      setStatusUpdating(false)
    }
  }



  function renderStatusPill(status, method) {
    const s = (status || 'SUCCESS').toUpperCase()
    if (s === 'SUCCESS' || s === 'CLEARED') {
      return (
        <span
          className="badge"
          style={{ backgroundColor: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}
        >
          {s === 'CLEARED' ? 'Cleared' : 'Paid'}
        </span>
      )
    }
    if (s === 'PENDING') {
      return (
        <span
          className="badge"
          style={{ backgroundColor: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}
        >
          {method === 'Cheque' ? 'Cheque Pending' : 'Pending'}
        </span>
      )
    }
    if (s === 'PENDING_VERIFICATION') {
      return (
        <span
          className="badge"
          style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
        >
          Awaiting Verification
        </span>
      )
    }
    if (s === 'BOUNCED') {
      return (
        <span
          className="badge"
          style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}
        >
          Bounced
        </span>
      )
    }
    return (
      <span
        className="badge"
        style={{ backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}
      >
        {s}
      </span>
    )
  }

  return (
    <div>
      <div className={selectedReceipt ? 'no-print' : ''}>
      {/* ─── 1. Payment Dashboard Metrics ────────────────────────────────────── */}
      <div className="metrics-grid" style={{ marginBottom: '20px' }}>
        <div className="card metric-card">
          <div className="metric-header">
            <span className="metric-title">Total Received</span>
            <span className="metric-icon" style={{ color: '#059669' }}>
              💰
            </span>
          </div>
          <div className="metric-value" style={{ color: '#059669' }}>
            {money(summary?.total_received ?? 0)}
          </div>
          <div className="metric-footer">
            <span>Cleared & Confirmed Settlements</span>
          </div>
        </div>

        <div className="card metric-card">
          <div className="metric-header">
            <span className="metric-title">Total Pending</span>
            <span className="metric-icon" style={{ color: '#d97706' }}>
              ⏳
            </span>
          </div>
          <div className="metric-value" style={{ color: '#d97706' }}>
            {money(summary?.total_pending ?? 0)}
          </div>
          <div className="metric-footer">
            <span>Pending Cheques & UPI Verifications</span>
          </div>
        </div>

        <div className="card metric-card">
          <div className="metric-header">
            <span className="metric-title">Cash & UPI</span>
            <span className="metric-icon" style={{ color: '#2563eb' }}>
              📱
            </span>
          </div>
          <div className="metric-value">
            {money((summary?.total_cash ?? 0) + (summary?.total_upi ?? 0))}
          </div>
          <div className="metric-footer">
            <span>Cash: {money(summary?.total_cash ?? 0)} | UPI: {money(summary?.total_upi ?? 0)}</span>
          </div>
        </div>

        <div className="card metric-card">
          <div className="metric-header">
            <span className="metric-title">Cheques & Cards</span>
            <span className="metric-icon" style={{ color: '#7c3aed' }}>
              🏛️
            </span>
          </div>
          <div className="metric-value">
            {money((summary?.total_cleared_cheque ?? 0) + (summary?.total_card ?? 0))}
          </div>
          <div className="metric-footer">
            <span>
              Cleared: {money(summary?.total_cleared_cheque ?? 0)} | Bounced: {money(summary?.total_bounced_failed ?? 0)}
            </span>
          </div>
        </div>
      </div>

      {/* ─── 2. Top Action & Filter Bar ──────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 className="card-title">Payment Receipts & Settlement Center</h3>
            <p className="card-desc">
              Audit trail of customer payments, transaction references, dynamic UPI QR, and cheque lifecycles
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '6px', padding: '3px' }}>
              <button
                type="button"
                onClick={() => setActiveViewTab('records')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  background: activeViewTab === 'records' ? '#ffffff' : 'transparent',
                  fontWeight: activeViewTab === 'records' ? 700 : 500,
                  color: activeViewTab === 'records' ? '#1e3a8a' : '#64748b',
                  boxShadow: activeViewTab === 'records' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Payment Records ({total})
              </button>
              <button
                type="button"
                onClick={() => setActiveViewTab('schedules')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  background: activeViewTab === 'schedules' ? '#ffffff' : 'transparent',
                  fontWeight: activeViewTab === 'schedules' ? 700 : 500,
                  color: activeViewTab === 'schedules' ? '#1e3a8a' : '#64748b',
                  boxShadow: activeViewTab === 'schedules' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                ⏰ Scheduled Payments
              </button>
            </div>
            <a
              href={paymentApi.getCsvUrl()}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              title="Export complete payment history to CSV"
            >
              📥 Export CSV
            </a>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setShowPayModal(true)
                setSelectedInvoice(null)
                setPayAmount('')
                setCardOrder(null)
              }}
            >
              + Record Payment
            </button>
          </div>
        </div>

        {/* Filters */}
        <div
          style={{
            marginTop: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', flex: 1, maxWidth: '380px' }}>
            <input
              className="form-control"
              type="search"
              placeholder="Search receipt #, invoice, customer, reference…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#64748b' }}>Method:</span>
            <select
              className="form-control"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              style={{ width: 'auto', padding: '4px 8px', height: '32px' }}
            >
              <option value="ALL">All Methods</option>
              <option value="UPI">UPI</option>
              <option value="Card">Debit/Credit Card</option>
              <option value="Cash">Cash</option>
              <option value="Cheque">Cheque</option>
              <option value="Bank Transfer">Bank Transfer</option>
            </select>

            <span style={{ fontSize: '13px', color: '#64748b', marginLeft: '6px' }}>Status:</span>
            <select
              className="form-control"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: 'auto', padding: '4px 8px', height: '32px' }}
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">Paid / Cleared</option>
              <option value="PENDING">Pending Cheque</option>
              <option value="PENDING_VERIFICATION">Awaiting UPI Verification</option>
              <option value="BOUNCED">Bounced</option>
              <option value="FAILED">Failed / Cancelled</option>
            </select>

            <input
              className="form-control"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              title="Start Date"
              style={{ width: '135px' }}
            />
            <span style={{ color: '#94a3b8' }}>–</span>
            <input
              className="form-control"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              title="End Date"
              style={{ width: '135px' }}
            />
            {(startDate || endDate) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setStartDate('')
                  setEndDate('')
                }}
                title="Clear date filters"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {activeViewTab === 'records' ? (
        /* ─── 3. Payments Table ──────────────────────────────────────────────── */
        <div className="card">
        {loading ? (
          <LoadingSpinner message="Fetching payment records…" />
        ) : payments.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💳</div>
            <h4>No payment transactions found</h4>
            <p>Try refining your search or method filters, or record a new customer payment.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Receipt #</th>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reference / Cheque</th>
                  <th>Recorded By</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const pStatus = (p.status || 'SUCCESS').toUpperCase()
                  const pMethod = p.payment_method || 'Cash'

                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600, color: '#1e293b' }}>
                        {p.receipt_number || `REC-${p.id.slice(-6)}`}
                      </td>
                      <td>{formatDate(p.payment_date)}</td>
                      <td>
                        <span className="mono-text" style={{ color: '#2563eb' }}>
                          {p.invoice_number || p.invoice_id}
                        </span>
                      </td>
                      <td>{p.customer_name || '—'}</td>
                      <td>
                        <span style={{ fontWeight: 500 }}>{pMethod}</span>
                      </td>
                      <td style={{ fontWeight: 700, color: '#0f172a' }}>{money(p.amount)}</td>
                      <td>{renderStatusPill(pStatus, pMethod)}</td>
                      <td style={{ fontSize: '12px' }}>
                        {p.cheque_number ? (
                          <div>
                            <strong>No:</strong> {p.cheque_number}
                            <div style={{ color: '#64748b', fontSize: '11px' }}>{p.bank_name}</div>
                          </div>
                        ) : p.reference ? (
                          <span className="mono-text" title={p.reference}>
                            {p.reference.length > 18 ? `${p.reference.slice(0, 16)}…` : p.reference}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: '12px', color: '#64748b' }}>
                        {p.recorded_by_name || p.recorded_by || 'System'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          {/* Cheque Actions */}
                          {pStatus === 'PENDING' && (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ color: '#059669', borderColor: '#a7f3d0' }}
                                onClick={() =>
                                  setActionModal({
                                    open: true,
                                    payment: p,
                                    targetStatus: 'CLEARED',
                                    reason: 'Funds cleared by bank',
                                  })
                                }
                                title="Mark Cheque Cleared"
                              >
                                ✓ Clear
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ color: '#dc2626', borderColor: '#fecaca' }}
                                onClick={() =>
                                  setActionModal({
                                    open: true,
                                    payment: p,
                                    targetStatus: 'BOUNCED',
                                    reason: '',
                                  })
                                }
                                title="Mark Cheque Bounced"
                              >
                                ✕ Bounce
                              </button>
                            </>
                          )}

                          {/* UPI Verification Action */}
                          {pStatus === 'PENDING_VERIFICATION' && (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ color: '#059669', borderColor: '#a7f3d0' }}
                                onClick={() =>
                                  setActionModal({
                                    open: true,
                                    payment: p,
                                    targetStatus: 'SUCCESS',
                                    reason: 'Confirmed against bank credit',
                                  })
                                }
                                title="Verify Bank Credit"
                              >
                                ✓ Verify
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ color: '#dc2626', borderColor: '#fecaca' }}
                                onClick={() =>
                                  setActionModal({
                                    open: true,
                                    payment: p,
                                    targetStatus: 'FAILED',
                                    reason: 'UTR mismatch or uncredited',
                                  })
                                }
                                title="Reject Transaction"
                              >
                                ✕ Reject
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setSelectedReceipt(p)}
                            title="View Official Receipt"
                          >
                            🧾 Receipt
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={total}
          itemsPerPage={limit}
          onPageChange={setPage}
          onLimitChange={(l) => {
            setLimit(l)
            setPage(1)
          }}
        />
      </div>
      ) : (
        /* ─── Scheduled Payments View ────────────────────────────────────────── */
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {['ALL', 'PLANNED', 'OVERDUE', 'COMPLETED', 'CANCELLED'].map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`btn btn-sm ${scheduleStatusFilter === st ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setScheduleStatusFilter(st)}
                >
                  {st}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={loadSchedules}
              disabled={schedulesLoading}
            >
              🔄 Refresh Schedules
            </button>
          </div>

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: '#1e40af' }}>
            ℹ️ <strong>Reminder Notice:</strong> Payment schedules are planned payment commitments. Marking a schedule complete updates its reminder status. When receiving payment, use "+ Record Payment" to credit the invoice balance.
          </div>

          {schedulesLoading ? (
            <LoadingSpinner message="Loading payment schedules…" />
          ) : schedules.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⏰</div>
              <h4>No payment schedules found</h4>
              <p>There are no scheduled payment reminders matching the selected status.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Invoice #</th>
                    <th>Scheduled Date</th>
                    <th>Planned Amount</th>
                    <th>Method</th>
                    <th>Notes</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((sch) => {
                    const isOverdue = sch.status === 'OVERDUE'
                    const isCompleted = sch.status === 'COMPLETED'

                    return (
                      <tr key={sch.id}>
                        <td style={{ fontWeight: 600 }}>{sch.customer_name || 'Customer'}</td>
                        <td style={{ fontWeight: 700, color: '#1e3a8a' }}>{sch.invoice_number}</td>
                        <td style={{ fontWeight: isOverdue ? 700 : 500, color: isOverdue ? '#dc2626' : '#334155' }}>
                          {formatDate(sch.scheduled_date)}
                          {isOverdue && (
                            <span style={{ marginLeft: '6px', fontSize: '10px', background: '#fee2e2', color: '#dc2626', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                              OVERDUE
                            </span>
                          )}
                        </td>
                        <td style={{ fontWeight: 700, color: '#0f172a' }}>{money(sch.planned_amount)}</td>
                        <td>
                          <span style={{ fontSize: '12px', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                            {sch.payment_method}
                          </span>
                        </td>
                        <td style={{ fontSize: '12px', color: '#64748b', maxWidth: '200px' }}>
                          {sch.notes || '—'}
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: isCompleted ? '#dcfce7' : sch.status === 'CANCELLED' ? '#f1f5f9' : isOverdue ? '#fee2e2' : '#dbeafe',
                              color: isCompleted ? '#15803d' : sch.status === 'CANCELLED' ? '#64748b' : isOverdue ? '#b91c1c' : '#1d4ed8',
                            }}
                          >
                            {sch.status}
                          </span>
                        </td>
                        <td>
                          {sch.status === 'PLANNED' || sch.status === 'OVERDUE' ? (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                style={{ padding: '3px 8px', fontSize: '11px', background: '#059669', borderColor: '#059669' }}
                                onClick={() => handleCompleteSchedule(sch.id)}
                                title="Mark this schedule as completed"
                              >
                                ✓ Complete
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '3px 8px', fontSize: '11px', color: '#dc2626', borderColor: '#fca5a5' }}
                                onClick={() => handleCancelSchedule(sch.id)}
                                title="Cancel schedule"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: '12px', color: '#94a3b8' }}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── 4. Multi-Channel Record Payment Modal ──────────────────────────── */}
      {showPayModal && (
        <Modal
          title={autoConfirmedUpiPayment ? 'Payment Confirmed' : 'Record Customer Payment'}
          onClose={() => {
            setShowPayModal(false)
            setAutoConfirmedUpiPayment(null)
          }}
          maxWidth="700px"
        >
          {autoConfirmedUpiPayment ? (
            <div style={{ textAlign: 'center', padding: '24px 16px' }}>
              <div
                style={{
                  width: '68px',
                  height: '68px',
                  borderRadius: '50%',
                  background: '#dcfce7',
                  color: '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '34px',
                  margin: '0 auto 16px',
                  border: '2px solid #86efac',
                }}
              >
                ✓
              </div>
              <h3 style={{ margin: '0 0 6px 0', color: '#15803d', fontSize: '20px', fontWeight: 800 }}>
                Payment Successful!
              </h3>
              <p style={{ margin: '0 0 20px 0', color: '#4b5563', fontSize: '13px' }}>
                Transaction verified and confirmed by bank via UPI instant banking.
              </p>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '16px 20px',
                  textAlign: 'left',
                  fontSize: '13px',
                  marginBottom: '24px',
                  lineHeight: 1.9,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                  <span style={{ color: '#64748b' }}>Receipt Number:</span>
                  <strong className="mono-text" style={{ color: '#2563eb' }}>
                    {autoConfirmedUpiPayment.receipt_number || 'REC-CONFIRMED'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Against Invoice:</span>
                  <strong className="mono-text">{selectedInvoice?.invoice_number || selectedInvoice?.id}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Amount Received:</span>
                  <strong style={{ color: '#16a34a', fontSize: '16px' }}>
                    {money(autoConfirmedUpiPayment.amount || payAmount)}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Payment Mode:</span>
                  <span style={{ fontWeight: 600 }}>UPI Dynamic QR (Verified)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Bank Reference / UTR:</span>
                  <span className="mono-text" style={{ fontSize: '12px' }}>
                    {autoConfirmedUpiPayment.reference || 'UPI-SETTLED'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {autoConfirmedUpiPayment.id && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowPayModal(false)
                      setSelectedReceipt(autoConfirmedUpiPayment)
                    }}
                  >
                    🧾 View Official Receipt
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setShowPayModal(false)
                    setAutoConfirmedUpiPayment(null)
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Channel Tabs */}
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  borderBottom: '2px solid #e2e8f0',
                  marginBottom: '16px',
                  paddingBottom: '2px',
                }}
              >
                {[
                  { id: 'UPI', label: '📱 UPI / QR Code' },
                  { id: 'Card', label: '💳 Debit / Credit Card' },
                  { id: 'Cash', label: '💵 Cash Entry' },
                  { id: 'Cheque', label: '🏛️ Cheque Entry' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveChannelTab(tab.id)}
                    style={{
                      padding: '8px 14px',
                      border: 'none',
                      background: 'none',
                      fontWeight: activeChannelTab === tab.id ? 700 : 500,
                      color: activeChannelTab === tab.id ? '#2563eb' : '#64748b',
                      borderBottom: activeChannelTab === tab.id ? '2px solid #2563eb' : 'none',
                      marginBottom: '-4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmitPayment}>
                {/* Invoice Selector */}
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label">Target Invoice *</label>
                  <select
                    className="form-control"
                    value={selectedInvoice?.id || ''}
                    onChange={(e) => handleSelectInvoice(e.target.value)}
                    required
                  >
                    <option value="">-- Choose outstanding invoice --</option>
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number || inv.id} — Due: {money(inv.balance_due)} ({inv.status})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedInvoice && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      padding: '10px 14px',
                      marginBottom: '14px',
                      fontSize: '13px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div>
                        Invoice Total: <strong>{money(selectedInvoice.total_amount)}</strong>
                      </div>
                      <div>
                        Previously Paid: <strong>{money(selectedInvoice.amount_paid)}</strong>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#64748b' }}>Current Balance Due:</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: '#dc2626' }}>
                        {money(selectedInvoice.balance_due)}
                      </div>
                    </div>
                  </div>
                )}

                {/* CHANNEL 1: UPI / SCAN QR */}
                {activeChannelTab === 'UPI' && (
                  <div>
                    <div
                      style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '8px',
                        padding: '14px',
                        marginBottom: '16px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <h5 style={{ margin: 0, fontSize: '14px', color: '#1e40af' }}>
                          Dynamic UPI Payment QR
                        </h5>
                        <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600 }}>
                          GPay • PhonePe • Paytm • BHIM
                        </span>
                      </div>

                      {companySettings?.upi_id ? (
                        <div>
                          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                            {modalQrCodeUrl ? (
                              <img
                                src={modalQrCodeUrl}
                                alt="Dynamic UPI QR"
                                style={{
                                  width: '130px',
                                  height: '130px',
                                  background: '#ffffff',
                                  padding: '4px',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '6px',
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: '130px',
                                  height: '130px',
                                  background: '#e2e8f0',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '11px',
                                  color: '#64748b',
                                  borderRadius: '6px',
                                }}
                              >
                                Select invoice to generate QR
                              </div>
                            )}
                            <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.6, flex: 1 }}>
                              <div>
                                VPA: <strong className="mono-text">{companySettings?.upi_id}</strong>{' '}
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ padding: '2px 6px', fontSize: '10px' }}
                                  onClick={() => handleCopy(companySettings?.upi_id, 'modal_vpa')}
                                >
                                  {copiedKey === 'modal_vpa' ? '✓ Copied' : 'Copy'}
                                </button>
                              </div>
                              <div style={{ marginTop: '2px' }}>
                                Payee: <strong>{companySettings.company_name || 'Viora Bills'}</strong>
                              </div>
                              <div style={{ marginTop: '2px' }}>
                                Amount:{' '}
                                <strong style={{ color: '#2563eb' }}>
                                  {payAmount ? money(payAmount) : '—'}
                                </strong>{' '}
                                {payAmount && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ padding: '2px 6px', fontSize: '10px' }}
                                    onClick={() => handleCopy(payAmount, 'modal_amt')}
                                  >
                                    {copiedKey === 'modal_amt' ? '✓ Copied' : 'Copy'}
                                  </button>
                                )}
                              </div>
                              {companySettings.bank_name && (
                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                  Bank: <strong>{companySettings.bank_name}</strong>
                                  {companySettings.account_number ? ` (A/C: ${companySettings.account_number})` : ''}
                                  {companySettings.ifsc_code ? ` | IFSC: ${companySettings.ifsc_code}` : ''}
                                </div>
                              )}
                              {modalUpiUri && (
                                <div style={{ marginTop: '8px' }}>
                                  <a
                                    href={modalUpiUri}
                                    className="btn btn-primary btn-sm"
                                    style={{ padding: '4px 8px', fontSize: '11px', textDecoration: 'none' }}
                                  >
                                    📱 Pay in UPI App
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Real-time Listening Card */}
                          {selectedInvoice && (
                            <div
                              style={{
                                background: '#f0fdf4',
                                border: '1px solid #86efac',
                                borderRadius: '8px',
                                padding: '12px 14px',
                                marginTop: '14px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span className="upi-pulse-dot" />
                                <div>
                                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#166534' }}>
                                    Waiting for UPI payment...
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#15803d' }}>
                                    Live settlement will be recorded once verified.
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          <div style={{ marginTop: '10px', textAlign: 'right' }}>
                            <button
                              type="button"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#64748b',
                                fontSize: '11px',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                padding: 0,
                              }}
                              onClick={() => setShowManualUpi(!showManualUpi)}
                            >
                              {showManualUpi ? 'Hide manual UTR entry' : 'Staff manual fallback: Enter UTR manually'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#b45309', fontSize: '13px' }}>
                          Business UPI ID is not configured. Admin can configure VPA in Settings.
                        </div>
                      )}
                    </div>

                    <div className="form-group" style={{ marginBottom: '12px' }}>
                      <label className="form-label">Payment Amount (₹) *</label>
                      <input
                        className="form-control"
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        required
                      />
                    </div>

                    {showManualUpi && (
                      <>
                        <div className="form-group" style={{ marginBottom: '12px' }}>
                          <label className="form-label">UPI Reference / UTR Number</label>
                          <input
                            className="form-control"
                            type="text"
                            placeholder="12-digit UPI reference number (e.g. 432109876543)"
                            value={upiReference}
                            onChange={(e) => setUpiReference(e.target.value)}
                          />
                        </div>

                        <div className="form-group" style={{ marginBottom: '14px' }}>
                          <label className="form-label">Verification Status</label>
                          <div style={{ display: 'flex', gap: '14px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                              <input
                                type="radio"
                                name="upiVerify"
                                checked={upiVerifiedDirect}
                                onChange={() => setUpiVerifiedDirect(true)}
                              />
                              <span>Confirmed in Bank (Mark as Paid)</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                              <input
                                type="radio"
                                name="upiVerify"
                                checked={!upiVerifiedDirect}
                                onChange={() => setUpiVerifiedDirect(false)}
                              />
                              <span>Customer Claim (Mark Pending Verification)</span>
                            </label>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

            {/* CHANNEL 2: DEBIT / CREDIT CARD */}
            {activeChannelTab === 'Card' && (
              <div>
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '14px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h5 style={{ margin: 0, fontSize: '14px', color: '#1e293b' }}>
                      Payment Gateway Integration
                    </h5>
                    <span
                      className="badge"
                      style={{ backgroundColor: '#e2e8f0', color: '#475569' }}
                    >
                      Razorpay Checkout
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: '6px 0 12px 0' }}>
                    Secure PCI-DSS compliant checkout. Card details are never collected or stored in Viora Bills.
                  </p>

                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label className="form-label">Card Charge Amount (₹) *</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      required
                    />
                  </div>

                  {!cardConfig?.is_configured ? (
                    <div
                      style={{
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: '6px',
                        padding: '12px',
                        fontSize: '13px',
                        color: '#92400e',
                      }}
                    >
                      <strong>⚠️ Gateway Not Configured:</strong> Real card checkout requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server. Simulated card charges are disabled. Please record as Cash, Cheque, or verified UPI.
                    </div>
                  ) : !cardOrder ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleInitCardOrder}
                      disabled={creatingCardOrder || !selectedInvoice}
                    >
                      {creatingCardOrder ? 'Creating Order…' : '💳 Generate Gateway Order'}
                    </button>
                  ) : (
                    <div style={{ background: '#f1f5f9', padding: '10px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '12px', marginBottom: '8px' }}>
                        Order ID: <strong className="mono-text">{cardOrder.order_id}</strong>
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>
                        Connect customer to live gateway payment checkout URL to capture payment.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CHANNEL 3: CASH ENTRY */}
            {activeChannelTab === 'Cash' && (
              <div>
                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label className="form-label">Cash Amount Received (₹) *</label>
                  <input
                    className="form-control"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label className="form-label">Payment Date</label>
                  <input
                    className="form-control"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label className="form-label">Cash Received By</label>
                  <input
                    className="form-control"
                    type="text"
                    value={`${currentUser?.full_name || ''} (${currentUser?.email || ''})`}
                    disabled
                  />
                </div>
              </div>
            )}

            {/* CHANNEL 4: CHEQUE ENTRY */}
            {activeChannelTab === 'Cheque' && (
              <div>
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    padding: '10px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#92400e',
                    marginBottom: '14px',
                  }}
                >
                  ⚠️ <strong>Notice:</strong> Cheque payments are saved with <strong>PENDING</strong> status.
                  The invoice balance will <em>not</em> be reduced until an authorized user verifies bank clearance.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label className="form-label">Cheque Number *</label>
                    <input
                      className="form-control"
                      type="text"
                      placeholder="e.g. 452109"
                      value={chequeNumber}
                      onChange={(e) => setChequeNumber(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Bank Name *</label>
                    <input
                      className="form-control"
                      type="text"
                      placeholder="e.g. State Bank of India"
                      value={chequeBankName}
                      onChange={(e) => setChequeBankName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label className="form-label">Cheque Date *</label>
                    <input
                      className="form-control"
                      type="date"
                      value={chequeDate}
                      onChange={(e) => setChequeDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Cheque Amount (₹) *</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Common Notes field */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">Audit Notes (Optional)</label>
              <textarea
                className="form-control"
                rows="2"
                placeholder="Internal settlement notes, drawer details, branch, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Modal Actions */}
            {activeChannelTab !== 'Card' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  {activeChannelTab === 'UPI' && !showManualUpi && (
                    <span style={{ fontSize: '12px', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="upi-pulse-dot" style={{ width: '8px', height: '8px' }} />
                      Listening for bank credit…
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowPayModal(false)
                      setAutoConfirmedUpiPayment(null)
                    }}
                  >
                    Cancel
                  </button>
                  {(activeChannelTab !== 'UPI' || showManualUpi) && (
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={saving || !selectedInvoice}
                    >
                      {saving ? 'Processing…' : 'Record Payment'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </Modal>
  )}

      {/* ─── 5. Status Transition Modal (Clear / Bounce / Reject) ─────────────── */}
      {actionModal.open && (
        <Modal
          title={`Transition Payment: ${actionModal.targetStatus}`}
          onClose={() => setActionModal({ open: false, payment: null, targetStatus: '', reason: '' })}
          maxWidth="480px"
        >
          <div>
            <p style={{ fontSize: '13px', color: '#475569' }}>
              You are updating payment <strong>{actionModal.payment?.receipt_number || actionModal.payment?.id}</strong>{' '}
              of <strong>{money(actionModal.payment?.amount)}</strong> to status{' '}
              <strong style={{ color: actionModal.targetStatus === 'CLEARED' ? '#059669' : '#dc2626' }}>
                {actionModal.targetStatus}
              </strong>
              .
            </p>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">
                {actionModal.targetStatus === 'BOUNCED'
                  ? 'Bounce Reason *'
                  : 'Action Notes / Reference'}
              </label>
              <input
                className="form-control"
                type="text"
                placeholder={
                  actionModal.targetStatus === 'BOUNCED'
                    ? 'e.g. Insufficient funds, signature mismatch'
                    : 'e.g. Cleared via clearing house'
                }
                value={actionModal.reason}
                onChange={(e) => setActionModal((m) => ({ ...m, reason: e.target.value }))}
                required={actionModal.targetStatus === 'BOUNCED'}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActionModal({ open: false, payment: null, targetStatus: '', reason: '' })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmStatusUpdate}
                disabled={statusUpdating}
              >
                {statusUpdating ? 'Updating…' : 'Confirm Transition'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      </div>

      {/* ─── 6. Printable Payment Receipt Modal ──────────────────────────────── */}
      {selectedReceipt && (
        <PaymentReceiptModal
          payment={selectedReceipt}
          companySettings={companySettings}
          onClose={() => setSelectedReceipt(null)}
        />
      )}
    </div>
  )
}
