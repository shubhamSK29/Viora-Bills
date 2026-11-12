import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { catalogueApi, cartApi } from '../services/api'
import { money } from '../utils/formatters'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Pagination from '../components/common/Pagination'
import Modal from '../components/common/Modal'
import Alert from '../components/common/Alert'

export default function CustomerCataloguePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalProducts, setTotalProducts] = useState(0)

  // Cart summary preview
  const [cartCount, setCartCount] = useState(0)
  const [cartTotal, setCartTotal] = useState(0)

  // Product detail modal
  const [activeProduct, setActiveProduct] = useState(null)
  const [quantityMap, setQuantityMap] = useState({})
  const [addingId, setAddingId] = useState(null)

  const fetchCartInfo = useCallback(async () => {
    try {
      const c = await cartApi.get()
      setCartCount(c.total_items_count || 0)
      setCartTotal(c.total_amount || 0)
    } catch {
      // Ignore background cart fetch error
    }
  }, [])

  const fetchCatalogue = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await catalogueApi.list({
        page,
        limit: 12,
        search: searchQuery.trim(),
        category: selectedCategory,
        sort_by: sortBy,
        sort_dir: sortDir,
      })
      setProducts(res.items || [])
      setTotalPages(res.total_pages || 1)
      setTotalProducts(res.total || 0)
      if (res.categories) {
        setCategories(res.categories)
      }
    } catch (err) {
      setError(`Failed to load product catalogue: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, searchQuery, selectedCategory, sortBy, sortDir])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchCatalogue()
        fetchCartInfo()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchCatalogue, fetchCartInfo])

  const handleQuantityChange = (productId, delta) => {
    setQuantityMap((prev) => {
      const current = prev[productId] || 1
      const next = Math.max(1, current + delta)
      return { ...prev, [productId]: next }
    })
  }

  const handleAddToCart = async (product) => {
    setAddingId(product.id)
    setError('')
    setSuccessMessage('')
    try {
      const qty = quantityMap[product.id] || 1
      const updatedCart = await cartApi.addItem(product.id, qty)
      setCartCount(updatedCart.total_items_count || 0)
      setCartTotal(updatedCart.total_amount || 0)
      setSuccessMessage(`Added ${qty} × "${product.name}" to your cart.`)
      // Reset qty selector
      setQuantityMap((prev) => ({ ...prev, [product.id]: 1 }))
      setTimeout(() => setSuccessMessage(''), 4000)
    } catch (err) {
      setError(`Could not add product to cart: ${err.message}`)
    } finally {
      setAddingId(null)
    }
  }

  return (
    <div className="catalogue-page" style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Header Banner & Cart Quick Link */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 6px 0', color: '#111827' }}>
            Product Catalogue
          </h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
            Browse our latest products, compare items, and order directly to your business account.
          </p>
        </div>

        <Link
          to="/customer/cart"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            padding: '10px 18px',
            borderRadius: '8px',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '14px',
            boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)',
          }}
        >
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <span>View Cart ({cartCount})</span>
          {cartTotal > 0 && <span style={{ opacity: 0.9 }}>• {money(cartTotal)}</span>}
        </Link>
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError('')} />}
      {successMessage && <Alert type="success" message={successMessage} onClose={() => setSuccessMessage('')} />}

      {/* Filter and Search Bar */}
      <div
        className="card"
        style={{
          padding: '16px',
          marginBottom: '24px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flex: '1 1 280px', gap: '10px' }}>
          <input
            type="text"
            className="form-control"
            placeholder="Search by name, SKU, or specification..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPage(1)
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <select
            className="form-control"
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value)
              setPage(1)
            }}
            style={{ minWidth: '150px' }}
          >
            <option value="ALL">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            className="form-control"
            value={`${sortBy}-${sortDir}`}
            onChange={(e) => {
              const [sb, sd] = e.target.value.split('-')
              setSortBy(sb)
              setSortDir(sd)
              setPage(1)
            }}
            style={{ minWidth: '170px' }}
          >
            <option value="name-asc">Name: A to Z</option>
            <option value="name-desc">Name: Z to A</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
          </select>
        </div>
      </div>

      {/* Product Grid */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center' }}>
          <LoadingSpinner />
          <p style={{ marginTop: '12px', color: '#6b7280' }}>Loading products catalogue...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" style={{ margin: '0 auto 16px' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#374151' }}>No products found</h3>
          <p style={{ color: '#6b7280', fontSize: '14px', maxWidth: '400px', margin: '8px auto 0' }}>
            We could not find any active products matching your filter criteria. Try clearing search filters.
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '20px',
              marginBottom: '32px',
            }}
          >
            {products.map((product) => {
              const qty = quantityMap[product.id] || 1
              return (
                <div
                  key={product.id}
                  className="card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: '1px solid #e5e7eb',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  }}
                >
                  {/* Product Image */}
                  <div
                    style={{
                      height: '180px',
                      backgroundColor: '#f3f4f6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="#9ca3af">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}

                    {product.category && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '10px',
                          left: '10px',
                          backgroundColor: 'rgba(17, 24, 39, 0.75)',
                          color: '#ffffff',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 500,
                          backdropFilter: 'blur(4px)',
                        }}
                      >
                        {product.category}
                      </span>
                    )}

                    {product.sku && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: '10px',
                          right: '10px',
                          backgroundColor: 'rgba(255, 255, 255, 0.85)',
                          color: '#374151',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontFamily: 'monospace',
                        }}
                      >
                        {product.sku}
                      </span>
                    )}
                  </div>

                  {/* Body Content */}
                  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <div style={{ flex: 1 }}>
                      <h3
                        style={{
                          fontSize: '16px',
                          fontWeight: 600,
                          margin: '0 0 6px 0',
                          color: '#111827',
                          cursor: 'pointer',
                        }}
                        onClick={() => setActiveProduct(product)}
                      >
                        {product.name}
                      </h3>
                      {product.description && (
                        <p
                          style={{
                            fontSize: '13px',
                            color: '#6b7280',
                            margin: '0 0 12px 0',
                            lineHeight: 1.4,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {product.description}
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '14px' }}>
                      <div>
                        <span style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                          {money(product.price)}
                        </span>
                        <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '4px' }}>
                          / {product.unit || 'pcs'}
                        </span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#4b5563', backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                        +{product.gst_rate}% GST
                      </span>
                    </div>

                    {/* Actions: Quantity Selector & Add to Cart */}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          backgroundColor: '#ffffff',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(product.id, -1)}
                          style={{
                            border: 'none',
                            background: '#f9fafb',
                            padding: '6px 10px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            color: '#374151',
                          }}
                        >
                          −
                        </button>
                        <span style={{ padding: '0 8px', fontSize: '13px', fontWeight: 600, minWidth: '24px', textAlign: 'center' }}>
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(product.id, 1)}
                          style={{
                            border: 'none',
                            background: '#f9fafb',
                            padding: '6px 10px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            color: '#374151',
                          }}
                        >
                          +
                        </button>
                      </div>

                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleAddToCart(product)}
                        disabled={addingId === product.id}
                        style={{
                          flex: 1,
                          padding: '7px 12px',
                          fontSize: '13px',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                        }}
                      >
                        {addingId === product.id ? (
                          'Adding...'
                        ) : (
                          <>
                            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                            </svg>
                            Add to Cart
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalProducts}
            pageSize={12}
            onPageChange={setPage}
          />
        </>
      )}

      {/* Product Details Modal */}
      {activeProduct && (
        <Modal
          isOpen={Boolean(activeProduct)}
          onClose={() => setActiveProduct(null)}
          title={activeProduct.name}
          maxWidth="640px"
        >
          <div>
            {activeProduct.image_url && (
              <div
                style={{
                  height: '240px',
                  backgroundColor: '#f3f4f6',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  marginBottom: '16px',
                }}
              >
                <img
                  src={activeProduct.image_url}
                  alt={activeProduct.name}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Unit Price</span>
                <span style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>
                  {money(activeProduct.price)}{' '}
                  <span style={{ fontSize: '13px', fontWeight: 400, color: '#6b7280' }}>
                    / {activeProduct.unit || 'pcs'}
                  </span>
                </span>
              </div>
              <div>
                <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Tax Rate</span>
                <span style={{ fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                  {activeProduct.gst_rate}% GST
                </span>
              </div>
              {activeProduct.category && (
                <div>
                  <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>Category</span>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#374151' }}>
                    {activeProduct.category}
                  </span>
                </div>
              )}
              {activeProduct.sku && (
                <div>
                  <span style={{ fontSize: '12px', color: '#6b7280', display: 'block' }}>SKU Code</span>
                  <span style={{ fontSize: '14px', fontFamily: 'monospace', color: '#374151' }}>
                    {activeProduct.sku}
                  </span>
                </div>
              )}
            </div>

            {activeProduct.description && (
              <div style={{ marginBottom: '20px' }}>
                <span style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Description & Specifications
                </span>
                <p style={{ fontSize: '14px', color: '#374151', lineHeight: 1.5, margin: 0 }}>
                  {activeProduct.description}
                </p>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveProduct(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  handleAddToCart(activeProduct)
                  setActiveProduct(null)
                }}
              >
                Add to Cart
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

