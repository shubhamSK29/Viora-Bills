import { useState, useEffect, useCallback, useRef } from 'react'
import { notificationApi } from '../../services/api'
import Modal from '../common/Modal'

export default function Header({
  pageInfo,
  pageTitle = 'Dashboard',
  companyName = 'Viora Bills',
  currentUser,
  userRole = 'staff',
  isMobileNavOpen = false,
  onRefresh,
  onOpenChangePassword,
  onLogout,
  loading = false,
}) {
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [userMenuOpen])

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationApi.list({ limit: 15 })
      if (res) {
        setNotifications(res.items || [])
        setUnreadCount(res.unread_count || 0)
      }
    } catch {
      // Ignore background notification fetch errors
    }
  }, [])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchNotifications()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchNotifications])

  const handleMarkAllRead = async () => {
    try {
      await notificationApi.markAllRead()
      await fetchNotifications()
    } catch {
      // Ignore
    }
  }

  const handleMarkOneRead = async (id) => {
    try {
      await notificationApi.markRead(id)
      await fetchNotifications()
    } catch {
      // Ignore
    }
  }

  const getInitials = (user) => {
    const name = user?.full_name || user?.name || ''
    if (name) {
      const parts = name.trim().split(/\s+/)
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      return name.slice(0, 2).toUpperCase()
    }
    if (user?.email) return user.email.slice(0, 2).toUpperCase()
    return 'VB'
  }

  const getRoleMeta = (role) => {
    switch (role?.toLowerCase()) {
      case 'admin':
        return {
          text: '#4338ca',
          bg: '#eef2ff',
          label: 'Admin',
          avatarClass: 'avatar-admin',
        }
      case 'customer':
        return {
          text: '#7c3aed',
          bg: '#f5f3ff',
          label: 'Customer',
          avatarClass: 'avatar-customer',
        }
      case 'staff':
      default:
        return {
          text: '#059669',
          bg: '#ecfdf5',
          label: 'Staff',
          avatarClass: 'avatar-staff',
        }
    }
  }

  const roleMeta = getRoleMeta(userRole)
  const currentTitle = pageInfo?.title || pageTitle
  const currentSection = pageInfo?.section || 'Overview'

  return (
    <>
      <header className="top-header no-print">
        <div className="top-header-left">
          <div>
            <div className="header-breadcrumb">
              <span>{currentSection}</span>
              <span className="header-breadcrumb-separator">/</span>
              <span className="header-breadcrumb-current">{currentTitle}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 className="page-title">{currentTitle}</h2>
              <span className="header-live-pill">
                <span className="header-pulse-dot" />
                Live
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Quick Sync Button */}
          {onRefresh && (
            <button
              type="button"
              className="header-btn header-btn-quick"
              disabled={loading}
              onClick={onRefresh}
              title="Sync latest data with server"
              aria-label="Refresh data"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={loading ? 'spinning' : ''}
              >
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
              <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
            </button>
          )}

          {/* Notification Bell Button with Floating Badge */}
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => {
              setShowNotifications(true)
              fetchNotifications()
            }}
            title="In-App Notifications"
            aria-label="In-App Notifications"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-3px',
                  right: '-3px',
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  color: '#ffffff',
                  fontSize: '10px',
                  fontWeight: 800,
                  borderRadius: '10px',
                  padding: '1px 5px',
                  lineHeight: '12px',
                  boxShadow: '0 2px 6px rgba(239, 68, 68, 0.45)',
                  border: '2px solid #ffffff',
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* User Profile Card with Dropdown Menu */}
          <div className="header-user-dropdown-wrap" ref={menuRef}>
            <div
              className="header-user-card"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              title={`Account: ${currentUser?.email} (${userRole})`}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              aria-haspopup="true"
              aria-expanded={userMenuOpen}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setUserMenuOpen((prev) => !prev)
                }
              }}
            >
              <div className={`header-avatar ${roleMeta.avatarClass}`}>
                {getInitials(currentUser)}
              </div>
              <div className="header-user-info">
                <span className="header-user-name">
                  {currentUser?.full_name || currentUser?.name || currentUser?.email || 'User'}
                </span>
                <span className="header-role-tag" style={{ color: roleMeta.text }}>
                  {roleMeta.label}
                </span>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="header-chevron"
                style={{
                  color: '#64748b',
                  transition: 'transform 0.18s ease',
                  transform: userMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>

            {/* Dropdown Menu */}
            {userMenuOpen && (
              <div className="header-dropdown-menu" role="menu">
                <div className="header-dropdown-header">
                  <div className="header-dropdown-name">
                    {currentUser?.full_name || currentUser?.name || 'Viora User'}
                  </div>
                  <div className="header-dropdown-email">
                    {currentUser?.email || 'authenticated'}
                  </div>
                  <span
                    className="header-dropdown-role"
                    style={{ background: roleMeta.bg, color: roleMeta.text }}
                  >
                    {roleMeta.label} Account
                  </span>
                </div>

                {onOpenChangePassword && (
                  <button
                    type="button"
                    className="header-dropdown-item"
                    onClick={() => {
                      setUserMenuOpen(false)
                      onOpenChangePassword()
                    }}
                    role="menuitem"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="7.5" cy="15.5" r="5.5" />
                      <path d="m21 2-9.6 9.6" />
                      <path d="m15.5 7.5 3 3L22 7l-3-3" />
                    </svg>
                    <span>Change Password</span>
                  </button>
                )}

                {onRefresh && (
                  <button
                    type="button"
                    className="header-dropdown-item"
                    onClick={() => {
                      setUserMenuOpen(false)
                      onRefresh()
                    }}
                    role="menuitem"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                    </svg>
                    <span>Sync / Refresh Data</span>
                  </button>
                )}

                <div className="header-dropdown-divider" />

                {onLogout && (
                  <button
                    type="button"
                    className="header-dropdown-item danger"
                    onClick={() => {
                      setUserMenuOpen(false)
                      onLogout()
                    }}
                    role="menuitem"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    <span>Sign Out</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Notifications Drawer / Modal */}
      {showNotifications && (
        <Modal
          title={`Notifications (${unreadCount} unread)`}
          onClose={() => setShowNotifications(false)}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              maxHeight: '450px',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleMarkAllRead}
                >
                  ✓ Mark all as read
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>
                No notifications right now.
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    background: notif.is_read ? '#f8fafc' : '#eff6ff',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>
                      {notif.title}
                    </div>
                    {!notif.is_read && (
                      <button
                        type="button"
                        style={{
                          background: 'none',
                          border: 'none',
                          fontSize: '11px',
                          color: '#2563eb',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        onClick={() => handleMarkOneRead(notif.id)}
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569' }}>{notif.message}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    {notif.created_at ? notif.created_at.replace('T', ' ').slice(0, 16) : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
