
import { useEffect, useState } from 'react'
import {
  customerApi,
  productApi,
  invoiceApi,
  paymentApi,
} from './api'
import './App.css'

const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)

const initialCustomer = {
  name: '',
  email: '',
  phone: '',
  address: '',
}

const initialProduct = {
  name: '',
  price: '',
  unit: 'Piece',
  gst_rate: '18',
}

const initialPayment = {
  invoice_id: '',
  amount: '',
  payment_method: 'UPI',
  reference: '',
  notes: '',
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  border: '1px solid #d7dce5',
  borderRadius: '8px',
  fontSize: '14px',
  background: '#fff',
  color: '#172033',
}

const buttonStyle = {
  padding: '10px 15px',
  border: 'none',
  borderRadius: '8px',
  background: '#3157d5',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
}

const secondaryButtonStyle = {
  ...buttonStyle,
  background: '#eef2ff',
  color: '#3157d5',
}

const panelStyle = {
  background: '#fff',
  border: '1px solid #e5e9f0',
  borderRadius: '12px',
  padding: '20px',
  marginBottom: '20px',
}

const fieldLabelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: '#4b5568',
  marginBottom: '6px',
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: '600px',
}

const cellStyle = {
  padding: '13px 12px',
  borderBottom: '1px solid #edf0f5',
  textAlign: 'left',
  fontSize: '14px',
  verticalAlign: 'middle',
}

