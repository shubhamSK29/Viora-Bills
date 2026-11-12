import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ordersApi } from '../services/api'
import { money, formatDate } from '../utils/formatters'
import OrderStatusBadge from '../components/common/OrderStatusBadge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Pagination from '../components/common/Pagination'
import Modal from '../components/common/Modal'
import Alert from '../components/common/Alert'

export default function OrdersPage() {
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [orders, setOrders] = useState([])
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalOrders, setTotalOrders] = useState(0)
  const [counts, setCounts] = useState({})

  // Modals / Drawers
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [rejectingOrder, setRejectingOrder] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [actionNotes, setActionNotes] = useState('')

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await ordersApi.list({
        page,
        limit: 15,
        status: statusFilter,
        search: searchQuery.trim(),
      })
      setOrders(res.items || [])
      setTotalPages(res.total_pages || 1)
      setTotalOrders(res.total || 0)
      if (res.counts) {
        setCounts(res.counts)
      }
    } catch (err) {
      setError(`Failed to retrieve orders: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, searchQuery])

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

  const handleReview = async (orderId) => {
    setActionLoading(true)
    setError('')
    try {
      const updated = await ordersApi.review(orderId, actionNotes)
      setSuccessMessage(`Order ${updated.order_number} marked as Under Review.`)
      setSelectedOrder(updated)
      setActionNotes('')
      fetchOrders()
    } catch (err) {
      setError(`Failed to update order: ${err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleAccept = async (orderId) => {
    setActionLoading(true)
    setError('')
    try {
      const updated = await ordersApi.accept(orderId, actionNotes)
      setSuccessMessage(`Order ${updated.order_number} accepted successfully.`)
      setSelectedOrder(updated)
      setActionNotes('')
      fetchOrders()
    } catch (err) {
      setError(`Failed to accept order: ${err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleRejectConfirm = async () => {
    if (!rejectingOrder || !rejectionReason.trim()) return
    setActionLoading(true)
    setError('')
    try {
      const updated = await ordersApi.reject(rejectingOrder.id, rejectionReason.trim())
      setSuccessMessage(`Order ${updated.order_number} has been rejected.`)
      setRejectingOrder(null)
      setRejectionReason('')
      if (selectedOrder?.id === rejectingOrder.id) {
        setSelectedOrder(updated)
      }
      fetchOrders()
    } catch (err) {
      setError(`Failed to reject order: ${err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleGenerateInvoice = async (orderId) => {
    if (!window.confirm('Generate official tax invoice for this order?')) return
    setActionLoading(true)
    setError('')
    try {
      const res = await ordersApi.generateInvoice(orderId)
      setSuccessMessage(
        `Official Invoice ${res.invoice.invoice_number} generated successfully for order ${res.order.order_number}!`
      )
      setSelectedOrder(res.order)
      fetchOrders()
    } catch (err) {
      setError(`Failed to generate invoice: ${err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const statusTabs = [
    { key: 'ALL', label: 'All Orders', count: counts.total || 0 },
    { key: 'PENDING_REVIEW', label: 'Pending Review', count: counts.pending_review || 0 },
    { key: 'UNDER_REVIEW', label: 'Under Review', count: counts.under_review || 0 },
    { key: 'ACCEPTED', label: 'Accepted', count: counts.accepted || 0 },
    { key: 'INVOICED', label: 'Invoiced', count: counts.invoiced || 0 },
    { key: 'REJECTED', label: 'Rejected', count: counts.rejected || 0 },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', color: '#111827' }}>
            Customer Orders Management
          </h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
            Review incoming customer purchase orders, approve requests, and generate official tax invoices.
          </p>
        </div>
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError('')} />}
      {successMessage && <Alert type="success" message={successMessage} onClose={() => setSuccessMessage('')} />}

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div className="card" style={{ padding: '16px', borderLeft: '4px solid #f59e0b' }}>
          <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Pending Review</span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#d97706' }}>
            {counts.pending_review || 0}
          </span>
        </div>

        <div className="card" style={{ padding: '16px', borderLeft: '4px solid #3b82f6' }}>
          <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Under Review</span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#2563eb' }}>
            {counts.under_review || 0}
          </span>
        </div>

        <div className="card" style={{ padding: '16px', borderLeft: '4px solid #10b981' }}>
          <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Accepted (Ready for Invoice)</span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#059669' }}>
            {counts.accepted || 0}
          </span>
        </div>

        <div className="card" style={{ padding: '16px', borderLeft: '4px solid #047857' }}>
          <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Invoiced & Billed</span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#047857' }}>
            {counts.invoiced || 0}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        className="card"
        style={{
          padding: '16px',
          marginBottom: '20px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', flex: '1 1 auto' }}>
          {statusTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setStatusFilter(t.key)
                setPage(1)
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                backgroundColor: statusFilter === t.key ? '#2563eb' : '#f3f4f6',
                color: statusFilter === t.key ? '#ffffff' : '#4b5563',
              }}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <div style={{ minWidth: '260px' }}>
          <input
            type="text"
            className="form-control"
            placeholder="Search by order # or customer..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPage(1)
            }}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Orders Table */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center' }}>
          <LoadingSpinner />
          <p style={{ marginTop: '12px', color: '#6b7280' }}>Loading orders queue...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
          <p style={{ color: '#6b7280', fontSize: '15px' }}>No orders found for the selected filter.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Order #</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Customer</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', color: '#4b5563' }}>Amount</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#4b5563' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Invoice Ref</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#4b5563' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((ord) => (
                  <tr key={ord.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 600, color: '#2563eb' }}>
                      {ord.order_number}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                        {ord.customer_name}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>
                        {ord.customer_email || '—'}
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '13px', color: '#4b5563' }}>
                      {formatDate(ord.created_at)}
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
                          to="/invoices"
                          style={{ color: '#059669', fontWeight: 600, textDecoration: 'none', fontFamily: 'monospace' }}
                        >
                          {ord.invoice_number}
                        </Link>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>Not Invoiced</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setSelectedOrder(ord)}
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '14px 16px', borderTop: '1px solid #e5e7eb' }}>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalOrders}
              pageSize={15}
              onPageChange={setPage}
            />
          </div>
        </div>
      )}

      {/* Review Drawer / Modal */}
      {selectedOrder && (
        <Modal
          isOpen={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Order Management: ${selectedOrder.order_number}`}
          maxWidth="750px"
        >
          <div>
            {/* Header info banner */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                backgroundColor: '#f9fafb',
                padding: '14px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
              }}
            >
              <div>
                <span style={{ color: '#6b7280', display: 'block', fontSize: '11px' }}>Customer Name</span>
                <strong style={{ color: '#111827' }}>{selectedOrder.customer_name}</strong>
              </div>
              <div>
                <span style={{ color: '#6b7280', display: 'block', fontSize: '11px' }}>Current Status</span>
                <OrderStatusBadge status={selectedOrder.status} />
              </div>
              <div>
                <span style={{ color: '#6b7280', display: 'block', fontSize: '11px' }}>Contact Phone / Email</span>
                <span>{selectedOrder.customer_phone || '—'} / {selectedOrder.customer_email || '—'}</span>
              </div>
              <div>
                <span style={{ color: '#6b7280', display: 'block', fontSize: '11px' }}>Delivery Address</span>
                <span>{selectedOrder.shipping_address || 'Standard Registered Address'}</span>
              </div>
              {selectedOrder.delivery_notes && (
                <div style={{ gridColumn: 'span 2', backgroundColor: '#ffffff', padding: '8px', borderRadius: '4px', border: '1px solid #e5e7eb' }}>
                  <span style={{ color: '#6b7280', display: 'block', fontSize: '11px' }}>Customer Notes:</span>
                  <span style={{ color: '#374151' }}>{selectedOrder.delivery_notes}</span>
                </div>
              )}
            </div>

            {/* Line items list */}
            <h4 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px 0', color: '#374151' }}>
              Order Line Items & Tax Breakdown
            </h4>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', marginBottom: '16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#4b5563' }}>Product</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#4b5563' }}>Qty</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>Price</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>Taxable</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>GST</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items?.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 500, color: '#111827' }}>
                        {it.product_name}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: '#4b5563' }}>
                        {it.quantity} {it.unit}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>
                        {money(it.unit_price)}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>
                        {money(it.taxable_amount)}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#4b5563' }}>
                        {money(it.gst_amount)}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#111827' }}>
                        {money(it.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '20px', marginBottom: '16px', fontSize: '13px' }}>
              <div>Subtotal: <strong>{money(selectedOrder.subtotal)}</strong></div>
              <div>GST: <strong>{money(selectedOrder.total_gst)}</strong></div>
              <div>Total: <strong style={{ color: '#2563eb', fontSize: '15px' }}>{money(selectedOrder.total_amount)}</strong></div>
            </div>

            {/* Workflow Action Buttons */}
            <div
              style={{
                borderTop: '1px solid #e5e7eb',
                paddingTop: '16px',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px' }}>
                {selectedOrder.status === 'PENDING_REVIEW' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleReview(selectedOrder.id)}
                    disabled={actionLoading}
                    style={{ fontSize: '13px' }}
                  >
                    Mark Under Review
                  </button>
                )}

                {['PENDING_REVIEW', 'UNDER_REVIEW'].includes(selectedOrder.status) && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleAccept(selectedOrder.id)}
                    disabled={actionLoading}
                    style={{ backgroundColor: '#059669', borderColor: '#059669', fontSize: '13px' }}
                  >
                    Accept Order
                  </button>
                )}

                {['PENDING_REVIEW', 'UNDER_REVIEW', 'ACCEPTED'].includes(selectedOrder.status) && (
                  <button
                    type="button"
                    onClick={() => setRejectingOrder(selectedOrder)}
                    disabled={actionLoading}
                    style={{
                      padding: '7px 12px',
                      borderRadius: '6px',
                      backgroundColor: '#fee2e2',
                      color: '#dc2626',
                      border: 'none',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Reject Order
                  </button>
                )}
              </div>

              <div>
                {selectedOrder.status === 'ACCEPTED' && !selectedOrder.invoice_id && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleGenerateInvoice(selectedOrder.id)}
                    disabled={actionLoading}
                    style={{ fontSize: '13px', fontWeight: 700 }}
                  >
                    {actionLoading ? 'Generating...' : '⚡ Generate Tax Invoice'}
                  </button>
                )}

                {selectedOrder.invoice_number && (
                  <Link
                    to="/invoices"
                    className="btn btn-secondary"
                    style={{ fontSize: '13px', textDecoration: 'none' }}
                  >
                    View Invoice {selectedOrder.invoice_number} →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Order Modal */}
      {rejectingOrder && (
        <Modal
          isOpen={Boolean(rejectingOrder)}
          onClose={() => setRejectingOrder(null)}
          title={`Reject Order: ${rejectingOrder.order_number}`}
          maxWidth="500px"
        >
          <div>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 12px 0' }}>
              Please provide a clear reason for rejection. This reason will be recorded and communicated to the customer.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <textarea
                className="form-control"
                rows="3"
                placeholder="Reason (e.g., product currently unavailable, invalid delivery region)..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                style={{ width: '100%' }}
                required
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRejectingOrder(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRejectConfirm}
                disabled={actionLoading || !rejectionReason.trim()}
                style={{ backgroundColor: '#dc2626', borderColor: '#dc2626' }}
              >
                {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

