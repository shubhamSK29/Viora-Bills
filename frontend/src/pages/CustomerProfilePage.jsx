import { useState, useEffect, useCallback, useRef } from 'react'
import { customerPortalApi, authApi } from '../services/api'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Alert from '../components/common/Alert'
import Modal from '../components/common/Modal'

export default function CustomerProfilePage() {
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [profile, setProfile] = useState(null)

  // Form State
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [gstin, setGstin] = useState('')
  const [businessPhone, setBusinessPhone] = useState('')
  const [billingAddress, setBillingAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [pincode, setPincode] = useState('')
  const [profileImage, setProfileImage] = useState('')

  // Password Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const fileInputRef = useRef(null)

  const syncFormFromProfile = useCallback((data) => {
    const cust = data?.customer || {}
    const usr = data?.user || {}
    setFullName(usr.full_name || cust.name || '')
    setPhone(cust.phone || usr.phone || '')
    setBusinessName(cust.business_name || cust.name || '')
    setGstin(cust.gstin || '')
    setBusinessPhone(cust.business_phone || '')
    setBillingAddress(cust.billing_address || '')
    setCity(cust.city || '')
    setState(cust.state || '')
    setPincode(cust.pincode || '')
    setProfileImage(cust.profile_image || usr.profile_image || '')
  }, [])

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await customerPortalApi.getProfile()
      setProfile(res)
      syncFormFromProfile(res)
    } catch (err) {
      setError(`Failed to retrieve profile: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [syncFormFromProfile])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchProfile()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchProfile])

  function handleCancelEdit() {
    syncFormFromProfile(profile)
    setIsEditing(false)
    setError('')
  }

  function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError('Profile image must be less than 2MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setProfileImage(reader.result)
    }
    reader.readAsDataURL(file)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const payload = {
      full_name: fullName.trim() || undefined,
      phone: phone.trim() || undefined,
      business_name: businessName.trim() || undefined,
      gstin: gstin.trim() ? gstin.trim().toUpperCase() : undefined,
      business_phone: businessPhone.trim() || undefined,
      billing_address: billingAddress.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      pincode: pincode.trim() || undefined,
      profile_image: profileImage || undefined,
    }

    try {
      const res = await customerPortalApi.updateProfile(payload)
      setSuccess(res.message || 'Profile updated successfully!')
      if (res.customer) {
        setProfile((prev) => ({
          ...prev,
          customer: res.customer,
          user: { ...prev?.user, full_name: res.customer.name },
        }))
      }
      setIsEditing(false)
    } catch (err) {
      setError(`Update failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')

    if (!currentPassword) {
      setPasswordError('Current password is required.')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError('New password must include uppercase, lowercase, and numbers.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }

    setChangingPassword(true)
    try {
      const res = await authApi.changePassword(currentPassword, newPassword)
      setPasswordSuccess(res?.message || 'Password changed successfully!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => {
        setShowPasswordModal(false)
        setPasswordSuccess('')
      }, 1500)
    } catch (err) {
      setPasswordError(err.message || 'Failed to update password.')
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading) {
    return <LoadingSpinner message="Loading customer profile…" size="large" />
  }

  const customer = profile?.customer || {}
  const user = profile?.user || {}

  return (
    <div style={{ maxWidth: '850px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header with Mode Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
            Customer Profile & Account Settings
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            Manage your personal profile, business identity, and verified billing coordinates.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {!isEditing ? (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowPasswordModal(true)}
              >
                🔒 Change Password
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setIsEditing(true)}
              >
                ✏️ Edit Profile
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCancelEdit}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving Changes…' : '💾 Save Profile'}
              </button>
            </>
          )}
        </div>
      </div>

      {success && <Alert type="success" message={success} />}
      {error && <Alert type="danger" message={error} />}

      {/* Snapshot Immobility Protection Notice */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px' }}>🛡️</span>
        <span>
          <strong>Audit Note:</strong> Updates made to your profile or business details apply to all new purchases and upcoming invoices. Historical finalized invoices remain immutable for statutory tax compliance.
        </span>
      </div>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Section 1: Personal Details & Avatar */}
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 20px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>👤</span> Personal Information
          </h3>

          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Avatar Column */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '90px',
                  height: '90px',
                  borderRadius: '50%',
                  background: '#e2e8f0',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '3px solid #cbd5e1',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
              >
                {profileImage ? (
                  <img src={profileImage} alt="Profile Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '36px', color: '#64748b' }}>
                    {(fullName || customer.name || 'C').charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              {isEditing && (
                <>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Change Photo
                  </button>
                  {profileImage && (
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '11px', cursor: 'pointer', padding: 0 }}
                      onClick={() => setProfileImage('')}
                    >
                      Remove
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Inputs Column */}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Full Name</label>
                {isEditing ? (
                  <input
                    type="text"
                    className="form-control"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. John Doe"
                    required
                  />
                ) : (
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', padding: '6px 0' }}>
                    {fullName || customer.name || 'Not provided'}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Login Email (Account Identifier)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
                  <span style={{ fontSize: '15px', color: '#334155' }}>
                    {user.email || customer.email}
                  </span>
                  <span style={{ fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                    Verified
                  </span>
                </div>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Email serves as your unique login ID and cannot be modified directly.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Mobile / Phone Number</label>
                {isEditing ? (
                  <input
                    type="tel"
                    className="form-control"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 9876543210"
                  />
                ) : (
                  <div style={{ fontSize: '15px', color: '#0f172a', padding: '6px 0' }}>
                    {phone || 'Not provided'}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600 }}>Account Role</label>
                <div style={{ padding: '6px 0' }}>
                  <span style={{ fontSize: '12px', background: '#e0e7ff', color: '#3730a3', padding: '3px 10px', borderRadius: '4px', fontWeight: 600, textTransform: 'uppercase' }}>
                    {user.role || 'Customer'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Business & Tax Identity */}
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 20px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🏢</span> Business & Billing Identity
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '18px' }}>
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600 }}>Business / Trade Name</label>
              {isEditing ? (
                <input
                  type="text"
                  className="form-control"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Acme Enterprises Ltd"
                />
              ) : (
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', padding: '6px 0' }}>
                  {businessName || 'Individual Consumer'}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600 }}>GSTIN (Goods and Services Tax ID)</label>
              {isEditing ? (
                <input
                  type="text"
                  className="form-control"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  placeholder="e.g. 27AAAAA0000A1Z5"
                  maxLength={15}
                  style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
                />
              ) : (
                <div style={{ fontSize: '14px', fontFamily: 'monospace', color: gstin ? '#2563eb' : '#64748b', fontWeight: 700, padding: '6px 0' }}>
                  {gstin || 'Unregistered Consumer'}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600 }}>Business Phone / Landline</label>
              {isEditing ? (
                <input
                  type="tel"
                  className="form-control"
                  value={businessPhone}
                  onChange={(e) => setBusinessPhone(e.target.value)}
                  placeholder="e.g. 022 2847 9000"
                />
              ) : (
                <div style={{ fontSize: '15px', color: '#0f172a', padding: '6px 0' }}>
                  {businessPhone || 'N/A'}
                </div>
              )}
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" style={{ fontWeight: 600 }}>Registered Billing Address</label>
              {isEditing ? (
                <textarea
                  className="form-control"
                  rows={3}
                  value={billingAddress}
                  onChange={(e) => setBillingAddress(e.target.value)}
                  placeholder="Building, Street, Area, Landmark"
                />
              ) : (
                <div style={{ fontSize: '14px', color: '#334155', padding: '6px 0', lineHeight: 1.5 }}>
                  {billingAddress || 'No billing address specified'}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600 }}>City</label>
              {isEditing ? (
                <input
                  type="text"
                  className="form-control"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Mumbai"
                />
              ) : (
                <div style={{ fontSize: '15px', color: '#0f172a', padding: '6px 0' }}>
                  {city || 'N/A'}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600 }}>State / Place of Supply</label>
              {isEditing ? (
                <input
                  type="text"
                  className="form-control"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="e.g. Maharashtra"
                />
              ) : (
                <div style={{ fontSize: '15px', color: '#0f172a', padding: '6px 0' }}>
                  {state || 'Maharashtra'}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600 }}>PIN Code</label>
              {isEditing ? (
                <input
                  type="text"
                  className="form-control"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  placeholder="e.g. 400001"
                  maxLength={10}
                />
              ) : (
                <div style={{ fontSize: '15px', color: '#0f172a', padding: '6px 0' }}>
                  {pincode || 'N/A'}
                </div>
              )}
            </div>
          </div>

          {isEditing && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancelEdit}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
                style={{ minWidth: '140px' }}
              >
                {saving ? 'Saving Changes…' : '💾 Save Profile'}
              </button>
            </div>
          )}
        </div>
      </form>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <Modal title="Change Account Password" onClose={() => setShowPasswordModal(false)}>
          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {passwordError && <Alert type="danger" message={passwordError} />}
            {passwordSuccess && <Alert type="success" message={passwordSuccess} />}

            <div className="form-group">
              <label className="form-label">Current Password</label>
              <input
                type="password"
                className="form-control"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div className="form-group">
              <label className="form-label">New Password</label>
              <input
                type="password"
                className="form-control"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters with upper, lower, number"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input
                type="password"
                className="form-control"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your new password"
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowPasswordModal(false)}
                disabled={changingPassword}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={changingPassword}
              >
                {changingPassword ? 'Updating Password…' : 'Update Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
