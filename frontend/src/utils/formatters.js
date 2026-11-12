export const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)

export const formatDate = (val) => {
  if (!val) return '—'
  try {
    return String(val).slice(0, 10)
  } catch {
    return '—'
  }
}

