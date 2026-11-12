import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import QRCode from 'qrcode'
import { dashboardApi, paymentApi } from '../services/api'
import { money } from '../utils/formatters'
import StatusBadge from '../components/common/StatusBadge'
import OrderStatusBadge from '../components/common/OrderStatusBadge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Modal from '../components/common/Modal'
import Alert from '../components/common/Alert'
import PaymentReceiptModal from '../components/payments/PaymentReceiptModal'

export default function CustomerDashboardPage() {
  const navigate = useNavigate()
  const outletContext = useOutletContext() || {}
  const companySettings = useMemo(
    () => outletContext.companySettings || {},
    [outletContext.companySettings]
  )

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  // Payment Modal state for customer
  const [payingInvoice, setPayingInvoice] = useState(null)
  const [payAmount, setPayAmount] = useState(0)
  const [payChannel, setPayChannel] = useState('UPI') // 'UPI' | 'Card'
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [upiUri, setUpiUri] = useState('')
  const [copiedKey, setCopiedKey] = useState('')
  const [upiUtr, setUpiUtr] = useState('')
  const [isSubmittingUpi, setIsSubmittingUpi] = useState(false)
  const [upiSuccessMessage, setUpiSuccessMessage] = useState('')
  const [cardConfig, setCardConfig] = useState({ is_configured: false })

  // Card payment state
  const [cardProcessing, setCardProcessing] = useState(false)
  const [cardNumber, setCardNumber] = useState('')
  const [cardExp, setCardExp] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [cardHolder, setCardHolder] = useState('')

  // Receipt Modal state
  const [viewingReceipt, setViewingReceipt] = useState(null)

  const fetchCustomerData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [res, cfg] = await Promise.all([
        dashboardApi.getCustomer(),
        paymentApi.getCardConfig().catch(() => ({ is_configured: false })),
      ])
      setData(res)
      setCardConfig(cfg || { is_configured: false })
    } catch (err) {
      setError(`Failed to load customer dashboard: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchCustomerData()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchCustomerData])

  // Generate dynamic QR code when payment modal is opened
  useEffect(() => {
    let active = true
    if (payingInvoice && payChannel === 'UPI') {
      const vpa = companySettings.upi_id || 'billing@viorabills'
      const compName = companySettings.company_name || 'Viora Bills'
      const amt = Number(payAmount) || Number(payingInvoice.balance_due) || 0

      if (amt > 0) {
        const invRef = payingInvoice.invoice_number || payingInvoice.id
        const uri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(
          compName
        )}&am=${amt.toFixed(2)}&tr=${encodeURIComponent(payingInvoice.id)}&tn=${encodeURIComponent(
          `Bill_${invRef}`
        )}&cu=INR`

        QRCode.toDataURL(uri, {
          width: 190,
          margin: 1,
          color: { dark: '#0f172a', light: '#ffffff' },
        })
          .then((url) => {
            if (active) {
              setQrCodeUrl(url)
              setUpiUri(uri)
            }
          })
          .catch(() => {
            if (active) {
              setQrCodeUrl('')
              setUpiUri('')
            }
          })
      }
    } else {
      Promise.resolve().then(() => {
        if (active) {
          setQrCodeUrl('')
          setUpiUri('')
        }
      })
    }
    return () => {
      active = false
    }
  }, [payingInvoice, payAmount, payChannel, companySettings])

  function handleOpenPayModal(inv) {
    setPayingInvoice(inv)
    setPayAmount(Number(inv.balance_due) || 0)
    setPayChannel('UPI')
    setUpiSuccessMessage('')
    setError('')
  }

  function handleClosePayModal() {
    setPayingInvoice(null)
    setPayAmount(0)
    setQrCodeUrl('')
    setUpiUri('')
    setUpiUtr('')
    setUpiSuccessMessage('')
    setCardNumber('')
    setCardExp('')
    setCardCvv('')
    setCardHolder('')
  }

  function handleCopy(text, key) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(''), 2500)
    }
  }

  // Handle Genuine UPI Reference Submission
  async function handleSubmitUpiReference(e) {
    if (e && e.preventDefault) e.preventDefault()
    if (!payingInvoice) return
    const trimmedUtr = upiUtr.trim()
    if (!trimmedUtr || trimmedUtr.length < 4) {
      setError('Please enter a valid UPI transaction reference / UTR (at least 4 characters).')
      return
    }
    setIsSubmittingUpi(true)
    setError('')
    try {
      const amt = Number(payAmount) || Number(payingInvoice.balance_due) || 0
      const res = await paymentApi.submitUpiReference(payingInvoice.id, {
        reference: trimmedUtr,
        amount: amt,
      })
      setUpiSuccessMessage(
        res.message ||
          `UPI transaction reference ${trimmedUtr} submitted successfully! Status is PENDING verification by the accounts team.`
      )
      setTimeout(async () => {
        handleClosePayModal()
        await fetchCustomerData()
      }, 2500)
    } catch (err) {
      setError(`Failed to submit UPI reference: ${err.message}`)
    } finally {
      setIsSubmittingUpi(false)
    }
  }

  // Handle Card Checkout
  async function handlePayCard(e) {
    e.preventDefault()
    if (!payingInvoice) return
    if (!cardConfig?.is_configured) {
      setError('Card payment gateway is not configured by the merchant. Real card payments are unavailable.')
      return
    }
    setCardProcessing(true)
    setError('')
    try {
      const amt = Number(payAmount)
      await paymentApi.createCardOrder({
        invoice_id: payingInvoice.id,
        amount: amt,
      })
      setError('Live payment gateway redirection required. Simulated card charges are disabled.')
    } catch (err) {
      setError(`Card payment initiation failed: ${err.message}`)
    } finally {
      setCardProcessing(false)
    }
  }

  const handleDownloadPdf = (inv) => {
    const token = localStorage.getItem('viora_access_token') || ''
    const apiBase =
      (typeof import.meta !== 'undefined' &&
        import.meta.env &&
        import.meta.env.VITE_API_BASE_URL) ||
      'http://127.0.0.1:8000'
    window.open(`${apiBase}/invoices/${inv.id}/pdf?token=${encodeURIComponent(token)}`, '_blank')
  }

  if (loading) {
    return <LoadingSpinner message="Loading your customer account…" size="large" />
  }

  const customer = data?.customer || {}
  const stats = data?.stats || {}
  const upcomingDueInvoices = data?.upcoming_due_invoices || []
  const overdueInvoices = data?.overdue_invoices || []
  const recentInvoices = data?.recent_invoices || []
  const recentPayments = data?.recent_payments || []
  const outstanding = Number(stats.outstanding_amount) || 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className={viewingReceipt ? 'no-print' : ''}>
      {/* Customer Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #4338ca 0%, #6366f1 100%)',
          borderRadius: '12px',
          padding: '24px 28px',
          color: '#ffffff',
          boxShadow: '0 4px 14px rgba(99,102,241,0.25)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span
              style={{
                background: 'rgba(255,255,255,0.2)',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
              }}
            >
              Customer Self-Service Portal
            </span>
            <span style={{ fontSize: '13px', opacity: 0.9 }}>
              Account #{customer.id ? customer.id.slice(-6).toUpperCase() : 'VIP'}
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 800 }}>
            Welcome, {customer.name || 'Valued Client'}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', opacity: 0.9 }}>
            Review your invoices, download tax receipts, and pay securely using UPI QR or Debit/Credit Card.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn"
            onClick={fetchCustomerData}
            style={{ background: '#ffffff', color: '#4338ca', fontWeight: 600, border: 'none' }}
          >
            ↻ Refresh Account
          </button>
        </div>
      </div>

      {error && <Alert type="danger" message={error} />}

      {/* Customer Account Summary Card */}
      <div
        className="card"
        style={{
          padding: '20px 24px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: '#e0e7ff',
              color: '#4338ca',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px',
              fontWeight: 700,
            }}
          >
            🏢
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              {customer.name}
            </div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
              ✉️ {customer.email || 'No email registered'} | 📞 {customer.phone || 'No phone registered'}
            </div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
              📍 {customer.billing_address || 'No billing address provided'}, {customer.state || 'India'}
              {customer.gstin && (
                <span style={{ marginLeft: '8px', fontWeight: 600, color: '#2563eb' }}>
                  [GSTIN: {customer.gstin}]
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/customer/profile')}
        >
          ✏️ Edit Profile & Address
        </button>
      </div>

      {/* Outstanding Balance Banner & KPI Cards */}
      <div className="metrics-grid">
        {/* Outstanding Balance Card (Highlighted) */}
        <div
          className="metric-card"
          style={{
            borderLeft: outstanding > 0 ? '4px solid #ef4444' : '4px solid #10b981',
            background: outstanding > 0 ? '#fff5f5' : '#f0fdf4',
          }}
        >
          <div>
            <p className="metric-label" style={{ fontWeight: 700 }}>
              Current Outstanding Balance
            </p>
            <h3
              className="metric-value"
              style={{ color: outstanding > 0 ? '#dc2626' : '#16a34a', fontSize: '24px' }}
            >
              {money(outstanding)}
            </h3>
            <p className="metric-sub">
              {outstanding > 0 ? 'Payment required' : 'All accounts settled!'}
            </p>
          </div>
          <div
            className="metric-icon-wrap"
            style={{
              background: outstanding > 0 ? '#fee2e2' : '#dcfce7',
              color: outstanding > 0 ? '#dc2626' : '#16a34a',
            }}
          >
            {outstanding > 0 ? '⚠️' : '✅'}
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Total Invoiced</p>
            <h3 className="metric-value">{money(stats.total_invoiced_amount || 0)}</h3>
            <p className="metric-sub">{stats.total_invoices_count || 0} total invoices</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#eff6ff', color: '#2563eb' }}>
            📄
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Total Paid</p>
            <h3 className="metric-value" style={{ color: '#059669' }}>
              {money(stats.paid_invoices_amount || stats.total_payments_amount || 0)}
            </h3>
            <p className="metric-sub">{stats.total_payments_count || 0} receipts credited</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
            💳
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Invoices Status</p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
              <span
                style={{
                  background: '#dcfce7',
                  color: '#166534',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {stats.paid_invoices_count || 0} Paid
              </span>
              <span
                style={{
                  background: '#fef3c7',
                  color: '#92400e',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {stats.partially_paid_invoices_count || 0} Partial
              </span>
              <span
                style={{
                  background: '#fee2e2',
                  color: '#991b1b',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {stats.unpaid_invoices_count || 0} Unpaid
              </span>
            </div>
            <p className="metric-sub" style={{ marginTop: '6px' }}>
              {stats.overdue_invoices_count || 0} overdue
            </p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
            📊
          </div>
        </div>

        {/* Active Orders Metric */}
        <div className="metric-card" style={{ borderLeft: '4px solid #2563eb' }}>
          <div>
            <p className="metric-label">Active Orders</p>
            <h3 className="metric-value" style={{ color: '#2563eb' }}>
              {stats.active_orders_count || 0}
            </h3>
            <p className="metric-sub">{stats.pending_orders_count || 0} pending review</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#eff6ff', color: '#2563eb' }}>
            📦
          </div>
        </div>

        {/* Confirmed Purchases Metric */}
        <div className="metric-card" style={{ borderLeft: '4px solid #10b981' }}>
          <div>
            <p className="metric-label">Purchased Items</p>
            <h3 className="metric-value" style={{ color: '#059669' }}>
              {stats.total_purchases_count || 0}
            </h3>
            <p className="metric-sub">Across all billed invoices</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
            🛍️
          </div>
        </div>
      </div>

      {/* Quick Navigation Buttons */}
      <div className="card" style={{ padding: '18px 24px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/customer/catalogue')}
          >
            🛍️ Product Catalogue
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/customer/cart')}
          >
            🛒 Shopping Cart
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/customer/orders')}
          >
            📦 My Orders ({stats.total_orders_count || 0})
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/customer/purchases')}
          >
            🎁 My Purchases
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/customer/invoices')}
          >
            📑 Invoices ({stats.total_invoices_count || 0})
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/customer/payments')}
          >
            🧾 Receipts ({stats.total_payments_count || 0})
          </button>
        </div>
      </div>

      {/* Recent Orders Section */}
      {data?.recent_orders && data.recent_orders.length > 0 && (
        <div className="card" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
              📦 Recent Purchase Orders
            </h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/customer/orders')}
            >
              View All Orders →
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#4b5563' }}>Order #</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#4b5563' }}>Date</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: '#4b5563' }}>Items</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', color: '#4b5563' }}>Total</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: '#4b5563' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_orders.map((ord) => (
                  <tr key={ord.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600, color: '#2563eb' }}>
                      {ord.order_number}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#4b5563' }}>
                      {String(ord.created_at || '').slice(0, 10)}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#374151' }}>
                      {ord.items?.length || 0} items
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>
                      {money(ord.total_amount)}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <OrderStatusBadge status={ord.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upcoming Due & Overdue Invoices Priority Section */}
      {(upcomingDueInvoices.length > 0 || overdueInvoices.length > 0) && (
        <div className="card" style={{ padding: '20px 24px', borderLeft: '4px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#dc2626' }}>
                ⏰ Invoices Requiring Immediate Attention
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                You have upcoming or overdue invoices. Pay online instantly using dynamic UPI QR or card.
              </p>
            </div>
          </div>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Due Date</th>
                  <th>Total Amount</th>
                  <th>Balance Due</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {[...overdueInvoices, ...upcomingDueInvoices]
                  .filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i)
                  .map((inv) => (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 600 }}>{inv.invoice_number || inv.id}</td>
                      <td style={{ fontSize: '12px', color: '#b91c1c', fontWeight: 600 }}>
                        {inv.due_date || 'Immediate'}
                      </td>
                      <td>{money(inv.total_amount)}</td>
                      <td style={{ color: '#dc2626', fontWeight: 700 }}>{money(inv.balance_due)}</td>
                      <td>
                        <StatusBadge status={inv.status} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handleOpenPayModal(inv)}
                            style={{ background: '#059669', borderColor: '#059669' }}
                          >
                            💳 Pay Now
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDownloadPdf(inv)}
                          >
                            ⬇️ PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dual Table: Invoices Requiring Payment & Recent Receipts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
        {/* Outstanding Invoices & Recent Bills */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              📑 My Recent Invoices
            </h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/customer/invoices')}
            >
              All Invoices →
            </button>
          </div>

          {recentInvoices.length === 0 ? (
            <p style={{ color: '#94a3b8', margin: '20px 0', textAlign: 'center' }}>
              No invoices generated yet for your account.
            </p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Due Date</th>
                    <th>Total</th>
                    <th>Balance Due</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => {
                    const hasBalance = Number(inv.balance_due) > 0
                    return (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 600 }}>{inv.invoice_number || inv.id}</td>
                        <td style={{ fontSize: '12px', color: '#64748b' }}>
                          {inv.due_date || inv.invoice_date || 'N/A'}
                        </td>
                        <td>{money(inv.total_amount)}</td>
                        <td style={{ color: hasBalance ? '#dc2626' : '#059669', fontWeight: 700 }}>
                          {money(inv.balance_due)}
                        </td>
                        <td>
                          <StatusBadge status={inv.status} />
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {hasBalance ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => handleOpenPayModal(inv)}
                                style={{ background: '#059669', borderColor: '#059669' }}
                              >
                                💳 Pay Now
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleDownloadPdf(inv)}
                              title="Download official PDF copy"
                            >
                              ⬇️ PDF
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
        </div>

        {/* Recent Payments & Receipts */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              🧾 Recent Payment Receipts
            </h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/customer/payments')}
            >
              All Receipts →
            </button>
          </div>

          {recentPayments.length === 0 ? (
            <p style={{ color: '#94a3b8', margin: '20px 0', textAlign: 'center' }}>
              No payments recorded yet.
            </p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt #</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.receipt_number || p.id}</td>
                      <td style={{ fontSize: '12px', color: '#64748b' }}>{p.payment_date}</td>
                      <td>
                        <span style={{ fontSize: '12px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                          {p.payment_method}
                        </span>
                      </td>
                      <td style={{ color: '#059669', fontWeight: 700 }}>{money(p.amount)}</td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setViewingReceipt(p)}
                          title="View & Print Official Receipt"
                        >
                          🧾 Receipt
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Support & Billing Contact Card */}
      <div
        className="card"
        style={{
          padding: '20px 24px',
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: '#e0e7ff',
              color: '#4338ca',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
            }}
          >
            💬
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '15px' }}>
              Questions about an invoice or payment?
            </div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
              Reach out to {companySettings.company_name || 'Viora Bills Billing Team'}:{' '}
              {companySettings.email && (
                <a href={`mailto:${companySettings.email}`} style={{ color: '#4338ca', fontWeight: 600 }}>
                  ✉️ {companySettings.email}
                </a>
              )}
              {companySettings.phone && (
                <span style={{ marginLeft: '10px' }}>
                  📞 {companySettings.phone}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            const email = companySettings.email || 'support@viorabills.com'
            window.location.href = `mailto:${email}?subject=Billing%20Inquiry%20from%20${encodeURIComponent(customer.name || 'Client')}`
          }}
        >
          ✉️ Email Accounts Team
        </button>
      </div>

      {/* Dynamic Pay Now Modal */}
      {payingInvoice && (
        <Modal
          title={`Secure Online Payment - ${payingInvoice.invoice_number || payingInvoice.id}`}
          onClose={handleClosePayModal}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {upiSuccessMessage && <Alert type="success" message={upiSuccessMessage} />}
            {error && <Alert type="danger" message={error} />}

            {/* Bill Summary Banner */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Billed To</div>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>{customer.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Outstanding Balance</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626' }}>
                  {money(payingInvoice.balance_due)}
                </div>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className={`btn ${payChannel === 'UPI' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, padding: '10px' }}
                onClick={() => setPayChannel('UPI')}
              >
                📱 Dynamic UPI QR
              </button>
              <button
                type="button"
                className={`btn ${payChannel === 'Card' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, padding: '10px' }}
                onClick={() => setPayChannel('Card')}
              >
                💳 Debit / Credit Card
              </button>
            </div>

            {/* Amount input */}
            <div className="form-group">
              <label className="form-label">Payment Amount (₹)</label>
              <input
                type="number"
                step="0.01"
                min="1"
                max={payingInvoice.balance_due}
                className="form-control"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>

            {/* UPI QR Flow */}
            {payChannel === 'UPI' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '12px',
                  padding: '20px',
                  gap: '12px',
                }}
              >
                {qrCodeUrl ? (
                  <img
                    src={qrCodeUrl}
                    alt="Dynamic UPI QR"
                    style={{
                      width: '180px',
                      height: '180px',
                      borderRadius: '8px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    }}
                  />
                ) : (
                  <div style={{ width: '180px', height: '180px', background: '#e2e8f0' }} />
                )}

                <div style={{ textAlign: 'center', fontSize: '13px', color: '#475569' }}>
                  Scan with any UPI App: GPay, PhonePe, Paytm, BHIM, Cred
                </div>

                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    UPI ID: <strong>{companySettings.upi_id || 'billing@viorabills'}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleCopy(companySettings.upi_id || 'billing@viorabills', 'upi')}
                  >
                    {copiedKey === 'upi' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>

                {upiUri && (
                  <a
                    href={upiUri}
                    className="btn btn-secondary btn-sm"
                    style={{ width: '100%', textAlign: 'center', textDecoration: 'none' }}
                  >
                    🚀 Open in UPI App (Mobile)
                  </a>
                )}

                <div style={{ width: '100%', marginTop: '8px' }}>
                  <label className="form-label" style={{ fontSize: '13px', fontWeight: 600 }}>
                    Enter Bank Transaction UTR / Ref Number:
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. 12-digit UTR from your UPI receipt"
                    value={upiUtr}
                    onChange={(e) => setUpiUtr(e.target.value)}
                  />
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                    Payments remain <strong>Pending Verification</strong> until confirmed by accounts.
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px', marginTop: '6px', background: '#059669', borderColor: '#059669' }}
                  disabled={isSubmittingUpi || !upiUtr.trim()}
                  onClick={handleSubmitUpiReference}
                >
                  {isSubmittingUpi ? 'Submitting payment reference…' : '📨 Submit Payment Reference for Verification'}
                </button>
              </div>
            )}

            {/* Card Checkout Flow */}
            {payChannel === 'Card' && (
              <div>
                {!cardConfig?.is_configured ? (
                  <div
                    style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '8px',
                      padding: '16px',
                      color: '#92400e',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                      ⚠️ Online Card Payments Not Configured
                    </div>
                    <div style={{ fontSize: '13px', lineHeight: '1.5' }}>
                      Real debit/credit card payments require payment gateway (Razorpay) credentials to be configured on the server.
                      Simulated card payments have been disabled for security.
                      Please pay securely using the <strong>Dynamic UPI QR Code</strong> or direct Bank Transfer.
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handlePayCard} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">Cardholder Name</label>
                      <input
                        type="text"
                        required
                        placeholder="Name as printed on card"
                        className="form-control"
                        value={cardHolder}
                        onChange={(e) => setCardHolder(e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Card Number</label>
                      <input
                        type="text"
                        required
                        maxLength={19}
                        placeholder="4532 •••• •••• 4242"
                        className="form-control"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="form-group">
                        <label className="form-label">Expiry (MM/YY)</label>
                        <input
                          type="text"
                          required
                          placeholder="12/28"
                          maxLength={5}
                          className="form-control"
                          value={cardExp}
                          onChange={(e) => setCardExp(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">CVV</label>
                        <input
                          type="password"
                          required
                          placeholder="•••"
                          maxLength={4}
                          className="form-control"
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value)}
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={cardProcessing}
                      style={{ width: '100%', padding: '12px', marginTop: '8px' }}
                    >
                      {cardProcessing ? 'Connecting to Payment Gateway…' : `Pay ${money(payAmount)} via Gateway`}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      </div>

      {/* Receipt Modal */}
      {viewingReceipt && (
        <PaymentReceiptModal
          payment={viewingReceipt}
          paymentId={viewingReceipt.payment_id || viewingReceipt.id || viewingReceipt._id}
          companySettings={companySettings}
          onClose={() => setViewingReceipt(null)}
        />
      )}
    </div>
  )
}
