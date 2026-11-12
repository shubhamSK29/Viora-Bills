import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function RoleRoute({ allowedRoles = ['admin'], children }) {
  const { userRole } = useAuth()

  if (!allowedRoles.includes(userRole)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

