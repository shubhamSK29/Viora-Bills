export default function Alert({ type = 'error', message, onDismiss }) {
  if (!message) return null

  const isError = type === 'error'

  return (
    <div
      className={`alert ${isError ? 'alert-error' : 'alert-success'} no-print`}
      role={isError ? 'alert' : 'status'}
    >
      <span>{message}</span>
      {onDismiss && (
        <button className="alert-dismiss" onClick={onDismiss} type="button">
          ✕
        </button>
      )}
    </div>
  )
}

