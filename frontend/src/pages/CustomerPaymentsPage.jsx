import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { customerPortalApi, paymentApi } from '../services/api'
import { money } from '../utils/formatters'
import StatusBadge from '../components/common/StatusBadge'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Pagination from '../components/common/Pagination'
import Modal from '../components/common/Modal'
import Alert from '../components/common/Alert'
import PaymentReceiptModal from '../components/payments/PaymentReceiptModal'

export default function CustomerPaymentsPage() {
  const outletCtx = useOutletContext() || {}
  const activeCompany =
    outletCtx.companySettings?.settings ||
    outletCtx.companySettings?.company ||
    outletCtx.companySettings ||
    {}

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [payments, setPayments] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalPayments, setTotalPayments] = useState(0)

  // Receipt Modal
  const [selectedReceipt, setSelectedReceipt] = useState(null)

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await customerPortalApi.getPayments({ page, limit: 15 })
      setPayments(res.items || [])
      setTotalPages(res.total_pages || 1)
      setTotalPayments(res.total || 0)
    } catch (err) {
      setError(`Failed to retrieve payments history: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchPayments()
      }
    })
    return () => {
      ignore = true
    }
  }, [fetchPayments])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className={selectedReceipt ? 'no-print' : ''}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
            Payment History & Receipts
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            Official transaction records and receipts for your payments.
          </p>
        </div>
      </div>

      {error && <Alert type="danger" message={error} />}

      <div className="card" style={{ padding: '0' }}>
        {loading ? (
          <div style={{ padding: '40px' }}>
            <LoadingSpinner message="Fetching payment history…" />
          </div>
        ) : payments.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            No payments recorded on your account yet.
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Receipt #</th>
                  <th>Payment Date</th>
                  <th>Invoice #</th>
                  <th>Payment Method</th>
                  <th>Amount</th>
                  <th>Reference / UTR</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700 }}>{p.receipt_number || p.id}</td>
                    <td style={{ fontSize: '13px' }}>{p.payment_date}</td>
                    <td style={{ fontWeight: 600 }}>{p.invoice_number || 'N/A'}</td>
                    <td>
                      <span style={{ fontSize: '12px', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                        {p.payment_method}
                      </span>
                    </td>
                    <td style={{ color: '#059669', fontWeight: 700 }}>{money(p.amount)}</td>
                    <td style={{ fontSize: '12px', color: '#475569', fontFamily: 'monospace' }}>
                      {p.reference || '—'}
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSelectedReceipt(p)}
                        title="View & Print Official Receipt"
                      >
                        🧾 Receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: '16px 20px', borderTop: '1px solid #e2e8f0' }}>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalPayments}
            pageSize={15}
            onPageChange={setPage}
          />
        </div>
      </div>
      </div>

      {/* View Receipt Modal */}
      {selectedReceipt && (
        <PaymentReceiptModal
          payment={selectedReceipt}
          paymentId={selectedReceipt.payment_id || selectedReceipt.id || selectedReceipt._id}
          companySettings={activeCompany}
          onClose={() => setSelectedReceipt(null)}
        />
      )}
    </div>
  )
}
