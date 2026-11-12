export default function StatusBadge({ status }) {
  const s = String(status || '').toUpperCase()

  if (s === 'PAID' || s === 'SUCCESS' || s === 'CLEARED') {
    return (
      <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <span className="status-dot online" /> {s === 'SUCCESS' ? 'Success' : s === 'CLEARED' ? 'Cleared' : 'Paid'}
      </span>
    )
  }

  if (s === 'PARTIALLY_PAID' || s === 'PARTIALLY PAID' || s === 'PARTIAL') {
    return (
      <span className="badge badge-partially-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <span className="status-dot" style={{ backgroundColor: '#f59e0b' }} /> Partially Paid
      </span>
    )
  }

  if (s === 'PENDING_VERIFICATION') {
    return (
      <span
        className="badge"
        style={{
          background: '#fffbeb',
          color: '#b45309',
          border: '1px solid #fde68a',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          fontWeight: 600,
        }}
      >
        <span className="status-dot" style={{ backgroundColor: '#d97706' }} /> Pending Verification
      </span>
    )
  }

  if (s === 'PENDING' || s === 'PROCESSING') {
    return (
      <span
        className="badge"
        style={{
          background: '#fffbeb',
          color: '#b45309',
          border: '1px solid #fde68a',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          fontWeight: 600,
        }}
      >
        <span className="status-dot" style={{ backgroundColor: '#d97706' }} /> Pending
      </span>
    )
  }

  if (s === 'FAILED') {
    return (
      <span className="badge badge-unpaid" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <span className="status-dot offline" /> Failed
      </span>
    )
  }

  if (s === 'BOUNCED') {
    return (
      <span className="badge badge-unpaid" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <span className="status-dot offline" /> Bounced
      </span>
    )
  }

  if (s === 'OVERDUE') {
    return (
      <span
        className="badge"
        style={{
          background: '#fef2f2',
          color: '#991b1b',
          border: '1px solid #fecaca',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          fontWeight: 700,
        }}
      >
        <span className="status-dot offline" /> Overdue
      </span>
    )
  }

  if (s === 'REFUNDED' || s === 'CANCELLED') {
    return (
      <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <span className="status-dot" style={{ backgroundColor: '#94a3b8' }} /> {s === 'REFUNDED' ? 'Refunded' : 'Cancelled'}
      </span>
    )
  }

  return (
    <span className="badge badge-unpaid" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
      <span className="status-dot offline" /> Unpaid
    </span>
  )
}

