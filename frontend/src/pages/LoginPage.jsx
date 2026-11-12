import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authApi } from '../api'

export default function LoginPage({ initialTab = 'signin' }) {
  const { login, register } = useAuth()
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState(initialTab) // 'signin' | 'signup'

  // Sign In State
  const [email, setEmail] = useState(() => localStorage.getItem('viora_remember_email') || '')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [logging, setLogging] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(() => Boolean(localStorage.getItem('viora_remember_email')))

  // Sign Up State
  const [regFullName, setRegFullName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regOtp, setRegOtp] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirmPassword, setRegConfirmPassword] = useState('')
  const [regShowPassword, setRegShowPassword] = useState(false)
  const [regStep, setRegStep] = useState(1) // 1: enter details, 2: enter otp & set password
  const [regSendingOtp, setRegSendingOtp] = useState(false)
  const [regSubmitting, setRegSubmitting] = useState(false)
  const [regError, setRegError] = useState('')
  const [regSuccess, setRegSuccess] = useState('')
  const [regCooldown, setRegCooldown] = useState(0)

  // Forgot Password Modal State
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [fpStep, setFpStep] = useState(1) // 1: enter email, 2: enter otp & new pass
  const [fpEmail, setFpEmail] = useState('')
  const [fpOtp, setFpOtp] = useState('')
  const [fpNewPassword, setFpNewPassword] = useState('')
  const [fpConfirmPassword, setFpConfirmPassword] = useState('')
  const [fpShowPassword, setFpShowPassword] = useState(false)
  const [fpLoading, setFpLoading] = useState(false)
  const [fpError, setFpError] = useState('')
  const [fpSuccess, setFpSuccess] = useState('')
  const [fpCooldown, setFpCooldown] = useState(0)

  // Registration Cooldown Timer
  useEffect(() => {
    let timer = null
    if (regCooldown > 0) {
      timer = setInterval(() => {
        setRegCooldown((prev) => (prev > 1 ? prev - 1 : 0))
      }, 1000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [regCooldown])

  // Forgot Password Cooldown Timer
  useEffect(() => {
    let timer = null
    if (fpCooldown > 0) {
      timer = setInterval(() => {
        setFpCooldown((prev) => (prev > 1 ? prev - 1 : 0))
      }, 1000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [fpCooldown])

  function redirectBasedOnRole(user) {
    const role = user?.role
    if (role === 'admin') {
      navigate('/admin/dashboard', { replace: true })
    } else if (role === 'customer') {
      navigate('/customer/dashboard', { replace: true })
    } else if (role === 'staff') {
      navigate('/staff/dashboard', { replace: true })
    } else {
      navigate('/dashboard', { replace: true })
    }
  }

  // ─── Sign In Handler ────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault()
    setLoginError('')
    setLogging(true)
    try {
      const user = await login(email.trim(), password)
      if (rememberMe) {
        localStorage.setItem('viora_remember_email', email.trim())
      } else {
        localStorage.removeItem('viora_remember_email')
      }
      redirectBasedOnRole(user)
    } catch (err) {
      setLoginError(err.message || 'Login failed. Please check your credentials.')
    } finally {
      setLogging(false)
    }
  }

  // ─── Sign Up Handlers ───────────────────────────────────────────────────────
  async function handleSendRegistrationOtp(e) {
    if (e && e.preventDefault) e.preventDefault()
    setRegError('')
    setRegSuccess('')

    if (!regFullName.trim() || regFullName.trim().length < 2) {
      setRegError('Please enter your full name (at least 2 characters).')
      return
    }
    if (!regEmail.trim() || !regEmail.includes('@')) {
      setRegError('Please enter a valid email address.')
      return
    }

    setRegSendingOtp(true)
    try {
      const res = await authApi.sendRegistrationOtp(regEmail.trim(), regFullName.trim())
      if (res?.smtp_configured === false || res?.email_delivered === false) {
        setRegError(
          `⚠️ Real email delivery requires Gmail credentials. SMTP_USER and SMTP_PASS are currently empty in backend/.env. Please configure your Gmail address and 16-character Google App Password in backend/.env to receive real emails in your inbox.`
        )
        if (res?.dev_otp) {
          setRegSuccess(
            `Development verification code: ${res.dev_otp} (Configure SMTP_USER & SMTP_PASS in backend/.env for real email delivery).`
          )
        }
      } else {
        setRegSuccess(
          `✉️ Verification code sent to ${regEmail.trim()}! Please check your Gmail Inbox or Spam folder, copy the OTP, and enter it below.`
        )
      }
      setRegStep(2)
      setRegCooldown(res?.cooldown_seconds || 60)
    } catch (err) {
      setRegError(err.message || 'Failed to send verification code. Please try again.')
    } finally {
      setRegSendingOtp(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setRegError('')
    setRegSuccess('')

    if (!regOtp.trim() || regOtp.trim().length !== 6) {
      setRegError('Please enter the 6-digit numeric verification code.')
      return
    }
    if (regPassword.length < 8) {
      setRegError('Password must be at least 8 characters long.')
      return
    }
    if (!/[A-Z]/.test(regPassword) || !/[a-z]/.test(regPassword) || !/[0-9]/.test(regPassword)) {
      setRegError('Password must contain at least one uppercase letter, one lowercase letter, and one number.')
      return
    }
    if (regPassword !== regConfirmPassword) {
      setRegError('Passwords do not match.')
      return
    }

    setRegSubmitting(true)
    try {
      const res = await register({
        email: regEmail.trim(),
        full_name: regFullName.trim(),
        phone: regPhone.trim() || undefined,
        otp: regOtp.trim(),
        password: regPassword,
      })

      setRegSuccess('🎉 Account verified and created successfully!')
      setTimeout(() => {
        if (res?.user) {
          redirectBasedOnRole(res.user)
        } else {
          setEmail(regEmail.trim())
          setActiveTab('signin')
        }
      }, 1200)
    } catch (err) {
      setRegError(err.message || 'Registration failed. Please verify your OTP and try again.')
    } finally {
      setRegSubmitting(false)
    }
  }

  // ─── Forgot Password Handlers ───────────────────────────────────────────────
  function openForgotPassword() {
    setFpEmail(email.trim())
    setFpOtp('')
    setFpNewPassword('')
    setFpConfirmPassword('')
    setFpError('')
    setFpSuccess('')
    setFpStep(1)
    setShowForgotPassword(true)
  }

  function closeForgotPassword() {
    setShowForgotPassword(false)
    setFpError('')
  }

  async function handleSendResetOtp(e) {
    e?.preventDefault()
    if (!fpEmail.trim()) {
      setFpError('Please enter your account email address.')
      return
    }
    setFpError('')
    setFpLoading(true)
    try {
      const res = await authApi.forgotPassword(fpEmail.trim())
      if (res?.smtp_configured === false || res?.email_delivered === false) {
        setFpError(
          `⚠️ Real email delivery requires Gmail credentials. SMTP_USER and SMTP_PASS are currently empty in backend/.env. Please configure your Gmail address and 16-character Google App Password in backend/.env to receive real emails.`
        )
        if (res?.dev_otp) {
          setFpSuccess(
            `Development recovery code: ${res.dev_otp} (Configure SMTP_USER & SMTP_PASS in backend/.env for real email delivery).`
          )
        }
      } else {
        setFpSuccess(
          `✉️ Verification code sent to ${fpEmail.trim()}! Please check your Gmail Inbox or Spam folder, copy the code, and enter it below.`
        )
      }
      setFpStep(2)
      setFpCooldown(res?.cooldown_seconds || 60)
    } catch (err) {
      setFpError(err.message || 'Failed to send verification code. Please try again.')
    } finally {
      setFpLoading(false)
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    setFpError('')
    if (!fpOtp.trim() || fpOtp.trim().length !== 6) {
      setFpError('Please enter the 6-digit numeric verification code.')
      return
    }
    if (fpNewPassword.length < 8) {
      setFpError('Password must be at least 8 characters long.')
      return
    }
    if (!/[A-Z]/.test(fpNewPassword) || !/[a-z]/.test(fpNewPassword) || !/[0-9]/.test(fpNewPassword)) {
      setFpError('Password must contain at least one uppercase letter, one lowercase letter, and one number.')
      return
    }
    if (fpNewPassword !== fpConfirmPassword) {
      setFpError('Passwords do not match.')
      return
    }

    setFpLoading(true)
    try {
      const res = await authApi.resetPasswordWithOtp(fpEmail.trim(), fpOtp.trim(), fpNewPassword)
      setEmail(fpEmail.trim())
      setPassword('')
      setShowForgotPassword(false)
      setLoginError('')
      alert(res?.message || 'Password reset successfully! Please sign in with your new password.')
    } catch (err) {
      setFpError(err.message || 'Failed to reset password. Please verify your OTP.')
    } finally {
      setFpLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #1d4ed8 100%)',
        padding: '24px 16px',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '40px 36px',
          width: '100%',
          maxWidth: '440px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              borderRadius: '14px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '10px',
              boxShadow: '0 4px 16px rgba(37,99,235,0.4)',
            }}
          >
            <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="#fff">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', margin: '0 0 2px' }}>
            Viora Bills
          </h1>
          <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>
            Billing & Invoice Management System
          </p>
        </div>

        {/* Tab Toggle: Sign In vs Sign Up */}
        <div
          style={{
            display: 'flex',
            background: '#f1f5f9',
            borderRadius: '10px',
            padding: '4px',
            marginBottom: '24px',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setActiveTab('signin')
              setLoginError('')
              setRegError('')
            }}
            style={{
              flex: 1,
              padding: '10px',
              border: 'none',
              borderRadius: '8px',
              background: activeTab === 'signin' ? '#ffffff' : 'transparent',
              fontWeight: activeTab === 'signin' ? 700 : 500,
              color: activeTab === 'signin' ? '#1e3a8a' : '#64748b',
              boxShadow: activeTab === 'signin' ? '0 2px 4px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.15s ease',
            }}
          >
            🔐 Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('signup')
              setLoginError('')
              setRegError('')
            }}
            style={{
              flex: 1,
              padding: '10px',
              border: 'none',
              borderRadius: '8px',
              background: activeTab === 'signup' ? '#ffffff' : 'transparent',
              fontWeight: activeTab === 'signup' ? 700 : 500,
              color: activeTab === 'signup' ? '#1e3a8a' : '#64748b',
              boxShadow: activeTab === 'signup' ? '0 2px 4px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.15s ease',
            }}
          >
            ✨ Sign Up / Register
          </button>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB 1: SIGN IN FORM
        ═══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'signin' && (
          <div>
            <h2
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: '#0f172a',
                margin: '0 0 18px',
                textAlign: 'center',
              }}
            >
              Enter your email and password to sign in
            </h2>

            {loginError && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#dc2626',
                  fontSize: '13px',
                  marginBottom: '18px',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'flex-start',
                }}
              >
                <span>⚠️</span>
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>Email Address</label>
                <input
                  className="form-control"
                  type="email"
                  required
                  autoFocus
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={logging}
                />
              </div>

              <div className="form-group" style={{ marginTop: '14px', position: 'relative' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>Password</label>
                <input
                  className="form-control"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={logging}
                  style={{ paddingRight: '44px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '34px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#64748b',
                    fontSize: '16px',
                    padding: '2px',
                  }}
                  tabIndex={-1}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#475569', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={openForgotPassword}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: '#2563eb',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Forgot Password?
                </button>
              </div>

              <button
                className="btn btn-primary"
                type="submit"
                disabled={logging}
                style={{ width: '100%', marginTop: '20px', padding: '12px', fontSize: '15px', fontWeight: 700 }}
              >
                {logging ? '🔄 Signing in…' : '🔐 Sign In'}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#64748b' }}>
              Don’t have an account yet?{' '}
              <button
                type="button"
                onClick={() => setActiveTab('signup')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: '#2563eb',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Create Account with OTP →
              </button>
            </div>

            {/* Quick Demo Credentials */}
            <div
              style={{
                marginTop: '20px',
                padding: '12px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px dashed #cbd5e1',
                fontSize: '11px',
                color: '#64748b',
              }}
            >
              <strong style={{ color: '#475569' }}>Quick Demo logins:</strong>
              <div style={{ marginTop: '4px', display: 'grid', gap: '3px' }}>
                <div>🔵 Admin: <code>admin@viorabills.com</code> / <code>Admin@12345</code></div>
                <div>🟢 Staff: <code>staff@viorabills.com</code> / <code>Staff@12345</code></div>
                <div>🟣 Customer: <code>customer@viorabills.com</code> / <code>Customer@12345</code></div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB 2: SIGN UP / REGISTER FORM WITH EMAIL OTP
        ═══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'signup' && (
          <div>
            <h2
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: '#0f172a',
                margin: '0 0 4px',
                textAlign: 'center',
              }}
            >
              {regStep === 1 ? 'Start by verifying your email' : 'Verify OTP & set your password'}
            </h2>
            <p style={{ textAlign: 'center', fontSize: '12px', color: '#64748b', margin: '0 0 18px' }}>
              {regStep === 1
                ? 'We will send a 6-digit OTP code to verify your email address.'
                : `Enter the 6-digit OTP sent to ${regEmail} and create your password.`}
            </p>

            {regError && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#dc2626',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                ⚠️ {regError}
              </div>
            )}

            {regSuccess && (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#166534',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                ✅ {regSuccess}
              </div>
            )}

            {regStep === 1 ? (
              /* Step 1: User details & Send OTP */
              <form onSubmit={handleSendRegistrationOtp}>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    Full Name
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    autoFocus
                    placeholder="e.g. John Doe"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    disabled={regSendingOtp}
                  />
                </div>

                <div className="form-group" style={{ marginTop: '14px' }}>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    className="form-control"
                    required
                    placeholder="name@example.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    disabled={regSendingOtp}
                  />
                </div>

                <div className="form-group" style={{ marginTop: '14px' }}>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    className="form-control"
                    placeholder="9876543210"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    disabled={regSendingOtp}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={regSendingOtp || !regEmail.trim() || !regFullName.trim()}
                  style={{ width: '100%', marginTop: '20px', padding: '12px', fontSize: '15px', fontWeight: 700 }}
                >
                  {regSendingOtp ? '✉️ Sending Verification Code…' : '✉️ Send Verification OTP'}
                </button>

                <div style={{ textAlign: 'center', marginTop: '18px', fontSize: '13px', color: '#64748b' }}>
                  Already registered?{' '}
                  <button
                    type="button"
                    onClick={() => setActiveTab('signin')}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#2563eb',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    Sign In with Password →
                  </button>
                </div>
              </form>
            ) : (
              /* Step 2: Enter OTP & Create Password */
              <form onSubmit={handleRegister}>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    6-Digit Verification Code (OTP)
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    className="form-control"
                    required
                    autoFocus
                    placeholder="123456"
                    value={regOtp}
                    onChange={(e) => setRegOtp(e.target.value.replace(/\D/g, ''))}
                    disabled={regSubmitting}
                    style={{ letterSpacing: '4px', fontSize: '18px', fontWeight: 700, textAlign: 'center' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>Valid for 10 minutes</span>
                    <button
                      type="button"
                      onClick={handleSendRegistrationOtp}
                      disabled={regCooldown > 0 || regSendingOtp}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: regCooldown > 0 ? '#94a3b8' : '#2563eb',
                        fontSize: '12px',
                        cursor: regCooldown > 0 ? 'default' : 'pointer',
                        padding: 0,
                        textDecoration: regCooldown > 0 ? 'none' : 'underline',
                      }}
                    >
                      {regCooldown > 0 ? `Resend in ${regCooldown}s` : 'Resend Code'}
                    </button>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '14px', position: 'relative' }}>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    Create Password
                  </label>
                  <input
                    type={regShowPassword ? 'text' : 'password'}
                    className="form-control"
                    required
                    placeholder="Min 8 chars, 1 uppercase, 1 digit"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    disabled={regSubmitting}
                    style={{ paddingRight: '40px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setRegShowPassword(!regShowPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '34px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#64748b',
                    }}
                    tabIndex={-1}
                  >
                    {regShowPassword ? '🙈' : '👁️'}
                  </button>
                </div>

                <div className="form-group" style={{ marginTop: '14px' }}>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>
                    Confirm Password
                  </label>
                  <input
                    type={regShowPassword ? 'text' : 'password'}
                    className="form-control"
                    required
                    placeholder="Repeat your password"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    disabled={regSubmitting}
                  />
                </div>

                <div
                  style={{
                    marginTop: '12px',
                    padding: '8px 10px',
                    background: '#f8fafc',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#64748b',
                    lineHeight: '1.4',
                  }}
                >
                  🔒 Must be at least 8 characters with at least one uppercase letter, one lowercase letter, and one number.
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setRegStep(1)}
                    disabled={regSubmitting}
                    style={{ flex: 1 }}
                  >
                    ← Back
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={regSubmitting || regOtp.length !== 6 || !regPassword}
                    style={{ flex: 2, fontWeight: 700 }}
                  >
                    {regSubmitting ? 'Verifying & Creating…' : '🚀 Verify & Register'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          FORGOT PASSWORD MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      {showForgotPassword && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '36px',
              width: '100%',
              maxWidth: '440px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: '#0f172a' }}>
                🔑 Reset Account Password
              </h3>
              <button
                type="button"
                onClick={closeForgotPassword}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: '13px', lineHeight: '1.5' }}>
              {fpStep === 1
                ? 'Enter your registered email address. We will send a secure 6-digit verification code.'
                : `Enter the 6-digit code sent to ${fpEmail} and choose a strong new password.`}
            </p>

            {fpError && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fca5a5',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#dc2626',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                ⚠️ {fpError}
              </div>
            )}

            {fpSuccess && (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#166534',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                ✅ {fpSuccess}
              </div>
            )}

            {fpStep === 1 ? (
              <form onSubmit={handleSendResetOtp}>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>Account Email</label>
                  <input
                    type="email"
                    className="form-control"
                    required
                    autoFocus
                    placeholder="name@example.com"
                    value={fpEmail}
                    onChange={(e) => setFpEmail(e.target.value)}
                    disabled={fpLoading}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeForgotPassword}
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={fpLoading || !fpEmail.trim()}
                    style={{ flex: 2, fontWeight: 700 }}
                  >
                    {fpLoading ? 'Sending Code…' : '✉️ Send Verification Code'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleResetPassword}>
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>6-Digit Verification Code (OTP)</label>
                  <input
                    type="text"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    className="form-control"
                    required
                    autoFocus
                    placeholder="123456"
                    value={fpOtp}
                    onChange={(e) => setFpOtp(e.target.value.replace(/\D/g, ''))}
                    disabled={fpLoading}
                    style={{ letterSpacing: '4px', fontSize: '18px', fontWeight: 700, textAlign: 'center' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>Valid for 10 minutes</span>
                    <button
                      type="button"
                      onClick={handleSendResetOtp}
                      disabled={fpCooldown > 0 || fpLoading}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: fpCooldown > 0 ? '#94a3b8' : '#2563eb',
                        fontSize: '12px',
                        cursor: fpCooldown > 0 ? 'default' : 'pointer',
                        padding: 0,
                        textDecoration: fpCooldown > 0 ? 'none' : 'underline',
                      }}
                    >
                      {fpCooldown > 0 ? `Resend in ${fpCooldown}s` : 'Resend Code'}
                    </button>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '16px', position: 'relative' }}>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>New Password</label>
                  <input
                    type={fpShowPassword ? 'text' : 'password'}
                    className="form-control"
                    required
                    placeholder="Min 8 chars, 1 uppercase, 1 digit"
                    value={fpNewPassword}
                    onChange={(e) => setFpNewPassword(e.target.value)}
                    disabled={fpLoading}
                    style={{ paddingRight: '40px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setFpShowPassword(!fpShowPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '34px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#64748b',
                    }}
                    tabIndex={-1}
                  >
                    {fpShowPassword ? '🙈' : '👁️'}
                  </button>
                </div>

                <div className="form-group" style={{ marginTop: '16px' }}>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px' }}>Confirm New Password</label>
                  <input
                    type={fpShowPassword ? 'text' : 'password'}
                    className="form-control"
                    required
                    placeholder="Repeat new password"
                    value={fpConfirmPassword}
                    onChange={(e) => setFpConfirmPassword(e.target.value)}
                    disabled={fpLoading}
                  />
                </div>

                <div
                  style={{
                    marginTop: '14px',
                    padding: '8px 10px',
                    background: '#f8fafc',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#64748b',
                    lineHeight: '1.4',
                  }}
                >
                  🔒 Must be at least 8 characters with at least one uppercase letter, one lowercase letter, and one number.
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setFpStep(1)}
                    style={{ flex: 1 }}
                  >
                    ← Back
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={fpLoading}
                    style={{ flex: 2, fontWeight: 700 }}
                  >
                    {fpLoading ? 'Resetting…' : '🔐 Set New Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
