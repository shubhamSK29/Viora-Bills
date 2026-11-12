export default function Pagination({
  page = 1,
  totalPages = 1,
  total = 0,
  limit = 20,
  onPageChange,
  onLimitChange,
  loading = false,
}) {
  if (total <= 0 && totalPages <= 1) return null

  const startIdx = total === 0 ? 0 : (page - 1) * limit + 1
  const endIdx = Math.min(page * limit, total)

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '14px 16px',
        borderTop: '1px solid #e2e8f0',
        background: '#f8fafc',
        borderRadius: '0 0 8px 8px',
        fontSize: '13px',
        color: '#64748b',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>
          Showing <strong>{startIdx}</strong>–<strong>{endIdx}</strong> of{' '}
          <strong>{total}</strong> records
        </span>
        {onLimitChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '12px' }}>
            <span>Per page:</span>
            <select
              className="form-control"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              disabled={loading}
              style={{
                padding: '2px 8px',
                fontSize: '12px',
                width: 'auto',
                display: 'inline-block',
                height: '28px',
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
          style={{ padding: '4px 10px' }}
        >
          ‹ Prev
        </button>

        <span style={{ padding: '0 8px', fontWeight: 600, color: '#334155' }}>
          Page {page} of {Math.max(1, totalPages)}
        </span>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= totalPages || loading}
          onClick={() => onPageChange(page + 1)}
          style={{ padding: '4px 10px' }}
        >
          Next ›
        </button>
      </div>
    </div>
  )
}

