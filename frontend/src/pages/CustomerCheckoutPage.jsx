import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cartApi, ordersApi } from '../services/api'
import { money } from '../utils/formatters'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Alert from '../components/common/Alert'

export default function CustomerCheckoutPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [cart, setCart] = useState(null)
  const [deliveryNotes, setDeliveryNotes] = useState('')

  const fetchCart = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await cartApi.get()
      if (!data.items || data.items.length === 0) {
        navigate('/customer/cart', { replace: true })
        return
      }
      setCart(data)
    } catch (err) {
      setError(`Failed to retrieve checkout items: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchCart()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchCart])

  const handlePlaceOrder = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const placedOrder = await ordersApi.placeOrder({
        delivery_notes: deliveryNotes.trim(),
      })
      // Order placed successfully! Redirect to customer orders page with order reference
      navigate('/customer/orders', {
        state: {
          successMessage: `Purchase order ${placedOrder.order_number} submitted successfully! Our staff will review and generate your invoice shortly.`,
        },
      })
    } catch (err) {
      setError(`Failed to submit order: ${err.message}`)
      setSubmitting(false)
    }
  }

  const customer = cart?.customer || {}
  const items = cart?.items || []

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link to="/customer/cart" style={{ color: '#2563eb', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}>
          ← Back to Shopping Cart
        </Link>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '8px 0 4px 0', color: '#111827' }}>
          Order Checkout & Review
        </h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
          Verify your billing details, order items, and add delivery instructions before submitting.
        </p>
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError('')} />}

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center' }}>
          <LoadingSpinner />
        </div>
      ) : (
        <form onSubmit={handlePlaceOrder}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '24px', alignItems: 'start' }}>
            {/* Left Column: Customer Profile & Order Items Review */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Billing / Business Entity Details */}
              <div className="card" style={{ padding: '20px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 14px 0', color: '#111827' }}>
                  Customer & Billing Information
                </h2>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '14px' }}>
                  <div>
                    <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Company / Client Name</span>
                    <strong style={{ color: '#111827' }}>{customer.name || customer.business_name || 'Valued Client'}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Email Address</span>
                    <span style={{ color: '#374151' }}>{customer.email || '—'}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Contact Phone</span>
                    <span style={{ color: '#374151' }}>{customer.phone || '—'}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>GSTIN</span>
                    <span style={{ color: '#374151', fontFamily: 'monospace' }}>{customer.gstin || 'Unregistered / B2C'}</span>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Delivery Address</span>
                    <span style={{ color: '#374151' }}>{customer.address || 'Standard Registered Address'}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Place of Supply</span>
                    <strong style={{ color: '#2563eb' }}>{customer.state || 'Maharashtra'}</strong>
                  </div>
                </div>
              </div>

              {/* Delivery Notes */}
              <div className="card" style={{ padding: '20px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 8px 0', color: '#111827' }}>
                  Delivery Instructions & Special Requests
                </h2>
                <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 12px 0' }}>
                  Optional notes for dispatch staff (e.g., loading bay number, preferred delivery hours, PO reference).
                </p>
                <textarea
                  className="form-control"
                  rows="3"
                  placeholder="Enter any delivery notes or reference numbers..."
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  style={{ width: '100%', resize: 'vertical' }}
                  maxLength={500}
                />
              </div>

              {/* Items Summary Table */}
              <div className="card" style={{ padding: '20px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 14px 0', color: '#111827' }}>
                  Items in this Order ({items.length})
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {items.map((it) => (
                    <div
                      key={it.product_id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: '12px',
                        borderBottom: '1px solid #f3f4f6',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                          {it.product_name}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>
                          {it.quantity} × {money(it.unit_price)} / {it.unit} • {it.gst_rate}% GST
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: '#111827', fontSize: '14px' }}>
                          {money(it.total)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>
                          Tax: {money(it.gst_amount)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Checkout Summary & Submission */}
            <div className="card" style={{ padding: '20px', position: 'sticky', top: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px 0', color: '#111827' }}>
                Payment & Tax Summary
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', borderBottom: '1px solid #e5e7eb', paddingBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4b5563' }}>
                  <span>Taxable Subtotal</span>
                  <span style={{ fontWeight: 500, color: '#111827' }}>{money(cart?.taxable_amount)}</span>
                </div>

                {cart?.supply_type === 'Intra-State' ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4b5563' }}>
                      <span>CGST</span>
                      <span style={{ fontWeight: 500, color: '#111827' }}>{money(cart?.total_cgst)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4b5563' }}>
                      <span>SGST</span>
                      <span style={{ fontWeight: 500, color: '#111827' }}>{money(cart?.total_sgst)}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4b5563' }}>
                    <span>IGST</span>
                    <span style={{ fontWeight: 500, color: '#111827' }}>{money(cart?.total_igst)}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4b5563' }}>
                  <span>Total Tax</span>
                  <span style={{ fontWeight: 500, color: '#111827' }}>{money(cart?.total_gst)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '16px 0' }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>Total Amount</span>
                <span style={{ fontSize: '24px', fontWeight: 800, color: '#2563eb' }}>
                  {money(cart?.total_amount)}
                </span>
              </div>

              <div
                style={{
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '12px',
                  color: '#166534',
                  marginBottom: '20px',
                  lineHeight: 1.4,
                }}
              >
                ✓ By placing this order, you submit a formal purchase request. Official tax invoice and payment options will be provided upon review by business staff.
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
                style={{ width: '100%', padding: '13px', fontSize: '15px', fontWeight: 700 }}
              >
                {submitting ? 'Placing Order...' : 'Confirm & Place Order'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

