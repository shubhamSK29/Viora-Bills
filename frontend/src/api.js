
const API_BASE_URL = 'http://127.0.0.1:8000'

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const data = await response.json().catch(() => null)

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

export const customerApi = {
  list: () => apiRequest('/customers?limit=100&skip=0'),

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
}

export const productApi = {
  list: () => apiRequest('/products?limit=100&skip=0'),

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

export const invoiceApi = {
  list: () => apiRequest('/invoices?limit=100&skip=0'),

  create: (invoice) =>
    apiRequest('/invoices', {
      method: 'POST',
      body: JSON.stringify(invoice),
    }),
}


export const paymentApi = {
  list: () => apiRequest('/payments?limit=100&skip=0'),

  create: (payment) =>
    apiRequest('/payments', {
      method: 'POST',
      body: JSON.stringify(payment),
    }),
}
