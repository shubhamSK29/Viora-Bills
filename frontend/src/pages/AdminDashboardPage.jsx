import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { dashboardApi } from '../services/api'
import { money } from '../utils/formatters'
import StatusBadge from '../components/common/StatusBadge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import InvoiceDetailModal from '../components/invoices/InvoiceDetailModal'
import Alert from '../components/common/Alert'

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const outletContext = useOutletContext() || {}
  const companySettings = outletContext.companySettings || {}

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [viewingInvoice, setViewingInvoice] = useState(null)

  const fetchAdminData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await dashboardApi.getAdmin()
      setData(res)
    } catch (err) {
      setError(`Failed to load admin dashboard: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchAdminData()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchAdminData])

  if (loading) {
    return <LoadingSpinner message="Loading Executive Business Dashboard…" size="large" />
  }

  const stats = data?.stats || {}
  const analytics = data?.revenue_analytics || {}
  const monthlyRevenue = analytics.monthly_revenue || []
  const weeklyRevenue = analytics.weekly_revenue || []
  const paymentMethods = analytics.payment_methods || []
  const paidVsPending = analytics.paid_vs_pending || { paid_amount: 0, pending_amount: 0 }
  const topCustomers = data?.top_customers || analytics.top_customers || []
  const recentInvoices = data?.recent_activity?.recent_invoices || []
  const recentPayments = data?.recent_activity?.recent_payments || []

  const hasPendingVerification =
    (stats.pending_cheques_count || 0) > 0 || (stats.pending_upi_claims_count || 0) > 0

  const maxMonthRev = Math.max(...monthlyRevenue.map((m) => m.revenue || 0), 1)
  const maxWeekRev = Math.max(...weeklyRevenue.map((w) => w.revenue || 0), 1)

  const totalPaidPlusPending = (paidVsPending.paid_amount || 0) + (paidVsPending.pending_amount || 0)
  const collectionRate = totalPaidPlusPending > 0
    ? Math.round(((paidVsPending.paid_amount || 0) / totalPaidPlusPending) * 100)
    : 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
          borderRadius: '12px',
          padding: '24px 28px',
          color: '#ffffff',
          boxShadow: '0 4px 14px rgba(37,99,235,0.25)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span
              style={{
                background: 'rgba(255,255,255,0.2)',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
              }}
            >
              Enterprise Admin
            </span>
            <span style={{ fontSize: '13px', opacity: 0.85 }}>
              {companySettings.company_name || 'Viora Bills'}
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 800 }}>Executive Business Dashboard</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', opacity: 0.9 }}>
            Real-time business performance, revenue streams, and enterprise financial health.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={fetchAdminData}
            style={{ background: '#ffffff', color: '#1d4ed8', fontWeight: 600, border: 'none' }}
          >
            ↻ Refresh Metrics
          </button>
        </div>
      </div>

      {error && <Alert type="danger" message={error} />}

      {/* Financial Operational Alert for Pending Cheques/Claims */}
      {hasPendingVerification && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '10px',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 700, color: '#92400e' }}>
                Pending Financial Verification Queue
              </div>
              <div style={{ fontSize: '13px', color: '#78350f', marginTop: '2px' }}>
                {stats.pending_cheques_count || 0} cheques waiting for clearance &{' '}
                {stats.pending_upi_claims_count || 0} manual UPI verification claims awaiting approval.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => navigate('/payments')}
          >
            Review Payments Queue →
          </button>
        </div>
      )}

      {/* KPI 8-Grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div>
            <p className="metric-label">Total Revenue (Invoiced)</p>
            <h3 className="metric-value">{money(stats.total_revenue || 0)}</h3>
            <p className="metric-sub">{stats.total_invoices || 0} total invoices billed</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#eff6ff', color: '#2563eb' }}>
            💼
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Payments Received</p>
            <h3 className="metric-value" style={{ color: '#059669' }}>
              {money(stats.total_payments_received || 0)}
            </h3>
            <p className="metric-sub">Cleared funds in bank/cash</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
            💰
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Pending Receivables</p>
            <h3 className="metric-value" style={{ color: stats.pending_payments > 0 ? '#d97706' : '#64748b' }}>
              {money(stats.pending_payments || 0)}
            </h3>
            <p className="metric-sub">{collectionRate}% collection rate</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#fffbeb', color: '#d97706' }}>
            ⏳
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Overdue Invoices</p>
            <h3 className="metric-value" style={{ color: stats.overdue_invoices > 0 ? '#dc2626' : '#64748b' }}>
              {stats.overdue_invoices || 0}
            </h3>
            <p className="metric-sub">Past payment due date</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#fef2f2', color: '#dc2626' }}>
            ⚠️
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Active Customers</p>
            <h3 className="metric-value">{stats.total_customers || 0}</h3>
            <p className="metric-sub">Registered client entities</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#f3e8ff', color: '#9333ea' }}>
            👥
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Catalog Products</p>
            <h3 className="metric-value">{stats.total_products || 0}</h3>
            <p className="metric-sub">SKUs with GST rates</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#e0e7ff', color: '#4f46e5' }}>
            📦
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Staff Members</p>
            <h3 className="metric-value">{stats.total_staff || 0}</h3>
            <p className="metric-sub">Operational billing users</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            🧑‍💼
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Total Invoices</p>
            <h3 className="metric-value">{stats.total_invoices || 0}</h3>
            <p className="metric-sub">Tax invoices generated</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#f8fafc', color: '#0f172a' }}>
            📄
          </div>
        </div>
      </div>

      {/* Quick Actions Panel */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px', color: '#0f172a' }}>
          ⚡ Executive Quick Actions
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/invoices')}
            style={{ justifyContent: 'center', padding: '12px' }}
          >
            ➕ New Invoice
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/orders')}
            style={{ justifyContent: 'center', padding: '12px', background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
          >
            📋 Manage Orders
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/payments')}
            style={{ justifyContent: 'center', padding: '12px' }}
          >
            💳 Record Payment
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/customers')}
            style={{ justifyContent: 'center', padding: '12px' }}
          >
            👥 Add Customer
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/products')}
            style={{ justifyContent: 'center', padding: '12px' }}
          >
            📦 Add Product
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/reports')}
            style={{ justifyContent: 'center', padding: '12px', background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}
          >
            📊 Financial Reports
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/users')}
            style={{ justifyContent: 'center', padding: '12px', background: '#f5f3ff', color: '#5b21b6', borderColor: '#ddd6fe' }}
          >
            🔐 Manage Staff
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/settings')}
            style={{ justifyContent: 'center', padding: '12px', background: '#f8fafc', color: '#334155' }}
          >
            ⚙️ Company Settings
          </button>
        </div>
      </div>

      {/* Revenue Analytics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
        {/* Monthly Revenue Chart */}
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                📈 Monthly Revenue Trend
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                Billed revenue performance over recent months
              </p>
            </div>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb' }}>MongoDB Aggregated</span>
          </div>

          {monthlyRevenue.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
              No monthly sales recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', height: '180px', paddingTop: '20px' }}>
              {monthlyRevenue.map((item) => {
                const heightPct = Math.max(12, Math.round(((item.revenue || 0) / maxMonthRev) * 100))
                return (
                  <div
                    key={item.month}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px',
                      height: '100%',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#1e3a8a' }}>
                      {money(item.revenue || 0)}
                    </span>
                    <div
                      style={{
                        width: '100%',
                        maxWidth: '48px',
                        height: `${heightPct}%`,
                        background: 'linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)',
                        borderRadius: '6px 6px 0 0',
                        boxShadow: '0 2px 6px rgba(37,99,235,0.3)',
                        transition: 'height 0.3s ease',
                      }}
                      title={`${item.month}: ${money(item.revenue || 0)}`}
                    />
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                      {item.month}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Weekly Revenue & Efficiency */}
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                📊 Weekly Cashflow & Collection Rate
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                Paid vs outstanding receivables balance
              </p>
            </div>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: collectionRate >= 75 ? '#059669' : '#d97706',
                background: collectionRate >= 75 ? '#ecfdf5' : '#fffbeb',
                padding: '3px 8px',
                borderRadius: '4px',
              }}
            >
              {collectionRate}% Collected
            </span>
          </div>

          {/* Paid vs Pending Progress Bar */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
              <span style={{ color: '#059669', fontWeight: 600 }}>
                Paid: {money(paidVsPending.paid_amount || 0)} ({paidVsPending.paid_count || 0} bills)
              </span>
              <span style={{ color: '#dc2626', fontWeight: 600 }}>
                Pending: {money(paidVsPending.pending_amount || 0)} ({paidVsPending.pending_count || 0} bills)
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '14px',
                background: '#fee2e2',
                borderRadius: '8px',
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <div
                style={{
                  width: `${collectionRate}%`,
                  background: '#10b981',
                  transition: 'width 0.4s ease',
                }}
                title={`Collected: ${collectionRate}%`}
              />
            </div>
          </div>

          {/* Weekly Trend bars */}
          <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#475569', margin: '0 0 10px' }}>
            Weekly Invoicing (Last 4 Weeks)
          </h4>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '110px' }}>
            {weeklyRevenue.length === 0 ? (
              <div style={{ textAlign: 'center', width: '100%', color: '#94a3b8' }}>
                No weekly records yet.
              </div>
            ) : (
              weeklyRevenue.map((item) => {
                const heightPct = Math.max(12, Math.round(((item.revenue || 0) / maxWeekRev) * 100))
                return (
                  <div
                    key={item.week}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      height: '100%',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#334155' }}>
                      {money(item.revenue || 0)}
                    </span>
                    <div
                      style={{
                        width: '100%',
                        maxWidth: '36px',
                        height: `${heightPct}%`,
                        background: '#0284c7',
                        borderRadius: '4px 4px 0 0',
                      }}
                      title={`${item.week}: ${money(item.revenue || 0)}`}
                    />
                    <span style={{ fontSize: '11px', color: '#64748b' }}>{item.week}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Payment Methods Breakdown */}
      <div className="card" style={{ padding: '24px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
          💳 Payment Channels Distribution
        </h3>
        {paymentMethods.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>No payment method data recorded.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {paymentMethods.map((pm) => {
              const methodTotal = stats.total_payments_received || 1
              const pct = Math.round(((pm.total || 0) / (methodTotal || 1)) * 100)
              const iconMap = {
                UPI: '📱',
                Card: '💳',
                Cash: '💵',
                Cheque: '📑',
                'Bank Transfer': '🏦',
              }
              return (
                <div
                  key={pm.method}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '14px 16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>{iconMap[pm.method] || '💰'}</span>
                      {pm.method}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#2563eb' }}>{pct}%</span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                    {money(pm.total || 0)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    {pm.count || 0} transaction{pm.count !== 1 ? 's' : ''}
                  </div>
                  <div
                    style={{
                      marginTop: '8px',
                      height: '6px',
                      background: '#e2e8f0',
                      borderRadius: '3px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(5, pct))}%`,
                        background: '#3b82f6',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Top Customers by Purchase Volume */}
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              🏆 Top Clients by Purchase Volume
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
              Highest billing enterprise clients and revenue contribution
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/customers')}
          >
            Manage Clients →
          </button>
        </div>

        {topCustomers.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: '20px 0', textAlign: 'center' }}>No customer purchase data available yet.</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client Name</th>
                  <th>Total Invoices</th>
                  <th>Total Billed</th>
                  <th>Total Paid</th>
                  <th>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((cust) => {
                  const contribPct = stats.total_revenue > 0
                    ? Math.round((cust.total_purchases / stats.total_revenue) * 100)
                    : 0

                  return (
                    <tr key={cust.customer_id}>
                      <td style={{ fontWeight: 700, color: '#0f172a' }}>{cust.customer_name}</td>
                      <td>{cust.total_invoices} bills</td>
                      <td style={{ fontWeight: 600 }}>{money(cust.total_purchases)}</td>
                      <td style={{ color: '#059669', fontWeight: 600 }}>{money(cust.total_paid)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div
                            style={{
                              width: '80px',
                              height: '8px',
                              background: '#e2e8f0',
                              borderRadius: '4px',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, Math.max(8, contribPct))}%`,
                                height: '100%',
                                background: '#2563eb',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#2563eb' }}>
                            {contribPct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dual Activity Lists */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
        {/* Recent Invoices */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              📄 Recent Invoices
            </h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/invoices')}
            >
              View All →
            </button>
          </div>

          {recentInvoices.length === 0 ? (
            <p style={{ color: '#94a3b8', margin: '20px 0', textAlign: 'center' }}>No invoices found.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 600 }}>{inv.invoice_number || inv.id}</td>
                      <td>{inv.customer_name || 'N/A'}</td>
                      <td>{money(inv.total_amount)}</td>
                      <td style={{ color: inv.balance_due > 0 ? '#dc2626' : '#059669', fontWeight: 600 }}>
                        {money(inv.balance_due)}
                      </td>
                      <td>
                        <StatusBadge status={inv.status} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setViewingInvoice(inv)}
                          title="View Invoice Details"
                        >
                          👁️ View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Payments */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              💳 Recent Payments
            </h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/payments')}
            >
              View All →
            </button>
          </div>

          {recentPayments.length === 0 ? (
            <p style={{ color: '#94a3b8', margin: '20px 0', textAlign: 'center' }}>No payments found.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt #</th>
                    <th>Customer</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.receipt_number || p.id}</td>
                      <td>{p.customer_name || 'N/A'}</td>
                      <td>
                        <span style={{ fontSize: '12px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                          {p.payment_method}
                        </span>
                      </td>
                      <td style={{ color: '#059669', fontWeight: 600 }}>{money(p.amount)}</td>
                      <td style={{ fontSize: '12px', color: '#64748b' }}>{p.payment_date}</td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Invoice Detail Modal */}
      {viewingInvoice && (
        <InvoiceDetailModal
          invoice={viewingInvoice}
          companySettings={companySettings}
          onClose={() => setViewingInvoice(null)}
        />
      )}
    </div>
  )
}
