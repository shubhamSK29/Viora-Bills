import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { dashboardApi } from '../services/api'
import { money } from '../utils/formatters'
import StatusBadge from '../components/common/StatusBadge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import InvoiceDetailModal from '../components/invoices/InvoiceDetailModal'
import Alert from '../components/common/Alert'

export default function StaffDashboardPage() {
  const navigate = useNavigate()
  const outletContext = useOutletContext() || {}
  const companySettings = outletContext.companySettings || {}
  const currentUser = outletContext.currentUser || {}

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [viewingInvoice, setViewingInvoice] = useState(null)

  const fetchStaffData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await dashboardApi.getStaff()
      setData(res)
    } catch (err) {
      setError(`Failed to load staff operational dashboard: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchStaffData()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchStaffData])

  if (loading) {
    return <LoadingSpinner message="Loading Staff Billing Dashboard…" size="large" />
  }

  const stats = data?.stats || {}
  const pendingFollowUps = data?.pending_follow_ups || []
  const recentInvoices = data?.recent_activity?.recent_invoices || []
  const recentPayments = data?.recent_activity?.recent_payments || []

  const hasPendingVerification =
    (stats.pending_cheques_count || 0) > 0 || (stats.pending_upi_claims_count || 0) > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #065f46 0%, #059669 100%)',
          borderRadius: '12px',
          padding: '24px 28px',
          color: '#ffffff',
          boxShadow: '0 4px 14px rgba(5,150,105,0.25)',
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
              Operations & Billing
            </span>
            <span style={{ fontSize: '13px', opacity: 0.9 }}>
              Logged in as {currentUser?.full_name || currentUser?.email || 'Staff Member'}
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 800 }}>Staff Operations Dashboard</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', opacity: 0.9 }}>
            Fast daily invoicing, customer management, payment collections and verification queue.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn"
            onClick={fetchStaffData}
            style={{ background: '#ffffff', color: '#065f46', fontWeight: 600, border: 'none' }}
          >
            ↻ Refresh Workdesk
          </button>
        </div>
      </div>

      {error && <Alert type="danger" message={error} />}

      {/* Operational Alerts for Pending Queues */}
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
            <span style={{ fontSize: '24px' }}>🔔</span>
            <div>
              <div style={{ fontWeight: 700, color: '#92400e' }}>
                Payments Awaiting Verification & Clearance
              </div>
              <div style={{ fontSize: '13px', color: '#78350f', marginTop: '2px' }}>
                You have {stats.pending_cheques_count || 0} pending cheques to clear and{' '}
                {stats.pending_upi_claims_count || 0} pending UPI verification requests.
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

      {/* Operational KPI Grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div>
            <p className="metric-label">Invoices Created By Me</p>
            <h3 className="metric-value">{stats.invoices_created_by_me_count || 0}</h3>
            <p className="metric-sub">{money(stats.invoices_created_by_me_amount || 0)} total billed</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
            📝
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Today's Invoices</p>
            <h3 className="metric-value" style={{ color: '#0284c7' }}>
              {stats.todays_invoices_count || 0}
            </h3>
            <p className="metric-sub">{money(stats.todays_invoices_amount || 0)} billed today</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#e0f2fe', color: '#0284c7' }}>
            📅
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Payments Recorded By Me</p>
            <h3 className="metric-value" style={{ color: '#059669' }}>
              {stats.payments_recorded_by_me_count || 0}
            </h3>
            <p className="metric-sub">{money(stats.payments_recorded_by_me_amount || 0)} collected</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            💵
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Today's Collections</p>
            <h3 className="metric-value" style={{ color: '#16a34a' }}>
              {stats.todays_collections_count || 0}
            </h3>
            <p className="metric-sub">{money(stats.todays_collections_amount || 0)} collected today</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#dcfce7', color: '#16a34a' }}>
            💰
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Total Outstanding Balance</p>
            <h3 className="metric-value" style={{ color: stats.pending_payments_amount > 0 ? '#d97706' : '#64748b' }}>
              {money(stats.pending_payments_amount || 0)}
            </h3>
            <p className="metric-sub">Pending customer payments</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#fffbeb', color: '#d97706' }}>
            ⏳
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Overdue Invoices</p>
            <h3 className="metric-value" style={{ color: stats.overdue_invoices_count > 0 ? '#dc2626' : '#64748b' }}>
              {stats.overdue_invoices_count || 0}
            </h3>
            <p className="metric-sub">Requires follow-up call</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#fef2f2', color: '#dc2626' }}>
            ⚠️
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Partially Paid Invoices</p>
            <h3 className="metric-value">{stats.partially_paid_invoices_count || 0}</h3>
            <p className="metric-sub">Partial installments active</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#eff6ff', color: '#2563eb' }}>
            📊
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Registered Customers</p>
            <h3 className="metric-value">{stats.total_customers_managed || 0}</h3>
            <p className="metric-sub">Clients ready for billing</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
            👥
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Products in Catalog</p>
            <h3 className="metric-value">{stats.total_products_count || 0}</h3>
            <p className="metric-sub">Items available to invoice</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#e0e7ff', color: '#4338ca' }}>
            📦
          </div>
        </div>

        <div className="metric-card">
          <div>
            <p className="metric-label">Pending Cheques</p>
            <h3 className="metric-value" style={{ color: stats.pending_cheques_count > 0 ? '#ea580c' : '#64748b' }}>
              {stats.pending_cheques_count || 0}
            </h3>
            <p className="metric-sub">Awaiting bank deposit</p>
          </div>
          <div className="metric-icon-wrap" style={{ background: '#fff7ed', color: '#ea580c' }}>
            📑
          </div>
        </div>
      </div>

      {/* Operational Quick Actions */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px', color: '#0f172a' }}>
          ⚡ Daily Operational Actions
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/invoices')}
            style={{ justifyContent: 'center', padding: '12px', background: '#059669', borderColor: '#059669' }}
          >
            ➕ Create New Invoice
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/orders')}
            style={{ justifyContent: 'center', padding: '12px', background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
          >
            📋 Customer Orders Queue
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/payments')}
            style={{ justifyContent: 'center', padding: '12px' }}
          >
            💳 Record Cash / Cheque
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/customers')}
            style={{ justifyContent: 'center', padding: '12px' }}
          >
            👥 Add New Customer
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/products')}
            style={{ justifyContent: 'center', padding: '12px' }}
          >
            📦 Browse Products & Rates
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/payments')}
            style={{ justifyContent: 'center', padding: '12px', background: '#fff7ed', color: '#c2410c', borderColor: '#fed7aa' }}
          >
            📑 Cheques & UPI Queue
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/reports')}
            style={{ justifyContent: 'center', padding: '12px', background: '#f8fafc', color: '#334155' }}
          >
            📊 View Sales Report
          </button>
        </div>
      </div>

      {/* Pending Payment Follow-ups Workbench */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              📞 Pending Payment Follow-ups
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
              Overdue & unpaid client accounts requiring telephone reminder or collection visit
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/invoices')}
          >
            All Invoices →
          </button>
        </div>

        {pendingFollowUps.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              background: '#f8fafc',
              borderRadius: '8px',
              border: '1px dashed #cbd5e1',
              color: '#64748b',
            }}
          >
            ✅ Excellent! No overdue or unpaid invoices pending follow-up.
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer Name</th>
                  <th>Phone / Contact</th>
                  <th>Due Date</th>
                  <th>Balance Due</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingFollowUps.map((inv) => (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 600 }}>{inv.invoice_number || inv.id}</td>
                    <td style={{ fontWeight: 600, color: '#1e293b' }}>{inv.customer_name}</td>
                    <td>
                      {inv.customer_phone ? (
                        <a
                          href={`tel:${inv.customer_phone}`}
                          style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}
                        >
                          📞 {inv.customer_phone}
                        </a>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>No phone</span>
                      )}
                    </td>
                    <td style={{ fontSize: '12px', color: '#64748b' }}>{inv.due_date || 'N/A'}</td>
                    <td style={{ color: '#dc2626', fontWeight: 700 }}>{money(inv.balance_due)}</td>
                    <td>
                      <StatusBadge status={inv.status} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => navigate('/payments')}
                          style={{ background: '#059669', borderColor: '#059669', fontSize: '12px', padding: '4px 8px' }}
                        >
                          💳 Collect
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setViewingInvoice(inv)}
                          style={{ fontSize: '12px', padding: '4px 8px' }}
                        >
                          👁️ View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Activity Sections */}
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
              All Invoices →
            </button>
          </div>

          {recentInvoices.length === 0 ? (
            <p style={{ color: '#94a3b8', margin: '20px 0', textAlign: 'center' }}>No invoices yet.</p>
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
              All Payments →
            </button>
          </div>

          {recentPayments.length === 0 ? (
            <p style={{ color: '#94a3b8', margin: '20px 0', textAlign: 'center' }}>No payments recorded yet.</p>
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
