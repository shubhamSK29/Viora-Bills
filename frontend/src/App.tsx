import { useState, type ReactNode } from 'react'

type PageId =
  | 'dashboard'
  | 'customers'
  | 'products'
  | 'invoices'
  | 'payments'
  | 'reports'
  | 'settings'

type IconName =
  | 'dashboard'
  | 'customers'
  | 'products'
  | 'invoices'
  | 'payments'
  | 'reports'
  | 'settings'
  | 'search'
  | 'bell'
  | 'plus'
  | 'arrowUp'
  | 'arrowDown'
  | 'chevronDown'
  | 'chevronRight'
  | 'calendar'
  | 'download'
  | 'filter'
  | 'menu'
  | 'close'
  | 'more'
  | 'wallet'
  | 'receipt'
  | 'card'
  | 'sparkles'
  | 'logout'
  | 'building'
  | 'users'
  | 'tax'
  | 'palette'
  | 'shield'
  | 'help'
  | 'eye'
  | 'edit'

const iconPaths: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  customers: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  products: (
    <>
      <path d="m21 8-9 5-9-5 9-5 9 5Z" />
      <path d="m3 8 9 5 9-5M3 12l9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  invoices: (
    <>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </>
  ),
  payments: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M2 10h20M6 15h2" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21h-4v-.08a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3v-4h.08a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3h4v.08a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.24.6.83 1 1.48 1H21v4h-.08c-.65 0-1.24.4-1.52 1Z" />
    </>
  ),
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrowUp: <path d="m18 15-6-6-6 6" />,
  arrowDown: <path d="m6 9 6 6 6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></>,
  filter: <path d="M4 5h16l-6 7v5l-4 2v-7z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  wallet: <><path d="M4 6h16v14H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h13v3" /><path d="M15 12h5v4h-5a2 2 0 0 1 0-4Z" /></>,
  receipt: <><path d="M5 3v18l3-2 4 2 4-2 3 2V3l-3 2-4-2-4 2z" /><path d="M9 10h6M9 14h4" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>,
  sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18 15l.7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7z" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3M15 4h5v16h-5" /></>,
  building: <><path d="M4 21V5l8-3 8 3v16M9 9h1M14 9h1M9 13h1M14 13h1M9 17h6" /></>,
  users: <><circle cx="9" cy="8" r="4" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 11a4 4 0 0 1 4 4v2" /></>,
  tax: <><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><path d="M19 5 5 19" /></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h3a6 6 0 0 0 0-12z" /><circle cx="7.5" cy="10" r=".5" fill="currentColor" /><circle cx="9" cy="6.5" r=".5" fill="currentColor" /></>,
  shield: <path d="M12 3 4 6v6c0 5 3.4 8 8 10 4.6-2 8-5 8-10V6z" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.5 2.5 0 1 1 3.6 2.25c-.8.4-1.3.8-1.3 1.75M12 17h.01" /></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  )
}

const navigation: { id: PageId; label: string; icon: IconName }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'customers', label: 'Customers', icon: 'customers' },
  { id: 'products', label: 'Products & Services', icon: 'products' },
  { id: 'invoices', label: 'Invoices', icon: 'invoices' },
  { id: 'payments', label: 'Payments', icon: 'payments' },
  { id: 'reports', label: 'Reports', icon: 'reports' },
]

const pageMeta: Record<PageId, { title: string; description: string }> = {
  dashboard: { title: 'Good morning, Sanchitha', description: 'Here’s what’s happening with your business today.' },
  customers: { title: 'Customers', description: 'Manage customer profiles, balances and billing history.' },
  products: { title: 'Product Management', description: 'Create, organize and manage the products you sell.' },
  invoices: { title: 'Invoices', description: 'Create, send and track every customer invoice.' },
  payments: { title: 'Payments', description: 'Monitor incoming payments and outstanding balances.' },
  reports: { title: 'Financial Reports', description: 'Understand your revenue, cash flow and business performance.' },
  settings: { title: 'Company Settings', description: 'Manage your business profile, preferences and team.' },
}

