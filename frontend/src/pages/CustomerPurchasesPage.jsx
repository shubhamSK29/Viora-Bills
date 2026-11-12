import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ordersApi, invoiceApi } from '../services/api'
import { money, formatDate } from '../utils/formatters'
import StatusBadge from '../components/common/StatusBadge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Alert from '../components/common/Alert'

export default function CustomerPurchasesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [purchases, setPurchases] = useState([])
  const [summary, setSummary] = useState({ total_purchases_count: 0, distinct_products_count: 0, total_spend: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [downloadingId, setDownloadingId] = useState(null)

  const fetchPurchases = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await ordersApi.getPurchases()
      setPurchases(res.items || [])
      setSummary({
        total_purchases_count: res.total_purchases_count || 0,
        distinct_products_count: res.distinct_products_count || 0,
        total_spend: res.total_spend || 0,
      })
    } catch (err) {
      setError(`Failed to retrieve purchase history: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchPurchases()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchPurchases])

  const handleDownloadPdf = async (invoiceId, invoiceNumber) => {
    setDownloadingId(invoiceId)
    setError('')
    try {
      await invoiceApi.downloadPdf(invoiceId, invoiceNumber)
    } catch (err) {
      setError(`Could not download invoice PDF: ${err.message}`)
    } finally {
      setDownloadingId(null)
    }
  }

  const filteredItems = purchases.filter((it) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      it.product_name?.toLowerCase().includes(q) ||
      it.invoice_number?.toLowerCase().includes(q)
    )
  })

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', color: '#111827' }}>
            My Purchases
          </h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
            Confirmed items purchased across your billed invoices with direct PDF download access.
          </p>
        </div>

        <Link
          to="/customer/catalogue"
          className="btn btn-primary"
          style={{ textDecoration: 'none' }}
        >
          Browse Catalogue
        </Link>
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError('')} />}

      {/* Summary KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div className="card" style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
            Total Items Purchased
          </span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#111827' }}>
            {summary.total_purchases_count}
          </span>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
            Distinct Products
          </span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#2563eb' }}>
            {summary.distinct_products_count}
          </span>
        </div>

        <div className="card" style={{ padding: '16px' }}>
          <span style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
            Total Billed Spend
          </span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#059669' }}>
            {money(summary.total_spend)}
          </span>
        </div>
      </div>

      {/* Search Input */}
      <div className="card" style={{ padding: '16px', marginBottom: '20px' }}>
        <input
          type="text"
          className="form-control"
          placeholder="Filter purchases by product name or invoice number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      {/* Purchases Table */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center' }}>
          <LoadingSpinner />
          <p style={{ marginTop: '12px', color: '#6b7280' }}>Loading purchase history...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
          <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" style={{ margin: '0 auto 16px' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#374151' }}>No confirmed purchases yet</h3>
          <p style={{ color: '#6b7280', fontSize: '14px', margin: '6px 0 20px 0' }}>
            Purchased items will appear here once your orders are approved and invoiced by management.
          </p>
          <Link to="/customer/catalogue" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Explore Catalogue
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Product Name</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Invoice #</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#4b5563' }}>Purchase Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#4b5563' }}>Quantity</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', color: '#4b5563' }}>Unit Price</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '12px', color: '#4b5563' }}>Line Total</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#4b5563' }}>Invoice Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: '#4b5563' }}>PDF</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((it, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 600, color: '#111827' }}>
                      {it.product_name}
                    </td>
                    <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 600, color: '#2563eb' }}>
                      <Link to="/customer/invoices" style={{ textDecoration: 'none', color: '#2563eb' }}>
                        {it.invoice_number}
                      </Link>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '13px', color: '#4b5563' }}>
                      {formatDate(it.invoice_date)}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: '13px', color: '#374151' }}>
                      {it.quantity} {it.unit}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: '13px', color: '#374151' }}>
                      {money(it.unit_price)}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: '#111827' }}>
                      {money(it.total)}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      <StatusBadge status={it.invoice_status} />
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleDownloadPdf(it.invoice_id, it.invoice_number)}
                        disabled={downloadingId === it.invoice_id}
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                      >
                        {downloadingId === it.invoice_id ? 'Downloading...' : 'PDF'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

