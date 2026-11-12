import { useState, useEffect, useCallback } from 'react'
import { auditLogApi } from '../services/api'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Pagination from '../components/common/Pagination'
import Alert from '../components/common/Alert'
import Modal from '../components/common/Modal'

export default function AuditLogsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalLogs, setTotalLogs] = useState(0)

  // Filters state
  const [moduleFilter, setModuleFilter] = useState('ALL')
  const [actionFilter, setActionFilter] = useState('ALL')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Detailed modal inspection state
  const [selectedLog, setSelectedLog] = useState(null)
  const [copiedDetails, setCopiedDetails] = useState(false)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = {
        page,
        limit: 20,
      }
      if (moduleFilter !== 'ALL') params.module = moduleFilter
      if (actionFilter !== 'ALL') params.action = actionFilter
      if (roleFilter !== 'ALL') params.role = roleFilter
      if (statusFilter !== 'ALL') params.status = statusFilter
      if (fromDate) params.from_date = fromDate
      if (toDate) params.to_date = toDate
      if (searchQuery.trim()) params.search = searchQuery.trim()

      const res = await auditLogApi.list(params)
      setLogs(res.items || [])
      setTotalPages(res.total_pages || 1)
      setTotalLogs(res.total || 0)
    } catch (err) {
      if (err.status === 403 || err.message?.includes('403') || err.message?.includes('forbidden')) {
        setError('Access Denied: You must be signed in with Administrator privileges to inspect governance and audit logs.')
      } else {
        setError(`Failed to retrieve audit trail: ${err.message}`)
      }
    } finally {
      setLoading(false)
    }
  }, [page, moduleFilter, actionFilter, roleFilter, statusFilter, fromDate, toDate, searchQuery])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchLogs()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchLogs])

  function handleResetFilters() {
    setModuleFilter('ALL')
    setActionFilter('ALL')
    setRoleFilter('ALL')
    setStatusFilter('ALL')
    setFromDate('')
    setToDate('')
    setSearchQuery('')
    setPage(1)
  }

  function handleCopyJson(data) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      setCopiedDetails(true)
      setTimeout(() => setCopiedDetails(false), 2000)
    }
  }

  function formatTimestamp(ts) {
    if (!ts) return '—'
    try {
      const d = new Date(ts)
      if (isNaN(d.getTime())) return String(ts).replace('T', ' ').slice(0, 19)
      return d.toLocaleString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    } catch {
      return String(ts)
    }
  }

  const moduleColors = {
    Auth: { bg: '#ede9fe', text: '#5b21b6' },
    Customers: { bg: '#e0f2fe', text: '#0369a1' },
    Products: { bg: '#fef3c7', text: '#92400e' },
    Orders: { bg: '#e0e7ff', text: '#3730a3' },
    Invoices: { bg: '#dcfce7', text: '#15803d' },
    Payments: { bg: '#d1fae5', text: '#065f46' },
    Settings: { bg: '#ffedd5', text: '#9a3412' },
    Users: { bg: '#fce7f3', text: '#9d174d' },
    General: { bg: '#f1f5f9', text: '#334155' },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🛡️</span> Financial & Governance Audit Trail
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            Immutable, tamper-evident log of logins, user activity, tax invoices, payment settlements, catalog edits, and company settings.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={fetchLogs}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && <Alert type="danger" message={error} onClose={() => setError('')} />}

      {/* Filter and Search Controls */}
      <div className="card" style={{ padding: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '14px' }}>
          {/* Search Box */}
          <div style={{ gridColumn: 'span 2' }}>
            <label className="form-label" style={{ fontSize: '12px' }}>Search Logs</label>
            <input
              type="text"
              placeholder="Search user name, email, description, or reference ID…"
              className="form-control"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setPage(1)
              }}
            />
          </div>

          {/* Module Filter */}
          <div>
            <label className="form-label" style={{ fontSize: '12px' }}>Module</label>
            <select
              className="form-control"
              value={moduleFilter}
              onChange={(e) => {
                setModuleFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="ALL">All Modules</option>
              <option value="Auth">Auth & Security</option>
              <option value="Customers">Customers</option>
              <option value="Products">Products & Inventory</option>
              <option value="Orders">Orders</option>
              <option value="Invoices">Invoices & Bills</option>
              <option value="Payments">Payments & Receipts</option>
              <option value="Settings">Company Settings</option>
              <option value="Users">User Management</option>
            </select>
          </div>

          {/* Action Filter */}
          <div>
            <label className="form-label" style={{ fontSize: '12px' }}>Action</label>
            <select
              className="form-control"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="ALL">All Actions</option>
              <option value="LOGIN_SUCCESS">Login Success</option>
              <option value="LOGIN_FAILED">Login Failed</option>
              <option value="LOGOUT">Logout</option>
              <option value="CHANGE_PASSWORD">Change Password</option>
              <option value="CREATE_INVOICE">Create Invoice</option>
              <option value="DOWNLOAD_INVOICE_PDF">Download Invoice PDF</option>
              <option value="INVOICE_STATUS_CHANGED">Invoice Status Changed</option>
              <option value="RECORD_PAYMENT">Record Payment</option>
              <option value="UPDATE_PAYMENT_STATUS">Update Payment Status</option>
              <option value="SUBMIT_UPI_PAYMENT">Submit UPI Payment</option>
              <option value="SUBMIT_CARD_PAYMENT">Submit Card Payment</option>
              <option value="CREATE_CUSTOMER">Create Customer</option>
              <option value="UPDATE_CUSTOMER">Update Customer</option>
              <option value="DELETE_CUSTOMER">Delete Customer</option>
              <option value="CREATE_PRODUCT">Create Product</option>
              <option value="UPDATE_PRODUCT">Update Product</option>
              <option value="DELETE_PRODUCT">Delete Product</option>
              <option value="UPDATE_COMPANY_SETTINGS">Update Company Settings</option>
              <option value="CREATE_USER">Create User</option>
              <option value="UPDATE_USER">Update User</option>
              <option value="DELETE_USER">Delete User</option>
              <option value="RESET_USER_PASSWORD">Reset User Password</option>
            </select>
          </div>

          {/* Role Filter */}
          <div>
            <label className="form-label" style={{ fontSize: '12px' }}>Role</label>
            <select
              className="form-control"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="ALL">All Roles</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
              <option value="customer">Customer</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="form-label" style={{ fontSize: '12px' }}>Status</label>
            <select
              className="form-control"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>

          {/* Date Range: From Date */}
          <div>
            <label className="form-label" style={{ fontSize: '12px' }}>From Date</label>
            <input
              type="date"
              className="form-control"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value)
                setPage(1)
              }}
            />
          </div>

          {/* Date Range: To Date */}
          <div>
            <label className="form-label" style={{ fontSize: '12px' }}>To Date</label>
            <input
              type="date"
              className="form-control"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: '13px', color: '#64748b' }}>
            Showing <strong>{logs.length}</strong> of <strong>{totalLogs}</strong> audit records
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleResetFilters}
          >
            Clear / Reset Filters
          </button>
        </div>
      </div>

      {/* Logs Table Card */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '50px 20px' }}>
            <LoadingSpinner message="Querying audit records from secure store…" />
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>📋</div>
            <h4 style={{ margin: '0 0 6px', color: '#0f172a' }}>No audit records found</h4>
            <p style={{ margin: 0, fontSize: '13px' }}>
              No audit logs matched your specified filters. Try adjusting dates or resetting filters.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table" style={{ fontSize: '13px' }}>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User / Actor</th>
                  <th>Module</th>
                  <th>Action</th>
                  <th>Description</th>
                  <th>IP Address</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const role = (log.user_role || log.actor_role || 'system').toLowerCase()
                  const roleBadgeBg =
                    role === 'admin' ? '#eff6ff' : role === 'staff' ? '#ecfdf5' : '#fdf2f8'
                  const roleBadgeColor =
                    role === 'admin' ? '#1e40af' : role === 'staff' ? '#065f46' : '#9d174d'

                  const modName = log.module || 'General'
                  const modColor = moduleColors[modName] || moduleColors.General

                  const isSuccess = (log.status || 'SUCCESS').toUpperCase() === 'SUCCESS'

                  return (
                    <tr key={log.id}>
                      <td style={{ fontSize: '12px', color: '#475569', whiteSpace: 'nowrap' }}>
                        {formatTimestamp(log.created_at)}
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>
                          {log.user_name || log.actor_email || 'System'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {log.user_email || log.actor_email || '—'}
                        </div>
                        <span
                          style={{
                            fontSize: '10px',
                            background: roleBadgeBg,
                            color: roleBadgeColor,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            textTransform: 'uppercase',
                            fontWeight: 700,
                            display: 'inline-block',
                            marginTop: '2px',
                          }}
                        >
                          {role}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            background: modColor.bg,
                            color: modColor.text,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            display: 'inline-block',
                          }}
                        >
                          {modName}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            background: '#f1f5f9',
                            color: '#1e293b',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontFamily: 'monospace',
                            display: 'inline-block',
                          }}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td style={{ maxWidth: '280px', fontSize: '12px', color: '#334155' }}>
                        {log.description || '—'}
                      </td>
                      <td style={{ fontSize: '11px', fontFamily: 'monospace', color: '#64748b' }}>
                        {log.ip_address || '127.0.0.1'}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: isSuccess ? '#dcfce7' : '#fee2e2',
                            color: isSuccess ? '#166534' : '#991b1b',
                            display: 'inline-block',
                          }}
                        >
                          {isSuccess ? '✓ SUCCESS' : '✕ FAILED'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedLog(log)}
                          title="Inspect Audit Document"
                        >
                          🔍 View
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: '16px 20px', borderTop: '1px solid #e2e8f0' }}>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalLogs}
            pageSize={20}
            onPageChange={setPage}
          />
        </div>
      </div>

      {/* Audit Log Detail Modal */}
      {selectedLog && (
        <Modal title="Audit Record Inspector" onClose={() => setSelectedLog(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
                background: '#f8fafc',
                padding: '16px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                fontSize: '13px',
              }}
            >
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Event ID
                </span>
                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                  {selectedLog.id}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Timestamp
                </span>
                <div style={{ color: '#0f172a', fontWeight: 600 }}>
                  {formatTimestamp(selectedLog.created_at)}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Actor / User
                </span>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>
                  {selectedLog.user_name || selectedLog.actor_email} ({selectedLog.user_role || selectedLog.actor_role})
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Client IP
                </span>
                <div style={{ fontFamily: 'monospace', color: '#0f172a' }}>
                  {selectedLog.ip_address || '127.0.0.1'}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Module & Action
                </span>
                <div>
                  <strong>{selectedLog.module || 'General'}</strong> → <span style={{ fontFamily: 'monospace' }}>{selectedLog.action}</span>
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Execution Status
                </span>
                <div>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: (selectedLog.status || 'SUCCESS').toUpperCase() === 'SUCCESS' ? '#dcfce7' : '#fee2e2',
                      color: (selectedLog.status || 'SUCCESS').toUpperCase() === 'SUCCESS' ? '#166534' : '#991b1b',
                    }}
                  >
                    {selectedLog.status || 'SUCCESS'}
                  </span>
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                Description:
              </span>
              <div
                style={{
                  background: '#f1f5f9',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  marginTop: '4px',
                  fontSize: '13px',
                  color: '#1e293b',
                }}
              >
                {selectedLog.description || 'No additional description provided.'}
              </div>
            </div>

            {/* Details Payload */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                  Event Payload Details (Sanitized):
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '11px', padding: '2px 8px' }}
                  onClick={() => handleCopyJson(selectedLog.details || {})}
                >
                  {copiedDetails ? '✓ Copied' : '📋 Copy JSON'}
                </button>
              </div>
              <pre
                style={{
                  background: '#0f172a',
                  color: '#38bdf8',
                  padding: '14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  overflowX: 'auto',
                  margin: 0,
                  maxHeight: '260px',
                }}
              >
                {JSON.stringify(selectedLog.details || {}, null, 2)}
              </pre>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedLog(null)}
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
