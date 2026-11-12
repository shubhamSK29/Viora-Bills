import AppLayout from './AppLayout'
import RoleRoute from '../routes/RoleRoute'

export default function AdminLayout() {
  return (
    <RoleRoute allowedRoles={['admin']}>
      <AppLayout />
    </RoleRoute>
  )
}

