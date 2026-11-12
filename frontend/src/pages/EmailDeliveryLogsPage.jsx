import { useState, useEffect, useCallback } from 'react'
import { emailDeliveryApi } from '../services/api'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Pagination from '../components/common/Pagination'
import Alert from '../components/common/Alert'

export default function EmailDeliveryLogsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [logs, setLogs] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalLogs, setTotalLogs] = useState(0)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [retryingId, setRetryingId] = useState(null)
  const [selectedLog, setSelectedLog] = useState(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await emailDeliveryApi.getLogs({
        page,
        limit: 20,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        email_type: typeFilter !== 'ALL' ? typeFilter : undefined,
        search: searchQuery.trim() || undefined,
      })
      setLogs(res.items || [])
      setTotalPages(res.pages || 1)
      setTotalLogs(res.total || 0)
    } catch (err) {
      setError(`Failed to retrieve email delivery audit logs: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, typeFilter, searchQuery])

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

  const handleRetry = async (log) => {
    const idToRetry = log.email_id || log.id || log._id
    setRetryingId(idToRetry)
    setError('')
    setSuccessMsg('')
    try {
      const res = await emailDeliveryApi.retryEmail(idToRetry)
      setSuccessMsg(res.message || 'Email delivery retry queued successfully.')
      // Refresh logs after queuing retry
      setTimeout(() => {
        fetchLogs()
      }, 1200)
    } catch (err) {
      setError(`Failed to queue email retry: ${err.message}`)
    } finally {
      setRetryingId(null)
    }
  }

  // Quick stats computed from current view
  const sentCount = logs.filter((l) => l.delivery_status === 'SENT').length
  const failedCount = logs.filter((l) => l.delivery_status === 'FAILED').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📨</span> Automated Email Delivery Audit Logs
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            Comprehensive tracking and retry audit log for automatic customer Invoice and Payment Receipt PDF email notifications.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => fetchLogs()}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh Logs
        </button>
      </div>

      {error && <Alert type="danger" message={error} />}
      {successMsg && <Alert type="success" message={successMsg} />}

      {/* Metric summary pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total Audit Logs</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>{totalLogs}</div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Sent Successfully (Page)</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>{sentCount}</div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #ef4444' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Failed Dispatches (Page)</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#ef4444', marginTop: '4px' }}>{failedCount}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 260px' }}>
            <input
              type="text"
              placeholder="Search recipient, customer name, reference #, or subject…"
              className="form-control"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setPage(1)
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Type:</span>
            {['ALL', 'INVOICE', 'PAYMENT_RECEIPT'].map((t) => (
              <button
                key={t}
                type="button"
                className={`btn btn-sm ${typeFilter === t ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setTypeFilter(t)
                  setPage(1)
                }}
              >
                {t === 'ALL' ? 'All Types' : t.replace('_', ' ')}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Status:</span>
            {['ALL', 'SENT', 'FAILED', 'PENDING'].map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setStatusFilter(s)
                  setPage(1)
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px' }}>
            <LoadingSpinner message="Loading email delivery audit logs…" />
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
            <div style={{ fontWeight: 600, fontSize: '15px', color: '#475569' }}>No email delivery records found</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>
              Whenever an invoice is generated or a verified payment is processed, automated dispatch logs appear here.
            </div>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Notification Type</th>
                  <th>Reference #</th>
                  <th>Customer / Recipient</th>
                  <th>Delivery Status</th>
                  <th>Attempts</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const logId = log.email_id || log.id || log._id
                  const isSent = log.delivery_status === 'SENT'
                  const isFailed = log.delivery_status === 'FAILED'
                  const isPending = log.delivery_status === 'PENDING'

                  return (
                    <tr key={logId}>
                      <td style={{ fontSize: '12px', whiteSpace: 'nowrap', color: '#475569' }}>
                        {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                      </td>

                      <td>
                        {log.email_type === 'INVOICE' ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: '1px solid #bfdbfe',
                            }}
                          >
                            📄 Invoice
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                            }}
                          >
                            🧾 Payment Receipt
                          </span>
                        )}
                      </td>

                      <td style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>
                        {log.reference_number || '—'}
                      </td>

                      <td>
                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '13px' }}>
                          {log.customer_name || 'Customer'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {log.recipient_email}
                        </div>
                      </td>

                      <td>
                        {isSent && (
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: '20px',
                              fontSize: '12px',
                              fontWeight: 700,
                              background: '#dcfce7',
                              color: '#15803d',
                            }}
                          >
                            ✓ Sent
                          </span>
                        )}
                        {isFailed && (
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: '20px',
                              fontSize: '12px',
                              fontWeight: 700,
                              background: '#fee2e2',
                              color: '#b91c1c',
                            }}
                          >
                            ✕ Failed
                          </span>
                        )}
                        {isPending && (
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: '20px',
                              fontSize: '12px',
                              fontWeight: 700,
                              background: '#fef3c7',
                              color: '#b45309',
                            }}
                          >
                            ⏳ Pending
                          </span>
                        )}
                      </td>

                      <td style={{ fontSize: '12px', color: '#64748b' }}>
                        {log.attempts || 1} {log.attempts === 1 ? 'try' : 'tries'}
                      </td>

                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setSelectedLog(log)}
                            title="Inspect Technical Log Details"
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${isFailed ? 'btn-danger' : 'btn-primary'}`}
                            onClick={() => handleRetry(log)}
                            disabled={retryingId === logId}
                            title="Trigger immediate SMTP retry dispatch"
                          >
                            {retryingId === logId ? 'Retrying…' : 'Retry'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid #e2e8f0' }}>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={(p) => setPage(p)}
            />
          </div>
        )}
      </div>

      {/* Modal for Details Inspection */}
      {selectedLog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: '620px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              borderRadius: '12px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                  Email Delivery Audit Detail
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  Log Reference: {selectedLog.email_id || selectedLog.id || selectedLog._id}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setSelectedLog(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', marginBottom: '16px' }}>
              <div>
                <strong style={{ color: '#475569' }}>Type:</strong>
                <div>{selectedLog.email_type}</div>
              </div>
              <div>
                <strong style={{ color: '#475569' }}>Status:</strong>
                <div>{selectedLog.delivery_status}</div>
              </div>
              <div>
                <strong style={{ color: '#475569' }}>Reference Number:</strong>
                <div>{selectedLog.reference_number || 'N/A'}</div>
              </div>
              <div>
                <strong style={{ color: '#475569' }}>Attempts:</strong>
                <div>{selectedLog.attempts || 1}</div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <strong style={{ color: '#475569' }}>Recipient:</strong>
                <div>{selectedLog.recipient_email} ({selectedLog.customer_name})</div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <strong style={{ color: '#475569' }}>Subject:</strong>
                <div>{selectedLog.subject || '—'}</div>
              </div>
              <div>
                <strong style={{ color: '#475569' }}>Created At:</strong>
                <div>{selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString() : '—'}</div>
              </div>
              <div>
                <strong style={{ color: '#475569' }}>Sent At:</strong>
                <div>{selectedLog.sent_at ? new Date(selectedLog.sent_at).toLocaleString() : 'Not sent yet'}</div>
              </div>
            </div>

            {selectedLog.last_error && (
              <div style={{ marginBottom: '16px' }}>
                <strong style={{ color: '#dc2626', fontSize: '13px' }}>Last Error / Failure Trace:</strong>
                <pre
                  style={{
                    marginTop: '6px',
                    padding: '10px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    color: '#991b1b',
                    fontSize: '12px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {selectedLog.last_error}
                </pre>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedLog(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  handleRetry(selectedLog)
                  setSelectedLog(null)
                }}
              >
                Trigger Immediate Retry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