function App() {
  const [activePage, setActivePage] = useState('Dashboard')

  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [invoices, setInvoices] = useState([])
  const [payments, setPayments] = useState([])

  const [customerForm, setCustomerForm] = useState(initialCustomer)
  const [productForm, setProductForm] = useState(initialProduct)
  const [paymentForm, setPaymentForm] = useState(initialPayment)

  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [invoiceItems, setInvoiceItems] = useState([
    { product_id: '', quantity: 1 },
  ])
  const [discount, setDiscount] = useState('0')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadCustomers() {
    const data = await customerApi.list()
    setCustomers(Array.isArray(data) ? data : data?.customers || [])
  }

  async function loadProducts() {
    const data = await productApi.list()
    setProducts(Array.isArray(data) ? data : data?.products || [])
  }

  async function loadInvoices() {
    const data = await invoiceApi.list()
    setInvoices(Array.isArray(data) ? data : data?.invoices || [])
  }

  async function loadPayments() {
    const data = await paymentApi.list()
    setPayments(Array.isArray(data) ? data : data?.payments || [])
  }

  async function loadAllData() {
    setLoading(true)
    setError('')

    try {
      await Promise.all([
        loadCustomers(),
        loadProducts(),
        loadInvoices(),
        loadPayments(),
      ])
    } catch (err) {
      setError(`Could not load data: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAllData()
  }, [])

  function navigate(page) {
    setActivePage(page)
    setError('')
    setSuccess('')
  }

  async function handleCreateCustomer(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    try {
      await customerApi.create(customerForm)
      setCustomerForm(initialCustomer)
      await loadCustomers()
      setSuccess('Customer added successfully.')
    } catch (err) {
      setError(`Could not add customer: ${err.message}`)
    }
  }

  async function handleCreateProduct(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    const price = Number(productForm.price)
    const gstRate = Number(productForm.gst_rate)

    if (!productForm.name.trim()) {
      setError('Please enter a product name.')
      return
    }

    if (!Number.isFinite(price) || price < 0) {
      setError('Please enter a valid product price.')
      return
    }

    try {
      await productApi.create({
        name: productForm.name.trim(),
        price,
        unit: productForm.unit,
        gst_rate: gstRate,
      })

      setProductForm(initialProduct)
      await loadProducts()
      setSuccess('Product added successfully.')
    } catch (err) {
      setError(`Could not add product: ${err.message}`)
    }
  }

  function updateInvoiceItem(index, field, value) {
    setInvoiceItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item

        return {
          ...item,
          [field]:
            field === 'quantity'
              ? Math.max(1, Number(value) || 1)
              : value,
        }
      })
    )
  }

  function addInvoiceItem() {
    setInvoiceItems((current) => [
      ...current,
      { product_id: '', quantity: 1 },
    ])
  }

  function removeInvoiceItem(index) {
    setInvoiceItems((current) =>
      current.length === 1
        ? current
        : current.filter((_, itemIndex) => itemIndex !== index)
    )
  }

  const calculatedItems = invoiceItems.map((item) => {
    const product = products.find((p) => p.id === item.product_id)
    const quantity = Number(item.quantity) || 1
    const unitPrice = Number(product?.price) || 0
    const gstRate = Number(product?.gst_rate) || 0
    const subtotal = unitPrice * quantity
    const gstAmount = (subtotal * gstRate) / 100

    return {
      ...item,
      product,
      quantity,
      unitPrice,
      gstRate,
      subtotal,
      gstAmount,
      total: subtotal + gstAmount,
    }
  })

  const invoiceSubtotal = calculatedItems.reduce(
    (sum, item) => sum + item.subtotal,
    0
  )

  const invoiceGst = calculatedItems.reduce(
    (sum, item) => sum + item.gstAmount,
    0
  )

  const discountAmount = Math.min(
    invoiceSubtotal,
    Math.max(0, Number(discount) || 0)
  )

  const invoiceTotal = Math.max(
    0,
    invoiceSubtotal - discountAmount + invoiceGst
  )

  async function handleCreateInvoice(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!selectedCustomer) {
      setError('Please select a customer.')
      return
    }

    if (invoiceItems.some((item) => !item.product_id)) {
      setError('Please select a product for every invoice row.')
      return
    }

    if (
      new Set(invoiceItems.map((item) => item.product_id)).size !==
      invoiceItems.length
    ) {
      setError(
        'Please use each product only once. Adjust its quantity instead.'
      )
      return
    }

    if (Number(discount) < 0 || !Number.isFinite(Number(discount))) {
      setError('Please enter a valid discount.')
      return
    }

    if (Number(discount) > invoiceSubtotal) {
      setError('Discount cannot exceed the subtotal.')
      return
    }

    setSaving(true)

    try {
      await invoiceApi.create({
        customer_id: selectedCustomer,
        items: invoiceItems.map((item) => ({
          product_id: item.product_id,
          quantity: Number(item.quantity),
        })),
        discount: Number(discount) || 0,
      })

      await loadInvoices()

      setSelectedCustomer('')
      setInvoiceItems([{ product_id: '', quantity: 1 }])
      setDiscount('0')
      setSuccess('Invoice created successfully.')
    } catch (err) {
      setError(`Could not create invoice: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const selectedPaymentInvoice = invoices.find(
    (invoice) => invoice.id === paymentForm.invoice_id
  )

  const selectedInvoiceBalance = Math.max(
    0,
    Number(selectedPaymentInvoice?.balance_due) || 0
  )

  function handlePaymentInvoiceChange(invoiceId) {
    const invoice = invoices.find((item) => item.id === invoiceId)

    setPaymentForm((current) => ({
      ...current,
      invoice_id: invoiceId,
      amount:
        invoice && Number(invoice.balance_due) > 0
          ? String(invoice.balance_due)
          : '',
    }))
  }

  async function handleCreatePayment(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!paymentForm.invoice_id) {
      setError('Please select an invoice.')
      return
    }

    const invoice = invoices.find(
      (item) => item.id === paymentForm.invoice_id
    )

    if (!invoice) {
      setError('The selected invoice could not be found. Refresh and try again.')
      return
    }

    const amount = Number(paymentForm.amount)
    const balance = Number(invoice.balance_due) || 0

    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Payment amount must be greater than zero.')
      return
    }

    if (amount > balance + 0.000001) {
      setError(`Payment cannot exceed the outstanding balance of ${money(balance)}.`)
      return
    }

    if (!paymentForm.payment_method) {
      setError('Please select a payment method.')
      return
    }

    setSaving(true)

    try {
      await paymentApi.create({
        invoice_id: paymentForm.invoice_id,
        amount,
        payment_method: paymentForm.payment_method,
        reference: paymentForm.reference.trim(),
        notes: paymentForm.notes.trim(),
      })

      await Promise.all([loadInvoices(), loadPayments()])

      setPaymentForm(initialPayment)
      setSuccess('Payment recorded successfully. Invoice balances have been refreshed.')
    } catch (err) {
      setError(`Could not record payment: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  function statusColor(status) {
    const value = String(status || '').toUpperCase()

    if (value === 'PAID') {
      return { background: '#dcfce7', color: '#166534' }
    }

    if (value === 'PARTIALLY_PAID' || value === 'PARTIALLY PAID') {
      return { background: '#fef3c7', color: '#92400e' }
    }

    return { background: '#fee2e2', color: '#991b1b' }
  }

  function renderCustomerPage() {
    return (
      <>
        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Add Customer</h3>

          <form
            onSubmit={handleCreateCustomer}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '14px',
            }}
          >
            {[
              ['name', 'Customer name', 'text', true],
              ['email', 'Email address', 'email', false],
              ['phone', 'Phone number', 'tel', false],
              ['address', 'Address', 'text', false],
            ].map(([key, label, type, required]) => (
              <label key={key}>
                <span style={fieldLabelStyle}>{label}</span>
                <input
                  style={inputStyle}
                  type={type}
                  value={customerForm[key]}
                  required={required}
                  onChange={(event) =>
                    setCustomerForm({
                      ...customerForm,
                      [key]: event.target.value,
                    })
                  }
                  placeholder={label}
                />
              </label>
            ))}

            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button style={buttonStyle} type="submit">
                Add Customer
              </button>
            </div>
          </form>
        </div>

        <div style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h3 style={{ margin: 0 }}>
              Customer List ({customers.length})
            </h3>
            <button
              style={secondaryButtonStyle}
              onClick={() => runRefresh(loadCustomers)}
            >
              Refresh
            </button>
          </div>

          {customers.length === 0 ? (
            <p style={mutedStyle}>No customers found.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {['Name', 'Email', 'Phone', 'Address'].map((heading) => (
                      <th key={heading} style={headerCellStyle}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td style={cellStyle}>{customer.name}</td>
                      <td style={cellStyle}>{customer.email || '—'}</td>
                      <td style={cellStyle}>{customer.phone || '—'}</td>
                      <td style={cellStyle}>{customer.address || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )
  }

  function renderProductPage() {
    return (
      <>
        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Add Product</h3>

          <form
            onSubmit={handleCreateProduct}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '14px',
            }}
          >
            <label>
              <span style={fieldLabelStyle}>Product name</span>
              <input
                style={inputStyle}
                value={productForm.name}
                required
                onChange={(event) =>
                  setProductForm({ ...productForm, name: event.target.value })
                }
                placeholder="e.g. Blue Pen"
              />
            </label>

            <label>
              <span style={fieldLabelStyle}>Price (₹)</span>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={productForm.price}
                required
                onChange={(event) =>
                  setProductForm({ ...productForm, price: event.target.value })
                }
                placeholder="0.00"
              />
            </label>

            <label>
              <span style={fieldLabelStyle}>Unit</span>
              <select
                style={inputStyle}
                value={productForm.unit}
                onChange={(event) =>
                  setProductForm({ ...productForm, unit: event.target.value })
                }
              >
                {[
                  'Piece', 'Box', 'Packet', 'Kg', 'Gram',
                  'Litre', 'Metre', 'Hour', 'Service',
                ].map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span style={fieldLabelStyle}>GST rate</span>
              <select
                style={inputStyle}
                value={productForm.gst_rate}
                onChange={(event) =>
                  setProductForm({
                    ...productForm,
                    gst_rate: event.target.value,
                  })
                }
              >
                {[0, 5, 12, 18, 28].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}%
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button style={buttonStyle} type="submit">
                Add Product
              </button>
            </div>
          </form>
        </div>

        <div style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h3 style={{ margin: 0 }}>
              Product List ({products.length})
            </h3>
            <button
              style={secondaryButtonStyle}
              onClick={() => runRefresh(loadProducts)}
            >
              Refresh
            </button>
          </div>

          {products.length === 0 ? (
            <p style={mutedStyle}>No products found.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {['Product', 'Price', 'Unit', 'GST'].map((heading) => (
                      <th key={heading} style={headerCellStyle}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td style={cellStyle}>{product.name}</td>
                      <td style={cellStyle}>{money(product.price)}</td>
                      <td style={cellStyle}>{product.unit}</td>
                      <td style={cellStyle}>
                        {Number(product.gst_rate) || 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )
  }

  function renderInvoicePage() {
    return (
      <>
        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Create New Invoice</h3>
          <p style={mutedStyle}>
            Choose a customer, add products, and review the invoice before saving.
          </p>

          {customers.length === 0 || products.length === 0 ? (
            <p style={warningStyle}>
              You need at least one customer and one product before creating an invoice.
              Add them in the Customers and Products pages first.
            </p>
          ) : (
            <form onSubmit={handleCreateInvoice}>
              <label
                style={{
                  display: 'block',
                  maxWidth: '500px',
                  marginBottom: '20px',
                }}
              >
                <span style={fieldLabelStyle}>Customer</span>
                <select
                  style={inputStyle}
                  value={selectedCustomer}
                  required
                  onChange={(event) => setSelectedCustomer(event.target.value)}
                >
                  <option value="">Select a customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                      {customer.phone ? ` — ${customer.phone}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <h4>Invoice Items</h4>

              <div style={{ display: 'grid', gap: '12px' }}>
                {calculatedItems.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'minmax(180px, 2fr) minmax(85px, 0.7fr) minmax(95px, 1fr) minmax(95px, 1fr) auto',
                      gap: '10px',
                      alignItems: 'end',
                      padding: '12px',
                      border: '1px solid #e5e9f0',
                      borderRadius: '10px',
                    }}
                  >
                    <label>
                      <span style={fieldLabelStyle}>Product</span>
                      <select
                        style={inputStyle}
                        value={item.product_id}
                        required
                        onChange={(event) =>
                          updateInvoiceItem(
                            index,
                            'product_id',
                            event.target.value
                          )
                        }
                      >
                        <option value="">Select product</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} — {money(product.price)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span style={fieldLabelStyle}>Quantity</span>
                      <input
                        style={inputStyle}
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={item.quantity}
                        onChange={(event) =>
                          updateInvoiceItem(
                            index,
                            'quantity',
                            event.target.value
                          )
                        }
                      />
                    </label>

                    <div>
                      <span style={fieldLabelStyle}>Unit price</span>
                      <div style={{ padding: '10px 0', fontSize: '14px' }}>
                        {money(item.unitPrice)}
                      </div>
                    </div>

                    <div>
                      <span style={fieldLabelStyle}>Line total*</span>
                      <div style={{ padding: '10px 0', fontSize: '14px' }}>
                        {money(item.total)}
                      </div>
                    </div>

                    <button
                      type="button"
                      title="Remove item"
                      style={{
                        ...secondaryButtonStyle,
                        padding: '10px',
                        color: '#b42318',
                        background: '#fff1f0',
                      }}
                      disabled={invoiceItems.length === 1}
                      onClick={() => removeInvoiceItem(index)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <p style={{ ...mutedStyle, fontSize: '12px' }}>
                *Line total includes GST. The backend calculates the final invoice amounts.
              </p>

              <button
                type="button"
                style={{ ...secondaryButtonStyle, marginTop: '8px' }}
                onClick={addInvoiceItem}
              >
                + Add Another Product
              </button>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(200px, 1fr) minmax(250px, 1fr)',
                  gap: '24px',
                  marginTop: '24px',
                }}
              >
                <label>
                  <span style={fieldLabelStyle}>Discount (₹)</span>
                  <input
                    style={inputStyle}
                    type="number"
                    min="0"
                    max={invoiceSubtotal}
                    step="0.01"
                    value={discount}
                    onChange={(event) => setDiscount(event.target.value)}
                  />
                </label>

                <div
                  style={{
                    background: '#f7f8fc',
                    borderRadius: '10px',
                    padding: '16px',
                  }}
                >
                  <SummaryRow label="Subtotal" value={money(invoiceSubtotal)} />
                  <SummaryRow label="GST" value={money(invoiceGst)} />
                  <SummaryRow
                    label="Discount"
                    value={`− ${money(discountAmount)}`}
                  />
                  <div
                    style={{
                      borderTop: '1px solid #dce1eb',
                      margin: '12px 0',
                    }}
                  />
                  <SummaryRow
                    label="Estimated Total"
                    value={money(invoiceTotal)}
                    strong
                  />
                </div>
              </div>

              <button
                type="submit"
                style={{ ...buttonStyle, marginTop: '20px' }}
                disabled={saving}
              >
                {saving ? 'Saving Invoice…' : 'Create Invoice'}
              </button>
            </form>
          )}
        </div>

        <div style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h3 style={{ margin: 0 }}>
              Saved Invoices ({invoices.length})
            </h3>
            <button
              style={secondaryButtonStyle}
              onClick={() => runRefresh(loadInvoices)}
            >
              Refresh
            </button>
          </div>

          {invoices.length === 0 ? (
            <p style={mutedStyle}>
              No invoices found. Create your first invoice above.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {[
                      'Invoice ID',
                      'Customer',
                      'Items',
                      'Total',
                      'Paid',
                      'Balance',
                      'Status',
                    ].map((heading) => (
                      <th key={heading} style={headerCellStyle}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td
                        style={{
                          ...cellStyle,
                          fontFamily: 'monospace',
                        }}
                      >
                        {invoice.id}
                      </td>
                      <td style={cellStyle}>
                        {invoice.customer_name || '—'}
                      </td>
                      <td style={cellStyle}>
                        {(invoice.items || [])
                          .map(
                            (item) =>
                              `${item.product_name} × ${item.quantity}`
                          )
                          .join(', ') || '—'}
                      </td>
                      <td style={cellStyle}>
                        {money(invoice.total_amount)}
                      </td>
                      <td style={cellStyle}>
                        {money(invoice.amount_paid)}
                      </td>
                      <td style={cellStyle}>
                        {money(invoice.balance_due)}
                      </td>
                      <td style={cellStyle}>
                        <span
                          style={{
                            display: 'inline-block',
                            borderRadius: '20px',
                            padding: '5px 9px',
                            fontSize: '12px',
                            fontWeight: 700,
                            ...statusColor(invoice.status),
                          }}
                        >
                          {invoice.status || 'UNPAID'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )
  }

  function renderPaymentsPage() {
    const totalCollected = payments.reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0
    )

    const payableInvoices = invoices.filter(
      (invoice) => Number(invoice.balance_due) > 0
    )

    return (
      <>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '16px',
          }}
        >
          <div style={panelStyle}>
            <p style={{ ...mutedStyle, marginTop: 0 }}>Recorded Payments</p>
            <h2 style={{ marginBottom: 0 }}>{payments.length}</h2>
          </div>
          <div style={panelStyle}>
            <p style={{ ...mutedStyle, marginTop: 0 }}>Total Collected</p>
            <h2 style={{ marginBottom: 0 }}>{money(totalCollected)}</h2>
          </div>
          <div style={panelStyle}>
            <p style={{ ...mutedStyle, marginTop: 0 }}>Invoices Awaiting Payment</p>
            <h2 style={{ marginBottom: 0 }}>{payableInvoices.length}</h2>
          </div>
        </div>

        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Record a Payment</h3>
          <p style={mutedStyle}>
            Select an invoice with an outstanding balance. The amount defaults
            to the full balance, but you can record a smaller partial payment.
          </p>

          {payableInvoices.length === 0 ? (
            <p style={warningStyle}>
              There are no unpaid invoice balances. Create an invoice first,
              or check whether all existing invoices are fully paid.
            </p>
          ) : (
            <form
              onSubmit={handleCreatePayment}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '16px',
              }}
            >
              <label style={{ gridColumn: '1 / -1' }}>
                <span style={fieldLabelStyle}>Invoice</span>
                <select
                  style={inputStyle}
                  value={paymentForm.invoice_id}
                  required
                  onChange={(event) =>
                    handlePaymentInvoiceChange(event.target.value)
                  }
                >
                  <option value="">Select an invoice</option>
                  {payableInvoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.customer_name || 'Customer'} —{' '}
                      {invoice.id} — Balance: {money(invoice.balance_due)}
                    </option>
                  ))}
                </select>
              </label>

              {selectedPaymentInvoice && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    background: '#f7f8fc',
                    borderRadius: '10px',
                    padding: '14px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <SummaryRow
                    label="Invoice total"
                    value={money(selectedPaymentInvoice.total_amount)}
                  />
                  <SummaryRow
                    label="Already paid"
                    value={money(selectedPaymentInvoice.amount_paid)}
                  />
                  <SummaryRow
                    label="Balance due"
                    value={money(selectedInvoiceBalance)}
                    strong
                  />
                </div>
              )}

              <label>
                <span style={fieldLabelStyle}>Payment amount (₹)</span>
                <input
                  style={inputStyle}
                  type="number"
                  min="0.01"
                  max={selectedInvoiceBalance || undefined}
                  step="0.01"
                  value={paymentForm.amount}
                  required
                  onChange={(event) =>
                    setPaymentForm({
                      ...paymentForm,
                      amount: event.target.value,
                    })
                  }
                  placeholder="Enter amount"
                />
                {selectedPaymentInvoice && (
                  <span
                    style={{
                      ...mutedStyle,
                      display: 'block',
                      fontSize: '12px',
                      marginTop: '5px',
                    }}
                  >
                    Maximum: {money(selectedInvoiceBalance)}
                  </span>
                )}
              </label>

              <label>
                <span style={fieldLabelStyle}>Payment method</span>
                <select
                  style={inputStyle}
                  value={paymentForm.payment_method}
                  required
                  onChange={(event) =>
                    setPaymentForm({
                      ...paymentForm,
                      payment_method: event.target.value,
                    })
                  }
                >
                  {['UPI', 'Cash', 'Bank Transfer', 'Card', 'Cheque', 'Other'].map(
                    (method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label>
                <span style={fieldLabelStyle}>Reference number (optional)</span>
                <input
                  style={inputStyle}
                  value={paymentForm.reference}
                  onChange={(event) =>
                    setPaymentForm({
                      ...paymentForm,
                      reference: event.target.value,
                    })
                  }
                  placeholder="e.g. transaction ID"
                />
              </label>

              <label>
                <span style={fieldLabelStyle}>Notes (optional)</span>
                <input
                  style={inputStyle}
                  value={paymentForm.notes}
                  onChange={(event) =>
                    setPaymentForm({
                      ...paymentForm,
                      notes: event.target.value,
                    })
                  }
                  placeholder="Payment details"
                />
              </label>

              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  style={buttonStyle}
                  type="submit"
                  disabled={saving}
                >
                  {saving ? 'Recording Payment…' : 'Record Payment'}
                </button>
                <button
                  style={secondaryButtonStyle}
                  type="button"
                  onClick={() => setPaymentForm(initialPayment)}
                  disabled={saving}
                >
                  Clear Form
                </button>
              </div>
            </form>
          )}
        </div>

        <div style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h3 style={{ margin: 0 }}>
              Payment History ({payments.length})
            </h3>
            <button
              style={secondaryButtonStyle}
              onClick={() =>
                runRefresh(async () => {
                  await Promise.all([loadPayments(), loadInvoices()])
                })
              }
            >
              Refresh Payments
            </button>
          </div>

          {payments.length === 0 ? (
            <p style={mutedStyle}>No payment records found.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {[
                      'Payment ID',
                      'Invoice ID',
                      'Customer',
                      'Method',
                      'Reference',
                      'Amount',
                      'Notes',
                    ].map((heading) => (
                      <th key={heading} style={headerCellStyle}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => {
                    const invoice = invoices.find(
                      (item) => item.id === payment.invoice_id
                    )

                    return (
                      <tr key={payment.id}>
                        <td
                          style={{
                            ...cellStyle,
                            fontFamily: 'monospace',
                          }}
                        >
                          {payment.id}
                        </td>
                        <td
                          style={{
                            ...cellStyle,
                            fontFamily: 'monospace',
                          }}
                        >
                          {payment.invoice_id}
                        </td>
                        <td style={cellStyle}>
                          {invoice?.customer_name || '—'}
                        </td>
                        <td style={cellStyle}>
                          {payment.payment_method || '—'}
                        </td>
                        <td style={cellStyle}>
                          {payment.reference || '—'}
                        </td>
                        <td style={cellStyle}>
                          <strong>{money(payment.amount)}</strong>
                        </td>
                        <td style={cellStyle}>{payment.notes || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )
  }

  function renderDashboard() {
    const totalValue = invoices.reduce(
      (sum, invoice) => sum + (Number(invoice.total_amount) || 0),
      0
    )

    const outstanding = invoices.reduce(
      (sum, invoice) => sum + (Number(invoice.balance_due) || 0),
      0
    )

    const dashboardCards = [
      { label: 'Total Customers', value: customers.length },
      { label: 'Total Products', value: products.length },
      { label: 'Total Invoices', value: invoices.length },
      { label: 'Invoice Value', value: money(totalValue) },
      { label: 'Outstanding Balance', value: money(outstanding) },
      {
        label: 'Total Payments',
        value: money(
          payments.reduce(
            (sum, payment) => sum + (Number(payment.amount) || 0),
            0
          )
        ),
      },
    ]

    return (
      <>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          {dashboardCards.map((card) => (
            <div key={card.label} style={panelStyle}>
              <p style={{ ...mutedStyle, marginTop: 0 }}>{card.label}</p>
              <h2 style={{ marginBottom: 0, overflowWrap: 'anywhere' }}>
                {card.value}
              </h2>
            </div>
          ))}
        </div>

        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Welcome to Viora Bills</h3>
          <p style={mutedStyle}>
            Manage your customers, products, invoices, and payments from one place.
          </p>
          <button style={buttonStyle} onClick={() => navigate('Invoices')}>
            + Create an Invoice
          </button>
        </div>

        <div style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h3 style={{ margin: 0 }}>Recent Invoices</h3>
            <button
              style={secondaryButtonStyle}
              onClick={() => navigate('Invoices')}
            >
              View All
            </button>
          </div>

          {invoices.length === 0 ? (
            <p style={mutedStyle}>Your invoices will appear here.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {['Customer', 'Total', 'Balance', 'Status'].map((heading) => (
                      <th key={heading} style={headerCellStyle}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, 5).map((invoice) => (
                    <tr key={invoice.id}>
                      <td style={cellStyle}>
                        {invoice.customer_name || '—'}
                      </td>
                      <td style={cellStyle}>
                        {money(invoice.total_amount)}
                      </td>
                      <td style={cellStyle}>
                        {money(invoice.balance_due)}
                      </td>
                      <td style={cellStyle}>
                        {invoice.status || 'UNPAID'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )
  }

  async function runRefresh(loader) {
    setError('')
    setSuccess('')

    try {
      await loader()
      setSuccess('Data refreshed successfully.')
    } catch (err) {
      setError(`Refresh failed: ${err.message}`)
    }
  }

  const pages = [
    { name: 'Dashboard', icon: '▦' },
    { name: 'Customers', icon: '♙' },
    { name: 'Products', icon: '▤' },
    { name: 'Invoices', icon: '▧' },
    { name: 'Payments', icon: '₹' },
  ]

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        background: '#f5f7fb',
        color: '#172033',
        fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
      }}
    >
      <aside
        style={{
          width: '220px',
          flexShrink: 0,
          background: '#172554',
          color: '#fff',
          padding: '24px 14px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ padding: '0 10px 28px' }}>
          <div style={{ fontSize: '24px', fontWeight: 800 }}>Viora Bills</div>
          <div style={{ fontSize: '12px', color: '#c7d2fe', marginTop: '6px' }}>
            Billing & Invoice Management
          </div>
        </div>

        <nav style={{ display: 'grid', gap: '6px' }}>
          {pages.map((page) => (
            <button
              key={page.name}
              onClick={() => navigate(page.name)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '100%',
                padding: '12px',
                border: 'none',
                borderRadius: '9px',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: activePage === page.name ? 700 : 500,
                color: '#fff',
                background:
                  activePage === page.name ? '#3157d5' : 'transparent',
              }}
            >
              <span style={{ width: '20px', textAlign: 'center' }}>
                {page.icon}
              </span>
              {page.name}
            </button>
          ))}
        </nav>
      </aside>

      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: '28px',
          overflowX: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap',
            marginBottom: '26px',
          }}
        >
          <div>
            <h1 style={{ fontSize: '26px', margin: 0 }}>{activePage}</h1>
            <p style={{ ...mutedStyle, marginBottom: 0 }}>
              Manage your billing operations
            </p>
          </div>

          <button
            style={secondaryButtonStyle}
            disabled={loading}
            onClick={loadAllData}
          >
            {loading ? 'Refreshing…' : '↻ Refresh Data'}
          </button>
        </header>

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}

        {success && (
          <div role="status" style={successStyle}>
            {success}
          </div>
        )}

        {loading && customers.length === 0 && products.length === 0 ? (
          <div style={panelStyle}>Loading your data…</div>
        ) : (
          <>
            {activePage === 'Dashboard' && renderDashboard()}
            {activePage === 'Customers' && renderCustomerPage()}
            {activePage === 'Products' && renderProductPage()}
            {activePage === 'Invoices' && renderInvoicePage()}
            {activePage === 'Payments' && renderPaymentsPage()}
          </>
        )}
      </main>
    </div>
  )
}

function SummaryRow({ label, value, strong = false }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        margin: '8px 0',
        fontSize: '14px',
        fontWeight: strong ? 800 : 500,
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

const sectionHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '12px',
  marginBottom: '16px',
}

const headerCellStyle = {
  ...cellStyle,
  background: '#f7f8fc',
  color: '#4b5568',
  fontSize: '12px',
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

const mutedStyle = {
  color: '#697386',
  fontSize: '14px',
  lineHeight: 1.6,
}

const errorStyle = {
  padding: '12px 14px',
  borderRadius: '8px',
  marginBottom: '16px',
  background: '#fee2e2',
  color: '#991b1b',
  fontSize: '14px',
}

const successStyle = {
  padding: '12px 14px',
  borderRadius: '8px',
  marginBottom: '16px',
  background: '#dcfce7',
  color: '#166534',
  fontSize: '14px',
}

const warningStyle = {
  padding: '12px 14px',
  borderRadius: '8px',
  background: '#fff7ed',
  color: '#9a3412',
  fontSize: '14px',
  lineHeight: 1.6,
}

export default App
