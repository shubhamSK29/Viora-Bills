import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { productApi } from '../services/api'
import { useDebounce } from '../hooks/useDebounce'
import { initialProduct } from '../utils/constants'
import { money } from '../utils/formatters'
import Pagination from '../components/common/Pagination'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Modal from '../components/common/Modal'
import ConfirmModal from '../components/common/ConfirmModal'

export default function ProductsPage() {
  const { setError, setSuccess } = useOutletContext()

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const debouncedSearch = useDebounce(searchTerm, 300)

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [deletingProduct, setDeletingProduct] = useState(null)
  const [productForm, setProductForm] = useState(initialProduct)
  const [saving, setSaving] = useState(false)

  const handleToggleProductStatus = async (product) => {
    setError('')
    setSuccess('')
    try {
      const newStatus = product.is_active === false ? true : false
      await productApi.update(product.id, { is_active: newStatus })
      setSuccess(`Product "${product.name}" is now ${newStatus ? 'Active' : 'Inactive'}.`)
      await fetchProducts()
    } catch (err) {
      setError(`Could not update product status: ${err.message}`)
    }
  }

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await productApi.list({
        page,
        limit,
        search: debouncedSearch,
        sort_by: sortBy,
        sort_dir: sortDir,
      })
      const list = data?.items || data?.products || (Array.isArray(data) ? data : [])
      setProducts(list)
      setTotal(data?.total ?? list.length)
      setTotalPages(data?.total_pages ?? 1)
    } catch (err) {
      setError(`Failed to fetch products: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, limit, debouncedSearch, sortBy, sortDir, setError])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchProducts()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchProducts])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        setPage(1)
      }
    })
    return () => {
      ignore = true
    }
  }, [debouncedSearch, sortBy, sortDir])

  async function handleCreateProduct(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const name = productForm.name.trim()
    const price = Number(productForm.price)
    const unit = productForm.unit.trim()
    const gstRate = Number(productForm.gst_rate)

    if (name.length < 2) {
      setError('Product name must contain at least 2 characters.')
      return
    }
    if (isNaN(price) || price <= 0) {
      setError('Price must be a valid positive number.')
      return
    }
    if (!unit) {
      setError('Unit cannot be empty.')
      return
    }

    setSaving(true)
    try {
      await productApi.create({
        name,
        price,
        unit,
        gst_rate: gstRate,
      })
      setProductForm(initialProduct)
      setShowAddModal(false)
      setSuccess('Product added successfully.')
      await fetchProducts()
    } catch (err) {
      setError(`Could not add product: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateProduct(e) {
    e.preventDefault()
    if (!editingProduct?.id) return
    setError('')
    setSuccess('')

    const name = editingProduct.name.trim()
    const price = Number(editingProduct.price)
    const unit = editingProduct.unit.trim()
    const gstRate = Number(editingProduct.gst_rate)

    if (name.length < 2) {
      setError('Product name must contain at least 2 characters.')
      return
    }
    if (isNaN(price) || price <= 0) {
      setError('Price must be a valid positive number.')
      return
    }
    if (!unit) {
      setError('Unit cannot be empty.')
      return
    }

    setSaving(true)
    try {
      await productApi.update(editingProduct.id, {
        name,
        price,
        unit,
        gst_rate: gstRate,
      })
      setEditingProduct(null)
      setSuccess('Product updated successfully.')
      await fetchProducts()
    } catch (err) {
      setError(`Could not update product: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteProduct() {
    if (!deletingProduct?.id) return
    setError('')
    setSuccess('')

    setSaving(true)
    try {
      await productApi.delete(deletingProduct.id)
      setDeletingProduct(null)
      setSuccess('Product removed from catalog.')
      await fetchProducts()
    } catch (err) {
      setError(`Could not delete product: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Top Action Bar */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 className="card-title">Product Catalog</h3>
            <p className="card-desc">
              Manage inventory items, standard pricing, and default GST tax slabs
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setProductForm(initialProduct)
              setShowAddModal(true)
            }}
          >
            + Add Product
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div
          style={{
            marginTop: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', flex: 1, maxWidth: '400px' }}>
            <input
              className="form-control"
              type="search"
              placeholder="Search by product name…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px' }}>
            <span style={{ color: '#64748b' }}>Sort by:</span>
            <select
              className="form-control"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ width: 'auto', padding: '4px 8px', height: '32px' }}
            >
              <option value="name">Name</option>
              <option value="price">Price</option>
              <option value="gst_rate">GST Rate</option>
              <option value="created_at">Date Added</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
              title="Toggle sort direction"
            >
              {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
            </button>
          </div>
        </div>
      </div>

      {/* Product Table Card */}
      <div className="card">
        {loading ? (
          <LoadingSpinner message="Fetching product catalog…" />
        ) : products.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <h4>No products found</h4>
            <p>
              {searchTerm
                ? 'No products match your search query.'
                : 'Build your catalog by adding your first product.'}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddModal(true)}
              style={{ marginTop: '10px' }}
            >
              + Add Product
            </button>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th>Unit Price</th>
                  <th>Unit</th>
                  <th>GST Rate</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{p.name}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>ID: {p.id?.slice(-6)}</div>
                    </td>
                    <td style={{ fontWeight: 600, color: '#2563eb' }}>{money(p.price)}</td>
                    <td>{p.unit}</td>
                    <td>
                      <span
                        style={{
                          fontSize: '12px',
                          padding: '3px 8px',
                          background: '#f1f5f9',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}
                      >
                        {p.gst_rate}%
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '12px',
                          background: p.is_active !== false ? '#dcfce7' : '#f1f5f9',
                          color: p.is_active !== false ? '#15803d' : '#64748b',
                        }}
                      >
                        {p.is_active !== false ? '● ACTIVE' : '○ INACTIVE'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setEditingProduct(p)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{
                            background: p.is_active !== false ? '#fffbeb' : '#ecfdf5',
                            color: p.is_active !== false ? '#b45309' : '#047857',
                            borderColor: p.is_active !== false ? '#fef3c7' : '#a7f3d0',
                          }}
                          onClick={() => handleToggleProductStatus(p)}
                          title={p.is_active !== false ? 'Deactivate product from customer catalogue' : 'Activate product in customer catalogue'}
                        >
                          {p.is_active !== false ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setDeletingProduct(p)}
                          style={{
                            background: '#fee2e2',
                            color: '#dc2626',
                            border: '1px solid #fca5a5',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={setLimit}
          loading={loading}
        />
      </div>

      {/* Add Product Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New Catalog Product"
        maxWidth="500px"
      >
        <form onSubmit={handleCreateProduct}>
          <div className="modal-body" style={{ padding: '24px' }}>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">
                Product / Item Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-control"
                type="text"
                required
                placeholder="e.g. Wireless Barcode Scanner"
                value={productForm.name}
                onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
              />
            </div>

            <div
              className="form-grid"
              style={{ gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}
            >
              <div className="form-group">
                <label className="form-label">
                  Unit Price (₹) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="number"
                  step="0.01"
                  required
                  min="0.01"
                  placeholder="e.g. 1500.00"
                  value={productForm.price}
                  onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Unit of Measure</label>
                <select
                  className="form-control"
                  value={productForm.unit}
                  onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}
                >
                  <option value="Piece">Piece</option>
                  <option value="Box">Box</option>
                  <option value="Kg">Kg</option>
                  <option value="Meter">Meter</option>
                  <option value="Hour">Hour</option>
                  <option value="Service">Service</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">GST Tax Slab</label>
              <select
                className="form-control"
                value={productForm.gst_rate}
                onChange={(e) => setProductForm({ ...productForm, gst_rate: e.target.value })}
              >
                <option value="0">0% (Nil Rated / Exempt)</option>
                <option value="5">5% (Essential Commodities)</option>
                <option value="12">12% (Standard Lower)</option>
                <option value="18">18% (Standard Rate)</option>
                <option value="28">28% (Luxury / De-merit)</option>
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddModal(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add Product'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Product Modal */}
      {editingProduct && (
        <Modal
          isOpen={Boolean(editingProduct)}
          onClose={() => setEditingProduct(null)}
          title={`Edit Product: ${editingProduct.name}`}
          maxWidth="500px"
        >
          <form onSubmit={handleUpdateProduct}>
            <div className="modal-body" style={{ padding: '24px' }}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label">Product Name</label>
                <input
                  className="form-control"
                  type="text"
                  required
                  value={editingProduct.name || ''}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, name: e.target.value })
                  }
                />
              </div>

              <div
                className="form-grid"
                style={{ gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}
              >
                <div className="form-group">
                  <label className="form-label">Price (₹)</label>
                  <input
                    className="form-control"
                    type="number"
                    step="0.01"
                    required
                    min="0.01"
                    value={editingProduct.price || ''}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, price: e.target.value })
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Unit</label>
                  <select
                    className="form-control"
                    value={editingProduct.unit || 'Piece'}
                    onChange={(e) =>
                      setEditingProduct({ ...editingProduct, unit: e.target.value })
                    }
                  >
                    <option value="Piece">Piece</option>
                    <option value="Box">Box</option>
                    <option value="Kg">Kg</option>
                    <option value="Meter">Meter</option>
                    <option value="Hour">Hour</option>
                    <option value="Service">Service</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">GST Tax Slab</label>
                <select
                  className="form-control"
                  value={editingProduct.gst_rate}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, gst_rate: e.target.value })
                  }
                >
                  <option value="0">0%</option>
                  <option value="5">5%</option>
                  <option value="12">12%</option>
                  <option value="18">18%</option>
                  <option value="28">28%</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingProduct(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Updating…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingProduct)}
        onClose={() => setDeletingProduct(null)}
        onConfirm={handleDeleteProduct}
        title="Delete Product"
        message={`Are you sure you want to delete "${deletingProduct?.name}"? Existing invoices referencing this product will retain their historical line items.`}
        confirmText="Yes, Delete"
        loading={saving}
      />
    </div>
  )
}
