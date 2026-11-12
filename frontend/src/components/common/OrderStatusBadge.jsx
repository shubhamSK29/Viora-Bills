export default function OrderStatusBadge({ status }) {
  const s = String(status || '').toUpperCase()

  const map = {
    PENDING_REVIEW: { label: 'Pending Review', bg: 'rgba(245, 158, 11, 0.15)', text: '#d97706', dot: '#f59e0b' },
    UNDER_REVIEW: { label: 'Under Review', bg: 'rgba(59, 130, 246, 0.15)', text: '#2563eb', dot: '#3b82f6' },
    ACCEPTED: { label: 'Accepted', bg: 'rgba(16, 185, 129, 0.15)', text: '#059669', dot: '#10b981' },
    INVOICED: { label: 'Invoiced', bg: 'rgba(16, 185, 129, 0.2)', text: '#047857', dot: '#10b981' },
    REJECTED: { label: 'Rejected', bg: 'rgba(239, 68, 68, 0.15)', text: '#dc2626', dot: '#ef4444' },
    CANCELLED: { label: 'Cancelled', bg: 'rgba(107, 114, 128, 0.15)', text: '#4b5563', dot: '#9ca3af' },
  }

  const conf = map[s] || { label: s || 'Unknown', bg: 'rgba(107, 114, 128, 0.15)', text: '#4b5563', dot: '#9ca3af' }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 9px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: conf.bg,
        color: conf.text,
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: conf.dot,
        }}
      />
      {conf.label}
    </span>
  )
}

