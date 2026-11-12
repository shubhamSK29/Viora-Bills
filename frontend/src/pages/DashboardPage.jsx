import { Navigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function DashboardPage() {
  const { userRole } = useAuth()
  const outletContext = useOutletContext() || {}
  const role = outletContext.userRole || userRole

  if (role === 'admin') {
    return <Navigate to="/admin/dashboard" replace />
  }

  if (role === 'customer') {
    return <Navigate to="/customer/dashboard" replace />
  }

  return <Navigate to="/staff/dashboard" replace />
}
