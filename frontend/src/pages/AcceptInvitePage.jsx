import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { invitationApi, authApi } from '../services/api'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Alert from '../components/common/Alert'

export default function AcceptInvitePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(Boolean(token))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(!token ? 'Missing invitation token in the link. Please check your invitation URL.' : '')
  const [success, setSuccess] = useState('')
  const [inviteData, setInviteData] = useState(null)

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // OTP State
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [otpCooldown, setOtpCooldown] = useState(0)
  const [otpNotice, setOtpNotice] = useState('')

  useEffect(() => {
    let timer = null
    if (otpCooldown > 0) {
      timer = setInterval(() => {
        setOtpCooldown((prev) => (prev > 1 ? prev - 1 : 0))
      }, 1000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [otpCooldown])

  useEffect(() => {
    let ignore = false
    if (!token) return

    Promise.resolve().then(async () => {
      try {
        const data = await invitationApi.verifyInvite(token)
        if (!ignore) {
          setInviteData(data)
          setFullName(data.customer_name || '')
        }
      } catch (err) {
        if (!ignore) {
          setError(err.message || 'Invitation is invalid or has expired.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    })

    return () => {
      ignore = true
    }
  }, [token])

  async function handleSendVerificationOtp() {
    if (!inviteData?.email) return
    setError('')
    setOtpNotice('')
    setSendingOtp(true)
    try {
      const res = await authApi.sendOtp(inviteData.email, 'VERIFICATION')
      setOtpSent(true)
      setOtpCooldown(res?.cooldown_seconds || 60)
      setOtpNotice(res?.message || `A 6-digit verification code has been dispatched to ${inviteData.email}.`)
    } catch (err) {
      setError(err.message || 'Failed to dispatch verification code. Please try again.')
    } finally {
      setSendingOtp(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must contain at least one uppercase letter, one lowercase letter, and one number.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      let res
      if (otpSent && otp.trim()) {
        res = await authApi.verifyOtpAndSetPassword({
          email: inviteData.email,
          otp: otp.trim(),
          password,
          token,
          full_name: fullName.trim() || inviteData?.customer_name,
        })
      } else {
        res = await invitationApi.acceptInvite({
          token,
          password,
          full_name: fullName.trim() || inviteData?.customer_name,
        })
      }
      setSuccess(res.message || 'Account activated successfully! You may now sign in.')
      setTimeout(() => {
        navigate('/login')
      }, 2500)
    } catch (err) {
      setError(err.message || 'Failed to complete registration.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingSpinner message="Verifying invitation link…" size="large" />
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #312e81 0%, #4f46e5 50%, #4338ca 100%)',
        padding: '20px',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '40px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
              borderRadius: '14px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px',
              color: '#ffffff',
              fontSize: '24px',
            }}
          >
            🏛️
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
            Viora Bills Client Portal
          </h1>
          <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>
            Activate your customer account & access invoices
          </p>
        </div>

        {error && <Alert type="danger" message={error} />}
        {success && <Alert type="success" message={success} />}

        {inviteData && !success && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 16px',
                fontSize: '13px',
              }}
            >
              <div style={{ color: '#64748b', fontSize: '11px', textTransform: 'uppercase' }}>
                Account Linked To
              </div>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>{inviteData.customer_name}</div>
              <div style={{ color: '#475569', fontSize: '12px' }}>{inviteData.email}</div>
            </div>

            <div className="form-group">
              <label className="form-label">Contact Person Name</label>
              <input
                type="text"
                className="form-control"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            {/* Email OTP Verification Section */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                  ✉️ Email Verification (Recommended)
                </span>
                <button
                  type="button"
                  onClick={handleSendVerificationOtp}
                  disabled={sendingOtp || otpCooldown > 0}
                  style={{
                    background: otpCooldown > 0 ? '#e2e8f0' : '#4f46e5',
                    color: otpCooldown > 0 ? '#64748b' : '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: otpCooldown > 0 ? 'default' : 'pointer',
                  }}
                >
                  {sendingOtp ? 'Sending…' : otpCooldown > 0 ? `Resend (${otpCooldown}s)` : otpSent ? 'Resend Code' : 'Send Code'}
                </button>
              </div>

              {otpNotice && (
                <div style={{ fontSize: '12px', color: '#166534', background: '#f0fdf4', padding: '6px 10px', borderRadius: '4px', marginBottom: '10px' }}>
                  ✅ {otpNotice}
                </div>
              )}

              {otpSent && (
                <div>
                  <label className="form-label" style={{ fontSize: '12px' }}>6-Digit Email Verification Code</label>
                  <input
                    type="text"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    className="form-control"
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    style={{ letterSpacing: '4px', fontSize: '16px', fontWeight: 700, textAlign: 'center' }}
                  />
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                    Check your inbox at {inviteData.email} (valid for 10 minutes)
                  </div>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Create Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-control"
                  required
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '8px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#64748b',
                  }}
                  tabIndex={-1}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                required
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <div
              style={{
                fontSize: '11px',
                color: '#64748b',
                background: '#f8fafc',
                padding: '6px 10px',
                borderRadius: '6px',
              }}
            >
              Password must be at least 8 characters with uppercase, lowercase, and numeric digits.
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '12px',
                marginTop: '8px',
                background: '#4f46e5',
                borderColor: '#4f46e5',
              }}
            >
              {submitting ? 'Activating Account…' : '🔐 Activate Account & Set Password'}
            </button>
          </form>
        )}

        {success && (
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/login')}
              style={{ width: '100%', padding: '12px', background: '#059669', borderColor: '#059669' }}
            >
              Proceed to Sign In →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