function Button({
  children,
  icon,
  variant = 'primary',
  onClick,
  className = '',
}: {
  children?: ReactNode
  icon?: IconName
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon'
  onClick?: () => void
  className?: string
}) {
  return (
    <button className={`button button--${variant} ${className}`} onClick={onClick}>
      {icon && <Icon name={icon} size={variant === 'icon' ? 19 : 17} />}
      {children}
    </button>
  )
}

function Badge({ status }: { status: string }) {
  const kind =
    status === 'Paid' || status === 'Active' || status === 'In stock'
      ? 'success'
      : status === 'Partially paid' || status === 'Low stock' || status === 'Pending'
        ? 'warning'
        : status === 'Unpaid' || status === 'Overdue' || status === 'Out of stock'
          ? 'danger'
          : 'neutral'
  return <span className={`badge badge--${kind}`}><span />{status}</span>
}

function Avatar({ initials, tone = 0 }: { initials: string; tone?: number }) {
  return <span className={`avatar avatar--${tone % 5}`}>{initials}</span>
}

function PageHeader({
  page,
  action,
  onAction,
}: {
  page: PageId
  action?: string
  onAction?: () => void
}) {
  const meta = pageMeta[page]
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{page === 'dashboard' ? 'MONDAY, MAY 26' : 'VIORA BILLS'}</div>
        <h1>{meta.title}</h1>
        <p>{meta.description}</p>
      </div>
      {action && <Button icon="plus" onClick={onAction}>{action}</Button>}
    </div>
  )
}

function StatCard({
  label,
  value,
  change,
  icon,
  tone,
  down,
}: {
  label: string
  value: string
  change: string
  icon: IconName
  tone: string
  down?: boolean
}) {
  return (
    <article className="stat-card">
      <div className={`stat-icon stat-icon--${tone}`}><Icon name={icon} size={20} /></div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className={`stat-change ${down ? 'stat-change--down' : ''}`}>
        <Icon name={down ? 'arrowDown' : 'arrowUp'} size={13} />
        <strong>{change}</strong>
        <span>vs last month</span>
      </div>
    </article>
  )
}

const recentInvoices = [
  { id: 'INV-2048', customer: 'Sanchitha', initials: 'SP', amount: '$4,250.00', date: 'May 26, 2025', status: 'Paid' },
  { id: 'INV-2047', customer: 'Shubham', initials: 'S', amount: '$1,800.00', date: 'May 24, 2025', status: 'Partially paid' },
  { id: 'INV-2046', customer: 'Shreyas', initials: 'S', amount: '$3,120.00', date: 'May 23, 2025', status: 'Unpaid' }
]

function RevenueChart() {
  return (
    <div className="chart-wrap">
      <div className="chart-y-labels"><span>$30k</span><span>$20k</span><span>$10k</span><span>$0</span></div>
      <svg className="chart" viewBox="0 0 700 230" preserveAspectRatio="none" aria-label="Revenue chart">
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--violet)" stopOpacity=".22" />
            <stop offset="100%" stopColor="var(--violet)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chart-grid" d="M0 15H700M0 78H700M0 142H700M0 205H700" />
        <path className="chart-area" d="M0 177 C50 166 65 174 105 150 S178 130 210 144 S285 115 315 122 S375 82 420 100 S486 72 525 82 S596 35 630 54 S670 26 700 18 V205 H0Z" />
        <path className="chart-line" d="M0 177 C50 166 65 174 105 150 S178 130 210 144 S285 115 315 122 S375 82 420 100 S486 72 525 82 S596 35 630 54 S670 26 700 18" />
        <circle cx="630" cy="54" r="5" className="chart-dot" />
      </svg>
      <div className="chart-x-labels"><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span></div>
    </div>
  )
}

