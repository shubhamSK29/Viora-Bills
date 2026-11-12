import { useState, useEffect, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import Modal from '../components/common/Modal'
import Alert from '../components/common/Alert'
import {
  companySettingsApi,
  healthApi,
  authApi,
} from '../services/api'
import { defaultCompanySettings } from '../utils/constants'

export default function AppLayout() {
  const { currentUser, userRole, logout } = useAuth()
  const location = useLocation()

  const [companySettings, setCompanySettings] = useState(defaultCompanySettings)
  const [systemOnline, setSystemOnline] = useState(true)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [globalSuccess, setGlobalSuccess] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Prevent background scrolling while mobile drawer is open
  useEffect(() => {
    if (isMobileNavOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobileNavOpen])

  // Change password modal state
  const [changePasswordModal, setChangePasswordModal] = useState(false)
  const [changePasswordForm, setChangePasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [passwordSaving, setPasswordSaving] = useState(false)

  const fetchAppropriateSettings = useCallback(async () => {
    try {
      if (userRole === 'customer') {
        const publicRes = await companySettingsApi.getPublic().catch(() => null)
        return publicRes?.company ? { settings: publicRes.company } : null
      }
      const res = await companySettingsApi.get().catch(async () => {
        const publicRes = await companySettingsApi.getPublic().catch(() => null)
        return publicRes?.company ? { settings: publicRes.company } : null
      })
      return res
    } catch {
      return null
    }
  }, [userRole])

  const loadSettingsAndHealth = useCallback(async () => {
    try {
      const [settingsRes, healthRes] = await Promise.all([
        fetchAppropriateSettings(),
        healthApi.check().catch(() => null),
      ])
      if (settingsRes?.settings) {
        setCompanySettings(settingsRes.settings)
      }
      setSystemOnline(healthRes?.status === 'healthy')
    } catch {
      setSystemOnline(false)
    }
  }, [fetchAppropriateSettings])

  useEffect(() => {
    let ignore = false
    Promise.all([
      fetchAppropriateSettings(),
      healthApi.check().catch(() => null),
    ]).then(([settingsRes, healthRes]) => {
      if (ignore) return
      if (settingsRes?.settings) {
        setCompanySettings(settingsRes.settings)
      }
      setSystemOnline(healthRes?.status === 'healthy')
    })
    return () => {
      ignore = true
    }
  }, [fetchAppropriateSettings])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    setGlobalError('')
    setGlobalSuccess('')
    try {
      await loadSettingsAndHealth()
      setGlobalSuccess('Data refreshed successfully.')
    } catch (err) {
      setGlobalError(`Refresh failed: ${err.message}`)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setGlobalError('')
    setGlobalSuccess('')

    if (changePasswordForm.new_password !== changePasswordForm.confirm_password) {
      setGlobalError('New password and confirmation do not match.')
      return
    }
    if (changePasswordForm.new_password.length < 8) {
      setGlobalError('New password must be at least 8 characters long.')
      return
    }
    const hasUpper = /[A-Z]/.test(changePasswordForm.new_password)
    const hasLower = /[a-z]/.test(changePasswordForm.new_password)
    const hasDigit = /[0-9]/.test(changePasswordForm.new_password)
    if (!hasUpper || !hasLower || !hasDigit) {
      setGlobalError('New password must contain at least one uppercase letter, one lowercase letter, and one number.')
      return
    }

    setPasswordSaving(true)
    try {
      await authApi.changePassword(
        changePasswordForm.current_password,
        changePasswordForm.new_password
      )
      setGlobalSuccess('Your password has been changed successfully.')
      setChangePasswordModal(false)
      setChangePasswordForm({ current_password: '', new_password: '', confirm_password: '' })
    } catch (err) {
      setGlobalError(`Could not change password: ${err.message}`)
    } finally {
      setPasswordSaving(false)
    }
  }

  // Derive human-readable page title and section from current path
  const getPageInfo = (pathname) => {
    const routeMap = {
      '/': { title: 'Dashboard', section: 'Main' },
      '/dashboard': { title: 'Dashboard', section: 'Overview' },
      '/admin/dashboard': { title: 'Executive Dashboard', section: 'Administration' },
      '/staff/dashboard': { title: 'Staff Dashboard', section: 'Operations' },
      '/customer/dashboard': { title: 'Client Dashboard', section: 'Client Portal' },
      '/customer/catalogue': { title: 'Product Catalogue', section: 'Client Portal' },
      '/customer/cart': { title: 'Shopping Cart', section: 'Client Portal' },
      '/customer/checkout': { title: 'Order Checkout', section: 'Client Portal' },
      '/customer/orders': { title: 'My Orders', section: 'Client Portal' },
      '/customer/purchases': { title: 'My Purchases', section: 'Client Portal' },
      '/customer/invoices': { title: 'My Invoices', section: 'Client Portal' },
      '/customer/payments': { title: 'Payment Receipts', section: 'Client Portal' },
      '/customer/profile': { title: 'My Profile', section: 'Client Portal' },
      '/orders': { title: 'Sales Orders', section: 'Management' },
      '/customers': { title: 'Customers Directory', section: 'CRM' },
      '/products': { title: 'Products & Inventory', section: 'Catalog' },
      '/invoices': { title: 'Invoices & Billing', section: 'Finance' },
      '/payments': { title: 'Payments & Settlement', section: 'Finance' },
      '/reports': { title: 'Reports & Analytics', section: 'Analytics' },
      '/email-logs': { title: 'Email Delivery Logs', section: 'Communication' },
      '/users': { title: 'Staff & User Access', section: 'Security' },
      '/settings': { title: 'Company Settings', section: 'Configuration' },
      '/audit-logs': { title: 'System Audit Logs', section: 'Compliance' },
    }
    return routeMap[pathname] || { title: 'Viora Bills', section: 'Enterprise' }
  }

  const pageInfo = getPageInfo(location.pathname)

  return (
    <div className="app-container">
      <Sidebar
        companyName={companySettings.company_name}
        isOpen={isMobileNavOpen}
        onClose={() => setIsMobileNavOpen(false)}
        userRole={userRole}
        systemOnline={systemOnline}
      />

      <main className="app-main">
        <Header
          pageInfo={pageInfo}
          pageTitle={pageInfo.title}
          companyName={companySettings.company_name}
          currentUser={currentUser}
          userRole={userRole}
          isMobileNavOpen={isMobileNavOpen}
          onRefresh={handleRefresh}
          onOpenChangePassword={() => setChangePasswordModal(true)}
          onLogout={logout}
          loading={isRefreshing}
        />

        <div className="content-container">
          <Alert type="error" message={globalError} onDismiss={() => setGlobalError('')} />
          <Alert type="success" message={globalSuccess} onDismiss={() => setGlobalSuccess('')} />

          <Outlet
            context={{
              companySettings,
              setCompanySettings,
              userRole,
              currentUser,
              setError: setGlobalError,
              setSuccess: setGlobalSuccess,
            }}
          />
        </div>
      </main>

      {/* Change Password Modal */}
      <Modal
        isOpen={changePasswordModal}
        onClose={() => setChangePasswordModal(false)}
        title="Change Your Password"
        maxWidth="440px"
      >
        <form onSubmit={handleChangePassword}>
          <div className="modal-body" style={{ padding: '24px' }}>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">
                Current Password <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-control"
                type="password"
                required
                autoFocus
                placeholder="Enter current password"
                value={changePasswordForm.current_password}
                onChange={(e) =>
                  setChangePasswordForm({ ...changePasswordForm, current_password: e.target.value })
                }
              />
            </div>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">
                New Password <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-control"
                type="password"
                required
                minLength={8}
                placeholder="Min 8 chars, uppercase, lowercase, digit"
                value={changePasswordForm.new_password}
                onChange={(e) =>
                  setChangePasswordForm({ ...changePasswordForm, new_password: e.target.value })
                }
              />
              <small style={{ color: '#64748b', fontSize: '11px', marginTop: '2px', display: 'block' }}>
                Must be at least 8 characters with at least 1 uppercase letter, 1 lowercase letter, and 1 digit.
              </small>
            </div>
            <div className="form-group">
              <label className="form-label">
                Confirm New Password <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-control"
                type="password"
                required
                minLength={8}
                placeholder="Re-enter new password"
                value={changePasswordForm.confirm_password}
                onChange={(e) =>
                  setChangePasswordForm({ ...changePasswordForm, confirm_password: e.target.value })
                }
              />
            </div>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setChangePasswordModal(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={passwordSaving}>
              {passwordSaving ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
