import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import QRCode from 'qrcode'
import { companySettingsApi } from '../services/api'
import { INDIAN_STATES, defaultCompanySettings } from '../utils/constants'

export default function SettingsPage() {
  const { companySettings, setCompanySettings, userRole, currentUser, setError, setSuccess } =
    useOutletContext()

  const [settingsForm, setSettingsForm] = useState(companySettings || defaultCompanySettings)
  const [saving, setSaving] = useState(false)
  const [previewQrUrl, setPreviewQrUrl] = useState('')
  const [qrCopyStatus, setQrCopyStatus] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    let active = true
    const upi = settingsForm.upi_id?.trim()
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/

    if (upi && upiRegex.test(upi)) {
      const compName = settingsForm.company_name?.trim() || 'Viora Bills'
      const testUri = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(
        compName
      )}&cu=INR&tn=${encodeURIComponent('Test QR Code Payment')}`

      QRCode.toDataURL(testUri, {
        width: 180,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
        .then((url) => {
          if (active) setPreviewQrUrl(url)
        })
        .catch(() => {
          if (active) setPreviewQrUrl('')
        })
    } else {
      setPreviewQrUrl('')
    }

    return () => {
      active = false
    }
  }, [settingsForm.upi_id, settingsForm.company_name])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore && companySettings) {
        setSettingsForm(companySettings)
      }
    })
    return () => {
      ignore = true
    }
  }, [companySettings])

  function handleLogoFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (PNG, JPG, SVG).')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('Logo image must be smaller than 2MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      setSettingsForm((prev) => ({ ...prev, logo_url: e.target?.result }))
    }
    reader.readAsDataURL(file)
  }

  async function handleSaveCompanySettings(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (userRole !== 'admin') {
      setError('Permission Denied: Only administrators can update Company and Bank settings.')
      return
    }

    const gstin = settingsForm.gstin?.trim()
    if (gstin) {
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
      if (!gstinRegex.test(gstin.toUpperCase())) {
        setError('Invalid GSTIN format. Expected 15 characters (e.g., 27AABCU9603R1ZM).')
        return
      }
    }

    const ifsc = settingsForm.ifsc_code?.trim()
    if (ifsc) {
      const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/
      if (!ifscRegex.test(ifsc.toUpperCase())) {
        setError('Invalid IFSC code format. Expected 11 characters (e.g., HDFC0001234).')
        return
      }
    }

    const upi = settingsForm.upi_id?.trim()
    if (upi) {
      const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/
      if (!upiRegex.test(upi)) {
        setError('Invalid UPI ID format (e.g. name@upi or phone@bank).')
        return
      }
    }

    setSaving(true)
    try {
      const res = await companySettingsApi.update(settingsForm)
      if (res?.settings) {
        setCompanySettings(res.settings)
        setSettingsForm(res.settings)
      }
      setSuccess('Company profile and bank settings saved successfully.')
    } catch (err) {
      setError(`Failed to save company settings: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Authenticated Identity Card */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          marginBottom: '20px',
          background: '#f8fafc',
          borderLeft: '4px solid #3b82f6',
        }}
      >
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
            <span
              style={{
                fontSize: '12px',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: '#64748b',
              }}
            >
              Authenticated Administrator
            </span>
            <h4 style={{ margin: '2px 0 0', fontSize: '15px', color: '#0f172a' }}>
              Signed in as: <strong>{currentUser?.full_name || currentUser?.email}</strong>{' '}
              <span
                style={{
                  marginLeft: '8px',
                  fontSize: '11px',
                  padding: '2px 8px',
                  background: '#dbeafe',
                  color: '#1e40af',
                  borderRadius: '4px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}
              >
                ADMIN
              </span>
            </h4>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              Email: <code>{currentUser?.email}</code> • Full permission to configure company
              tax profile, banking details, and merchant UPI payment receivers.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveCompanySettings}>
        {/* Company Profile Card */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Company Profile Information</h3>
              <p className="card-desc">
                Your official business details displayed on generated invoices and tax filings
              </p>
            </div>
          </div>

          <div
            className="form-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
          >
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">
                Company / Business Legal Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-control"
                type="text"
                required
                placeholder="e.g. Viora Bills Solutions Pvt Ltd"
                value={settingsForm.company_name || ''}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, company_name: e.target.value })
                }
              />
            </div>

            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">
                Official Registered Address <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-control"
                type="text"
                required
                placeholder="Building, Street, Area"
                value={settingsForm.business_address || ''}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, business_address: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label className="form-label">State</label>
              <select
                className="form-control"
                value={settingsForm.state || ''}
                onChange={(e) => setSettingsForm({ ...settingsForm, state: e.target.value })}
              >
                {INDIAN_STATES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">PIN Code</label>
              <input
                className="form-control"
                type="text"
                maxLength={6}
                placeholder="e.g. 411001"
                value={settingsForm.pincode || ''}
                onChange={(e) => setSettingsForm({ ...settingsForm, pincode: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">GSTIN (15 characters)</label>
              <input
                className="form-control"
                type="text"
                maxLength={15}
                placeholder="e.g. 27AABCU9603R1ZM"
                value={settingsForm.gstin || ''}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, gstin: e.target.value.toUpperCase() })
                }
              />
              <small style={{ color: '#64748b', fontSize: '11px', marginTop: '2px' }}>
                Standard 15-character GST identification number
              </small>
            </div>

            <div className="form-group">
              <label className="form-label">Official Phone</label>
              <input
                className="form-control"
                type="tel"
                placeholder="e.g. +91 9876543210"
                value={settingsForm.phone || ''}
                onChange={(e) => setSettingsForm({ ...settingsForm, phone: e.target.value })}
              />
            </div>

            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Official Support / Billing Email</label>
              <input
                className="form-control"
                type="email"
                placeholder="e.g. billing@viorabills.com"
                value={settingsForm.email || ''}
                onChange={(e) => setSettingsForm({ ...settingsForm, email: e.target.value })}
              />
            </div>

            {/* Logo Upload Section */}
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Company Brand Logo (Header on Invoices)</label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  flexWrap: 'wrap',
                  padding: '14px',
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '8px',
                }}
              >
                {settingsForm.logo_url ? (
                  <img
                    src={settingsForm.logo_url}
                    alt="Logo Preview"
                    style={{
                      width: '64px',
                      height: '64px',
                      objectFit: 'contain',
                      borderRadius: '6px',
                      border: '1px solid #e2e8f0',
                      background: '#fff',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      background: '#e2e8f0',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      color: '#64748b',
                    }}
                  >
                    No Logo
                  </div>
                )}

                <div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleLogoFileChange}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      📁 Upload New Logo
                    </button>
                    {settingsForm.logo_url && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSettingsForm({ ...settingsForm, logo_url: '' })}
                        style={{ color: '#dc2626' }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <small style={{ color: '#64748b', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                    PNG, JPG, or SVG up to 2MB. Appears on invoice headers & printouts.
                  </small>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bank & UPI Payment Details Card */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Bank Account & UPI Payment Details</h3>
              <p className="card-desc">
                Payment settlement credentials printed on invoices and encoded in dynamic scan-to-pay QR codes
              </p>
            </div>
          </div>

          <div
            className="form-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
          >
            <div className="form-group">
              <label className="form-label">Bank Name</label>
              <input
                className="form-control"
                type="text"
                placeholder="e.g. HDFC Bank, ICICI Bank"
                value={settingsForm.bank_name || ''}
                onChange={(e) => setSettingsForm({ ...settingsForm, bank_name: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Account Holder Name</label>
              <input
                className="form-control"
                type="text"
                placeholder="e.g. Viora Bills Solutions Pvt Ltd"
                value={settingsForm.account_holder_name || ''}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, account_holder_name: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label className="form-label">Bank Account Number</label>
              <input
                className="form-control"
                type="text"
                placeholder="e.g. 50200012345678"
                value={settingsForm.account_number || ''}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, account_number: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label className="form-label">IFSC Code (11 characters)</label>
              <input
                className="form-control"
                type="text"
                maxLength={11}
                placeholder="e.g. HDFC0001234"
                value={settingsForm.ifsc_code || ''}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, ifsc_code: e.target.value.toUpperCase() })
                }
              />
              <small style={{ color: '#64748b', fontSize: '11px', marginTop: '2px' }}>
                4 letters, 0, followed by 6 alphanumeric characters
              </small>
            </div>

            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">
                Merchant UPI ID <span style={{ color: '#2563eb' }}>(Dynamic QR Code Receiver)</span>
              </label>
              <input
                className="form-control"
                type="text"
                placeholder="e.g. viorabills@hdfcbank or 9876543210@paytm"
                value={settingsForm.upi_id || ''}
                onChange={(e) => setSettingsForm({ ...settingsForm, upi_id: e.target.value })}
              />
              <small style={{ color: '#64748b', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                Used to dynamically generate scan-to-pay QR codes with invoice amount and transaction reference on all printable invoices.
              </small>
            </div>

            {/* Live QR Preview Card */}
            <div
              style={{
                gridColumn: '1 / -1',
                marginTop: '12px',
                padding: '16px',
                background: '#f8fafc',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '20px',
              }}
            >
              {previewQrUrl ? (
                <>
                  <div
                    style={{
                      background: '#ffffff',
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    }}
                  >
                    <img src={previewQrUrl} alt="UPI QR Code Preview" style={{ width: '140px', height: '140px' }} />
                    <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', fontWeight: 600 }}>
                      Live UPI Preview
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span
                        style={{
                          background: '#dcfce7',
                          color: '#15803d',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                        }}
                      >
                        ✓ UPI QR READY
                      </span>
                      <span style={{ fontSize: '13px', color: '#475569' }}>
                        Merchant: <strong>{settingsForm.company_name || 'Viora Bills'}</strong>
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#1e293b', marginBottom: '8px' }}>
                      Settlement VPA: <strong>{settingsForm.upi_id?.trim()}</strong>
                    </div>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                      This QR code will be automatically embedded in printable invoice PDFs and customer payment screens with exact balance amounts and invoice reference codes.
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        if (navigator?.clipboard?.writeText && settingsForm.upi_id) {
                          navigator.clipboard.writeText(settingsForm.upi_id.trim())
                          setQrCopyStatus('Copied!')
                          setTimeout(() => setQrCopyStatus(''), 2000)
                        }
                      }}
                    >
                      {qrCopyStatus ? '✓ Copied' : '📋 Copy UPI ID'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ width: '100%', color: '#64748b', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>ℹ️</span>
                  <div>
                    <strong>No UPI QR Generated:</strong>{' '}
                    {settingsForm.upi_id?.trim()
                      ? 'The UPI ID format is invalid (e.g. name@upi or phone@bank).'
                      : 'Enter a valid Merchant UPI ID above to preview and activate your dynamic scan-to-pay QR code.'}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              marginTop: '24px',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setSettingsForm(companySettings)}
            >
              Reset
            </button>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving Settings…' : '✓ Save Company Settings'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
