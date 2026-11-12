import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import QRCode from 'qrcode'
import { invoiceApi, customerApi, productApi, paymentApi } from '../services/api'
import { useDebounce } from '../hooks/useDebounce'
import { getTodayDate, getFutureDate, INDIAN_STATES } from '../utils/constants'
import { money, formatDate } from '../utils/formatters'
import Pagination from '../components/common/Pagination'
import LoadingSpinner from '../components/common/LoadingSpinner'
import StatusBadge from '../components/common/StatusBadge'
import Modal from '../components/common/Modal'
import InvoiceDetailModal from '../components/invoices/InvoiceDetailModal'

export default function InvoicesPage() {
  const outletCtx = useOutletContext() || {}
  const companySettings = outletCtx.companySettings || {}
  const setError = outletCtx.setError || (() => {})
  const setSuccess = outletCtx.setSuccess || (() => {})

  // Invoices list state
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const debouncedSearch = useDebounce(searchTerm, 300)

  // Creation form & dependencies
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [placeOfSupply, setPlaceOfSupply] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(getTodayDate())
  const [dueDate, setDueDate] = useState(getFutureDate(30))
  const [discount, setDiscount] = useState('0')
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState('')
  const [invoiceItems, setInvoiceItems] = useState([
    { product_id: '', quantity: 1 },
  ])
  const [creating, setCreating] = useState(false)

  // View / Print modal
  const [viewingInvoice, setViewingInvoice] = useState(null)

  // Direct Pay modal
  const [payingInvoice, setPayingInvoice] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('UPI')
  const [payReference, setPayReference] = useState('')
  const [paying, setPaying] = useState(false)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [upiUri, setUpiUri] = useState('')
  const [copiedKey, setCopiedKey] = useState('')
  const [autoConfirmedPayment, setAutoConfirmedPayment] = useState(null)
  const [showManualEntry, setShowManualEntry] = useState(false)

  useEffect(() => {
    let active = true
    const vpa = companySettings?.upi_id || ''
    const compName = companySettings?.company_name || 'Viora Bills'
    const amt = Number(payAmount) || 0

    if (payingInvoice && vpa && amt > 0 && payMethod === 'UPI') {
      const invRef = payingInvoice.invoice_number || payingInvoice.id
      const uri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(
        compName
      )}&am=${amt.toFixed(2)}&tr=${encodeURIComponent(payingInvoice.id)}&tn=${encodeURIComponent(
        `Bill_${invRef}`
      )}&cu=INR`

      QRCode.toDataURL(uri, {
        width: 160,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
        .then((url) => {
          if (active) {
            setQrCodeDataUrl(url)
            setUpiUri(uri)
          }
        })
        .catch(() => {
          if (active) {
            setQrCodeDataUrl('')
            setUpiUri('')
          }
        })
    } else {
      Promise.resolve().then(() => {
        if (active) {
          setQrCodeDataUrl('')
          setUpiUri('')
        }
      })
    }

    return () => {
      active = false
    }
  }, [payingInvoice, payAmount, payMethod, companySettings])

  function handleCopy(text, key) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(''), 2500)
    }
  }

  // Fetch dropdown dependencies on mount
  useEffect(() => {
    let isMounted = true
    async function loadDependencies() {
      try {
        const [cRes, pRes, nRes] = await Promise.all([
          customerApi.list({ limit: 100, page: 1 }),
          productApi.list({ limit: 100, page: 1 }),
          invoiceApi.getNextNumber().catch(() => null),
        ])
        if (isMounted) {
          setCustomers(cRes?.items || cRes?.customers || (Array.isArray(cRes) ? cRes : []))
          setProducts(pRes?.items || pRes?.products || (Array.isArray(pRes) ? pRes : []))
          if (nRes?.next_invoice_number) {
            setNextInvoiceNumber(nRes.next_invoice_number)
          }
        }
      } catch {
        // Handled silently
      }
    }
    loadDependencies()
    return () => {
      isMounted = false
    }
  }, [])

  // Fetch invoices with pagination, search, status, and dates
  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const data = await invoiceApi.list({
        page,
        limit,
        search: debouncedSearch,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      })
      const list = data?.items || data?.invoices || (Array.isArray(data) ? data : [])
      setInvoices(list)
      setTotal(data?.total ?? list.length)
      setTotalPages(data?.total_pages ?? 1)
    } catch (err) {
      setError(`Failed to fetch invoices: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, limit, debouncedSearch, statusFilter, startDate, endDate, setError])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchInvoices()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchInvoices])

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
  }, [debouncedSearch, statusFilter, startDate, endDate])

  // Real-time polling for UPI QR auto-confirmation
  useEffect(() => {
    if (!payingInvoice || payMethod !== 'UPI' || autoConfirmedPayment) {
      return
    }

    const invoiceId = payingInvoice.id
    const initialPaid = Number(payingInvoice.amount_paid) || 0
    let isCancelled = false

    const pollInterval = setInterval(async () => {
      try {
        const res = await invoiceApi.getPaymentStatus(invoiceId)
        if (isCancelled) return

        if (res && (res.is_paid || Number(res.amount_paid) > initialPaid)) {
          setAutoConfirmedPayment(
            res.latest_payment || {
              receipt_number: `REC-${Date.now().toString().slice(-6)}`,
              amount: Number(payAmount) || res.amount_paid,
              payment_method: 'UPI',
              reference: 'UPI-AUTO-CONFIRMED',
            }
          )
          setSuccess('Payment confirmed automatically by bank!')
          fetchInvoices()
        }
      } catch {
        // Polling retry silently
      }
    }, 2000)

    return () => {
      isCancelled = true
      clearInterval(pollInterval)
    }
  }, [payingInvoice, payMethod, autoConfirmedPayment, payAmount, fetchInvoices, setSuccess])

  // Customer selection auto-detects place of supply
  function handleCustomerSelect(custId) {
    setSelectedCustomer(custId)
    const cust = customers.find((c) => c.id === custId)
    if (cust?.state) {
      setPlaceOfSupply(cust.state)
    } else if (companySettings?.state) {
      setPlaceOfSupply(companySettings.state)
    }
  }

  // Line item handlers
  function handleAddItem() {
    setInvoiceItems([...invoiceItems, { product_id: '', quantity: 1 }])
  }

  function handleRemoveItem(index) {
    if (invoiceItems.length <= 1) return
    setInvoiceItems(invoiceItems.filter((_, idx) => idx !== index))
  }

  function handleItemChange(index, field, value) {
    const updated = [...invoiceItems]
    updated[index] = { ...updated[index], [field]: value }
    setInvoiceItems(updated)
  }

  // Real-time calculation summary
  const subtotal = invoiceItems.reduce((sum, it) => {
    const prod = products.find((p) => p.id === it.product_id)
    const price = prod ? Number(prod.price) : 0
    return sum + price * (Number(it.quantity) || 0)
  }, 0)

  const discountVal = Math.min(Number(discount) || 0, subtotal)
  const taxableVal = Math.max(0, subtotal - discountVal)

  const isInterState =
    placeOfSupply &&
    companySettings?.state &&
    placeOfSupply.toLowerCase().trim() !== companySettings.state.toLowerCase().trim()

  const totalGst = invoiceItems.reduce((sum, it) => {
    const prod = products.find((p) => p.id === it.product_id)
    if (!prod) return sum
    const itemSub = Number(prod.price) * (Number(it.quantity) || 0)
    const itemFraction = subtotal > 0 ? itemSub / subtotal : 0
    const itemTaxable = itemSub - discountVal * itemFraction
    const rate = Number(prod.gst_rate) || 0
    return sum + (itemTaxable * rate) / 100
  }, 0)

  const grandTotal = taxableVal + totalGst

  async function handleCreateInvoice(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!selectedCustomer) {
      setError('Please select a customer for the invoice.')
      return
    }

    const validItems = invoiceItems.filter(
      (it) => it.product_id && Number(it.quantity) > 0
    )
    if (validItems.length === 0) {
      setError('Please select at least one product with a quantity greater than zero.')
      return
    }

    setCreating(true)
    try {
      const payload = {
        customer_id: selectedCustomer,
        items: validItems.map((it) => ({
          product_id: it.product_id,
          quantity: Number(it.quantity),
        })),
        discount: Number(discount) || 0,
        due_date: dueDate,
        invoice_date: invoiceDate,
        place_of_supply: placeOfSupply || companySettings?.state || 'Maharashtra',
      }

      const res = await invoiceApi.create(payload)
      setSuccess(`Invoice ${res.invoice_number || res.id} created successfully!`)
      setShowCreateForm(false)
      setSelectedCustomer('')
      setInvoiceItems([{ product_id: '', quantity: 1 }])
      setDiscount('0')

      // Refresh invoice list and next sequence number
      await fetchInvoices()
      invoiceApi.getNextNumber().then((n) => {
        if (n?.next_invoice_number) setNextInvoiceNumber(n.next_invoice_number)
      }).catch(() => {})
    } catch (err) {
      setError(`Could not generate invoice: ${err.message}`)
    } finally {
      setCreating(false)
    }
  }

  // Quick Direct Payment
  function handleOpenPayModal(inv) {
    setPayingInvoice(inv)
    setPayAmount(String(inv.balance_due || inv.total_amount || ''))
    setPayMethod('UPI')
    setPayReference(`Direct_Pay_${inv.invoice_number || inv.id}`)
    setAutoConfirmedPayment(null)
    setShowManualEntry(false)
  }

  async function handleProcessPayment(e) {
    e.preventDefault()
    if (!payingInvoice) return
    setError('')
    setSuccess('')

    const amt = Number(payAmount)
    if (isNaN(amt) || amt <= 0) {
      setError('Payment amount must be greater than zero.')
      return
    }

    setPaying(true)
    try {
      await paymentApi.create({
        invoice_id: payingInvoice.id,
        amount: amt,
        payment_method: payMethod,
        reference: payReference.trim() || undefined,
      })
      setSuccess(`Payment of ${money(amt)} recorded successfully for invoice ${payingInvoice.invoice_number || payingInvoice.id}.`)
      setPayingInvoice(null)
      await fetchInvoices()
    } catch (err) {
      setError(`Payment recording failed: ${err.message}`)
    } finally {
      setPaying(false)
    }
  }

  const handleDownloadInvoicePdf = async (inv) => {
    try {
      const iid = inv.id || inv._id
      if (!iid) {
        setError('Missing invoice ID for PDF download')
        return
      }
      await invoiceApi.downloadPdf(iid, inv.invoice_number || iid)
    } catch (err) {
      setError(`Could not download invoice PDF: ${err.message}`)
    }
  }

  return (
    <div>
      <div className={viewingInvoice ? 'no-print' : ''}>
      {/* Top Header Card */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h3 className="card-title">Tax Invoices</h3>
              {nextInvoiceNumber && (
                <span
                  style={{
                    background: '#e0f2fe',
                    color: '#0369a1',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  Next: {nextInvoiceNumber}
                </span>
              )}
            </div>
            <p className="card-desc">
              Sequential Indian GST tax invoices with itemized tax slabs and instant UPI scan-to-pay
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <a
              href={invoiceApi.getCsvUrl()}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              title="Export all invoice records to CSV"
            >
              📥 Export CSV
            </a>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreateForm(!showCreateForm)}
            >
              {showCreateForm ? '✕ Close Form' : '+ Create Invoice'}
            </button>
          </div>
        </div>

        {/* Status Filter Tabs & Search Bar */}
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
          {/* Status Pills */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {['ALL', 'UNPAID', 'PARTIALLY_PAID', 'PAID'].map((st) => (
              <button
                key={st}
                type="button"
                className={`btn btn-sm ${
                  statusFilter === st ? 'btn-primary' : 'btn-secondary'
                }`}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setStatusFilter(st)}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Search & Dates */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="form-control"
              type="search"
              placeholder="Search invoice no or customer…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '220px' }}
            />
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

      {/* Invoice Creation Form Card */}
      {showCreateForm && (
        <div className="card" style={{ marginBottom: '24px', borderLeft: '4px solid #2563eb' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title">New GST Tax Invoice</h3>
              <p className="card-desc">
                Estimated Invoice No: <strong>{nextInvoiceNumber || 'Auto-generated'}</strong>
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateInvoice}>
            <div
              className="form-grid"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: '20px' }}
            >
              <div className="form-group">
                <label className="form-label">
                  Customer <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  className="form-control"
                  required
                  value={selectedCustomer}
                  onChange={(e) => handleCustomerSelect(e.target.value)}
                >
                  <option value="">Select Customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.business_name ? `(${c.business_name})` : ''}{' '}
                      {c.gstin ? `[GSTIN: ${c.gstin}]` : '[Unregistered]'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Place of Supply (State)</label>
                <select
                  className="form-control"
                  value={placeOfSupply}
                  onChange={(e) => setPlaceOfSupply(e.target.value)}
                >
                  <option value="">Select State</option>
                  {INDIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st} {st === companySettings?.state ? '(Intra-State: CGST+SGST)' : '(Inter-State: IGST)'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Invoice Date</label>
                <input
                  className="form-control"
                  type="date"
                  required
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Payment Due Date</label>
                <input
                  className="form-control"
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            {/* Line Items Table */}
            <div style={{ marginBottom: '20px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                }}
              >
                <h4 style={{ margin: 0, fontSize: '15px', color: '#0f172a' }}>
                  Invoice Line Items
                </h4>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleAddItem}
                >
                  + Add Line Item
                </button>
              </div>

              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40%' }}>Product</th>
                      <th>Quantity</th>
                      <th>Unit Price</th>
                      <th>GST Slab</th>
                      <th>Item Total</th>
                      <th style={{ textAlign: 'right' }}>Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceItems.map((item, idx) => {
                      const prod = products.find((p) => p.id === item.product_id)
                      const price = prod ? Number(prod.price) : 0
                      const rate = prod ? Number(prod.gst_rate) : 0
                      const rowSub = price * (Number(item.quantity) || 0)
                      const rowTax = (rowSub * rate) / 100
                      const rowTotal = rowSub + rowTax

                      return (
                        <tr key={idx}>
                          <td>
                            <select
                              className="form-control"
                              required
                              value={item.product_id}
                              onChange={(e) => handleItemChange(idx, 'product_id', e.target.value)}
                            >
                              <option value="">Select Catalog Product…</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} — {money(p.price)} ({p.gst_rate}% GST)
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="form-control"
                              type="number"
                              min="1"
                              required
                              value={item.quantity}
                              onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                              style={{ width: '90px' }}
                            />
                          </td>
                          <td>{money(price)}</td>
                          <td>{rate}%</td>
                          <td style={{ fontWeight: 600 }}>{money(rowTotal)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleRemoveItem(idx)}
                              disabled={invoiceItems.length <= 1}
                              style={{ color: '#dc2626' }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom Calculations & Submit */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '24px',
              }}
            >
              <div style={{ maxWidth: '300px' }}>
                <label className="form-label">Discount Amount (₹)</label>
                <input
                  className="form-control"
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0.00"
                />
                <small style={{ color: '#64748b', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                  Supply Type: <strong>{isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}</strong>
                </small>
              </div>

              {/* Financial Box */}
              <div
                style={{
                  width: '320px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '16px 20px',
                  fontSize: '13px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span>Subtotal:</span>
                  <strong>{money(subtotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span>Discount:</span>
                  <span style={{ color: '#dc2626' }}>− {money(discountVal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span>Taxable Value:</span>
                  <strong>{money(taxableVal)}</strong>
                </div>
                {isInterState ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span>IGST:</span>
                    <span>+ {money(totalGst)}</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span>CGST:</span>
                      <span>+ {money(totalGst / 2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span>SGST:</span>
                      <span>+ {money(totalGst / 2)}</span>
                    </div>
                  </>
                )}
                <div
                  style={{
                    borderTop: '2px solid #cbd5e1',
                    paddingTop: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#2563eb',
                  }}
                >
                  <span>Grand Total:</span>
                  <span>{money(grandTotal)}</span>
                </div>

                <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowCreateForm(false)}
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={creating}
                    style={{ flex: 2 }}
                  >
                    {creating ? 'Generating…' : '✓ Generate Invoice'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Invoices List Table Card */}
      <div className="card">
        {loading ? (
          <LoadingSpinner message="Fetching invoice records…" />
        ) : invoices.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🧾</div>
            <h4>No invoices found</h4>
            <p>
              {searchTerm || statusFilter !== 'ALL' || startDate || endDate
                ? 'No invoices match the selected filter criteria.'
                : 'Create your first invoice above.'}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreateForm(true)}
              style={{ marginTop: '10px' }}
            >
              + Create Invoice
            </button>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice Number</th>
                  <th>Customer</th>
                  <th>Invoice Date</th>
                  <th>Due Date</th>
                  <th>Total Amount</th>
                  <th>Paid</th>
                  <th>Payment Mode</th>
                  <th>Balance Due</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <div className="mono-text" style={{ fontWeight: 700, color: '#0f172a' }}>
                        {inv.invoice_number || inv.id}
                      </div>
                      {inv.invoice_number && (
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>ID: {inv.id.slice(-6)}</div>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{inv.customer_name || '—'}</td>
                    <td>{inv.invoice_date || formatDate(inv.created_at)}</td>
                    <td>{formatDate(inv.due_date)}</td>
                    <td>{money(inv.total_amount)}</td>
                    <td>{money(inv.amount_paid)}</td>
                    <td>
                      <span
                        style={{
                          fontSize: '11px',
                          background: '#f1f5f9',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          color: '#334155',
                          display: 'inline-block',
                        }}
                      >
                        {inv.payment_mode || (Number(inv.amount_paid) > 0 ? 'Not Recorded' : '—')}
                      </span>
                    </td>
                    <td
                      style={{
                        fontWeight: 600,
                        color: Number(inv.balance_due) > 0 ? '#dc2626' : '#16a34a',
                      }}
                    >
                      {money(inv.balance_due)}
                    </td>
                    <td>
                      <StatusBadge status={inv.status} />
                      {inv.has_pending_payment && (
                        <div style={{ marginTop: '3px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              background: '#fef3c7',
                              color: '#92400e',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              display: 'inline-block',
                            }}
                            title="A payment has been submitted by customer and requires verification"
                          >
                            ⏳ Review Required
                          </span>
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleDownloadInvoicePdf(inv)}
                          title="Download ReportLab PDF"
                        >
                          📄 PDF
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setViewingInvoice(inv)}
                          title="View & Print Invoice Bill"
                        >
                          👁️ View
                        </button>
                        {Number(inv.balance_due) > 0 && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handleOpenPayModal(inv)}
                          >
                            Pay
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={setLimit}
          loading={loading}
        />
      </div>
      </div>

      {/* Invoice Detail & Print Modal */}
      {viewingInvoice && (
        <InvoiceDetailModal
          invoice={viewingInvoice}
          companySettings={companySettings}
          onClose={() => setViewingInvoice(null)}
          onPayDirect={handleOpenPayModal}
        />
      )}

      {/* Direct Payment Modal */}
      {payingInvoice && (
        <Modal
          isOpen={Boolean(payingInvoice)}
          onClose={() => {
            setPayingInvoice(null)
            setAutoConfirmedPayment(null)
          }}
          title={
            autoConfirmedPayment
              ? 'Payment Confirmed'
              : `Record Payment for ${payingInvoice.invoice_number || payingInvoice.id}`
          }
          maxWidth="560px"
        >
          {autoConfirmedPayment ? (
            <div className="modal-body" style={{ padding: '28px 24px', textAlign: 'center' }}>
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
              <h3 style={{ margin: '0 0 6px 0', color: '#15803d', fontSize: '21px', fontWeight: 800 }}>
                Payment Successful!
              </h3>
              <p style={{ margin: '0 0 20px 0', color: '#4b5563', fontSize: '13px' }}>
                Transaction verified and confirmed by bank. Invoice is settled as <strong>PAID</strong>.
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
                    {autoConfirmedPayment.receipt_number || 'REC-CONFIRMED'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Invoice Settled:</span>
                  <strong className="mono-text">{payingInvoice.invoice_number || payingInvoice.id}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Amount Received:</span>
                  <strong style={{ color: '#16a34a', fontSize: '16px' }}>
                    {money(autoConfirmedPayment.amount || payAmount)}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Payment Mode:</span>
                  <span style={{ fontWeight: 600 }}>UPI Dynamic QR (Verified)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Bank Reference / UTR:</span>
                  <span className="mono-text" style={{ fontSize: '12px' }}>
                    {autoConfirmedPayment.reference || 'UPI-SETTLED'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <a
                  href={invoiceApi.getPdfUrl(payingInvoice.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{ textDecoration: 'none' }}
                >
                  📄 Download Paid Invoice PDF
                </a>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setPayingInvoice(null)
                    setAutoConfirmedPayment(null)
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleProcessPayment}>
              <div className="modal-body" style={{ padding: '24px' }}>
                <div
                  style={{
                    background: '#f8fafc',
                    padding: '12px 16px',
                    borderRadius: '6px',
                    marginBottom: '16px',
                    fontSize: '13px',
                  }}
                >
                  <div>
                    Customer: <strong>{payingInvoice.customer_name}</strong>
                  </div>
                  <div>
                    Total Invoiced: <strong>{money(payingInvoice.total_amount)}</strong>
                  </div>
                  <div>
                    Current Balance Due:{' '}
                    <strong style={{ color: '#dc2626' }}>
                      {money(payingInvoice.balance_due)}
                    </strong>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label">
                    Payment Amount (₹) <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    className="form-control"
                    type="number"
                    step="0.01"
                    required
                    min="0.01"
                    max={payingInvoice.balance_due}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label">Payment Method</label>
                  <select
                    className="form-control"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                  >
                    <option value="UPI">UPI / Dynamic QR Code (GPay / PhonePe / Paytm)</option>
                    <option value="Cash">Cash Entry</option>
                    <option value="Bank Transfer">Bank Transfer (NEFT / RTGS / IMPS)</option>
                    <option value="Cheque">Cheque Entry</option>
                    <option value="Card">Debit / Credit Card</option>
                  </select>
                </div>

                {/* DYNAMIC UPI QR SECTION WITH ACCOUNT DETAILS */}
                {payMethod === 'UPI' && (
                  <div
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: '8px',
                      padding: '14px',
                      marginBottom: '16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '10px',
                      }}
                    >
                      <h5 style={{ margin: 0, fontSize: '13px', color: '#1e40af' }}>
                        📱 Scan QR to Pay via UPI
                      </h5>
                      <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600 }}>
                        GPay • PhonePe • Paytm • BHIM
                      </span>
                    </div>

                    {companySettings?.upi_id ? (
                      <div>
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                          {qrCodeDataUrl ? (
                            <img
                              src={qrCodeDataUrl}
                              alt="Dynamic UPI QR Code"
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
                              Generating QR…
                            </div>
                          )}

                          <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.6, flex: 1 }}>
                            <div>
                              UPI VPA: <strong className="mono-text">{companySettings.upi_id}</strong>{' '}
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '1px 5px', fontSize: '10px', marginLeft: '4px' }}
                                onClick={() => handleCopy(companySettings.upi_id, 'inv_vpa')}
                              >
                                {copiedKey === 'inv_vpa' ? '✓ Copied' : 'Copy'}
                              </button>
                            </div>
                            <div style={{ marginTop: '2px' }}>
                              Payee: <strong>{companySettings.company_name || 'Viora Bills'}</strong>
                            </div>
                            <div style={{ marginTop: '2px' }}>
                              Amount:{' '}
                              <strong style={{ color: '#2563eb', fontSize: '13px' }}>
                                {money(payAmount || payingInvoice.balance_due)}
                              </strong>{' '}
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '1px 5px', fontSize: '10px', marginLeft: '4px' }}
                                onClick={() =>
                                  handleCopy(Number(payAmount || payingInvoice.balance_due).toFixed(2), 'inv_amt')
                                }
                              >
                                {copiedKey === 'inv_amt' ? '✓ Copied' : 'Copy ₹'}
                              </button>
                            </div>
                            {companySettings.bank_name && (
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                Bank: <strong>{companySettings.bank_name}</strong>
                                {companySettings.account_number ? ` (A/C: ${companySettings.account_number})` : ''}
                                {companySettings.ifsc_code ? ` | IFSC: ${companySettings.ifsc_code}` : ''}
                              </div>
                            )}
                            {upiUri && (
                              <div style={{ marginTop: '8px' }}>
                                <a
                                  href={upiUri}
                                  className="btn btn-primary btn-sm"
                                  style={{ padding: '3px 8px', fontSize: '11px', textDecoration: 'none' }}
                                >
                                  📱 Open in UPI App
                                </a>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Real-Time Live Status Box */}
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
                                Automatically detects & confirms upon transaction completion.
                              </div>
                            </div>
                          </div>
                        </div>

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
                            onClick={() => setShowManualEntry(!showManualEntry)}
                          >
                            {showManualEntry ? 'Hide manual UTR entry' : 'Staff manual fallback: Enter UTR manually'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: '#b45309', fontSize: '12px' }}>
                        ⚠️ Business UPI ID is not configured in Company Settings. Please configure UPI ID in Settings to enable dynamic QR code billing.
                      </div>
                    )}
                  </div>
                )}

                {(payMethod !== 'UPI' || showManualEntry) && (
                  <div className="form-group">
                    <label className="form-label">Transaction Reference / UTR Number</label>
                    <input
                      className="form-control"
                      type="text"
                      placeholder="e.g. 12-digit UTR from payment app (e.g. 432109876543)"
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  {payMethod === 'UPI' && !showManualEntry && (
                    <span style={{ fontSize: '12px', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="upi-pulse-dot" style={{ width: '8px', height: '8px' }} />
                      Listening for bank credit…
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setPayingInvoice(null)
                      setAutoConfirmedPayment(null)
                    }}
                  >
                    Cancel
                  </button>
                  {(payMethod !== 'UPI' || showManualEntry) && (
                    <button type="submit" className="btn btn-primary" disabled={paying}>
                      {paying ? 'Recording…' : 'Confirm Payment Received'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  )
}
