export default function LoadingSpinner({ message = 'Loading data…', size = 'medium' }) {
  const iconSize = size === 'large' ? '40px' : size === 'small' ? '18px' : '28px'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '36px 16px',
        color: '#64748b',
        gap: '12px',
      }}
    >
      <div
        style={{
          fontSize: iconSize,
          animation: 'spin 1s linear infinite',
          display: 'inline-block',
        }}
      >
        🔄
      </div>
      {message && <span style={{ fontSize: '13px' }}>{message}</span>}
    </div>
  )
}

