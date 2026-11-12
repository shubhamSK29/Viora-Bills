const API_BASE_URL =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE_URL) ||
  'http://127.0.0.1:8000'

// ─── Token Storage ──────────────────────────────────────────────────────────
const TOKEN_KEY = 'viora_access_token'
const USER_KEY  = 'viora_user'

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function storeSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

// ─── Core Request Helper ────────────────────────────────────────────────────
export async function apiRequest(path, options = {}) {
  const token = getStoredToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  const data = await response.json().catch(() => null)

  if (response.status === 401) {
    // Token expired or invalid – clear session and reload to login
    clearSession()
    window.location.reload()
    return
  }

  if (!response.ok) {
    const message =
      data?.detail ||
      data?.message ||
      `Request failed with status ${response.status}`
    throw new Error(
      typeof message === 'string' ? message : JSON.stringify(message)
    )
  }

  return data
}

// ─── Auth API ───────────────────────────────────────────────────────────────
export const authApi = {
  login: (email, password) =>
    fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(async (res) => {
      const data = await res.json()
      if (!res.ok) {
        throw new Error(
          typeof data?.detail === 'string'
            ? data.detail
            : JSON.stringify(data?.detail) || 'Login failed'
        )
      }
      return data
    }),

  logout: () => apiRequest('/auth/logout', { method: 'POST' }),

  me: () => apiRequest('/auth/me'),

  changePassword: (currentPassword, newPassword) =>
    apiRequest('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    }),

  sendOtp: (email, purpose = 'VERIFICATION') =>
    apiRequest('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email, purpose }),
    }),

  verifyOtpAndSetPassword: ({ email, otp, password, token, full_name }) =>
    apiRequest('/auth/verify-otp-and-set-password', {
      method: 'POST',
      body: JSON.stringify({ email, otp, password, token, full_name }),
    }),

  forgotPassword: (email) =>
    apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPasswordWithOtp: (email, otp, newPassword) =>
    apiRequest('/auth/reset-password-with-otp', {
      method: 'POST',
      body: JSON.stringify({
        email,
        otp,
        new_password: newPassword,
      }),
    }),

  sendRegistrationOtp: (email, fullName = '') =>
    apiRequest('/auth/send-registration-otp', {
      method: 'POST',
      body: JSON.stringify({ email, full_name: fullName }),
    }),

  register: (payload) =>
    apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  requestEmailChange: (newEmail) =>
    apiRequest('/auth/request-email-change', {
      method: 'POST',
      body: JSON.stringify({ new_email: newEmail }),
    }),

  verifyEmailChange: (newEmail, otp) =>
    apiRequest('/auth/verify-email-change', {
      method: 'POST',
      body: JSON.stringify({ new_email: newEmail, otp }),
    }),
}

function buildQueryString(params = {}) {
  const sp = new URLSearchParams()
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        sp.append(k, v)
      }
    })
  }
  const str = sp.toString()
  return str ? `?${str}` : ''
}

