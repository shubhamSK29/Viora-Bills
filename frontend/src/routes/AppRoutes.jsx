import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import RoleRoute from './RoleRoute'
import AppLayout from '../layouts/AppLayout'
import LoginPage from '../pages/LoginPage'
import AcceptInvitePage from '../pages/AcceptInvitePage'
import DashboardPage from '../pages/DashboardPage'
import AdminDashboardPage from '../pages/AdminDashboardPage'
import StaffDashboardPage from '../pages/StaffDashboardPage'
import CustomerDashboardPage from '../pages/CustomerDashboardPage'
import CustomerInvoicesPage from '../pages/CustomerInvoicesPage'
import CustomerPaymentsPage from '../pages/CustomerPaymentsPage'
import CustomerProfilePage from '../pages/CustomerProfilePage'
import CustomerCataloguePage from '../pages/CustomerCataloguePage'
import CustomerCartPage from '../pages/CustomerCartPage'
import CustomerCheckoutPage from '../pages/CustomerCheckoutPage'
import CustomerOrdersPage from '../pages/CustomerOrdersPage'
import CustomerPurchasesPage from '../pages/CustomerPurchasesPage'
import OrdersPage from '../pages/OrdersPage'
import CustomersPage from '../pages/CustomersPage'
import ProductsPage from '../pages/ProductsPage'
import InvoicesPage from '../pages/InvoicesPage'
import PaymentsPage from '../pages/PaymentsPage'
import ReportsPage from '../pages/ReportsPage'
import SettingsPage from '../pages/SettingsPage'
import UsersPage from '../pages/UsersPage'
import AuditLogsPage from '../pages/AuditLogsPage'
import EmailDeliveryLogsPage from '../pages/EmailDeliveryLogsPage'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<LoginPage initialTab="signup" />} />
      <Route path="/invite" element={<AcceptInvitePage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        {/* Default redirect to role-specific dashboard via DashboardPage router */}
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />

        {/* Dedicated Role Dashboards */}
        <Route
          path="admin/dashboard"
          element={
            <RoleRoute allowedRoles={['admin']}>
              <AdminDashboardPage />
            </RoleRoute>
          }
        />
        <Route
          path="staff/dashboard"
          element={
            <RoleRoute allowedRoles={['staff', 'admin']}>
              <StaffDashboardPage />
            </RoleRoute>
          }
        />
        <Route
          path="customer/dashboard"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerDashboardPage />
            </RoleRoute>
          }
        />

        {/* Customer Portal Pages */}
        <Route
          path="customer/catalogue"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerCataloguePage />
            </RoleRoute>
          }
        />
        <Route
          path="customer/cart"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerCartPage />
            </RoleRoute>
          }
        />
        <Route
          path="customer/checkout"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerCheckoutPage />
            </RoleRoute>
          }
        />
        <Route
          path="customer/orders"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerOrdersPage />
            </RoleRoute>
          }
        />
        <Route
          path="customer/purchases"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerPurchasesPage />
            </RoleRoute>
          }
        />
        <Route
          path="customer/invoices"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerInvoicesPage />
            </RoleRoute>
          }
        />
        <Route
          path="customer/payments"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerPaymentsPage />
            </RoleRoute>
          }
        />
        <Route
          path="customer/receipts"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerPaymentsPage />
            </RoleRoute>
          }
        />
        <Route
          path="customer/profile"
          element={
            <RoleRoute allowedRoles={['customer']}>
              <CustomerProfilePage />
            </RoleRoute>
          }
        />

        {/* Operational & Admin Management Pages (Forbidden to Customers) */}
        <Route
          path="orders"
          element={
            <RoleRoute allowedRoles={['admin', 'staff']}>
              <OrdersPage />
            </RoleRoute>
          }
        />
        <Route
          path="customers"
          element={
            <RoleRoute allowedRoles={['admin', 'staff']}>
              <CustomersPage />
            </RoleRoute>
          }
        />
        <Route
          path="products"
          element={
            <RoleRoute allowedRoles={['admin', 'staff']}>
              <ProductsPage />
            </RoleRoute>
          }
        />
        <Route
          path="invoices"
          element={
            <RoleRoute allowedRoles={['admin', 'staff']}>
              <InvoicesPage />
            </RoleRoute>
          }
        />
        <Route
          path="payments"
          element={
            <RoleRoute allowedRoles={['admin', 'staff']}>
              <PaymentsPage />
            </RoleRoute>
          }
        />
        <Route
          path="reports"
          element={
            <RoleRoute allowedRoles={['admin', 'staff']}>
              <ReportsPage />
            </RoleRoute>
          }
        />
        <Route
          path="email-logs"
          element={
            <RoleRoute allowedRoles={['admin', 'staff']}>
              <EmailDeliveryLogsPage />
            </RoleRoute>
          }
        />

        {/* Admin Exclusive Pages */}
        <Route
          path="settings"
          element={
            <RoleRoute allowedRoles={['admin']}>
              <SettingsPage />
            </RoleRoute>
          }
        />
        <Route
          path="users"
          element={
            <RoleRoute allowedRoles={['admin']}>
              <UsersPage />
            </RoleRoute>
          }
        />
        <Route
          path="audit-logs"
          element={
            <RoleRoute allowedRoles={['admin']}>
              <AuditLogsPage />
            </RoleRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
