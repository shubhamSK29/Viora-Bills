import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import QRCode from 'qrcode'
import { customerPortalApi, paymentApi, invoiceApi, companySettingsApi } from '../services/api'
import { money, formatDate } from '../utils/formatters'
import StatusBadge from '../components/common/StatusBadge'
import Pagination from '../components/common/Pagination'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Alert from '../components/common/Alert'
import Modal from '../components/common/Modal'
import InvoiceDetailModal from '../components/invoices/InvoiceDetailModal'

export default function CustomerInvoicesPage() {
  const outletContext = useOutletContext() || {}
  const [companyInfo, setCompanyInfo] = useState(outletContext?.companySettings || null)

  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalInvoices, setTotalInvoices] = useState(0)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')

  // View Bill Modal State
  const [viewingInvoice, setViewingInvoice] = useState(null)

  // Pay Now State
  const [payingInvoice, setPayingInvoice] = useState(null)
  const [payAmount, setPayAmount] = useState(0)
  const [payChannel, setPayChannel] = useState('UPI') // 'UPI' | 'Card'
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [copiedKey, setCopiedKey] = useState('')

  // Fetch latest public company payment details to ensure up-to-date UPI ID
  useEffect(() => {
    let active = true
    companySettingsApi
      .getPublic()
      .then((res) => {
        if (active && res?.company) {
          setCompanyInfo(res.company)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // UPI Form State
  const [upiUtr, setUpiUtr] = useState('')
  const [isSubmittingUpi, setIsSubmittingUpi] = useState(false)
  const [upiSuccessMessage, setUpiSuccessMessage] = useState('')

  // Card Form State
  const [cardHolder, setCardHolder] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [cardNotes, setCardNotes] = useState('')
  const [isSubmittingCard, setIsSubmittingCard] = useState(false)
  const [cardSuccessMessage, setCardSuccessMessage] = useState('')

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await customerPortalApi.getInvoices({
        page,
        limit: 15,
        status: statusFilter,
        search: searchQuery.trim(),
      })
      setInvoices(res.items || [])
      setTotalPages(res.total_pages || 1)
      setTotalInvoices(res.total || 0)
    } catch (err) {
      setError(`Failed to retrieve your invoices: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, searchQuery])

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

  // Open Pay Now Modal
  function handleOpenPay(inv) {
    const bal = Number(inv.balance_due) || 0
    setPayingInvoice(inv)
    setPayAmount(bal)
    setPayChannel('UPI')
    setUpiUtr('')
    setUpiSuccessMessage('')
    setCardHolder(inv.customer_name || '')
    setCardNumber('')
    setCardExpiry('')
    setCardCvv('')
    setCardNotes('')
    setCardSuccessMessage('')
    setError('')
  }

  function handleClosePay() {
    setPayingInvoice(null)
    setQrCodeUrl('')
    setUpiUtr('')
    setUpiSuccessMessage('')
    setCardSuccessMessage('')
    setError('')
  }

  // Format Card Number (XXXX XXXX XXXX XXXX)
  function handleCardNumberChange(e) {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 19)
    const formatted = raw.replace(/(\d{4})(?=\d)/g, '$1 ')
    setCardNumber(formatted)
  }

  // Format Expiry (MM/YY)
  function handleExpiryChange(e) {
    let raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    if (raw.length >= 3) {
      raw = raw.slice(0, 2) + '/' + raw.slice(2)
    }
    setCardExpiry(raw)
  }

  // Active company payment details
  const activeCompany = companyInfo || outletContext?.companySettings || {}
  const activeVpa = (activeCompany.upi_id || '').trim()
  const activePayee = activeCompany.company_name || 'Viora Bills'

  // Generate UPI QR Code
  useEffect(() => {
    let active = true
    if (payingInvoice && payChannel === 'UPI' && activeVpa) {
      const invRef = payingInvoice.invoice_number || payingInvoice.id
      const amt = Number(payAmount) || Number(payingInvoice.balance_due) || 0

      const uri = `upi://pay?pa=${encodeURIComponent(activeVpa)}&pn=${encodeURIComponent(
        activePayee
      )}&am=${amt.toFixed(2)}&cu=INR&tr=${encodeURIComponent(invRef)}&tn=${encodeURIComponent(`Invoice ${invRef}`)}`

      QRCode.toDataURL(uri, {
        width: 240,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
        .then((url) => {
          if (active) setQrCodeUrl(url)
        })
        .catch(() => {
          if (active) setQrCodeUrl('')
        })
    } else {
      setQrCodeUrl('')
    }
    return () => {
      active = false
    }
  }, [payingInvoice, payChannel, payAmount, activeVpa, activePayee])

  function handleCopy(text, key) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(''), 2500)
    }
  }

  // Submit UPI Reference
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
        handleClosePay()
        await fetchInvoices()
      }, 2500)
    } catch (err) {
      setError(`UPI submission failed: ${err.message}`)
    } finally {
      setIsSubmittingUpi(false)
    }
  }

  // Submit Direct Card Payment
  async function handleSubmitCardPayment(e) {
    if (e && e.preventDefault) e.preventDefault()
    if (!payingInvoice) return

    const rawPan = cardNumber.replace(/\D/g, '')
    if (rawPan.length < 12 || rawPan.length > 19) {
      setError('Please enter a valid card number (12 to 19 digits).')
      return
    }
    if (!cardHolder.trim() || cardHolder.trim().length < 2) {
      setError('Please enter the cardholder name.')
      return
    }
    if (!cardExpiry || cardExpiry.length < 4) {
      setError('Please enter the card expiry date (MM/YY).')
      return
    }
    if (cardCvv && (cardCvv.length < 3 || cardCvv.length > 4)) {
      setError('Please enter a valid 3 or 4 digit CVV.')
      return
    }

    const amt = Number(payAmount) || Number(payingInvoice.balance_due) || 0
    if (amt <= 0) {
      setError('Payment amount must be greater than zero.')
      return
    }
    if (amt > Number(payingInvoice.balance_due)) {
      setError(`Payment amount cannot exceed outstanding balance of ${money(payingInvoice.balance_due)}.`)
      return
    }

    setIsSubmittingCard(true)
    setError('')

    try {
      const res = await paymentApi.submitCardPayment(payingInvoice.id, {
        amount: amt,
        card_holder: cardHolder.trim(),
        card_number: rawPan,
        expiry: cardExpiry.trim(),
        cvv: cardCvv.trim() || undefined,
        notes: cardNotes.trim() || undefined,
      })

      setCardSuccessMessage(
        res.message ||
          `Card payment of ${money(amt)} submitted successfully! Your payment is PENDING verification.`
      )
      setTimeout(async () => {
        handleClosePay()
        await fetchInvoices()
      }, 2500)
    } catch (err) {
      setError(`Card payment failed: ${err.message}`)
    } finally {
      setIsSubmittingCard(false)
    }
  }

  const handleDownloadPdf = async (inv) => {
    try {
      await invoiceApi.downloadPdf(inv.id, inv.invoice_number)
    } catch (err) {
      setError(`Could not download invoice PDF: ${err.message}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className={viewingInvoice ? 'no-print' : ''}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
            My Invoices
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            Review your tax invoices, make payments via Dynamic UPI QR Code or Credit/Debit Card, and download PDF receipts.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={fetchInvoices}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          🔄 Refresh
        </button>
      </div>

      {success && <Alert type="success" message={success} onClose={() => setSuccess('')} />}
      {error && <Alert type="danger" message={error} onClose={() => setError('')} />}

      {/* Invoices Table Card */}
      <div className="card" style={{ padding: 0 }}>
        {/* Filters Bar */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {['ALL', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].map((status) => (
              <button
                key={status}
                type="button"
                className={`btn btn-sm ${statusFilter === status ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setStatusFilter(status)
                  setPage(1)
                }}
              >
                {status.replace('_', ' ')}
              </button>
            ))}
          </div>

          <div style={{ maxWidth: '280px', width: '100%' }}>
            <input
              type="text"
              className="form-control"
              placeholder="Search invoice number..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>

        {loading ? (
          <LoadingSpinner message="Loading your invoices…" size="large" />
        ) : invoices.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>📄</div>
            <h4 style={{ margin: '0 0 6px', color: '#0f172a' }}>No invoices found</h4>
            <p style={{ margin: 0, fontSize: '13px' }}>
              {searchQuery || statusFilter !== 'ALL'
                ? 'No invoices match your selected filters.'
                : 'You do not have any invoices generated yet.'}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Due Date</th>
                  <th>Total Amount</th>
                  <th>Amount Paid</th>
                  <th>Payment Mode</th>
                  <th>Balance Due</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const balanceDue = Number(inv.balance_due) || 0
                  const hasBalance = balanceDue > 0 && inv.status !== 'PAID'
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 700, color: '#1e3a8a' }}>{inv.invoice_number}</td>
                      <td>{formatDate(inv.invoice_date)}</td>
                      <td>{formatDate(inv.due_date)}</td>
                      <td style={{ fontWeight: 600 }}>{money(inv.total_amount)}</td>
                      <td style={{ color: '#059669', fontWeight: 600 }}>{money(inv.amount_paid)}</td>
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
                      <td style={{ fontWeight: 700, color: balanceDue > 0 ? '#dc2626' : '#059669' }}>
                        {money(balanceDue)}
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
                              title="A payment transaction reference was submitted and is awaiting verification"
                            >
                              ⏳ Under Verification
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setViewingInvoice(inv)}
                            title="View Full Bill & Breakdown"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          >
                            👁️ View
                          </button>
                          {hasBalance ? (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => handleOpenPay(inv)}
                              style={{
                                background: '#059669',
                                borderColor: '#059669',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              💳 Pay
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDownloadPdf(inv)}
                            title="Download Invoice PDF"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
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

        <div style={{ padding: '16px 20px', borderTop: '1px solid #e2e8f0' }}>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalInvoices}
            pageSize={15}
            onPageChange={setPage}
          />
        </div>
      </div>

      {/* Pay Now Modal with UPI QR & Credit/Debit Card Options */}
      {payingInvoice && (
        <Modal
          isOpen={true}
          title={`Pay Invoice ${payingInvoice.invoice_number || payingInvoice.id}`}
          onClose={handleClosePay}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {upiSuccessMessage && <Alert type="success" message={upiSuccessMessage} />}
            {cardSuccessMessage && <Alert type="success" message={cardSuccessMessage} />}
            {error && <Alert type="danger" message={error} onClose={() => setError('')} />}

            {/* Invoice Payment Header Card */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '14px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Invoice Total</div>
                <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '15px' }}>{money(payingInvoice.total_amount)}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Amount Paid</div>
                <div style={{ fontWeight: 600, color: '#059669', fontSize: '15px' }}>{money(payingInvoice.amount_paid)}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Balance Due</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#dc2626' }}>
                  {money(payingInvoice.balance_due)}
                </div>
              </div>
            </div>

            {/* Payment Channel Tabs: Dynamic UPI QR vs Credit / Debit Card */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className={`btn ${payChannel === 'UPI' ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  fontWeight: 700,
                  fontSize: '14px',
                  background: payChannel === 'UPI' ? '#2563eb' : '#f1f5f9',
                  color: payChannel === 'UPI' ? '#ffffff' : '#334155',
                  borderColor: payChannel === 'UPI' ? '#2563eb' : '#cbd5e1',
                }}
                onClick={() => {
                  setPayChannel('UPI')
                  setError('')
                }}
              >
                📱 Dynamic UPI QR
              </button>
              <button
                type="button"
                className={`btn ${payChannel === 'Card' ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  fontWeight: 700,
                  fontSize: '14px',
                  background: payChannel === 'Card' ? '#2563eb' : '#f1f5f9',
                  color: payChannel === 'Card' ? '#ffffff' : '#334155',
                  borderColor: payChannel === 'Card' ? '#2563eb' : '#cbd5e1',
                }}
                onClick={() => {
                  setPayChannel('Card')
                  setError('')
                }}
              >
                💳 Credit / Debit Card
              </button>
            </div>

            {/* Amount to Pay Field */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                Amount to Pay (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                max={Number(payingInvoice.balance_due) || undefined}
                className="form-control"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Enter amount"
                required
              />
            </div>

            {/* CHANNEL 1: Dynamic UPI QR */}
            {payChannel === 'UPI' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', color: '#64748b' }}>
                    Scan with any UPI app: Google Pay, PhonePe, Paytm, BHIM, CRED
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                    Pay {money(payAmount)}
                  </div>
                </div>

                {activeVpa ? (
                  <>
                    <div
                      style={{
                        padding: '12px',
                        background: '#ffffff',
                        border: '2px solid #e2e8f0',
                        borderRadius: '12px',
                        display: 'flex',
                        justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      }}
                    >
                      {qrCodeUrl ? (
                        <img src={qrCodeUrl} alt="UPI QR Code" style={{ width: '220px', height: '220px' }} />
                      ) : (
                        <LoadingSpinner message="Generating QR code…" />
                      )}
                    </div>

                    <div
                      style={{
                        width: '100%',
                        background: '#f8fafc',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <span>VPA: <strong>{activeVpa}</strong></span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleCopy(activeVpa, 'vpa')}
                      >
                        {copiedKey === 'vpa' ? '✓ Copied' : '📋 Copy VPA'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      width: '100%',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '8px',
                      padding: '14px',
                      fontSize: '13px',
                      color: '#92400e',
                      textAlign: 'center',
                    }}
                  >
                    ⚠️ <strong>UPI Payment Not Configured</strong>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: '#b45309' }}>
                      The merchant has not configured a UPI ID yet. Please switch to <strong>Card</strong> payment or contact billing support.
                    </div>
                  </div>
                )}

                {/* UTR Submission Form */}
                <form
                  onSubmit={handleSubmitUpiReference}
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    borderTop: '1px solid #e2e8f0',
                    paddingTop: '14px',
                  }}
                >
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    Enter 12-Digit UPI Reference / UTR Number
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="e.g. 403819284729"
                      value={upiUtr}
                      onChange={(e) => setUpiUtr(e.target.value)}
                      required
                      disabled={isSubmittingUpi}
                    />
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={isSubmittingUpi}
                      style={{ whiteSpace: 'nowrap', minWidth: '120px' }}
                    >
                      {isSubmittingUpi ? 'Verifying…' : 'Submit UTR'}
                    </button>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    ℹ️ Your payment will be recorded in <strong>Pending Verification</strong> status until verified against bank statement.
                  </span>
                </form>
              </div>
            )}

            {/* CHANNEL 2: Credit / Debit Card */}
            {payChannel === 'Card' && (
              <form
                onSubmit={handleSubmitCardPayment}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  borderTop: '1px solid #e2e8f0',
                  paddingTop: '14px',
                }}
              >
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    Cardholder Name
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Name as printed on card"
                    value={cardHolder}
                    onChange={(e) => setCardHolder(e.target.value)}
                    required
                    disabled={isSubmittingCard}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    Card Number
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="4111 2222 3333 4444"
                    value={cardNumber}
                    onChange={handleCardNumberChange}
                    maxLength={23}
                    required
                    disabled={isSubmittingCard}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                      Expiry Date
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="MM/YY"
                      value={cardExpiry}
                      onChange={handleExpiryChange}
                      maxLength={5}
                      required
                      disabled={isSubmittingCard}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                      CVV
                    </label>
                    <input
                      type="password"
                      className="form-control"
                      placeholder="123"
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      maxLength={4}
                      disabled={isSubmittingCard}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    Payment Note (Optional)
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Advance payment / settlement"
                    value={cardNotes}
                    onChange={(e) => setCardNotes(e.target.value)}
                    disabled={isSubmittingCard}
                  />
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontSize: '11px',
                    color: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  🔒 <span>PCI Compliant: Full card details are securely processed; only masked last-4 digits are logged.</span>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingCard}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontWeight: 700,
                    fontSize: '15px',
                    background: '#059669',
                    borderColor: '#059669',
                    marginTop: '4px',
                  }}
                >
                  {isSubmittingCard ? 'Processing Card Payment…' : `💳 Pay ${money(payAmount)} with Card`}
                </button>
              </form>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClosePay}
                disabled={isSubmittingUpi || isSubmittingCard}
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
      </div>

      {/* Invoice Detail Modal with Live Breakdown & Printing */}
      {viewingInvoice && (
        <InvoiceDetailModal
          invoice={viewingInvoice}
          companySettings={activeCompany}
          onClose={() => setViewingInvoice(null)}
          onPayDirect={handleOpenPay}
        />
      )}
    </div>
  )
}