// ─── User Management API (Admin) ────────────────────────────────────────────
export const usersApi = {
  list: (params = {}) => apiRequest(`/users${buildQueryString(params)}`),

  getById: (id) => apiRequest(`/users/${encodeURIComponent(id)}`),

  create: (user) =>
    apiRequest('/users', {
      method: 'POST',
      body: JSON.stringify(user),
    }),

  update: (id, updates) =>
    apiRequest(`/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  resetPassword: (id, newPassword) =>
    apiRequest(`/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    }),

  delete: (id) =>
    apiRequest(`/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
}

// ─── Customer API ───────────────────────────────────────────────────────────
export const customerApi = {
  list: (params = {}) => {
    const defaultParams = { limit: 20, page: 1 }
    const merged = typeof params === 'object' && Object.keys(params).length > 0 ? params : defaultParams
    return apiRequest(`/customers${buildQueryString(merged)}`)
  },

  search: (query) =>
    apiRequest(`/customers/search?q=${encodeURIComponent(query)}`),

  create: (customer) =>
    apiRequest('/customers', {
      method: 'POST',
      body: JSON.stringify(customer),
    }),

  update: (id, customer) =>
    apiRequest(`/customers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(customer),
    }),

  get: (id) => apiRequest(`/customers/${encodeURIComponent(id)}`),

  delete: (id) =>
    apiRequest(`/customers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getCsvUrl: () => `${API_BASE_URL}/customers/csv`,
}

// ─── Product API ────────────────────────────────────────────────────────────
export const productApi = {
  list: (params = {}) => {
    const defaultParams = { limit: 20, page: 1 }
    const merged = typeof params === 'object' && Object.keys(params).length > 0 ? params : defaultParams
    return apiRequest(`/products${buildQueryString(merged)}`)
  },

  create: (product) =>
    apiRequest('/products', {
      method: 'POST',
      body: JSON.stringify(product),
    }),

  update: (id, product) =>
    apiRequest(`/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(product),
    }),

  delete: (id) =>
    apiRequest(`/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
}

// ─── Invoice API ────────────────────────────────────────────────────────────
export const invoiceApi = {
  list: (params = {}) => {
    const defaultParams = { limit: 20, page: 1 }
    const merged = typeof params === 'object' && Object.keys(params).length > 0 ? params : defaultParams
    return apiRequest(`/invoices${buildQueryString(merged)}`)
  },

  get: (id) => apiRequest(`/invoices/${encodeURIComponent(id)}`),
  getById: (id) => apiRequest(`/invoices/${encodeURIComponent(id)}`),

  getNextNumber: () => apiRequest('/invoices/next-number'),

  getPdfUrl: (id) => `${API_BASE_URL}/invoices/${encodeURIComponent(id)}/pdf?token=${getStoredToken() || ''}`,

  downloadPdf: async (id, invoiceNumber = 'invoice') => {
    const token = getStoredToken()
    const res = await fetch(`${API_BASE_URL}/invoices/${encodeURIComponent(id)}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Failed to download invoice PDF')
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Invoice-${invoiceNumber}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  },

  getCsvUrl: () => `${API_BASE_URL}/invoices/csv?token=${getStoredToken() || ''}`,

  getPaymentStatus: (id) => apiRequest(`/invoices/${encodeURIComponent(id)}/payment-status`),

  create: (invoice) =>
    apiRequest('/invoices', {
      method: 'POST',
      body: JSON.stringify(invoice),
    }),
}

