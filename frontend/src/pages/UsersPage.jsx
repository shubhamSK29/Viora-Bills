import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { usersApi } from '../services/api'
import { useDebounce } from '../hooks/useDebounce'
import { formatDate } from '../utils/formatters'
import Pagination from '../components/common/Pagination'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Modal from '../components/common/Modal'
import ConfirmModal from '../components/common/ConfirmModal'

export default function UsersPage() {
  const { currentUser, userRole, setError, setSuccess } = useOutletContext()

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')

  const debouncedSearch = useDebounce(searchTerm, 300)

  // Creation form
  const [userForm, setUserForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'staff',
    is_active: true,
  })

  // Modals
  const [editingUser, setEditingUser] = useState(null)
  const [resetModalUser, setResetModalUser] = useState(null)
  const [newPasswordValue, setNewPasswordValue] = useState('')
  const [deletingUser, setDeletingUser] = useState(null)
  const [saving, setSaving] = useState(false)

  const fetchUsers = useCallback(async () => {
    if (userRole !== 'admin') return
    setLoading(true)
    try {
      const data = await usersApi.list({
        page,
        limit,
        search: debouncedSearch,
        role: roleFilter !== 'ALL' ? roleFilter : undefined,
      })
      const list = data?.items || data?.users || (Array.isArray(data) ? data : [])
      setUsers(list)
      setTotal(data?.total ?? list.length)
      setTotalPages(data?.total_pages ?? 1)
    } catch (err) {
      setError(`Failed to fetch users: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [userRole, page, limit, debouncedSearch, roleFilter, setError])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchUsers()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchUsers])

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
  }, [debouncedSearch, roleFilter])

  async function handleCreateUser(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const fullName = userForm.full_name.trim()
    const email = userForm.email.trim().toLowerCase()
    const password = userForm.password

    if (!fullName || !email || !password) {
      setError('Full name, email, and password are required.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    const hasUpper = /[A-Z]/.test(password)
    const hasLower = /[a-z]/.test(password)
    const hasDigit = /[0-9]/.test(password)
    if (!hasUpper || !hasLower || !hasDigit) {
      setError('Password must contain at least one uppercase letter, one lowercase letter, and one number.')
      return
    }

    setSaving(true)
    try {
      await usersApi.create({
        full_name: fullName,
        email,
        password,
        role: userForm.role,
        is_active: userForm.is_active,
      })
      setUserForm({
        full_name: '',
        email: '',
        password: '',
        role: 'staff',
        is_active: true,
      })
      setSuccess(`User account created for ${email}.`)
      await fetchUsers()
    } catch (err) {
      setError(`Could not create user: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateUser(e) {
    e.preventDefault()
    if (!editingUser?.id) return
    setError('')
    setSuccess('')

    setSaving(true)
    try {
      await usersApi.update(editingUser.id, {
        full_name: editingUser.full_name?.trim() || null,
        role: editingUser.role,
        is_active: editingUser.is_active,
      })
      setEditingUser(null)
      setSuccess('User updated successfully.')
      await fetchUsers()
    } catch (err) {
      setError(`Could not update user: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleUserStatus(u) {
    setError('')
    setSuccess('')
    if (u.id === currentUser?.id) {
      setError('You cannot deactivate your own account.')
      return
    }

    try {
      await usersApi.update(u.id, { is_active: !u.is_active })
      setSuccess(`User ${u.email} is now ${u.is_active ? 'deactivated' : 'activated'}.`)
      await fetchUsers()
    } catch (err) {
      setError(`Could not update status: ${err.message}`)
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    if (!resetModalUser?.id || !newPasswordValue) return
    setError('')
    setSuccess('')

    if (newPasswordValue.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    const hasUpper = /[A-Z]/.test(newPasswordValue)
    const hasLower = /[a-z]/.test(newPasswordValue)
    const hasDigit = /[0-9]/.test(newPasswordValue)
    if (!hasUpper || !hasLower || !hasDigit) {
      setError('Password must contain at least one uppercase letter, one lowercase letter, and one number.')
      return
    }

    setSaving(true)
    try {
      await usersApi.resetPassword(resetModalUser.id, newPasswordValue)
      setSuccess(`Password for ${resetModalUser.email} has been reset successfully.`)
      setResetModalUser(null)
      setNewPasswordValue('')
    } catch (err) {
      setError(`Failed to reset password: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteUserConfirm() {
    if (!deletingUser?.id) return
    setError('')
    setSuccess('')

    setSaving(true)
    try {
      await usersApi.delete(deletingUser.id)
      setSuccess(`User ${deletingUser.email} permanently deleted.`)
      setDeletingUser(null)
      await fetchUsers()
    } catch (err) {
      setError(`Could not delete user: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const activeCount = users.filter((u) => u.is_active).length
  const staffCount = users.filter((u) => u.role === 'staff').length

  return (
    <div>
      {/* Top Stats Cards */}
      <div className="stats-grid" style={{ marginBottom: '24px' }}>
        <div className="stat-card">
          <span className="stat-label">Total Registered Accounts</span>
          <span className="stat-value">{total}</span>
          <span className="stat-sub">System authentication identities</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Users (On Page)</span>
          <span className="stat-value" style={{ color: '#16a34a' }}>
            {activeCount}
          </span>
          <span className="stat-sub">Permitted to sign in</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Staff Members (On Page)</span>
          <span className="stat-value" style={{ color: '#2563eb' }}>
            {staffCount}
          </span>
          <span className="stat-sub">Standard billing access</span>
        </div>
      </div>

      {/* Create User Form Card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <div>
            <h3 className="card-title">Provision New User Account</h3>
            <p className="card-desc">
              Create staff or administrator accounts with secure Argon2id credentials
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateUser}>
          <div
            className="form-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
          >
            <div className="form-group">
              <label className="form-label">
                Full Name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-control"
                type="text"
                required
                placeholder="e.g. Rahul Sharma"
                value={userForm.full_name}
                onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Email Address <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-control"
                type="email"
                required
                placeholder="e.g. rahul@viorabills.com"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Initial Password <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-control"
                type="password"
                required
                minLength={6}
                placeholder="At least 6 characters"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Account Role</label>
              <select
                className="form-control"
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
              >
                <option value="staff">Staff (Billing & Invoices)</option>
                <option value="admin">Administrator (Full Access)</option>
              </select>
            </div>
          </div>

          <div
            style={{
              marginTop: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                color: '#334155',
              }}
            >
              <input
                type="checkbox"
                checked={userForm.is_active}
                onChange={(e) => setUserForm({ ...userForm, is_active: e.target.checked })}
                style={{ width: '16px', height: '16px' }}
              />
              <span>Account enabled for sign-in immediately</span>
            </label>

            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Creating Account…' : '+ Create User Account'}
            </button>
          </div>
        </form>
      </div>

      {/* Users List Table Card */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 className="card-title">Registered System Users</h3>
            <p className="card-desc">All user accounts with RBAC roles and authentication status</p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="form-control"
              type="search"
              placeholder="Search name, email…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '200px' }}
            />
            <select
              className="form-control"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              style={{ width: 'auto', padding: '4px 8px', height: '32px' }}
            >
              <option value="ALL">All Roles</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </select>
          </div>
        </div>

        {loading ? (
          <LoadingSpinner message="Fetching user identities…" />
        ) : users.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👤</div>
            <h4>No user accounts found</h4>
            <p>{searchTerm ? 'No users match your search query.' : 'No staff accounts exist yet.'}</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User / Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === currentUser?.id
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>
                          {u.full_name || '—'}{' '}
                          {isSelf && (
                            <span style={{ fontSize: '11px', color: '#2563eb' }}>(You)</span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>{u.email}</div>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            background: u.role === 'admin' ? '#dbeafe' : '#e0f2fe',
                            color: u.role === 'admin' ? '#1e40af' : '#0369a1',
                          }}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: u.is_active ? '#16a34a' : '#dc2626',
                          }}
                        >
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: u.is_active ? '#16a34a' : '#dc2626',
                            }}
                          />
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ fontSize: '13px', color: '#64748b' }}>
                        {formatDate(u.created_at)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div
                          style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}
                        >
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditingUser(u)}
                            style={{ padding: '4px 8px', fontSize: '12px' }}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setResetModalUser(u)
                              setNewPasswordValue('')
                            }}
                            style={{ padding: '4px 8px', fontSize: '12px' }}
                          >
                            🔑 Reset
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleToggleUserStatus(u)}
                            disabled={isSelf}
                            style={{
                              padding: '4px 8px',
                              fontSize: '12px',
                              opacity: isSelf ? 0.5 : 1,
                            }}
                          >
                            {u.is_active ? '⏸ Deactivate' : '▶ Activate'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => setDeletingUser(u)}
                            disabled={isSelf}
                            style={{
                              padding: '4px 8px',
                              fontSize: '12px',
                              background: '#fee2e2',
                              color: '#dc2626',
                              border: '1px solid #fca5a5',
                              opacity: isSelf ? 0.5 : 1,
                            }}
                          >
                            🗑 Delete
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

      {/* Edit User Modal */}
      {editingUser && (
        <Modal
          isOpen={Boolean(editingUser)}
          onClose={() => setEditingUser(null)}
          title={`Edit User: ${editingUser.email}`}
          maxWidth="480px"
        >
          <form onSubmit={handleUpdateUser}>
            <div className="modal-body" style={{ padding: '24px' }}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label">Full Name</label>
                <input
                  className="form-control"
                  type="text"
                  required
                  value={editingUser.full_name || ''}
                  onChange={(e) =>
                    setEditingUser({ ...editingUser, full_name: e.target.value })
                  }
                />
              </div>

              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label">Account Role</label>
                <select
                  className="form-control"
                  value={editingUser.role}
                  disabled={editingUser.id === currentUser?.id}
                  onChange={(e) =>
                    setEditingUser({ ...editingUser, role: e.target.value })
                  }
                >
                  <option value="staff">Staff (Billing & Invoices)</option>
                  <option value="admin">Administrator (Full Access)</option>
                </select>
                {editingUser.id === currentUser?.id && (
                  <small style={{ color: '#64748b', marginTop: '4px', display: 'block' }}>
                    You cannot change your own role to prevent accidental lockout.
                  </small>
                )}
              </div>

              <div className="form-group">
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editingUser.is_active}
                    disabled={editingUser.id === currentUser?.id}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, is_active: e.target.checked })
                    }
                    style={{ width: '16px', height: '16px' }}
                  />
                  <span>Account Active (Allowed to sign in)</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingUser(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reset Staff Password Modal */}
      {resetModalUser && (
        <Modal
          isOpen={Boolean(resetModalUser)}
          onClose={() => setResetModalUser(null)}
          title="Reset User Password"
          maxWidth="440px"
        >
          <form onSubmit={handleResetPassword}>
            <div className="modal-body" style={{ padding: '24px' }}>
              <p style={{ color: '#475569', fontSize: '14px', margin: '0 0 16px' }}>
                Setting a new password for: <strong>{resetModalUser.full_name || resetModalUser.email}</strong> (
                <code>{resetModalUser.email}</code>)
              </p>
              <div className="form-group">
                <label className="form-label">
                  New Password <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  className="form-control"
                  type="password"
                  required
                  minLength={6}
                  autoFocus
                  placeholder="Minimum 6 characters"
                  value={newPasswordValue}
                  onChange={(e) => setNewPasswordValue(e.target.value)}
                />
                <small style={{ color: '#64748b', marginTop: '4px', display: 'block' }}>
                  The user will need to use this new password on their next sign in.
                </small>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setResetModalUser(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !newPasswordValue}
              >
                {saving ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete User Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingUser)}
        onClose={() => setDeletingUser(null)}
        onConfirm={handleDeleteUserConfirm}
        title="Delete User Account"
        message={`Are you sure you want to permanently delete user "${deletingUser?.full_name || deletingUser?.email}"? This action cannot be undone.`}
        confirmText="Yes, Delete User"
        loading={saving}
      />
    </div>
  )
}
