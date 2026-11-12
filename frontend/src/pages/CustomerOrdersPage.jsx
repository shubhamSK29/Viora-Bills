import { useState, useEffect, useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ordersApi } from '../services/api'
import { money, formatDate } from '../utils/formatters'
import OrderStatusBadge from '../components/common/OrderStatusBadge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Pagination from '../components/common/Pagination'
import Modal from '../components/common/Modal'
import Alert from '../components/common/Alert'

export default function CustomerOrdersPage() {
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState(location.state?.successMessage || '')
  const [orders, setOrders] = useState([])
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalOrders, setTotalOrders] = useState(0)

  // Drawer / Detail modal
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [cancellingOrder, setCancellingOrder] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await ordersApi.getCustomerOrders({
        page,
        limit: 10,
        status: statusFilter,
      })
      setOrders(res.items || [])
      setTotalPages(res.total_pages || 1)
      setTotalOrders(res.total || 0)
    } catch (err) {
      setError(`Failed to retrieve orders: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchOrders()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchOrders])

  const handleConfirmCancel = async () => {
    if (!cancellingOrder) return
    setIsCancelling(true)
    setError('')
    try {
      await ordersApi.cancelOrder(cancellingOrder.id, cancelReason)
      setSuccessMessage(`Order ${cancellingOrder.order_number} has been cancelled.`)
      setCancellingOrder(null)
      setCancelReason('')
      if (selectedOrder?.id === cancellingOrder.id) {
        setSelectedOrder(null)
      }
      fetchOrders()
    } catch (err) {
      setError(`Failed to cancel order: ${err.message}`)
    } finally {
      setIsCancelling(false)
    }
  }

  const statuses = [
    { key: 'ALL', label: 'All Orders' },
    { key: 'PENDING_REVIEW', label: 'Pending Review' },
    { key: 'UNDER_REVIEW', label: 'Under Review' },
    { key: 'ACCEPTED', label: 'Accepted' },
    { key: 'INVOICED', label: 'Invoiced' },
    { key: 'REJECTED', label: 'Rejected' },
    { key: 'CANCELLED', label: 'Cancelled' },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', color: '#111827' }}>
            My Orders
          </h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
            Track the status of your purchase orders, approvals, and invoices.
          </p>
        </div>

        <Link
          to="/customer/catalogue"
          className="btn btn-primary"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <span>Browse Catalogue</span>
        </Link>
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError('')} />}
      {successMessage && <Alert type="success" message={successMessage} onClose={() => setSuccessMessage('')} />}

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginBottom: '20px', paddingBottom: '4px' }}>
        {statuses.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setStatusFilter(s.key)
              setPage(1)
            }}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              backgroundColor: statusFilter === s.key ? '#2563eb' : '#f3f4f6',
              color: statusFilter === s.key ? '#ffffff' : '#4b5563',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Orders Table */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center' }}>
          <LoadingSpinner />
          <p style={{ marginTop: '12px', color: '#6b7280' }}>Loading orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" style={{ margin: '0 auto 16px' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#374151' }}>No orders found</h3>
          <p style={{ color: '#6b7280', fontSize: '14px', margin: '6px 0 20px 0' }}>
            You haven't placed any orders matching this filter.
          </p>
          <Link to="/customer/catalogue" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Start Shopping
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Order #</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Items Summary</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', color: '#4b5563' }}>Total Amount</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#4b5563' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Invoice Ref</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#4b5563' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((ord) => {
                  const itemCount = ord.items?.length || 0
                  const firstItem = ord.items?.[0]?.product_name || 'Product'
                  const summaryText = itemCount > 1 ? `${firstItem} + ${itemCount - 1} more` : firstItem

                  return (
                    <tr key={ord.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 600, color: '#2563eb' }}>
                        {ord.order_number}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: '#4b5563' }}>
                        {formatDate(ord.created_at)}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: '13px', color: '#374151' }}>
                        {summaryText}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: '#111827' }}>
                        {money(ord.total_amount)}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <OrderStatusBadge status={ord.status} />
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: '13px' }}>
                        {ord.invoice_number ? (
                          <Link
                            to="/customer/invoices"
                            style={{ color: '#059669', fontWeight: 600, textDecoration: 'none', fontFamily: 'monospace' }}
                          >
                            {ord.invoice_number}
                          </Link>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>Pending Review</span>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setSelectedOrder(ord)}
                            style={{ padding: '4px 10px', fontSize: '12px' }}
                          >
                            Details
                          </button>
                          {['PENDING_REVIEW', 'UNDER_REVIEW'].includes(ord.status) && (
                            <button
                              type="button"
                              onClick={() => setCancellingOrder(ord)}
                              style={{
                                padding: '4px 10px',
                                fontSize: '12px',
                                background: '#fee2e2',
                                color: '#dc2626',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 500,
                              }}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '14px 16px', borderTop: '1px solid #e5e7eb' }}>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalOrders}
              pageSize={10}
              onPageChange={setPage}
            />
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <Modal
          isOpen={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Order Details: ${selectedOrder.order_number}`}
          maxWidth="700px"
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Order Date</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                  {formatDate(selectedOrder.created_at)}
                </span>
              </div>
              <div>
                <OrderStatusBadge status={selectedOrder.status} />
              </div>
            </div>

            {selectedOrder.invoice_number && (
              <div
                style={{
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong style={{ color: '#166534', fontSize: '13px', display: 'block' }}>
                    Official Tax Invoice Generated:
                  </strong>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#047857' }}>
                    {selectedOrder.invoice_number}
                  </span>
                </div>
                <Link
                  to="/customer/invoices"
                  className="btn btn-primary"
                  style={{ fontSize: '12px', padding: '6px 12px', textDecoration: 'none' }}
                >
                  View Invoice & Pay →
                </Link>
              </div>
            )}

            {selectedOrder.rejection_reason && (
              <div
                style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                  fontSize: '13px',
                  color: '#991b1b',
                }}
              >
                <strong>Rejection Reason:</strong> {selectedOrder.rejection_reason}
              </div>
            )}

            {/* Line items list */}
            <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 10px 0', color: '#374151' }}>
              Ordered Products
            </h4>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', marginBottom: '16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#4b5563' }}>Product</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#4b5563' }}>Qty</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>Price</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>Tax</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items?.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500, color: '#111827' }}>
                        {it.product_name}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#4b5563' }}>
                        {it.quantity} {it.unit}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#4b5563' }}>
                        {money(it.unit_price)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#4b5563' }}>
                        {money(it.gst_amount)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>
                        {money(it.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tax summary totals */}
            <div style={{ backgroundColor: '#f9fafb', padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#6b7280' }}>Taxable Amount:</span>
                <span style={{ fontWeight: 500 }}>{money(selectedOrder.taxable_amount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#6b7280' }}>Total GST:</span>
                <span style={{ fontWeight: 500 }}>{money(selectedOrder.total_gst)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 700, borderTop: '1px solid #e5e7eb', paddingTop: '6px' }}>
                <span>Total Amount:</span>
                <span style={{ color: '#2563eb' }}>{money(selectedOrder.total_amount)}</span>
              </div>
            </div>

            {/* Timeline history */}
            {selectedOrder.status_history && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px 0', color: '#374151' }}>
                  Status History
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '2px solid #e5e7eb', paddingLeft: '12px' }}>
                  {selectedOrder.status_history.map((h, i) => (
                    <div key={i} style={{ fontSize: '12px' }}>
                      <strong style={{ color: '#111827' }}>{h.status}</strong>
                      <span style={{ color: '#6b7280', marginLeft: '6px' }}>({formatDate(h.changed_at)})</span>
                      {h.notes && <div style={{ color: '#4b5563', marginTop: '2px' }}>{h.notes}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              {['PENDING_REVIEW', 'UNDER_REVIEW'].includes(selectedOrder.status) && (
                <button
                  type="button"
                  onClick={() => setCancellingOrder(selectedOrder)}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: '#fee2e2',
                    color: '#dc2626',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '13px',
                  }}
                >
                  Cancel Order
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedOrder(null)}
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Cancel Order Modal */}
      {cancellingOrder && (
        <Modal
          isOpen={Boolean(cancellingOrder)}
          onClose={() => setCancellingOrder(null)}
          title={`Cancel Order: ${cancellingOrder.order_number}`}
          maxWidth="500px"
        >
          <div>
            <p style={{ fontSize: '14px', color: '#374151', margin: '0 0 16px 0' }}>
              Are you sure you want to cancel this order? This action cannot be undone.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#4b5563', display: 'block', marginBottom: '6px' }}>
                Cancellation Reason (Optional)
              </label>
              <textarea
                className="form-control"
                rows="2"
                placeholder="Reason for cancellation..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCancellingOrder(null)}
                disabled={isCancelling}
              >
                Keep Order
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmCancel}
                disabled={isCancelling}
                style={{ backgroundColor: '#dc2626', borderColor: '#dc2626' }}
              >
                {isCancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