function InvoiceTable({ compact = false }: { compact?: boolean }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Amount</th>
            <th>Issue date</th>
            <th>Status</th>
            {!compact && <th />}
          </tr>
        </thead>
        <tbody>
          {recentInvoices.map((invoice, index) => (
            <tr key={invoice.id}>
              <td><strong className="invoice-id">{invoice.id}</strong></td>
              <td><div className="customer-cell"><Avatar initials={invoice.initials} tone={index} /><span>{invoice.customer}</span></div></td>
              <td><strong>{invoice.amount}</strong></td>
              <td>{invoice.date}</td>
              <td><Badge status={invoice.status} /></td>
              {!compact && <td><Button variant="icon" icon="more" /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Dashboard({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  return (
    <>
      <PageHeader page="dashboard" action="Create invoice" onAction={() => onNavigate('invoices')} />
      <div className="stats-grid">
        <StatCard label="Total revenue" value="$0" change="12.5%" icon="wallet" tone="violet" />
        <StatCard label="Outstanding" value="$0" change="4.2%" icon="receipt" tone="orange" down />
        <StatCard label="Paid invoices" value="0" change="8.4%" icon="invoices" tone="green" />
        <StatCard label="Active customers" value="0" change="6.1%" icon="customers" tone="blue" />
      </div>

      <div className="dashboard-grid">
        <section className="panel revenue-panel">
          <div className="panel-header">
            <div>
              <h2>Revenue overview</h2>
              <p>Your revenue performance over the last 6 months.</p>
            </div>
            <Button variant="secondary" icon="calendar">Last 6 months <Icon name="chevronDown" size={14} /></Button>
          </div>
          <div className="revenue-summary">
            <div><span>Total revenue</span><strong>$0.00</strong></div>
            <div className="chart-growth"><Icon name="arrowUp" size={13} /> 12.5%</div>
          </div>
          <RevenueChart />
        </section>

        <section className="panel invoice-overview">
          <div className="panel-header">
            <div><h2>Invoice overview</h2><p>Current payment status.</p></div>
          </div>
          <div className="donut-wrap">
            <div className="donut"><div><strong>184</strong><span>Total</span></div></div>
          </div>
          <div className="donut-legend">
            <div><span className="legend-dot legend-dot--paid" /><span>Paid</span><strong>148</strong></div>
            <div><span className="legend-dot legend-dot--partial" /><span>Partially paid</span><strong>18</strong></div>
            <div><span className="legend-dot legend-dot--unpaid" /><span>Unpaid</span><strong>18</strong></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header table-heading">
          <div><h2>Recent invoices</h2><p>Latest invoices created across your workspace.</p></div>
          <Button variant="ghost" onClick={() => onNavigate('invoices')}>View all <Icon name="chevronRight" size={16} /></Button>
        </div>
        <InvoiceTable compact />
      </section>
    </>
  )
}

const customers = [
  ['Sanchitha', 'sanchitha@example.com', '12', '$16,840.00', 'Active'],
  ['Shubham', 'shubham@example.com', '8', '$11,420.00', 'Active'],
  ['Shreyas', 'shreyas@example.com', '6', '$8,960.00', 'Active'],
]

function Toolbar({ placeholder = 'Search...', filter = true }: { placeholder?: string; filter?: boolean }) {
  return (
    <div className="toolbar">
      <label className="search-field">
        <Icon name="search" size={17} />
        <input placeholder={placeholder} aria-label={placeholder} />
      </label>
      {filter && <Button variant="secondary" icon="filter">Filter</Button>}
      <Button variant="secondary" icon="download">Export</Button>
    </div>
  )
}

function CustomersPage() {
  return (
    <>
      <PageHeader page="customers" action="Add customer" />
      <section className="panel content-panel">
        <Toolbar placeholder="Search customers..." />
        <div className="table-scroll">
          <table>
            <thead><tr><th>Customer</th><th>Contact</th><th>Invoices</th><th>Total billed</th><th>Status</th><th /></tr></thead>
            <tbody>
              {customers.map((customer, index) => (
                <tr key={customer[0]}>
                  <td><div className="customer-cell"><Avatar initials={customer[0].split(' ').map((w) => w[0]).join('').slice(0, 2)} tone={index} /><strong>{customer[0]}</strong></div></td>
                  <td>{customer[1]}</td><td>{customer[2]}</td><td><strong>{customer[3]}</strong></td>
                  <td><Badge status={customer[4]} /></td><td><Button variant="icon" icon="more" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination />
      </section>
    </>
  )
}

type Product = {
  name: string
  code: string
  unit: string
  price: string
  gst: string
  category: string
  description: string
}

const products: Product[] = [
  { name: 'Premium Office Chair', code: 'PRD-1001', unit: 'Piece', price: '$420.00', gst: '18%', category: 'Furniture', description: 'Ergonomic office chair with adjustable lumbar support.' },
  { name: 'Wireless Keyboard', code: 'PRD-1002', unit: 'Piece', price: '$89.00', gst: '18%', category: 'Electronics', description: 'Compact wireless keyboard with multi-device pairing.' },
  { name: 'A4 Copy Paper', code: 'PRD-1003', unit: 'Ream', price: '$12.50', gst: '12%', category: 'Stationery', description: 'Premium white A4 copy paper, 500 sheets per ream.' },
  { name: 'Desk Organizer Set', code: 'PRD-1004', unit: 'Set', price: '$34.00', gst: '18%', category: 'Accessories', description: 'Five-piece desk organization set in matte navy.' },
  { name: 'USB-C Docking Station', code: 'PRD-1005', unit: 'Piece', price: '$149.00', gst: '18%', category: 'Electronics', description: 'Eight-port USB-C docking station for modern workspaces.' },
]

type ProductPanelMode = 'add' | 'view' | 'edit'

function ProductPanel({
  mode,
  product,
  onClose,
  onEdit,
}: {
  mode: ProductPanelMode
  product?: Product
  onClose: () => void
  onEdit: () => void
}) {
  const isView = mode === 'view'
  const title = mode === 'add' ? 'Add new product' : mode === 'edit' ? 'Edit product' : 'Product details'
  const subtitle = mode === 'add'
    ? 'Enter the basic information for your new product.'
    : isView
      ? 'Review product information and tax details.'
      : 'Update the selected product information.'

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="product-drawer" aria-label={title}>
        <div className="product-drawer__header">
          <div>
            <span className="drawer-eyebrow">{mode === 'add' ? 'NEW PRODUCT' : product?.code}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <Button variant="icon" icon="close" onClick={onClose} />
        </div>

        {isView ? (
          <div className="product-view">
            <div className="product-view__hero">
              <span className="product-view__icon"><Icon name="products" size={24} /></span>
              <div><h3>{product?.name}</h3><p>{product?.category}</p></div>
            </div>
            <div className="product-view__price"><span>Unit price</span><strong>{product?.price}</strong></div>
            <div className="detail-list">
              <div><span>Product code</span><strong>{product?.code}</strong></div>
              <div><span>Unit</span><strong>{product?.unit}</strong></div>
              <div><span>GST rate</span><strong>{product?.gst}</strong></div>
              <div><span>Status</span><Badge status="Active" /></div>
            </div>
            <div className="product-description"><span>Description</span><p>{product?.description}</p></div>
          </div>
        ) : (
          <div className="product-form">
            <label><span>Product name</span><input defaultValue={product?.name ?? ''} placeholder="Enter product name" /></label>
            <div className="product-form__row">
              <label><span>Product code</span><input defaultValue={product?.code ?? ''} placeholder="e.g. PRD-1006" /></label>
              <label><span>Unit</span><select defaultValue={product?.unit ?? 'Piece'}><option>Piece</option><option>Set</option><option>Ream</option><option>Box</option><option>Kg</option></select></label>
            </div>
            <div className="product-form__row">
              <label><span>Price</span><input defaultValue={product?.price.replace('$', '') ?? ''} placeholder="0.00" /></label>
              <label><span>GST rate</span><select defaultValue={product?.gst ?? '18%'}><option>0%</option><option>5%</option><option>12%</option><option>18%</option><option>28%</option></select></label>
            </div>
            <label><span>Category</span><select defaultValue={product?.category ?? 'Electronics'}><option>Electronics</option><option>Furniture</option><option>Stationery</option><option>Accessories</option></select></label>
            <label><span>Description</span><textarea defaultValue={product?.description ?? ''} placeholder="Add a short product description" rows={4} /></label>
          </div>
        )}

        <div className="product-drawer__footer">
          <Button variant="secondary" onClick={onClose}>{isView ? 'Close' : 'Cancel'}</Button>
          {isView ? <Button icon="edit" onClick={onEdit}>Edit product</Button> : <Button onClick={onClose}>{mode === 'add' ? 'Add product' : 'Save changes'}</Button>}
        </div>
      </aside>
    </>
  )
}

function ProductsPage() {
  const [panel, setPanel] = useState<{ mode: ProductPanelMode; product?: Product } | null>(null)

  return (
    <>
      <PageHeader page="products" action="Add Product" onAction={() => setPanel({ mode: 'add' })} />
      <section className="product-overview">
        <div className="product-overview__intro">
          <span className="product-overview__icon"><Icon name="products" size={23} /></span>
          <div><h2>Product overview</h2><p>A quick summary of your current product catalogue.</p></div>
        </div>
        <div className="product-overview__metrics">
          <div><span>Total products</span><strong>48</strong><small><Icon name="arrowUp" size={12} /> 6 added this month</small></div>
          <div><span>Active products</span><strong>45</strong><small>93.7% of catalogue</small></div>
          <div><span>Average price</span><strong>$140.90</strong><small>Across all products</small></div>
        </div>
      </section>
      <div className="section-heading">
        <div><h2>Product list</h2><p>View and manage all products in your catalogue.</p></div>
        <span>48 products</span>
      </div>
      <section className="panel content-panel">
        <Toolbar placeholder="Search by product name or code..." />
        <div className="table-scroll">
          <table>
            <thead><tr><th>Product Name</th><th>Product Code</th><th>Unit</th><th>Price</th><th>GST Rate</th><th>Actions</th></tr></thead>
            <tbody>{products.map((item, index) => (
              <tr key={item.code}>
                <td><div className="customer-cell"><span className={`product-icon product-icon--${index % 3}`}><Icon name="products" size={17} /></span><div className="product-name"><strong>{item.name}</strong><span>{item.category}</span></div></div></td>
                <td><span className="product-code">{item.code}</span></td>
                <td>{item.unit}</td>
                <td><strong>{item.price}</strong></td>
                <td><span className="gst-rate">{item.gst}</span></td>
                <td><div className="table-actions"><Button variant="ghost" icon="eye" onClick={() => setPanel({ mode: 'view', product: item })}>View</Button><Button variant="ghost" icon="edit" onClick={() => setPanel({ mode: 'edit', product: item })}>Edit</Button></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <Pagination />
      </section>
      {panel && (
        <ProductPanel
          mode={panel.mode}
          product={panel.product}
          onClose={() => setPanel(null)}
          onEdit={() => setPanel({ mode: 'edit', product: panel.product })}
        />
      )}
    </>
  )
}

function InvoicesPage() {
  return (
    <>
      <PageHeader page="invoices" action="Create invoice" />
      <div className="tab-row">
        <button className="tab tab--active">All invoices <span>184</span></button>
        <button className="tab">Draft <span>7</span></button>
        <button className="tab">Outstanding <span>36</span></button>
        <button className="tab">Overdue <span>8</span></button>
      </div>
      <section className="panel content-panel">
        <Toolbar placeholder="Search by invoice or customer..." />
        <InvoiceTable />
        <Pagination />
      </section>
    </>
  )
}

const payments = [
  ['PAY-8024', 'Sanchitha', 'INV-2048', 'May 26, 2025', 'Bank transfer', '$4,250.00', 'Paid'],
  ['PAY-8023', 'Shubham', 'INV-2045', 'May 22, 2025', 'Credit card', '$960.00', 'Paid'],
  ['PAY-8022', 'Shreyas', 'INV-2047', 'May 21, 2025', 'Bank transfer', '$900.00', 'Partially paid'],
]

function PaymentsPage() {
  return (
    <>
      <PageHeader page="payments" action="Record payment" />
      <div className="stats-grid stats-grid--three">
        <StatCard label="Collected this month" value="$32,480" change="14.2%" icon="wallet" tone="green" />
        <StatCard label="Pending payments" value="$6,240" change="2.8%" icon="card" tone="orange" down />
        <StatCard label="Average payment time" value="4.2 days" change="8.1%" icon="calendar" tone="blue" />
      </div>
      <section className="panel content-panel">
        <Toolbar placeholder="Search payments..." />
        <div className="table-scroll"><table>
          <thead><tr><th>Payment</th><th>Customer</th><th>Invoice</th><th>Date</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>{payments.map((payment) => <tr key={payment[0]}>{payment.map((cell, i) => <td key={i}>{i === 6 ? <Badge status={cell} /> : i === 0 || i === 5 ? <strong>{cell}</strong> : cell}</td>)}</tr>)}</tbody>
        </table></div>
        <Pagination />
      </section>
    </>
  )
}

function ReportsPage() {
  return (
    <>
      <PageHeader page="reports" />
      <div className="report-actions">
        <div className="segmented"><button className="active">This year</button><button>Last year</button><button>Custom</button></div>
        <Button variant="secondary" icon="download">Export report</Button>
      </div>
      <div className="stats-grid">
        <StatCard label="Gross revenue" value="$146,840" change="18.4%" icon="wallet" tone="violet" />
        <StatCard label="Net income" value="$98,420" change="12.6%" icon="reports" tone="green" />
        <StatCard label="Total expenses" value="$48,420" change="3.2%" icon="card" tone="orange" />
        <StatCard label="Profit margin" value="67.0%" change="4.8%" icon="sparkles" tone="blue" />
      </div>
      <div className="reports-grid">
        <section className="panel revenue-panel">
          <div className="panel-header"><div><h2>Income performance</h2><p>Gross revenue compared with net income.</p></div><div className="report-legend"><span><i className="violet" />Revenue</span><span><i className="green" />Net income</span></div></div>
          <RevenueChart />
        </section>
        <section className="panel report-list">
          <div className="panel-header"><div><h2>Saved reports</h2><p>Quick access to key statements.</p></div></div>
          {['Profit & loss', 'Tax summary', 'Accounts receivable', 'Customer revenue'].map((report, index) => (
            <button key={report} className="report-row"><span className={`report-row__icon report-row__icon--${index}`}><Icon name={index === 1 ? 'tax' : 'reports'} size={18} /></span><span><strong>{report}</strong><small>Updated May {26 - index}, 2025</small></span><Icon name="chevronRight" size={17} /></button>
          ))}
        </section>
      </div>
    </>
  )
}

const settingsLinks: { icon: IconName; title: string; description: string }[] = [
  { icon: 'building', title: 'Company profile', description: 'Business details, logo and contact information' },
  { icon: 'invoices', title: 'Invoice preferences', description: 'Numbering, defaults, reminders and payment terms' },
  { icon: 'tax', title: 'Tax settings', description: 'Tax rates, registration and regional preferences' },
  { icon: 'users', title: 'Team members', description: 'Manage roles and workspace access' },
  { icon: 'palette', title: 'Branding', description: 'Colors, logo and invoice appearance' },
  { icon: 'shield', title: 'Security', description: 'Password, sessions and two-factor authentication' },
]

function SettingsPage() {
  return (
    <>
      <PageHeader page="settings" />
      <div className="settings-layout">
        <aside className="settings-nav">
          <div className="settings-nav__title">Workspace</div>
          {settingsLinks.map((item, index) => <button className={index === 0 ? 'active' : ''} key={item.title}><Icon name={item.icon} size={17} />{item.title}</button>)}
          <div className="settings-nav__title">Support</div>
          <button><Icon name="help" size={17} />Help center</button>
        </aside>
        <section className="panel settings-card">
          <div className="settings-card__header"><h2>Company profile</h2><p>Keep your business details accurate across invoices and reports.</p></div>
          <div className="logo-uploader">
            <div className="company-logo">VB</div>
            <div><strong>Company logo</strong><p>PNG, JPG or SVG. Maximum 2MB.</p><Button variant="secondary">Change logo</Button></div>
          </div>
          <div className="form-grid">
            <label><span>Company name</span><input defaultValue="Viora Creative Inc." /></label>
            <label><span>Business email</span><input defaultValue="billing@viora.co" /></label>
            <label><span>Phone number</span><input defaultValue="+1 (415) 555-0142" /></label>
            <label><span>Website</span><input defaultValue="www.viora.co" /></label>
            <label className="full"><span>Business address</span><input defaultValue="455 Market Street, San Francisco, CA 94105" /></label>
          </div>
          <div className="form-actions"><Button variant="secondary">Cancel</Button><Button>Save changes</Button></div>
        </section>
      </div>
    </>
  )
}

function Pagination() {
  return (
    <div className="pagination">
      <span>Showing 1–5 of 24 results</span>
      <div><Button variant="secondary">Previous</Button><Button variant="secondary">Next</Button></div>
    </div>
  )
}

function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notice, setNotice] = useState(false)

  const navigate = (page: PageId) => {
    setActivePage(page)
    setSidebarOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDemoAction = () => {
    setNotice(true)
    window.setTimeout(() => setNotice(false), 2400)
  }

  return (
    <div className="app-shell">
      <div className={`mobile-overlay ${sidebarOpen ? 'mobile-overlay--visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><span>V</span></span>
          <span>Viora <strong>Bills</strong></span>
          <Button variant="icon" icon="close" className="sidebar-close" onClick={() => setSidebarOpen(false)} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navigation.map((item) => (
            <button key={item.id} className={`nav-item ${activePage === item.id ? 'nav-item--active' : ''}`} onClick={() => navigate(item.id)}>
              <Icon name={item.icon} size={19} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="nav-spacer" />
        <div className="nav-label">ACCOUNT</div>
        <nav>
          <button className={`nav-item ${activePage === 'settings' ? 'nav-item--active' : ''}`} onClick={() => navigate('settings')}><Icon name="settings" size={19} /><span>Settings</span></button>
          <button className="nav-item" onClick={handleDemoAction}><Icon name="help" size={19} /><span>Help & support</span></button>
        </nav>
        <div className="upgrade-card">
          <span className="upgrade-icon"><Icon name="sparkles" size={18} /></span>
          <strong>Unlock more with Pro</strong>
          <p>Advanced reports and unlimited invoices.</p>
          <button onClick={handleDemoAction}>View plans <Icon name="chevronRight" size={14} /></button>
        </div>
        <div className="sidebar-profile">
          <Avatar initials="SP" tone={3} />
          <div><strong>Sanchitha</strong><span>sanchitha@example.com</span></div>
          <Icon name="more" size={18} />
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <Button variant="icon" icon="menu" className="mobile-menu" onClick={() => setSidebarOpen(true)} />
          <label className="global-search">
            <Icon name="search" size={18} />
            <input placeholder="Search anything..." aria-label="Search anything" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar-actions">
            <Button variant="icon" icon="bell" className="notification-button" onClick={handleDemoAction} />
            <div className="topbar-divider" />
            <button className="profile-button" onClick={() => setProfileOpen(!profileOpen)}>
              <Avatar initials="SP" tone={3} />
              <span><strong>Sanchitha Poojari</strong><small>Administrator</small></span>
              <Icon name="chevronDown" size={15} />
            </button>
            {profileOpen && (
              <div className="profile-menu">
                <button onClick={() => navigate('settings')}><Icon name="settings" size={16} />Account settings</button>
                <button onClick={handleDemoAction}><Icon name="logout" size={16} />Sign out</button>
              </div>
            )}
          </div>
        </header>

        <main className="main-content">
          {activePage === 'dashboard' && <Dashboard onNavigate={navigate} />}
          {activePage === 'customers' && <CustomersPage />}
          {activePage === 'products' && <ProductsPage />}
          {activePage === 'invoices' && <InvoicesPage />}
          {activePage === 'payments' && <PaymentsPage />}
          {activePage === 'reports' && <ReportsPage />}
          {activePage === 'settings' && <SettingsPage />}
        </main>
      </div>
      {notice && <div className="toast"><span><Icon name="sparkles" size={17} /></span>This action will be available in the next release.</div>}
    </div>
  )
}

export default App
