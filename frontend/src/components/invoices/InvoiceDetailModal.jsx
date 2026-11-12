import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { invoiceApi } from '../../services/api'
import { money } from '../../utils/formatters'
import StatusBadge from '../common/StatusBadge'

export default function InvoiceDetailModal({ invoice, companySettings, onClose, onPayDirect }) {
  const [inv, setInv] = useState(invoice)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [upiLink, setUpiLink] = useState('')
  const [copiedField, setCopiedField] = useState('')
  const [livePaid, setLivePaid] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  // Normalize companySettings to handle direct object or nested { settings: ... } or { company: ... }
  const comp =
    companySettings?.settings ||
    companySettings?.company ||
    companySettings ||
    {}

  const invoiceId = inv?.id || inv?._id || invoice?.id || invoice?._id || ''

  // Fetch complete invoice data including itemized payments, modes, and pending status
  useEffect(() => {
    let active = true
    setInv(invoice)
    const targetId = invoice?.id || invoice?._id
    if (targetId && invoiceApi?.get) {
      invoiceApi
        .get(targetId)
        .then((fullData) => {
          if (active && fullData) {
            setInv(fullData)
          }
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [invoice?.id, invoice?._id])

  // Real-time polling while invoice modal is open
  useEffect(() => {
    const currentId = inv?.id || inv?._id
    if (!currentId || Number(inv?.balance_due) <= 0 || livePaid) return
    let isCancelled = false
    const pollInterval = setInterval(async () => {
      try {
        if (invoiceApi?.getPaymentStatus) {
          const res = await invoiceApi.getPaymentStatus(currentId)
          if (!isCancelled && res?.is_paid) {
            setLivePaid(true)
            const updated = await invoiceApi.get(currentId)
            if (!isCancelled && updated) {
              setInv(updated)
            }
          }
        }
      } catch {
        // Retry silently
      }
    }, 2500)
    return () => {
      isCancelled = true
      clearInterval(pollInterval)
    }
  }, [inv?.id, inv?._id, inv?.balance_due, livePaid])

  // UPI QR Code Generation
  useEffect(() => {
    let active = true
    const upiId = comp?.upi_id || ''
    const companyName = comp?.company_name || 'Viora Bills'
    const balance = Number(inv?.balance_due) || 0

    if (inv && upiId && balance > 0) {
      const invRef = inv.invoice_number || invoiceId || 'INV'
      const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
        companyName
      )}&am=${balance.toFixed(2)}&tr=${encodeURIComponent(invoiceId)}&tn=${encodeURIComponent(
        `Bill_${invRef}`
      )}&cu=INR`

      QRCode.toDataURL(upiUri, {
        width: 160,
        margin: 1,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      })
        .then((url) => {
          if (active) {
            setQrCodeDataUrl(url)
            setUpiLink(upiUri)
          }
        })
        .catch(() => {
          if (active) {
            setQrCodeDataUrl('')
            setUpiLink('')
          }
        })
    } else {
      Promise.resolve().then(() => {
        if (active) {
          setQrCodeDataUrl('')
          setUpiLink('')
        }
      })
    }

    return () => {
      active = false
    }
  }, [inv, comp, invoiceId])

  function handleCopy(text, fieldName) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
      setCopiedField(fieldName)
      setTimeout(() => setCopiedField(''), 2500)
    }
  }

  const handleDownloadPdf = async () => {
    if (!invoiceId) return
    setDownloadingPdf(true)
    try {
      if (invoiceApi?.downloadPdf) {
        await invoiceApi.downloadPdf(invoiceId, inv?.invoice_number || invoiceId)
      } else {
        const url = invoiceApi.getPdfUrl(invoiceId)
        window.open(url, '_blank')
      }
    } catch {
      const url = invoiceApi.getPdfUrl(invoiceId)
      window.open(url, '_blank')
    } finally {
      setDownloadingPdf(false)
    }
  }

  if (!inv) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content printable-invoice"
        style={{ maxWidth: '880px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header no-print">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3>Invoice Document</h3>
            <span className="mono-text" style={{ fontWeight: 700, color: '#2563eb' }}>
              {inv.invoice_number || invoiceId}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={downloadingPdf}
              onClick={handleDownloadPdf}
              title="Download Official ReportLab Generated PDF"
            >
              {downloadingPdf ? 'Downloading…' : '📥 Download PDF'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => window.print()}
            >
              🖨️ Print Bill
            </button>
            {onPayDirect && Number(inv.balance_due) > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  onClose()
                  onPayDirect(inv)
                }}
              >
                💳 Pay Now
              </button>
            )}
            <button className="modal-close" onClick={onClose} type="button">
              ✕
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ padding: '32px' }}>
          {/* Pending Verification Notice */}
          {inv.has_pending_payment && (
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '8px',
                padding: '12px 16px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <div>
                <strong style={{ color: '#92400e', fontSize: '13px' }}>
                  Payment Submitted & Awaiting Verification
                </strong>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#b45309' }}>
                  A payment transaction reference was submitted for this invoice and is currently pending verification by staff or admin.
                </p>
              </div>
            </div>
          )}

          {/* Company Header with Logo */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              borderBottom: '2px solid #e2e8f0',
              paddingBottom: '20px',
              marginBottom: '24px',
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
                  {comp?.state ? `State: ${comp.state}` : ''}{' '}
                  {comp?.pincode ? `— PIN: ${comp.pincode}` : ''}{' '}
                  {comp?.phone ? `| Ph: ${comp.phone}` : ''}
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
              <div style={{ marginBottom: '6px' }}>
                <StatusBadge status={inv.status} />
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>
                {inv.invoice_number || invoiceId}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                Date:{' '}
                {inv.invoice_date ||
                  (inv.created_at ? String(inv.created_at).slice(0, 10) : '—')}
              </div>
              {inv.due_date && (
                <div style={{ fontSize: '12px', color: '#b91c1c', fontWeight: 600 }}>
                  Due: {String(inv.due_date).slice(0, 10)}
                </div>
              )}
              <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>
                Place of Supply:{' '}
                <strong>{inv.place_of_supply || comp?.state || '—'}</strong>
              </div>
            </div>
          </div>

          {/* Billed To Customer Info */}
          <div
            style={{
              background: '#f8fafc',
              padding: '16px 20px',
              borderRadius: '8px',
              marginBottom: '24px',
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
              Billed To:
            </span>
            <h4 style={{ margin: '6px 0 2px', fontSize: '16px', color: '#0f172a' }}>
              {inv.customer_name || 'Customer'}
            </h4>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              Customer ID: <span className="mono-text">{inv.customer_id || '—'}</span>
            </div>
          </div>

          {/* Itemized Products Table */}
          <table className="data-table" style={{ marginBottom: '24px' }}>
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Taxable Val</th>
                <th>GST Rate</th>
                <th>GST Amount</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(inv.items || []).map((it, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 600 }}>{it.product_name}</td>
                  <td>
                    {it.quantity} {it.unit || ''}
                  </td>
                  <td>{money(it.unit_price)}</td>
                  <td>{money(it.taxable_amount || it.subtotal)}</td>
                  <td>{it.gst_rate}%</td>
                  <td>{money(it.gst_amount)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Financial Summary */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
            <div
              style={{
                width: '360px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '16px 20px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  fontSize: '13px',
                }}
              >
                <span style={{ color: '#64748b' }}>Subtotal:</span>
                <span style={{ fontWeight: 600 }}>{money(inv.subtotal)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  fontSize: '13px',
                }}
              >
                <span style={{ color: '#64748b' }}>Discount:</span>
                <span style={{ fontWeight: 600, color: '#dc2626' }}>
                  − {money(inv.discount)}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  fontSize: '13px',
                }}
              >
                <span style={{ color: '#64748b' }}>Taxable Amount:</span>
                <span style={{ fontWeight: 600 }}>{money(inv.taxable_amount)}</span>
              </div>

              {inv.tax_breakdown?.supply_type === 'Inter-State' ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '8px',
                    fontSize: '13px',
                  }}
                >
                  <span style={{ color: '#64748b' }}>IGST Total:</span>
                  <span style={{ fontWeight: 600 }}>
                    + {money(inv.igst_amount || inv.gst_amount)}
                  </span>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: '#64748b' }}>CGST Total:</span>
                    <span style={{ fontWeight: 600 }}>
                      + {money(inv.cgst_amount || (Number(inv.gst_amount) || 0) / 2)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: '#64748b' }}>SGST Total:</span>
                    <span style={{ fontWeight: 600 }}>
                      + {money(inv.sgst_amount || (Number(inv.gst_amount) || 0) / 2)}
                    </span>
                  </div>
                </>
              )}

              <div
                style={{
                  borderTop: '2px solid #cbd5e1',
                  paddingTop: '10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '15px', fontWeight: 700 }}>Total Amount:</span>
                <span style={{ fontSize: '18px', fontWeight: 800, color: '#2563eb' }}>
                  {money(inv.total_amount)}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '8px',
                  fontSize: '13px',
                }}
              >
                <span style={{ color: '#64748b' }}>Amount Paid:</span>
                <span style={{ fontWeight: 600, color: '#16a34a' }}>
                  {money(inv.amount_paid)}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '4px',
                  fontSize: '13px',
                }}
              >
                <span style={{ color: '#64748b' }}>Payment Mode:</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>
                  {inv.payment_mode || (Number(inv.amount_paid) > 0 ? 'Not Recorded' : 'None')}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '4px',
                  fontSize: '14px',
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    color: Number(inv.balance_due) > 0 ? '#dc2626' : '#16a34a',
                  }}
                >
                  Balance Due:
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: Number(inv.balance_due) > 0 ? '#dc2626' : '#16a34a',
                  }}
                >
                  {money(inv.balance_due)}
                </span>
              </div>
            </div>
          </div>

          {/* Payment Information & Settlement Records Section */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '16px 20px',
              marginBottom: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '10px',
                marginBottom: '12px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <h5
                style={{
                  margin: 0,
                  fontSize: '13px',
                  textTransform: 'uppercase',
                  color: '#1e293b',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>💳</span> Payment Information & Settlement Record
              </h5>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Payment Status:</span>
                <StatusBadge status={inv.status} />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                marginBottom: '16px',
              }}
            >
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Recorded Payment Mode
                </span>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                  {inv.payment_mode || (Number(inv.amount_paid) > 0 ? 'Not Recorded' : 'None')}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Total Amount Paid
                </span>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#16a34a', marginTop: '2px' }}>
                  {money(inv.amount_paid)}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Outstanding Balance
                </span>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: Number(inv.balance_due) > 0 ? '#dc2626' : '#16a34a',
                    marginTop: '2px',
                  }}
                >
                  {money(inv.balance_due)}
                </div>
              </div>
            </div>

            {/* Itemized Verified Payments Table */}
            {inv.payments && inv.payments.length > 0 ? (
              <div className="table-responsive">
                <table className="data-table" style={{ fontSize: '12px', margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Payment Date</th>
                      <th>Payment Mode</th>
                      <th>Reference / UTR</th>
                      <th>Receipt #</th>
                      <th style={{ textAlign: 'right' }}>Amount Paid</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.payments.map((p, pIdx) => (
                      <tr key={p.id || pIdx}>
                        <td style={{ whiteSpace: 'nowrap' }}>{p.payment_date || '—'}</td>
                        <td style={{ fontWeight: 600 }}>
                          <span
                            style={{
                              background: '#e0f2fe',
                              color: '#0369a1',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              display: 'inline-block',
                              fontSize: '11px',
                              fontWeight: 700,
                            }}
                          >
                            {p.payment_method || 'Not Recorded'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '11px', color: '#475569' }}>
                          {p.reference && p.reference !== '—'
                            ? p.reference
                            : p.payment_method?.toLowerCase() === 'cash'
                            ? 'Cash (No Ref Required)'
                            : '—'}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                          {p.receipt_number || '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>
                          {money(p.amount)}
                        </td>
                        <td>
                          <StatusBadge status={p.status || 'PAID'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : Number(inv.amount_paid) > 0 ? (
              <div
                style={{
                  background: '#f1f5f9',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#475569',
                }}
              >
                ℹ️ <strong>Historical Invoice:</strong> Payment of {money(inv.amount_paid)} was settled on this invoice. Payment Mode: <strong>Not Recorded</strong>.
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
                No verified payments recorded for this invoice yet. Outstanding balance is {money(inv.balance_due)}.
              </div>
            )}
          </div>

          {/* Bank Details & Dynamic UPI QR Section */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '20px',
              borderTop: '1px solid #e2e8f0',
              paddingTop: '20px',
            }}
          >
            {/* Bank Details Card */}
            <div
              style={{
                background: '#f8fafc',
                padding: '16px 20px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}
            >
              <h5
                style={{
                  margin: '0 0 10px',
                  fontSize: '13px',
                  textTransform: 'uppercase',
                  color: '#334155',
                  fontWeight: 700,
                }}
              >
                Bank Payment Instructions
              </h5>
              <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.7 }}>
                <div>
                  <strong>Bank:</strong> {comp?.bank_name || '—'}
                </div>
                <div>
                  <strong>A/C Name:</strong>{' '}
                  {comp?.account_holder_name || comp?.company_name || '—'}
                </div>
                <div>
                  <strong>A/C No:</strong> {comp?.account_number || '—'}
                </div>
                <div>
                  <strong>IFSC:</strong> {comp?.ifsc_code || '—'}
                </div>
                <div>
                  <strong>UPI ID:</strong> {comp?.upi_id || '—'}
                </div>
              </div>
            </div>

            {/* Dynamic UPI QR Code Card */}
            {livePaid || Number(inv.balance_due) <= 0 ? (
              <div
                style={{
                  background: '#ecfdf5',
                  border: '1px solid #86efac',
                  borderRadius: '8px',
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '24px', color: '#16a34a' }}>✓</span>
                <div>
                  <div style={{ fontWeight: 700, color: '#166534', fontSize: '14px' }}>
                    Invoice Fully Paid & Settled
                  </div>
                  <div style={{ fontSize: '12px', color: '#15803d', marginTop: '2px' }}>
                    Transaction verified & confirmed. Outstanding balance is {money(0)}.
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: '#f8fafc',
                  padding: '16px 20px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h5
                    style={{
                      margin: 0,
                      fontSize: '13px',
                      textTransform: 'uppercase',
                      color: '#334155',
                      fontWeight: 700,
                    }}
                  >
                    Instant Scan-to-Pay (UPI)
                  </h5>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="upi-pulse-dot" style={{ width: '8px', height: '8px' }} />
                    <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
                      Listening for payment…
                    </span>
                  </div>
                </div>

                {comp?.upi_id ? (
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                    {qrCodeDataUrl ? (
                      <img
                        src={qrCodeDataUrl}
                        alt="UPI QR Code"
                        style={{
                          width: '110px',
                          height: '110px',
                          background: '#ffffff',
                          padding: '4px',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '110px',
                          height: '110px',
                          background: '#e2e8f0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          color: '#64748b',
                        }}
                      >
                        Generating QR…
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.6 }}>
                      <div>
                        Scan with <strong>GPay, PhonePe, Paytm, BHIM</strong>
                      </div>
                      <div style={{ marginTop: '4px' }}>
                        UPI ID: <strong className="mono-text">{comp.upi_id}</strong>{' '}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '2px 6px', fontSize: '10px', marginLeft: '6px' }}
                          onClick={() => handleCopy(comp.upi_id, 'upi')}
                        >
                          {copiedField === 'upi' ? '✓ Copied' : 'Copy VPA'}
                        </button>
                      </div>
                      <div style={{ marginTop: '2px' }}>
                        Amount:{' '}
                        <strong style={{ color: '#2563eb' }}>
                          {money(inv.balance_due)}
                        </strong>{' '}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '2px 6px', fontSize: '10px', marginLeft: '6px' }}
                          onClick={() => handleCopy(Number(inv.balance_due).toFixed(2), 'amount')}
                        >
                          {copiedField === 'amount' ? '✓ Copied' : 'Copy ₹'}
                        </button>
                      </div>
                      {comp?.bank_name && (
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          Bank: {comp.bank_name} {comp.account_number ? `(A/C: ${comp.account_number})` : ''}
                        </div>
                      )}
                      {upiLink && (
                        <div style={{ marginTop: '6px' }}>
                          <a
                            href={upiLink}
                            className="btn btn-primary btn-sm"
                            style={{ padding: '3px 8px', fontSize: '11px', textDecoration: 'none' }}
                          >
                            📱 Open UPI App
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: '#64748b' }}>
                    UPI payment not configured in Company Settings.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer no-print">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
