import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { paymentApi } from '../../services/api'
import { money } from '../../utils/formatters'
import StatusBadge from '../common/StatusBadge'

export default function PaymentReceiptModal({
  payment,
  paymentId,
  companySettings,
  onClose,
}) {
  const [data, setData] = useState(payment || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  const activeId =
    payment?.id ||
    payment?._id ||
    payment?.payment_id ||
    paymentId ||
    data?.id ||
    data?._id ||
    data?.payment_id ||
    ''

  // Keep data state synchronized if payment prop changes
  useEffect(() => {
    if (payment) {
      setData(payment)
    }
  }, [payment])

  // Load detailed receipt structure if not fully populated
  useEffect(() => {
    let isCancelled = false
    const pid = payment?.id || payment?._id || payment?.payment_id || paymentId
    if (!pid) return

    // If payment prop already has full invoice with items, use it directly
    if (payment?.invoice?.items && Array.isArray(payment.invoice.items) && payment.invoice.items.length > 0) {
      setData(payment)
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    paymentApi
      .getReceipt(pid)
      .then((res) => {
        if (!isCancelled && res) {
          setData(res)
        }
      })
      .catch((err) => {
        console.error('Failed to load receipt details:', err)
        if (!isCancelled && !payment) {
          setError(err?.message || 'Failed to load receipt details')
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [payment?.id, payment?._id, payment?.payment_id, paymentId])

  // Company details resolution
  const comp =
    data?.company ||
    companySettings?.settings ||
    companySettings?.company ||
    companySettings ||
    {}

  const inv = data?.invoice || {}
  const cust = data?.customer || {}
  const receiptNum = data?.receipt_number || (activeId ? `REC-${String(activeId).slice(-6)}` : 'RECEIPT')
  const invoiceNum = inv?.invoice_number || data?.invoice_number || 'N/A'
  const payStatus = (data?.status || 'SUCCESS').toUpperCase()
  const isCleared = data?.is_cleared ?? (payStatus === 'SUCCESS' || payStatus === 'CLEARED')
  const remainingDue = Number(data?.remaining_balance ?? inv?.balance_due ?? 0)
  const previousBalance = Number(data?.previous_balance ?? (remainingDue + (Number(data?.amount) || 0)))

  // QR Code Generation for remaining balance if > 0
  useEffect(() => {
    let isMounted = true
    const upiId = comp?.upi_id || ''
    const companyName = comp?.company_name || 'Viora Bills'

    if (upiId && remainingDue > 0) {
      const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
        companyName
      )}&am=${remainingDue.toFixed(2)}&tr=${encodeURIComponent(
        inv?.id || activeId || 'PAY'
      )}&tn=${encodeURIComponent(`Bal_${invoiceNum}`)}&cu=INR`

      QRCode.toDataURL(upiUri, {
        width: 150,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
        .then((url) => {
          if (isMounted) setQrCodeDataUrl(url)
        })
        .catch(() => {
          if (isMounted) setQrCodeDataUrl('')
        })
    } else {
      setQrCodeDataUrl('')
    }

    return () => {
      isMounted = false
    }
  }, [comp?.upi_id, comp?.company_name, remainingDue, inv?.id, activeId, invoiceNum])

  const handleDownloadPdf = async () => {
    const pid = activeId || data?.id || data?._id || data?.payment_id
    if (!pid) return
    setDownloadingPdf(true)
    try {
      await paymentApi.downloadReceiptPdf(pid, receiptNum)
    } catch (err) {
      alert(`Could not download receipt PDF: ${err.message || 'Unknown error'}`)
    } finally {
      setDownloadingPdf(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content printable-invoice"
        style={{ maxWidth: '880px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Action Bar */}
        <div className="modal-header no-print">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Payment Receipt</h3>
            <span
              className="mono-text"
              style={{
                fontWeight: 700,
                color: '#16a34a',
                background: '#f0fdf4',
                padding: '2px 8px',
                borderRadius: '4px',
                border: '1px solid #bbf7d0',
                fontSize: '13px',
              }}
            >
              {receiptNum}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={downloadingPdf || loading}
              onClick={handleDownloadPdf}
              title="Download standardized ReportLab PDF Receipt"
            >
              {downloadingPdf ? 'Downloading…' : '📥 Download PDF'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => window.print()}
              disabled={loading}
            >
              🖨️ Print Receipt
            </button>
            <button className="modal-close" onClick={onClose} type="button">
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ padding: '32px' }}>
          {loading && !data ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748b' }}>
              <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
              <p style={{ margin: 0, fontSize: '14px' }}>Loading payment receipt details…</p>
            </div>
          ) : error && !data ? (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '16px',
                borderRadius: '8px',
                fontSize: '14px',
              }}
            >
              {error}
            </div>
          ) : data ? (
            <div>
              {/* Header: Company Info on Left, Receipt Meta on Right */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  borderBottom: '2px solid #e2e8f0',
                  paddingBottom: '20px',
                  marginBottom: '24px',
                  flexWrap: 'wrap',
                  gap: '16px',
                }}
              >
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  {comp?.logo_url ? (
                    <img
                      src={comp.logo_url}
                      alt="Company Logo"
                      style={{
                        width: '64px',
                        height: '64px',
                        objectFit: 'contain',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                      }}
                    />
                  ) : (
                    <div
                      className="brand-logo-icon"
                      style={{ width: '48px', height: '48px', fontSize: '20px' }}
                    >
                      VB
                    </div>
                  )}
                  <div>
                    <h2
                      style={{
                        margin: '0 0 4px',
                        fontSize: '20px',
                        fontWeight: 800,
                        color: '#1e293b',
                      }}
                    >
                      {comp?.company_name || 'Viora Bills'}
                    </h2>
                    <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>
                      {comp?.business_address || ''}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                      {comp?.phone ? `Ph: ${comp.phone}` : ''}{' '}
                      {comp?.email ? `| Email: ${comp.email}` : ''}
                    </p>
                    {comp?.gstin && (
                      <p
                        style={{
                          margin: '4px 0 0',
                          fontSize: '12px',
                          fontWeight: 700,
                          color: '#0f172a',
                        }}
                      >
                        GSTIN: {comp.gstin}
                      </p>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontSize: '22px',
                      fontWeight: 800,
                      color:
                        payStatus === 'BOUNCED' || payStatus === 'FAILED'
                          ? '#dc2626'
                          : payStatus === 'PENDING'
                          ? '#d97706'
                          : '#16a34a',
                      letterSpacing: '0.5px',
                      marginBottom: '4px',
                    }}
                  >
                    PAYMENT RECEIPT
                  </div>
                  <div style={{ marginBottom: '6px' }}>
                    <StatusBadge status={payStatus} />
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>
                    Receipt #: {receiptNum}
                  </div>
                  <div style={{ fontSize: '13px', color: '#475569', marginTop: '2px' }}>
                    Invoice #: <strong>{invoiceNum}</strong>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    Date:{' '}
                    {data.payment_date ||
                      (data.created_at ? String(data.created_at).slice(0, 10) : '—')}
                  </div>
                  <div style={{ fontSize: '12px', color: '#0f172a', marginTop: '2px', fontWeight: 600 }}>
                    Mode: {data.payment_method || 'UPI'}
                  </div>
                </div>
              </div>

              {/* Billed To & Receipt Details Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: '16px',
                  marginBottom: '24px',
                }}
              >
                <div
                  style={{
                    background: '#f8fafc',
                    padding: '16px 20px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      color: '#64748b',
                      fontWeight: 700,
                      letterSpacing: '0.5px',
                    }}
                  >
                    Customer Details:
                  </span>
                  <h4 style={{ margin: '6px 0 2px', fontSize: '16px', color: '#0f172a' }}>
                    {cust?.name || inv?.customer_name || 'Valued Customer'}
                  </h4>
                  <div style={{ fontSize: '13px', color: '#475569' }}>
                    {cust?.address || inv?.billing_address || ''}
                  </div>
                  {cust?.phone && (
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      Phone: {cust.phone}
                    </div>
                  )}
                  {cust?.gstin && (
                    <div style={{ fontSize: '12px', color: '#0f172a', fontWeight: 600, marginTop: '2px' }}>
                      GSTIN: {cust.gstin}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    padding: '16px 20px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      color: '#64748b',
                      fontWeight: 700,
                      letterSpacing: '0.5px',
                    }}
                  >
                    Payment Verification & Settlement:
                  </span>
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
                    <div>
                      <span style={{ color: '#64748b' }}>Reference / UTR:</span>{' '}
                      <span className="mono-text" style={{ fontWeight: 600, color: '#0f172a' }}>
                        {data.reference || data.transaction_id || 'N/A'}
                      </span>
                    </div>
                    {data.recorded_by_name && (
                      <div>
                        <span style={{ color: '#64748b' }}>Verified By:</span>{' '}
                        <strong>{data.recorded_by_name}</strong> ({data.recorded_by_role || 'Staff'})
                      </div>
                    )}
                    <div>
                      <span style={{ color: '#64748b' }}>Clearance:</span>{' '}
                      <span
                        style={{
                          fontWeight: 700,
                          color: isCleared ? '#16a34a' : '#d97706',
                        }}
                      >
                        {isCleared ? 'Verified & Cleared' : 'Pending Verification'}
                      </span>
                    </div>
                    {inv?.place_of_supply && (
                      <div>
                        <span style={{ color: '#64748b' }}>Place of Supply:</span>{' '}
                        <strong>{inv.place_of_supply}</strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Itemized Invoice Products Table (Standardized A4 invoice format) */}
              {inv?.items && inv.items.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <div
                    style={{
                      fontSize: '12px',
                      textTransform: 'uppercase',
                      color: '#64748b',
                      fontWeight: 700,
                      letterSpacing: '0.5px',
                      marginBottom: '8px',
                    }}
                  >
                    Billed Products & Services:
                  </div>
                  <table
                    className="data-table"
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '13px',
                    }}
                  >
                    <thead>
                      <tr style={{ background: '#1e293b', color: '#ffffff' }}>
                        <th style={{ padding: '8px 10px', textAlign: 'left', color: '#ffffff' }}>#</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left', color: '#ffffff' }}>Product Description</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', color: '#ffffff' }}>Qty</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', color: '#ffffff' }}>Unit Price</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', color: '#ffffff' }}>Taxable Val</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', color: '#ffffff' }}>GST</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', color: '#ffffff' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.items.map((it, idx) => (
                        <tr
                          key={idx}
                          style={{
                            background: idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                            borderBottom: '1px solid #e2e8f0',
                          }}
                        >
                          <td style={{ padding: '8px 10px' }}>{idx + 1}</td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1e293b' }}>
                            {it.product_name}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            {it.quantity} {it.unit || ''}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                            {money(it.unit_price)}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                            {money(it.taxable_amount || it.subtotal || 0)}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            {it.gst_rate ?? 0}%
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                            {money(it.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Bottom Section: Bank / UPI Details on Left, Financial Summary on Right */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '24px',
                  marginBottom: '24px',
                  flexWrap: 'wrap',
                }}
              >
                {/* Left: Bank Info & QR Code */}
                <div
                  style={{
                    flex: '1 1 320px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '16px 20px',
                  }}
                >
                  <h5
                    style={{
                      margin: '0 0 10px',
                      fontSize: '12px',
                      textTransform: 'uppercase',
                      color: '#1e293b',
                      fontWeight: 700,
                      letterSpacing: '0.5px',
                    }}
                  >
                    🏦 Payment & Settlement Details
                  </h5>
                  <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {comp?.bank_name && (
                      <div>
                        <span style={{ color: '#64748b' }}>Bank:</span> <strong>{comp.bank_name}</strong>
                      </div>
                    )}
                    {comp?.account_number && (
                      <div>
                        <span style={{ color: '#64748b' }}>A/C Number:</span>{' '}
                        <span className="mono-text" style={{ fontWeight: 600 }}>{comp.account_number}</span>
                      </div>
                    )}
                    {comp?.ifsc_code && (
                      <div>
                        <span style={{ color: '#64748b' }}>IFSC Code:</span>{' '}
                        <span className="mono-text" style={{ fontWeight: 600 }}>{comp.ifsc_code}</span>
                      </div>
                    )}
                    {comp?.upi_id && (
                      <div>
                        <span style={{ color: '#64748b' }}>UPI ID:</span>{' '}
                        <span className="mono-text" style={{ fontWeight: 600, color: '#2563eb' }}>
                          {comp.upi_id}
                        </span>
                      </div>
                    )}
                  </div>

                  {remainingDue > 0 && qrCodeDataUrl ? (
                    <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <img
                        src={qrCodeDataUrl}
                        alt="UPI QR Code"
                        style={{
                          width: '100px',
                          height: '100px',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                        }}
                      />
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        <strong style={{ color: '#0f172a', display: 'block', marginBottom: '2px' }}>
                          Scan to Pay Balance
                        </strong>
                        UPI QR dynamically generated for remaining ₹{remainingDue.toFixed(2)}
                      </div>
                    </div>
                  ) : remainingDue <= 0 ? (
                    <div
                      style={{
                        marginTop: '14px',
                        padding: '10px 14px',
                        background: '#ecfdf5',
                        border: '1px solid #a7f3d0',
                        borderRadius: '6px',
                        color: '#065f46',
                        fontSize: '12px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span style={{ fontSize: '16px' }}>✓</span>
                      <span>INVOICE FULLY SETTLED — ZERO BALANCE DUE</span>
                    </div>
                  ) : null}
                </div>

                {/* Right: Financial Totals Summary */}
                <div
                  style={{
                    width: '380px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '16px 20px',
                  }}
                >
                  {inv?.total_amount ? (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '6px',
                          fontSize: '13px',
                        }}
                      >
                        <span style={{ color: '#64748b' }}>Total Invoice Amount:</span>
                        <span style={{ fontWeight: 600 }}>{money(inv.total_amount)}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '6px',
                          fontSize: '13px',
                        }}
                      >
                        <span style={{ color: '#64748b' }}>Previous Balance:</span>
                        <span style={{ fontWeight: 600 }}>{money(previousBalance)}</span>
                      </div>
                    </>
                  ) : null}

                  {/* Highlighted Amount Received in This Receipt */}
                  <div
                    style={{
                      background: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: '6px',
                      padding: '10px 12px',
                      margin: '10px 0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: '11px',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          color: '#065f46',
                          display: 'block',
                        }}
                      >
                        Amount Received (This Receipt):
                      </span>
                      <span style={{ fontSize: '11px', color: '#047857' }}>
                        via {data.payment_method || 'UPI'}
                      </span>
                    </div>
                    <span style={{ fontSize: '18px', fontWeight: 800, color: '#059669' }}>
                      {money(data.amount)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: '2px solid #cbd5e1',
                      fontSize: '14px',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        color: remainingDue > 0 ? '#dc2626' : '#16a34a',
                      }}
                    >
                      Remaining Balance Due:
                    </span>
                    <span
                      style={{
                        fontWeight: 800,
                        color: remainingDue > 0 ? '#dc2626' : '#16a34a',
                      }}
                    >
                      {money(remainingDue)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Signatory Block & Note */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                  marginTop: '36px',
                  paddingTop: '20px',
                  borderTop: '1px solid #e2e8f0',
                  fontSize: '12px',
                  color: '#64748b',
                }}
              >
                <div>
                  <p style={{ margin: 0, fontStyle: 'italic' }}>
                    Thank you for your business!
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#94a3b8' }}>
                    This is an authentic, computer-generated digital payment receipt.
                  </p>
                </div>
                <div style={{ textAlign: 'center', minWidth: '180px' }}>
                  <div
                    style={{
                      borderBottom: '1px solid #94a3b8',
                      marginBottom: '6px',
                      height: '32px',
                    }}
                  />
                  <div style={{ fontWeight: 700, color: '#1e293b' }}>
                    {comp?.company_name || 'Viora Bills'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Authorized Signatory</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Modal Footer Actions */}
        <div
          className="modal-footer no-print"
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            background: '#f8fafc',
            borderBottomLeftRadius: '12px',
            borderBottomRightRadius: '12px',
          }}
        >
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={downloadingPdf}
            onClick={handleDownloadPdf}
            title="Download standardized ReportLab PDF Receipt"
          >
            {downloadingPdf ? 'Downloading…' : '📥 Download PDF'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => window.print()}
          >
            🖨️ Print Receipt
          </button>
        </div>
      </div>
    </div>
  )
}

