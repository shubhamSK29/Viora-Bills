import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { reportsApi, customerApi } from '../services/api'
import { money } from '../utils/formatters'
import { getTodayDate } from '../utils/constants'
import LoadingSpinner from '../components/common/LoadingSpinner'
import StatusBadge from '../components/common/StatusBadge'

export default function ReportsPage() {
  const { setError } = useOutletContext()

  const [reportsTab, setReportsTab] = useState('sales') // 'sales' | 'gst' | 'aging'
  const [loadingReport, setLoadingReport] = useState(false)

  // Sales state
  const [salesReport, setSalesReport] = useState(null)
  const [salesStartDate, setSalesStartDate] = useState('')
  const [salesEndDate, setSalesEndDate] = useState('')

  // GST state
  const [gstReport, setGstReport] = useState(null)
  const [gstStartDate, setGstStartDate] = useState('')
  const [gstEndDate, setGstEndDate] = useState('')

  // Aging state
  const [agingReport, setAgingReport] = useState(null)
  const [agingAsOfDate, setAgingAsOfDate] = useState(getTodayDate())
  const [agingCustomerFilter, setAgingCustomerFilter] = useState('')
  const [customers, setCustomers] = useState([])

  // Load customer list for aging filter dropdown
  useEffect(() => {
    let isMounted = true
    customerApi.list({ limit: 100, page: 1 }).then((res) => {
      const list = res?.items || res?.customers || (Array.isArray(res) ? res : [])
      if (isMounted) setCustomers(list)
    }).catch(() => {})
    return () => {
      isMounted = false
    }
  }, [])

  // Tab change & initial loader
  const loadActiveReport = useCallback(async () => {
    setLoadingReport(true)
    try {
      if (reportsTab === 'sales') {
        const data = await reportsApi.getSalesSummary(salesStartDate, salesEndDate)
        setSalesReport(data)
      } else if (reportsTab === 'gst') {
        const data = await reportsApi.getGstReport(gstStartDate, gstEndDate)
        setGstReport(data)
      } else if (reportsTab === 'aging') {
        const data = await reportsApi.getAging(agingAsOfDate, agingCustomerFilter)
        setAgingReport(data)
      }
    } catch (err) {
      setError(`Failed to load ${reportsTab} report: ${err.message}`)
    } finally {
      setLoadingReport(false)
    }
  }, [reportsTab, salesStartDate, salesEndDate, gstStartDate, gstEndDate, agingAsOfDate, agingCustomerFilter, setError])

  useEffect(() => {
    let ignore = false
    Promise.resolve().then(() => {
      if (!ignore) {
        loadActiveReport()
      }
    })
    return () => {
      ignore = true
    }
  }, [loadActiveReport])

  function handleDownloadGstCsv() {
    const url = reportsApi.getGstCsvUrl(gstStartDate, gstEndDate)
    window.open(url, '_blank')
  }

  return (
    <div>
      {/* Reports Header & Sub-Tab Navigation */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '14px',
          }}
        >
          <div>
            <h3 className="card-title">Reports & Financial Analytics</h3>
            <p className="card-desc">
              Comprehensive revenue trends, GST tax liability reconciliations, and accounts receivable aging
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${reportsTab === 'sales' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setReportsTab('sales')}
            >
              📊 Sales Summary
            </button>
            <button
              type="button"
              className={`btn btn-sm ${reportsTab === 'gst' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setReportsTab('gst')}
            >
              🏛️ GST Liability
            </button>
            <button
              type="button"
              className={`btn btn-sm ${reportsTab === 'aging' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setReportsTab('aging')}
            >
              ⏳ Aging (AR)
            </button>
          </div>
        </div>
      </div>

      {loadingReport && !salesReport && !gstReport && !agingReport ? (
        <LoadingSpinner message="Calculating financial metrics…" size="large" />
      ) : null}

      {/* ─── TAB 1: SALES SUMMARY ─── */}
      {reportsTab === 'sales' && (
        <div>
          {/* Filter Bar */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>From:</span>
                <input
                  className="form-control"
                  type="date"
                  style={{ width: '150px' }}
                  value={salesStartDate}
                  onChange={(e) => setSalesStartDate(e.target.value)}
                />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>To:</span>
                <input
                  className="form-control"
                  type="date"
                  style={{ width: '150px' }}
                  value={salesEndDate}
                  onChange={(e) => setSalesEndDate(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={loadActiveReport}
                  disabled={loadingReport}
                >
                  {loadingReport ? 'Filtering…' : 'Filter Sales'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setSalesStartDate('')
                    setSalesEndDate('')
                  }}
                >
                  All Time
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() - 30)
                    setSalesStartDate(d.toISOString().split('T')[0])
                    setSalesEndDate(getTodayDate())
                  }}
                >
                  Last 30 Days
                </button>
              </div>
            </div>
          </div>

          {salesReport && (
            <>
              {/* Summary KPIs */}
              <div className="metrics-grid">
                <div className="metric-card">
                  <div>
                    <p className="metric-label">Total Invoiced Sales</p>
                    <h3 className="metric-value">{money(salesReport.summary.total_sales)}</h3>
                    <p className="metric-sub">{salesReport.summary.total_invoices} invoices in period</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#eff6ff', color: '#2563eb' }}>
                    ₹
                  </div>
                </div>

                <div className="metric-card">
                  <div>
                    <p className="metric-label">Paid Collections</p>
                    <h3 className="metric-value" style={{ color: '#16a34a' }}>
                      {money(salesReport.summary.paid_amount)}
                    </h3>
                    <p className="metric-sub">
                      {salesReport.summary.total_sales > 0
                        ? `${Math.round(
                            (salesReport.summary.paid_amount / salesReport.summary.total_sales) * 100
                          )}% collection rate`
                        : 'No revenue recorded'}
                    </p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
                    ✓
                  </div>
                </div>

                <div className="metric-card">
                  <div>
                    <p className="metric-label">Pending / Unpaid Dues</p>
                    <h3
                      className="metric-value"
                      style={{ color: salesReport.summary.pending_amount > 0 ? '#dc2626' : '#16a34a' }}
                    >
                      {money(salesReport.summary.pending_amount)}
                    </h3>
                    <p className="metric-sub">Accounts receivable balance</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#fef2f2', color: '#ef4444' }}>
                    ⏳
                  </div>
                </div>

                <div className="metric-card">
                  <div>
                    <p className="metric-label">Net Taxable Revenue</p>
                    <h3 className="metric-value">{money(salesReport.summary.taxable_sales)}</h3>
                    <p className="metric-sub">Total GST: {money(salesReport.summary.total_gst)}</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#f8fafc', color: '#475569' }}>
                    🏛️
                  </div>
                </div>
              </div>

              {/* Visual Sales Trend Bar Chart */}
              <div className="chart-card">
                <div className="card-header">
                  <div>
                    <h3 className="card-title">Revenue & Collection Trend</h3>
                    <p className="card-desc">Visual timeline of billed sales and payments</p>
                  </div>
                </div>

                {salesReport.sales_trend.length === 0 ? (
                  <div className="empty-state">
                    <p>No sales activity recorded in the selected period.</p>
                  </div>
                ) : (
                  <div className="chart-svg-container">
                    <div
                      style={{
                        display: 'flex',
                        gap: '16px',
                        alignItems: 'flex-end',
                        height: '220px',
                        padding: '20px 10px',
                        borderBottom: '2px solid #e2e8f0',
                      }}
                    >
                      {(() => {
                        const maxVal = Math.max(
                          ...salesReport.sales_trend.map((t) => Math.max(t.sales, t.paid)),
                          1
                        )
                        return salesReport.sales_trend.map((pt) => {
                          const salesH = Math.max(8, Math.round((pt.sales / maxVal) * 160))
                          const paidH = Math.max(4, Math.round((pt.paid / maxVal) * 160))
                          return (
                            <div
                              key={pt.date}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                flex: '1 1 60px',
                                minWidth: '50px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  gap: '4px',
                                  alignItems: 'flex-end',
                                  height: '170px',
                                }}
                              >
                                <div
                                  title={`Sales: ${money(pt.sales)}`}
                                  style={{
                                    width: '16px',
                                    height: `${salesH}px`,
                                    backgroundColor: '#3b82f6',
                                    borderRadius: '4px 4px 0 0',
                                  }}
                                />
                                <div
                                  title={`Paid: ${money(pt.paid)}`}
                                  style={{
                                    width: '16px',
                                    height: `${paidH}px`,
                                    backgroundColor: '#10b981',
                                    borderRadius: '4px 4px 0 0',
                                  }}
                                />
                              </div>
                              <span
                                style={{
                                  fontSize: '11px',
                                  color: '#64748b',
                                  marginTop: '8px',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {pt.date.slice(5)}
                              </span>
                            </div>
                          )
                        })
                      })()}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '20px',
                        marginTop: '12px',
                        justifyContent: 'center',
                        fontSize: '12px',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            width: '12px',
                            height: '12px',
                            background: '#3b82f6',
                            borderRadius: '3px',
                          }}
                        />{' '}
                        Total Sales
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            width: '12px',
                            height: '12px',
                            background: '#10b981',
                            borderRadius: '3px',
                          }}
                        />{' '}
                        Payments Collected
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Monthly & Weekly Tables */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                  gap: '20px',
                }}
              >
                <div className="card">
                  <h3 className="card-title" style={{ marginBottom: '14px' }}>
                    Monthly Sales Summary
                  </h3>
                  <div className="table-responsive">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Invoices</th>
                          <th>Total Sales</th>
                          <th>Collected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesReport.monthly_sales.map((m) => (
                          <tr key={m.month}>
                            <td style={{ fontWeight: 600 }}>{m.label}</td>
                            <td>{m.count}</td>
                            <td>{money(m.sales)}</td>
                            <td style={{ color: '#16a34a', fontWeight: 600 }}>{money(m.paid)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card">
                  <h3 className="card-title" style={{ marginBottom: '14px' }}>
                    Weekly Sales Breakdown
                  </h3>
                  <div className="table-responsive">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Week</th>
                          <th>Invoices</th>
                          <th>Total Sales</th>
                          <th>Collected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesReport.weekly_sales.map((w) => (
                          <tr key={w.week}>
                            <td style={{ fontWeight: 600 }}>{w.week}</td>
                            <td>{w.count}</td>
                            <td>{money(w.sales)}</td>
                            <td style={{ color: '#16a34a', fontWeight: 600 }}>{money(w.paid)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── TAB 2: GST LIABILITY REPORT ─── */}
      {reportsTab === 'gst' && (
        <div>
          {/* Filter Bar */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>From:</span>
                <input
                  className="form-control"
                  type="date"
                  style={{ width: '150px' }}
                  value={gstStartDate}
                  onChange={(e) => setGstStartDate(e.target.value)}
                />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>To:</span>
                <input
                  className="form-control"
                  type="date"
                  style={{ width: '150px' }}
                  value={gstEndDate}
                  onChange={(e) => setGstEndDate(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={loadActiveReport}
                  disabled={loadingReport}
                >
                  {loadingReport ? 'Filtering…' : 'Filter GST'}
                </button>
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleDownloadGstCsv}
              >
                📥 Export GST to CSV
              </button>
            </div>
          </div>

          {gstReport && (
            <>
              {/* GST Summary Cards */}
              <div className="metrics-grid">
                <div className="metric-card">
                  <div>
                    <p className="metric-label">Taxable Sales</p>
                    <h3 className="metric-value">{money(gstReport.summary.total_taxable_sales)}</h3>
                    <p className="metric-sub">Base value before GST</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#f8fafc', color: '#475569' }}>
                    📋
                  </div>
                </div>

                <div className="metric-card">
                  <div>
                    <p className="metric-label">Total GST Collected</p>
                    <h3 className="metric-value" style={{ color: '#16a34a' }}>
                      {money(gstReport.summary.total_gst_collected)}
                    </h3>
                    <p className="metric-sub">Actual tax received from paid bills</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
                    ✓
                  </div>
                </div>

                <div className="metric-card">
                  <div>
                    <p className="metric-label">Total GST Liability (Pending)</p>
                    <h3 className="metric-value" style={{ color: '#d97706' }}>
                      {money(gstReport.summary.total_gst_liability)}
                    </h3>
                    <p className="metric-sub">Tax payable upon balance collection</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#fffbeb', color: '#d97706' }}>
                    ⏳
                  </div>
                </div>

                <div className="metric-card">
                  <div>
                    <p className="metric-label">CGST / SGST / IGST</p>
                    <div style={{ fontSize: '13px', lineHeight: 1.6, marginTop: '6px' }}>
                      <div>
                        CGST: <strong>{money(gstReport.summary.cgst_collected)}</strong>{' '}
                        <span style={{ color: '#94a3b8' }}>
                          ({money(gstReport.summary.cgst_liability)} pend)
                        </span>
                      </div>
                      <div>
                        SGST: <strong>{money(gstReport.summary.sgst_collected)}</strong>{' '}
                        <span style={{ color: '#94a3b8' }}>
                          ({money(gstReport.summary.sgst_liability)} pend)
                        </span>
                      </div>
                      <div>
                        IGST: <strong>{money(gstReport.summary.igst_collected)}</strong>{' '}
                        <span style={{ color: '#94a3b8' }}>
                          ({money(gstReport.summary.igst_liability)} pend)
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#eff6ff', color: '#2563eb' }}>
                    🏛️
                  </div>
                </div>
              </div>

              {/* Monthly GST Breakdown Table */}
              <div className="card">
                <h3 className="card-title" style={{ marginBottom: '14px' }}>
                  Monthly GST Tax Breakdown
                </h3>
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Taxable Sales</th>
                        <th>CGST Collected</th>
                        <th>CGST Pending</th>
                        <th>SGST Collected</th>
                        <th>SGST Pending</th>
                        <th>IGST Collected</th>
                        <th>IGST Pending</th>
                        <th>Total GST Collected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gstReport.monthly_breakdown.map((row) => (
                        <tr key={row.month}>
                          <td style={{ fontWeight: 600 }}>{row.label}</td>
                          <td>{money(row.taxable_sales)}</td>
                          <td>{money(row.cgst_collected)}</td>
                          <td style={{ color: '#64748b' }}>{money(row.cgst_liability)}</td>
                          <td>{money(row.sgst_collected)}</td>
                          <td style={{ color: '#64748b' }}>{money(row.sgst_liability)}</td>
                          <td>{money(row.igst_collected)}</td>
                          <td style={{ color: '#64748b' }}>{money(row.igst_liability)}</td>
                          <td style={{ fontWeight: 700, color: '#16a34a' }}>
                            {money(row.total_gst_collected)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── TAB 3: ACCOUNTS RECEIVABLE AGING ─── */}
      {reportsTab === 'aging' && (
        <div>
          {/* Aging Filter Bar */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>
                    As of Date:
                  </label>
                  <input
                    className="form-control"
                    type="date"
                    style={{ width: '160px' }}
                    value={agingAsOfDate}
                    onChange={(e) => setAgingAsOfDate(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>
                    Customer:
                  </label>
                  <select
                    className="form-control"
                    style={{ width: '200px' }}
                    value={agingCustomerFilter}
                    onChange={(e) => setAgingCustomerFilter(e.target.value)}
                  >
                    <option value="">All Customers</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={loadActiveReport}
                  disabled={loadingReport}
                >
                  {loadingReport ? 'Calculating…' : 'Calculate Aging'}
                </button>
              </div>
            </div>
          </div>

          {agingReport && (
            <>
              {/* Aging Summary Buckets */}
              <div className="metrics-grid">
                <div className="metric-card">
                  <div>
                    <p className="metric-label">Total Outstanding Dues</p>
                    <h3
                      className="metric-value"
                      style={{ color: agingReport.summary.total_receivable > 0 ? '#dc2626' : '#10b981' }}
                    >
                      {money(agingReport.summary.total_receivable)}
                    </h3>
                    <p className="metric-sub">{agingReport.summary.unpaid_invoices_count} unpaid invoices</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#fef2f2', color: '#dc2626' }}>
                    ₹
                  </div>
                </div>

                <div className="metric-card">
                  <div>
                    <p className="metric-label">0–30 Days (Current)</p>
                    <h3 className="metric-value" style={{ color: '#059669' }}>
                      {money(agingReport.summary.total_0_30)}
                    </h3>
                    <p className="metric-sub">Recent billing cycle</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
                    🟢
                  </div>
                </div>

                <div className="metric-card">
                  <div>
                    <p className="metric-label">31–60 Days Overdue</p>
                    <h3 className="metric-value" style={{ color: '#d97706' }}>
                      {money(agingReport.summary.total_31_60)}
                    </h3>
                    <p className="metric-sub">Follow-up reminder recommended</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#fffbeb', color: '#d97706' }}>
                    🟡
                  </div>
                </div>

                <div className="metric-card">
                  <div>
                    <p className="metric-label">61+ Days Overdue (Critical)</p>
                    <h3 className="metric-value" style={{ color: '#b91c1c' }}>
                      {money(agingReport.summary.total_61_plus)}
                    </h3>
                    <p className="metric-sub">Immediate collection action</p>
                  </div>
                  <div className="metric-icon-wrap" style={{ background: '#fef2f2', color: '#b91c1c' }}>
                    🔴
                  </div>
                </div>
              </div>

              {/* Overdue Invoices Table */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <h3 className="card-title">Accounts Receivable Schedule</h3>
                    <p className="card-desc">
                      Detailed schedule of pending invoices with overdue days calculation
                    </p>
                  </div>
                </div>

                {agingReport.invoices.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">🎉</div>
                    <h4>No outstanding balances</h4>
                    <p>All invoices are fully settled as of {agingReport.summary.as_of_date}.</p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Invoice ID</th>
                          <th>Customer Name</th>
                          <th>Due Date</th>
                          <th>Days Overdue</th>
                          <th>Bucket</th>
                          <th>Invoice Total</th>
                          <th>Paid Amount</th>
                          <th>Balance Due</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agingReport.invoices.map((inv) => (
                          <tr key={inv.invoice_id}>
                            <td>
                              <span className="mono-text">{inv.invoice_id}</span>
                            </td>
                            <td style={{ fontWeight: 600 }}>{inv.customer_name}</td>
                            <td>{inv.due_date}</td>
                            <td
                              style={{
                                fontWeight: 600,
                                color: inv.overdue_days > 30 ? '#dc2626' : '#475569',
                              }}
                            >
                              {inv.overdue_days > 0
                                ? `${inv.overdue_days} days`
                                : 'Current (On Time)'}
                            </td>
                            <td>
                              <span
                                style={{
                                  fontSize: '11px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontWeight: 600,
                                  background:
                                    inv.bucket === '0-30 days'
                                      ? '#dcfce7'
                                      : inv.bucket === '31-60 days'
                                      ? '#fef3c7'
                                      : '#fee2e2',
                                  color:
                                    inv.bucket === '0-30 days'
                                      ? '#15803d'
                                      : inv.bucket === '31-60 days'
                                      ? '#b45309'
                                      : '#b91c1c',
                                }}
                              >
                                {inv.bucket}
                              </span>
                            </td>
                            <td>{money(inv.total_amount)}</td>
                            <td>{money(inv.amount_paid)}</td>
                            <td style={{ fontWeight: 700, color: '#dc2626' }}>
                              {money(inv.balance_due)}
                            </td>
                            <td>
                              <StatusBadge status={inv.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
