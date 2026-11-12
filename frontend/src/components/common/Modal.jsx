export default function Modal({ isOpen = true, onClose, title, children, maxWidth = '600px', className = '' }) {
  if (isOpen === false) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-content ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth }}
      >
        <div className="modal-header no-print">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} type="button">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

