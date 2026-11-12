import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { customerApi, invitationApi } from '../services/api'
import { useDebounce } from '../hooks/useDebounce'
import { initialCustomer, INDIAN_STATES, CODE_TO_STATE_MAP } from '../utils/constants'
import { formatDate } from '../utils/formatters'
import Pagination from '../components/common/Pagination'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Modal from '../components/common/Modal'
import ConfirmModal from '../components/common/ConfirmModal'

export default function CustomersPage() {
  const { setError, setSuccess, userRole } = useOutletContext()

  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const debouncedSearch = useDebounce(searchTerm, 300)

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [deletingCustomer, setDeletingCustomer] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [customerForm, setCustomerForm] = useState(initialCustomer)
  const [saving, setSaving] = useState(false)
  const [inviteModalData, setInviteModalData] = useState(null)
  const [copiedLink, setCopiedLink] = useState(false)

  const handleDeleteCustomer = async () => {
    if (!deletingCustomer?.id) return
    setIsDeleting(true)
    setError('')
    setSuccess('')
    try {
      await customerApi.delete(deletingCustomer.id)
      setSuccess(`Customer "${deletingCustomer.name}" was successfully removed.`)
      setDeletingCustomer(null)
      await fetchCustomers()
    } catch (err) {
      setError(`Cannot delete customer: ${err.message}`)
      setDeletingCustomer(null)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleInvite = async (customer) => {
    setError('')
    setSuccess('')
    try {
      const res = await invitationApi.inviteCustomer(customer.id)
      const fullUrl = `${window.location.origin}${res.invitation_link}`
      setInviteModalData({
        ...res,
        fullUrl,
        customerName: customer.name,
      })
      setSuccess(`Invitation token generated for ${customer.name}.`)
    } catch (err) {
      setError(err.message || 'Failed to generate invitation.')
    }
  }

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await customerApi.list({
        page,
        limit,
        search: debouncedSearch,
        sort_by: sortBy,
        sort_dir: sortDir,
      })
      const list = data?.items || data?.customers || (Array.isArray(data) ? data : [])
      setCustomers(list)
      setTotal(data?.total ?? list.length)
      setTotalPages(data?.total_pages ?? 1)
    } catch (err) {
      setError(`Failed to fetch customers: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page, limit, debouncedSearch, sortBy, sortDir, setError])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchCustomers()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchCustomers])

  // Reset to page 1 when search or sort changes
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

  function handleGstinChange(val, isEdit = false) {
    const cleanGstin = val.toUpperCase().trim()
    const prefix = cleanGstin.slice(0, 2)
    const derivedState = CODE_TO_STATE_MAP[prefix] || ''

    if (isEdit) {
      setEditingCustomer((prev) => ({
        ...prev,
        gstin: cleanGstin,
        state_code: prefix.length === 2 ? prefix : prev?.state_code,
        state: derivedState || prev?.state,
      }))
    } else {
      setCustomerForm((prev) => ({
        ...prev,
        gstin: cleanGstin,
        state_code: prefix.length === 2 ? prefix : prev.state_code,
        state: derivedState || prev.state,
      }))
    }
  }

  async function handleCreateCustomer(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const name = customerForm.name.trim()
    if (name.length < 2) {
      setError('Customer name must contain at least 2 characters.')
      return
    }

    setSaving(true)
    try {
      await customerApi.create({
        name,
        business_name: customerForm.business_name?.trim() || null,
        email: customerForm.email?.trim() || null,
        phone: customerForm.phone?.trim() || null,
        address: customerForm.address?.trim() || null,
        state: customerForm.state?.trim() || null,
        state_code: customerForm.state_code?.trim() || null,
        pincode: customerForm.pincode?.trim() || null,
        gstin: customerForm.gstin?.trim() || null,
      })
      setCustomerForm(initialCustomer)
      setShowAddModal(false)
      setSuccess('Customer added successfully.')
      await fetchCustomers()
    } catch (err) {
      setError(`Could not add customer: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateCustomer(e) {
    e.preventDefault()
    if (!editingCustomer?.id) return
    setError('')
    setSuccess('')

    const name = editingCustomer.name.trim()
    if (name.length < 2) {
      setError('Customer name must contain at least 2 characters.')
      return
    }

    setSaving(true)
    try {
      await customerApi.update(editingCustomer.id, {
        name,
        business_name: editingCustomer.business_name ? editingCustomer.business_name.trim() : null,
        email: editingCustomer.email ? editingCustomer.email.trim() : null,
        phone: editingCustomer.phone ? editingCustomer.phone.trim() : null,
        address: editingCustomer.address ? editingCustomer.address.trim() : null,
        state: editingCustomer.state ? editingCustomer.state.trim() : null,
        state_code: editingCustomer.state_code ? editingCustomer.state_code.trim() : null,
        pincode: editingCustomer.pincode ? editingCustomer.pincode.trim() : null,
        gstin: editingCustomer.gstin ? editingCustomer.gstin.trim() : null,
      })
      setEditingCustomer(null)
      setSuccess('Customer updated successfully.')
      await fetchCustomers()
    } catch (err) {
      setError(`Could not update customer: ${err.message}`)
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
            <h3 className="card-title">Customer Directory</h3>
            <p className="card-desc">
              Manage client accounts, billing addresses, and registered GSTIN details
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <a
              href={customerApi.getCsvUrl()}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              title="Export all customers to CSV"
            >
              📥 Export CSV
            </a>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setCustomerForm(initialCustomer)
                setShowAddModal(true)
              }}
            >
              + Add Customer
            </button>
          </div>
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
              placeholder="Search by name, business, GSTIN, phone…"
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
              <option value="business_name">Business Name</option>
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

      {/* Customer Table Card */}
      <div className="card">
        {loading ? (
          <LoadingSpinner message="Fetching customer records…" />
        ) : customers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👥</div>
            <h4>No customers found</h4>
            <p>
              {searchTerm
                ? 'No customer records match your search criteria.'
                : 'Get started by adding your first client.'}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddModal(true)}
              style={{ marginTop: '10px' }}
            >
              + Add Customer
            </button>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer Name</th>
                  <th>Business Name</th>
                  <th>GSTIN</th>
                  <th>Contact</th>
                  <th>State & Region</th>
                  <th>Date Added</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>ID: {c.id?.slice(-6)}</div>
                    </td>
                    <td>{c.business_name || '—'}</td>
                    <td>
                      {c.gstin ? (
                        <span
                          className="mono-text"
                          style={{
                            fontSize: '12px',
                            background: '#f1f5f9',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 600,
                          }}
                        >
                          {c.gstin}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '12px' }}>Unregistered</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: '12px' }}>{c.phone || '—'}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{c.email || ''}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: '13px' }}>{c.state || '—'}</div>
                      {c.state_code && (
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          Code: {c.state_code}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '12px', color: '#64748b' }}>{formatDate(c.created_at)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditingCustomer(c)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ marginLeft: '6px', background: '#f5f3ff', color: '#6d28d9', borderColor: '#ddd6fe' }}
                        onClick={() => handleInvite(c)}
                        title="Generate client portal registration link"
                      >
                        ✉️ Invite
                      </button>
                      {userRole === 'admin' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ marginLeft: '6px', background: '#fef2f2', color: '#dc2626', borderColor: '#fecaca' }}
                          onClick={() => setDeletingCustomer(c)}
                          title="Delete customer record"
                        >
                          🗑️ Delete
                        </button>
                      )}
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

      {/* Add Customer Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New Customer"
        maxWidth="680px"
      >
        <form onSubmit={handleCreateCustomer}>
          <div className="modal-body" style={{ padding: '24px' }}>
            <div
              className="form-grid"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
            >
              <div className="form-group">
                <label className="form-label">
                  Customer / Contact Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="text"
                  required
                  placeholder="e.g. Ramesh Patel"
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Business / Trade Name</label>
                <input
                  className="form-control"
                  type="text"
                  placeholder="e.g. Patel Enterprises"
                  value={customerForm.business_name}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, business_name: e.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label">Customer GSTIN (15 characters)</label>
                <input
                  className="form-control"
                  type="text"
                  maxLength={15}
                  placeholder="e.g. 27AABCU9603R1ZM"
                  value={customerForm.gstin}
                  onChange={(e) => handleGstinChange(e.target.value, false)}
                />
                <small style={{ color: '#64748b', fontSize: '11px', marginTop: '2px' }}>
                  Auto-derives State & Code from prefix
                </small>
              </div>

              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <input
                  className="form-control"
                  type="tel"
                  placeholder="e.g. +91 9876543210"
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  className="form-control"
                  type="email"
                  placeholder="e.g. ramesh@example.com"
                  value={customerForm.email}
                  onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">State</label>
                <select
                  className="form-control"
                  value={customerForm.state}
                  onChange={(e) => setCustomerForm({ ...customerForm, state: e.target.value })}
                >
                  <option value="">Select State</option>
                  {INDIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">State Code (2-digit)</label>
                <input
                  className="form-control"
                  type="text"
                  maxLength={2}
                  placeholder="e.g. 27"
                  value={customerForm.state_code}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, state_code: e.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label">PIN Code</label>
                <input
                  className="form-control"
                  type="text"
                  maxLength={6}
                  placeholder="e.g. 400001"
                  value={customerForm.pincode}
                  onChange={(e) => setCustomerForm({ ...customerForm, pincode: e.target.value })}
                />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Billing Address</label>
                <input
                  className="form-control"
                  type="text"
                  placeholder="Shop/Flat No., Complex, Street, Area"
                  value={customerForm.address}
                  onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                />
              </div>
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
              {saving ? 'Saving…' : 'Add Customer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <Modal
          isOpen={Boolean(editingCustomer)}
          onClose={() => setEditingCustomer(null)}
          title={`Edit Customer: ${editingCustomer.name}`}
          maxWidth="680px"
        >
          <form onSubmit={handleUpdateCustomer}>
            <div className="modal-body" style={{ padding: '24px' }}>
              <div
                className="form-grid"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
              >
                <div className="form-group">
                  <label className="form-label">Customer Name</label>
                  <input
                    className="form-control"
                    type="text"
                    required
                    value={editingCustomer.name || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, name: e.target.value })
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Business Name</label>
                  <input
                    className="form-control"
                    type="text"
                    value={editingCustomer.business_name || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, business_name: e.target.value })
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">GSTIN</label>
                  <input
                    className="form-control"
                    type="text"
                    maxLength={15}
                    value={editingCustomer.gstin || ''}
                    onChange={(e) => handleGstinChange(e.target.value, true)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input
                    className="form-control"
                    type="tel"
                    value={editingCustomer.phone || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, phone: e.target.value })
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-control"
                    type="email"
                    value={editingCustomer.email || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, email: e.target.value })
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">State</label>
                  <select
                    className="form-control"
                    value={editingCustomer.state || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, state: e.target.value })
                    }
                  >
                    <option value="">Select State</option>
                    {INDIAN_STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">State Code</label>
                  <input
                    className="form-control"
                    type="text"
                    maxLength={2}
                    value={editingCustomer.state_code || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, state_code: e.target.value })
                    }
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">PIN Code</label>
                  <input
                    className="form-control"
                    type="text"
                    maxLength={6}
                    value={editingCustomer.pincode || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, pincode: e.target.value })
                    }
                  />
                </div>

                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Billing Address</label>
                  <input
                    className="form-control"
                    type="text"
                    value={editingCustomer.address || ''}
                    onChange={(e) =>
                      setEditingCustomer({ ...editingCustomer, address: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingCustomer(null)}
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
      {/* Customer Portal Invitation Modal */}
      {inviteModalData && (
        <Modal
          title={`✉️ Portal Invitation – ${inviteModalData.customerName}`}
          onClose={() => {
            setInviteModalData(null)
            setCopiedLink(false)
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>
              A single-use, secure invitation link has been generated. Provide this link to the customer so they can set their password and access their bills.
            </p>

            <div className="form-group">
              <label className="form-label">Client Portal Invitation Link</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  className="form-control"
                  value={inviteModalData.fullUrl}
                  style={{ background: '#f8fafc', fontSize: '13px', fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(inviteModalData.fullUrl)
                      setCopiedLink(true)
                      setTimeout(() => setCopiedLink(false), 2500)
                    }
                  }}
                >
                  {copiedLink ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{ background: '#eff6ff', padding: '12px 14px', borderRadius: '8px', fontSize: '12px', color: '#1e40af' }}>
              <div><strong>Recipient Email:</strong> {inviteModalData.email}</div>
              <div style={{ marginTop: '2px' }}><strong>Expires:</strong> {inviteModalData.expires_at ? inviteModalData.expires_at.replace('T', ' ').slice(0, 16) : '7 Days'}</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setInviteModalData(null)
                  setCopiedLink(false)
                }}
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Customer Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingCustomer)}
        onClose={() => setDeletingCustomer(null)}
        onConfirm={handleDeleteCustomer}
        title="Delete Customer"
        message={`Are you sure you want to delete customer "${deletingCustomer?.name}"? Note: If this customer has existing tax invoices or orders, deletion will be blocked by system governance to preserve GST financial audit records.`}
        confirmText={isDeleting ? 'Deleting…' : 'Delete Customer'}
        danger
      />
    </div>
  )
}
