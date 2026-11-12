import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cartApi } from '../services/api'
import { money } from '../utils/formatters'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Alert from '../components/common/Alert'

export default function CustomerCartPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const [cart, setCart] = useState(null)

  const fetchCart = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await cartApi.get()
      setCart(data)
    } catch (err) {
      setError(`Failed to load your shopping cart: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

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

  const handleUpdateQty = async (productId, currentQty, delta) => {
    const nextQty = currentQty + delta
    setUpdating(true)
    setError('')
    try {
      let updated
      if (nextQty <= 0) {
        updated = await cartApi.removeItem(productId)
      } else {
        updated = await cartApi.updateItem(productId, nextQty)
      }
      setCart(updated)
    } catch (err) {
      setError(`Failed to update quantity: ${err.message}`)
    } finally {
      setUpdating(false)
    }
  }

  const handleRemoveItem = async (productId) => {
    setUpdating(true)
    setError('')
    try {
      const updated = await cartApi.removeItem(productId)
      setCart(updated)
    } catch (err) {
      setError(`Failed to remove item: ${err.message}`)
    } finally {
      setUpdating(false)
    }
  }

  const handleClearCart = async () => {
    if (!window.confirm('Are you sure you want to empty your entire shopping cart?')) {
      return
    }
    setUpdating(true)
    setError('')
    try {
      const cleared = await cartApi.clear()
      setCart(cleared)
    } catch (err) {
      setError(`Failed to clear cart: ${err.message}`)
    } finally {
      setUpdating(false)
    }
  }

  const items = cart?.items || []

  return (
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', color: '#111827' }}>
            Shopping Cart
          </h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
            Review items, quantities, and GST breakdown before submitting your purchase order.
          </p>
        </div>

        {items.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClearCart}
            disabled={updating}
            style={{ fontSize: '13px', color: '#dc2626' }}
          >
            Clear Cart
          </button>
        )}
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError('')} />}

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center' }}>
          <LoadingSpinner />
          <p style={{ marginTop: '12px', color: '#6b7280' }}>Calculating cart and tax totals...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
          <svg width="56" height="56" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" style={{ margin: '0 auto 16px' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1f2937', marginBottom: '8px' }}>
            Your cart is currently empty
          </h2>
          <p style={{ color: '#6b7280', fontSize: '14px', maxWidth: '420px', margin: '0 auto 24px' }}>
            Explore our product catalogue to discover items and add them to your shopping cart.
          </p>
          <Link
            to="/customer/catalogue"
            className="btn btn-primary"
            style={{ textDecoration: 'none', display: 'inline-block' }}
          >
            Browse Product Catalogue
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'start' }}>
          {/* Items Table Card */}
          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Product</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', color: '#4b5563' }}>Price</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#4b5563' }}>Qty</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', color: '#4b5563' }}>GST</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', color: '#4b5563' }}>Total</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#4b5563' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.product_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div
                            style={{
                              width: '44px',
                              height: '44px',
                              borderRadius: '6px',
                              backgroundColor: '#f3f4f6',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              overflow: 'hidden',
                              flexShrink: 0,
                            }}
                          >
                            {it.image_url ? (
                              <img src={it.image_url} alt={it.product_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#9ca3af">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                              </svg>
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                              {it.product_name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#6b7280' }}>
                              {it.sku ? `SKU: ${it.sku} • ` : ''}{it.unit || 'pcs'}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: '13px', fontWeight: 500, color: '#374151' }}>
                        {money(it.unit_price)}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            backgroundColor: '#ffffff',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(it.product_id, it.quantity, -1)}
                            disabled={updating}
                            style={{ border: 'none', background: '#f9fafb', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}
                          >
                            −
                          </button>
                          <span style={{ padding: '0 8px', fontSize: '13px', fontWeight: 600, minWidth: '20px', textAlign: 'center' }}>
                            {it.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(it.product_id, it.quantity, 1)}
                            disabled={updating}
                            style={{ border: 'none', background: '#f9fafb', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}
                          >
                            +
                          </button>
                        </div>
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: '13px', color: '#4b5563' }}>
                        <div>{money(it.gst_amount)}</div>
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>({it.gst_rate}%)</span>
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: '#111827' }}>
                        {money(it.total)}
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(it.product_id)}
                          disabled={updating}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#ef4444',
                            padding: '4px',
                            borderRadius: '4px',
                          }}
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ padding: '14px 16px', borderTop: '1px solid #e5e7eb', backgroundColor: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Link to="/customer/catalogue" style={{ fontSize: '13px', color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>
                ← Continue Shopping
              </Link>
              <span style={{ fontSize: '13px', color: '#6b7280' }}>
                {cart?.total_items_count} items in cart
              </span>
            </div>
          </div>

          {/* Order Summary & Tax Breakdown Card */}
          <div className="card" style={{ padding: '20px', position: 'sticky', top: '24px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px 0', color: '#111827' }}>
              Order Tax Summary
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', borderBottom: '1px solid #e5e7eb', paddingBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4b5563' }}>
                <span>Subtotal (Items)</span>
                <span style={{ fontWeight: 500, color: '#111827' }}>{money(cart?.subtotal)}</span>
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
                  <span>IGST (Inter-State)</span>
                  <span style={{ fontWeight: 500, color: '#111827' }}>{money(cart?.total_igst)}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4b5563' }}>
                <span>Total GST</span>
                <span style={{ fontWeight: 500, color: '#111827' }}>{money(cart?.total_gst)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '16px 0' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>Total Payable</span>
              <span style={{ fontSize: '22px', fontWeight: 800, color: '#2563eb' }}>
                {money(cart?.total_amount)}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '20px', lineHeight: 1.4 }}>
              * Place of Supply:{' '}
              <strong>{cart?.customer?.state || 'Maharashtra'}</strong> ({cart?.supply_type}).
              Orders are reviewed and invoiced by management before dispatch.
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/customer/checkout')}
              style={{ width: '100%', padding: '12px', fontSize: '15px', fontWeight: 600 }}
            >
              Proceed to Checkout →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

