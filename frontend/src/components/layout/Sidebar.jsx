import { NavLink } from 'react-router-dom'

// Standardized 20x20 crisp enterprise SVG icons
const ICONS = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  ),
  orders: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </svg>
  ),
  customers: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  products: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  ),
  invoices: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  ),
  payments: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
      <line x1="6" x2="10" y1="15" y2="15" />
    </svg>
  ),
  reports: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  ),
  email: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  ),
  users: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 21a8 8 0 0 0-16 0" />
      <circle cx="10" cy="8" r="5" />
      <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  audit: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  catalogue: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
    </svg>
  ),
  cart: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  ),
  purchases: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  ),
  profile: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  ),
}

export default function Sidebar({
  companyName = 'Viora Bills',
  isOpen = false,
  onClose,
  userRole = 'staff',
  systemOnline = true,
  isCollapsed = false,
  onToggleCollapse,
}) {
  let navItems = []

  if (userRole === 'customer') {
    navItems = [
      { name: 'Dashboard', path: '/customer/dashboard', icon: ICONS.dashboard },
      { name: 'Product Catalogue', path: '/customer/catalogue', icon: ICONS.catalogue },
      { name: 'Shopping Cart', path: '/customer/cart', icon: ICONS.cart },
      { name: 'My Orders', path: '/customer/orders', icon: ICONS.orders },
      { name: 'My Purchases', path: '/customer/purchases', icon: ICONS.purchases },
      { name: 'My Invoices', path: '/customer/invoices', icon: ICONS.invoices },
      { name: 'Payment Receipts', path: '/customer/payments', icon: ICONS.payments },
      { name: 'My Profile', path: '/customer/profile', icon: ICONS.profile },
    ]
  } else if (userRole === 'staff') {
    navItems = [
      { name: 'Dashboard', path: '/staff/dashboard', icon: ICONS.dashboard },
      { name: 'Orders', path: '/orders', icon: ICONS.orders },
      { name: 'Invoices', path: '/invoices', icon: ICONS.invoices },
      { name: 'Payments', path: '/payments', icon: ICONS.payments },
      { name: 'Customers', path: '/customers', icon: ICONS.customers },
      { name: 'Products', path: '/products', icon: ICONS.products },
      { name: 'Reports', path: '/reports', icon: ICONS.reports },
    ]
  } else {
    // Admin role
    navItems = [
      { name: 'Executive Dashboard', path: '/admin/dashboard', icon: ICONS.dashboard },
      { name: 'Orders', path: '/orders', icon: ICONS.orders },
      { name: 'Customers', path: '/customers', icon: ICONS.customers },
      { name: 'Products', path: '/products', icon: ICONS.products },
      { name: 'Invoices', path: '/invoices', icon: ICONS.invoices },
      { name: 'Payments', path: '/payments', icon: ICONS.payments },
      { name: 'Reports', path: '/reports', icon: ICONS.reports },
      { name: 'Email Delivery', path: '/email-logs', icon: ICONS.email },
      { name: 'Staff & Users', path: '/users', icon: ICONS.users },
      { name: 'Settings', path: '/settings', icon: ICONS.settings },
      { name: 'Audit Logs', path: '/audit-logs', icon: ICONS.audit },
    ]
  }

  const roleSubtitle =
    userRole === 'customer'
      ? 'Client Portal'
      : userRole === 'staff'
      ? 'Staff Operations'
      : 'Enterprise Admin'

  return (
    <>
      {isOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onClose}
          aria-label="Close navigation overlay"
        />
      )}

      <aside
        className={`app-sidebar no-print ${isOpen ? 'open' : ''} ${
          isCollapsed ? 'collapsed' : ''
        }`}
        aria-label="Main Navigation"
      >
        <div className="sidebar-header">
          <div className="brand-wrapper" title={`${companyName} - ${roleSubtitle}`}>
            <div className="brand-logo-icon">VB</div>
            <div className="brand-text">
              <h1>{companyName}</h1>
              <p>{roleSubtitle}</p>
            </div>
          </div>

          {/* Mobile Close Drawer Button */}
          {onClose && (
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={onClose}
              title="Close navigation"
              aria-label="Close navigation"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) =>
                `nav-link-btn ${isActive ? 'active' : ''}`
              }
              onClick={() => {
                if (onClose) onClose()
              }}
              title={isCollapsed ? item.name : undefined}
            >
              <span className="nav-link-icon">{item.icon}</span>
              <span className="nav-link-text">{item.name}</span>
              <span className="nav-tooltip">{item.name}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center' }} title={systemOnline ? 'System status: Online' : 'System status: Offline'}>
            <span className={`status-dot ${systemOnline ? 'online' : 'offline'}`} />
            <span className="sidebar-footer-text">
              {systemOnline ? 'System Online' : 'Offline'}
            </span>
          </div>
          <span className="sidebar-footer-text" style={{ fontSize: '11px', color: '#64748b' }}>
            v1.4.0
          </span>
        </div>
      </aside>
    </>
  )
}