// ─── Payment API ────────────────────────────────────────────────────────────
export const paymentApi = {
  list: (params = {}) => {
    const defaultParams = { limit: 20, page: 1 }
    const merged = typeof params === 'object' && Object.keys(params).length > 0 ? params : defaultParams
    return apiRequest(`/payments${buildQueryString(merged)}`)
  },

  getCsvUrl: () => `${API_BASE_URL}/payments/csv?token=${getStoredToken() || ''}`,

  create: (payment) =>
    apiRequest('/payments', {
      method: 'POST',
      body: JSON.stringify(payment),
    }),

  getSummary: () => apiRequest('/payments/summary'),

  submitUpiReference: (invoiceId, payload) =>
    apiRequest(`/customer/invoices/${invoiceId}/submit-upi`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitCardPayment: (invoiceId, payload) =>
    apiRequest(`/customer/invoices/${invoiceId}/submit-card`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getCardConfig: () => apiRequest('/payments/card/config'),

  updateStatus: (id, { new_status, reason }) =>
    apiRequest(`/payments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ new_status, reason }),
    }),

  createCardOrder: (payload) =>
    apiRequest('/payments/card/create-order', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyCardPayment: (payload) =>
    apiRequest('/payments/card/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getReceipt: (id) => apiRequest(`/payments/${id}/receipt`),

  getReceiptPdfUrl: (paymentId) =>
    `${API_BASE_URL}/payments/${encodeURIComponent(paymentId)}/receipt/pdf?token=${getStoredToken() || ''}`,

  downloadReceiptPdf: async (paymentId, receiptNumber = 'receipt') => {
    if (!paymentId) throw new Error('Missing payment ID for receipt download')
    const token = getStoredToken() || ''
    const url = `${API_BASE_URL}/payments/${encodeURIComponent(paymentId)}/receipt/pdf?token=${encodeURIComponent(token)}`
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      const errJson = await res.json().catch(() => null)
      throw new Error(errJson?.detail || 'Failed to download payment receipt PDF')
    }
    const blob = await res.blob()
    const urlBlob = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = urlBlob
    a.download = `Receipt-${receiptNumber}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(urlBlob)
  },
}

// ─── Company Settings API ───────────────────────────────────────────────────
export const companySettingsApi = {
  get: () => apiRequest('/settings/company'),
  getPublic: () => apiRequest('/settings/company/public'),
  update: (settings) =>
    apiRequest('/settings/company', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  getSmtpStatus: () => apiRequest('/settings/smtp/status'),

  testSmtpConnection: (recipientEmail) =>
    apiRequest('/settings/smtp/test', {
      method: 'POST',
      body: JSON.stringify({ recipient_email: recipientEmail }),
    }),
}

// ─── Reports API ────────────────────────────────────────────────────────────
export const reportsApi = {
  getSalesSummary: (startDate, endDate) => {
    const params = new URLSearchParams()
    if (startDate) params.append('start_date', startDate)
    if (endDate) params.append('end_date', endDate)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return apiRequest(`/reports/sales-summary${qs}`)
  },

  getGstReport: (startDate, endDate) => {
    const params = new URLSearchParams()
    if (startDate) params.append('start_date', startDate)
    if (endDate) params.append('end_date', endDate)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return apiRequest(`/reports/gst${qs}`)
  },

  getGstCsvUrl: (startDate, endDate) => {
    const params = new URLSearchParams()
    if (startDate) params.append('start_date', startDate)
    if (endDate) params.append('end_date', endDate)
    params.append('token', getStoredToken() || '')
    return `${API_BASE_URL}/reports/gst/csv?${params.toString()}`
  },

  getAging: (asOfDate, customerId) => {
    const params = new URLSearchParams()
    if (asOfDate) params.append('as_of_date', asOfDate)
    if (customerId) params.append('customer_id', customerId)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return apiRequest(`/reports/aging${qs}`)
  },
}

// ─── Health API ─────────────────────────────────────────────────────────────
export const healthApi = {
  check: () => apiRequest('/health'),
}

// ─── Dashboard APIs (Role-Based) ───────────────────────────────────────────
export const dashboardApi = {
  getAdmin: () => apiRequest('/admin/dashboard'),
  getStaff: () => apiRequest('/staff/dashboard'),
  getCustomer: (customerId) => {
    const qs = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ''
    return apiRequest(`/customer/dashboard${qs}`)
  },
}

// ─── Customer Self-Service Portal API ──────────────────────────────────────
export const customerPortalApi = {
  getInvoices: (params = {}) => {
    const query = new URLSearchParams()
    if (params.page) query.append('page', params.page)
    if (params.limit) query.append('limit', params.limit)
    if (params.status && params.status !== 'ALL') query.append('status', params.status)
    if (params.search) query.append('search', params.search)
    const qs = query.toString() ? `?${query.toString()}` : ''
    return apiRequest(`/customer/invoices${qs}`)
  },

  getPayments: (params = {}) => {
    const query = new URLSearchParams()
    if (params.page) query.append('page', params.page)
    if (params.limit) query.append('limit', params.limit)
    const qs = query.toString() ? `?${query.toString()}` : ''
    return apiRequest(`/customer/payments${qs}`)
  },

  getProfile: () => apiRequest('/customer/profile'),

  updateProfile: (data) =>
    apiRequest('/customer/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
}

// ─── Customer Invitation & Account Linking API ─────────────────────────────
export const invitationApi = {
  inviteCustomer: (customerId) =>
    apiRequest(`/customers/${customerId}/invite`, { method: 'POST' }),

  verifyInvite: (token) =>
    fetch(`${API_BASE_URL}/auth/verify-invite?token=${encodeURIComponent(token)}`).then(
      async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data?.detail || 'Invalid or expired invitation.')
        return data
      }
    ),

  acceptInvite: (payload) =>
    fetch(`${API_BASE_URL}/auth/accept-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(async (res) => {
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || 'Failed to complete registration.')
      return data
    }),
}

// ─── In-App Notifications API ──────────────────────────────────────────────
export const notificationApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiRequest(`/notifications${qs ? `?${qs}` : ''}`)
  },

  markRead: (id) =>
    apiRequest(`/notifications/${id}/read`, {
      method: 'PUT',
    }),

  markAllRead: () =>
    apiRequest('/notifications/read-all', {
      method: 'PUT',
    }),
}

// ─── Audit Trail API (Admin Only) ──────────────────────────────────────────
export const auditLogApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiRequest(`/audit-logs${qs ? `?${qs}` : ''}`)
  },
}

// ─── Customer Catalogue API ────────────────────────────────────────────────
export const catalogueApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiRequest(`/customer/catalogue${qs ? `?${qs}` : ''}`)
  },
  get: (id) => apiRequest(`/customer/catalogue/${id}`),
}

// ─── Shopping Cart API ─────────────────────────────────────────────────────
export const cartApi = {
  get: () => apiRequest('/customer/cart'),
  addItem: (productId, quantity = 1) =>
    apiRequest('/customer/cart/items', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, quantity }),
    }),
  updateItem: (productId, quantity) =>
    apiRequest(`/customer/cart/items/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }),
  removeItem: (productId) =>
    apiRequest(`/customer/cart/items/${productId}`, {
      method: 'DELETE',
    }),
  clear: () =>
    apiRequest('/customer/cart', {
      method: 'DELETE',
    }),
}

// ─── Orders API (Customer & Staff/Admin) ───────────────────────────────────
export const ordersApi = {
  // Customer endpoints
  placeOrder: (data = {}) =>
    apiRequest('/customer/orders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getCustomerOrders: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiRequest(`/customer/orders${qs ? `?${qs}` : ''}`)
  },
  getCustomerOrderDetail: (id) => apiRequest(`/customer/orders/${id}`),
  cancelOrder: (id, reason = '') =>
    apiRequest(`/customer/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  getPurchases: () => apiRequest('/customer/purchases'),

  // Business Management (Admin / Staff)
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return apiRequest(`/orders${qs ? `?${qs}` : ''}`)
  },
  get: (id) => apiRequest(`/orders/${id}`),
  review: (id, notes = '') =>
    apiRequest(`/orders/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  accept: (id, notes = '') =>
    apiRequest(`/orders/${id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  reject: (id, reason) =>
    apiRequest(`/orders/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  generateInvoice: (id) =>
    apiRequest(`/orders/${id}/generate-invoice`, {
      method: 'POST',
    }),
  getOrderPdfUrl: (id) => `${API_BASE_URL}/orders/${encodeURIComponent(id)}/pdf?token=${getStoredToken() || ''}`,
  downloadPdf: async (id, orderNumber = 'order') => {
    const token = getStoredToken()
    const res = await fetch(`${API_BASE_URL}/orders/${encodeURIComponent(id)}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Failed to download order summary PDF')
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Order-${orderNumber}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  },
}

// ─── Payment Schedules API ─────────────────────────────────────────────────
export const paymentScheduleApi = {
  list: (params = {}) => apiRequest(`/payment-schedules${buildQueryString(params)}`),
  getById: (id) => apiRequest(`/payment-schedules/${encodeURIComponent(id)}`),
  create: (schedule) =>
    apiRequest('/payment-schedules', {
      method: 'POST',
      body: JSON.stringify(schedule),
    }),
  update: (id, updates) =>
    apiRequest(`/payment-schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  cancel: (id) =>
    apiRequest(`/payment-schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  complete: (id) =>
    apiRequest(`/payment-schedules/${encodeURIComponent(id)}/complete`, {
      method: 'PATCH',
    }),
}

// ─── Product Image Upload API ──────────────────────────────────────────────
export const productImageApi = {
  upload: (imageData, filename = 'product.png') =>
    apiRequest('/products/upload-image', {
      method: 'POST',
      body: JSON.stringify({ image_data: imageData, filename }),
    }),
}

// ─── Email Delivery Audit Logs API ─────────────────────────────────────────
export const emailDeliveryApi = {
  getLogs: (params = {}) => apiRequest(`/emails/delivery-logs${buildQueryString(params)}`),
  retryEmail: (logId) =>
    apiRequest(`/emails/delivery-logs/${encodeURIComponent(logId)}/retry`, {
      method: 'POST',
    }),
}


