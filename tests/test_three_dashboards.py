"""
test_three_dashboards.py – Automated tests for the Three Role-Based Dashboards:
1. Admin Dashboard (/admin/dashboard)
2. Staff Dashboard (/staff/dashboard)
3. Customer Dashboard (/customer/dashboard) & Customer Portal Endpoints
Plus strict verification of Role-Based Access Control (RBAC) and customer data isolation.
"""
import pytest
from fastapi.testclient import TestClient


class TestAdminDashboard:
    """Test suite for Admin Dashboard (/admin/dashboard)."""

    def test_admin_dashboard_success(self, api_client: TestClient, admin_headers: dict):
        res = api_client.get("/admin/dashboard", headers=admin_headers)
        assert res.status_code == 200, f"Expected 200 OK, got: {res.text}"
        data = res.json()
        assert data["role"] == "admin"

        # Verify Statistics
        stats = data.get("stats", {})
        assert "total_revenue" in stats
        assert "total_invoices" in stats
        assert "total_customers" in stats
        assert "total_products" in stats
        assert "total_payments_received" in stats
        assert "pending_payments" in stats
        assert "overdue_invoices" in stats
        assert "total_staff" in stats
        assert stats["total_staff"] >= 1

        # Verify Revenue Analytics
        analytics = data.get("revenue_analytics", {})
        assert "monthly_revenue" in analytics
        assert isinstance(analytics["monthly_revenue"], list)
        assert "weekly_revenue" in analytics
        assert isinstance(analytics["weekly_revenue"], list)
        assert "payment_methods" in analytics
        assert isinstance(analytics["payment_methods"], list)
        assert "paid_vs_pending" in analytics
        assert "paid_amount" in analytics["paid_vs_pending"]
        assert "pending_amount" in analytics["paid_vs_pending"]

        # Verify Recent Activity
        activity = data.get("recent_activity", {})
        assert "recent_invoices" in activity
        assert "recent_payments" in activity

    def test_admin_dashboard_staff_forbidden(self, api_client: TestClient, staff_headers: dict):
        res = api_client.get("/admin/dashboard", headers=staff_headers)
        assert res.status_code == 403, "Staff must be forbidden from accessing Admin Dashboard"

    def test_admin_dashboard_customer_forbidden(self, api_client: TestClient, customer_headers: dict):
        res = api_client.get("/admin/dashboard", headers=customer_headers)
        assert res.status_code == 403, "Customer must be forbidden from accessing Admin Dashboard"

    def test_admin_dashboard_unauthenticated(self, api_client: TestClient):
        res = api_client.get("/admin/dashboard")
        assert res.status_code == 401, "Unauthenticated request must be rejected with 401"


class TestStaffDashboard:
    """Test suite for Staff Dashboard (/staff/dashboard)."""

    def test_staff_dashboard_success(self, api_client: TestClient, staff_headers: dict):
        res = api_client.get("/staff/dashboard", headers=staff_headers)
        assert res.status_code == 200, f"Expected 200 OK, got: {res.text}"
        data = res.json()
        assert data["role"] == "staff"

        # Verify Operational Statistics
        stats = data.get("stats", {})
        assert "invoices_created_by_me_count" in stats
        assert "invoices_created_by_me_amount" in stats
        assert "payments_recorded_by_me_count" in stats
        assert "payments_recorded_by_me_amount" in stats
        assert "pending_payments_amount" in stats
        assert "partially_paid_invoices_count" in stats
        assert "overdue_invoices_count" in stats
        assert "total_customers_managed" in stats
        assert "total_products_count" in stats
        assert "pending_cheques_count" in stats
        assert "pending_upi_claims_count" in stats

        # Verify Recent Activity
        activity = data.get("recent_activity", {})
        assert "recent_invoices" in activity
        assert "recent_payments" in activity

    def test_staff_dashboard_admin_allowed(self, api_client: TestClient, admin_headers: dict):
        res = api_client.get("/staff/dashboard", headers=admin_headers)
        assert res.status_code == 200, "Admin is permitted to inspect staff operational dashboard"

    def test_staff_dashboard_customer_forbidden(self, api_client: TestClient, customer_headers: dict):
        res = api_client.get("/staff/dashboard", headers=customer_headers)
        assert res.status_code == 403, "Customer must be forbidden from accessing Staff Dashboard"

    def test_staff_dashboard_unauthenticated(self, api_client: TestClient):
        res = api_client.get("/staff/dashboard")
        assert res.status_code == 401, "Unauthenticated request must be rejected with 401"


class TestCustomerDashboardAndPortal:
    """Test suite for Customer Self-Service Dashboard and Portal endpoints."""

    def test_customer_dashboard_success(self, api_client: TestClient, customer_headers: dict):
        res = api_client.get("/customer/dashboard", headers=customer_headers)
        assert res.status_code == 200, f"Expected 200 OK, got: {res.text}"
        data = res.json()
        assert data["role"] == "customer"
        assert "customer" in data
        assert data["customer"]["name"] == "Acme Retailers Ltd"

        stats = data.get("stats", {})
        assert "total_invoices_count" in stats
        assert "total_invoiced_amount" in stats
        assert "outstanding_amount" in stats
        assert "paid_invoices_count" in stats
        assert "unpaid_invoices_count" in stats
        assert "partially_paid_invoices_count" in stats
        assert "overdue_invoices_count" in stats
        assert "total_payments_count" in stats

        assert "recent_invoices" in data
        assert "recent_payments" in data

    def test_customer_invoices_endpoint(self, api_client: TestClient, customer_headers: dict):
        res = api_client.get("/customer/invoices", headers=customer_headers)
        assert res.status_code == 200
        data = res.json()
        assert "items" in data
        assert "total" in data
        assert "page" in data
        assert "total_pages" in data

    def test_customer_payments_endpoint(self, api_client: TestClient, customer_headers: dict):
        res = api_client.get("/customer/payments", headers=customer_headers)
        assert res.status_code == 200
        data = res.json()
        assert "items" in data
        assert "total" in data

    def test_customer_profile_get_and_update(self, api_client: TestClient, customer_headers: dict):
        # 1. Get Profile
        res = api_client.get("/customer/profile", headers=customer_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["customer"]["name"] == "Acme Retailers Ltd"

        # 2. Update Profile (phone and billing address)
        new_phone = "+91 98765 43210"
        new_address = "Unit 402, Trade Tower, Bandra Kurla Complex, Mumbai"
        up_res = api_client.put(
            "/customer/profile",
            headers=customer_headers,
            json={"phone": new_phone, "billing_address": new_address},
        )
        assert up_res.status_code == 200
        up_data = up_res.json()
        assert up_data["customer"]["phone"] == new_phone
        assert up_data["customer"]["billing_address"] == new_address


class TestCustomerDataIsolationAndRestrictions:
    """Strict tests verifying customer cannot access other customer records or management APIs."""

    def test_customer_cannot_access_users(self, api_client: TestClient, customer_headers: dict):
        res = api_client.get("/users", headers=customer_headers)
        assert res.status_code == 403, "Customers must never be allowed to access /users"

    def test_customer_cannot_access_company_settings(self, api_client: TestClient, customer_headers: dict):
        res = api_client.get("/settings/company", headers=customer_headers)
        assert res.status_code == 403, "Customers must never be allowed to access /settings/company"

    def test_customer_cannot_create_invoice(self, api_client: TestClient, customer_headers: dict):
        res = api_client.post(
            "/invoices",
            headers=customer_headers,
            json={
                "customer_id": "507f1f77bcf86cd799439011",
                "invoice_date": "2026-11-08",
                "items": [{"name": "Item A", "quantity": 1, "unit_price": 100, "gst_rate": 18}],
            },
        )
        assert res.status_code == 403, "Customers must never be allowed to create invoices"

    def test_customer_cannot_record_manual_payment(self, api_client: TestClient, customer_headers: dict):
        res = api_client.post(
            "/payments",
            headers=customer_headers,
            json={
                "invoice_id": "507f1f77bcf86cd799439011",
                "amount": 500,
                "payment_method": "Cash",
            },
        )
        assert res.status_code == 403, "Customers must never be allowed to record cash/cheque payments"

    def test_customer_invoice_data_isolation(
        self, api_client: TestClient, admin_headers: dict, customer_headers: dict
    ):
        import uuid
        uid = uuid.uuid4().hex[:6]
        # 1. Admin creates another customer
        c_res = api_client.post(
            "/customers",
            headers=admin_headers,
            json={
                "name": f"Different Customer {uid}",
                "email": f"diff_{uid}@corp.com",
                "phone": "9999999999",
                "billing_address": "Pune, Maharashtra",
                "state": "Maharashtra",
            },
        )
        assert c_res.status_code == 201
        diff_cust_id = c_res.json()["id"]

        # Admin creates or gets a product
        prod_res = api_client.post(
            "/products",
            headers=admin_headers,
            json={
                "name": f"Consulting Service SKU {uid}",
                "price": 5000.0,
                "unit": "hours",
                "gst_rate": 18.0,
            },
        )
        assert prod_res.status_code in [201, 200]
        prod_id = prod_res.json()["id"]

        # 2. Admin creates an invoice for Different Customer Corp
        inv_res = api_client.post(
            "/invoices",
            headers=admin_headers,
            json={
                "customer_id": diff_cust_id,
                "invoice_date": "2026-11-08",
                "items": [
                    {
                        "product_id": prod_id,
                        "quantity": 1,
                    }
                ],
            },
        )
        assert inv_res.status_code == 201
        diff_invoice_id = inv_res.json()["id"]

        # 3. Customer attempts to view Different Customer's invoice -> MUST BE 403 FORBIDDEN
        view_res = api_client.get(f"/invoices/{diff_invoice_id}", headers=customer_headers)
        assert view_res.status_code == 403, "Customer must be forbidden from viewing another customer's invoice"

        # 4. Customer attempts to download Different Customer's invoice PDF -> MUST BE 403 FORBIDDEN
        pdf_res = api_client.get(f"/invoices/{diff_invoice_id}/pdf", headers=customer_headers)
        assert pdf_res.status_code == 403, "Customer must be forbidden from downloading another customer's invoice PDF"


class TestCustomerInvitationFlow:
    """Test suite for customer portal invitation link generation, token verification, and acceptance."""

    def test_invite_generation_by_staff_and_admin(
        self, api_client: TestClient, admin_headers: dict, staff_headers: dict, customer_headers: dict
    ):
        import uuid
        uid = uuid.uuid4().hex[:6]

        # 1. Admin creates a customer
        c_res = api_client.post(
            "/customers",
            headers=admin_headers,
            json={
                "name": f"Invite Test Corp {uid}",
                "email": f"invite_{uid}@testcorp.in",
                "phone": "9811122233",
                "billing_address": "Tech Zone 4, Noida",
                "state": "Uttar Pradesh",
            },
        )
        assert c_res.status_code == 201
        cust_id = c_res.json()["id"]

        # 2. Staff generates an invitation link
        inv_res = api_client.post(f"/customers/{cust_id}/invite", headers=staff_headers)
        assert inv_res.status_code == 200, f"Expected 200 OK, got: {inv_res.text}"
        inv_data = inv_res.json()
        assert "token" in inv_data
        assert "invitation_link" in inv_data
        assert inv_data["email"] == f"invite_{uid}@testcorp.in"
        token = inv_data["token"]

        # 3. Customer role is forbidden from generating invites
        cust_invite_res = api_client.post(f"/customers/{cust_id}/invite", headers=customer_headers)
        assert cust_invite_res.status_code == 403

        # 4. Public token verification
        verify_res = api_client.get(f"/auth/verify-invite?token={token}")
        assert verify_res.status_code == 200
        verify_data = verify_res.json()
        assert verify_data["valid"] is True
        assert verify_data["customer_name"] == f"Invite Test Corp {uid}"
        assert verify_data["email"] == f"invite_{uid}@testcorp.in"

        # 5. Invalid token returns error
        invalid_res = api_client.get("/auth/verify-invite?token=non_existent_token_12345")
        assert invalid_res.status_code in [400, 404]

        # 6. Customer accepts invite and sets password
        accept_res = api_client.post(
            "/auth/accept-invite",
            json={
                "token": token,
                "password": "CustomerSecurePass123!",
                "full_name": f"Director {uid}",
            },
        )
        assert accept_res.status_code == 200
        accept_data = accept_res.json()
        assert accept_data["role"] == "customer"
        assert accept_data["customer_id"] == cust_id

        # 7. Customer logs in with newly created credentials
        login_res = api_client.post(
            "/auth/login",
            json={
                "email": f"invite_{uid}@testcorp.in",
                "password": "CustomerSecurePass123!",
            },
        )
        assert login_res.status_code == 200
        login_data = login_res.json()
        assert "access_token" in login_data
        assert login_data["user"]["role"] == "customer"
        assert login_data["user"]["customer_id"] == cust_id

        # 8. Reusing the same invite token is rejected
        reuse_res = api_client.post(
            "/auth/accept-invite",
            json={
                "token": token,
                "password": "AnotherPassword456!",
                "full_name": "Duplicate Attempt",
            },
        )
        assert reuse_res.status_code in [400, 404]


class TestInAppNotificationsAndAuditLogs:
    """Test suite for Notifications and Audit Logs across all roles."""

    def test_notifications_endpoints(
        self, api_client: TestClient, admin_headers: dict, staff_headers: dict, customer_headers: dict
    ):
        # 1. Admin can list notifications
        admin_notif_res = api_client.get("/notifications", headers=admin_headers)
        assert admin_notif_res.status_code == 200
        notifs = admin_notif_res.json()
        assert "items" in notifs
        assert isinstance(notifs["items"], list)
        assert "unread_count" in notifs

        # 2. Staff can list notifications
        staff_notif_res = api_client.get("/notifications", headers=staff_headers)
        assert staff_notif_res.status_code == 200
        assert "items" in staff_notif_res.json()

        # 3. Customer can list notifications
        cust_notif_res = api_client.get("/notifications", headers=customer_headers)
        assert cust_notif_res.status_code == 200
        assert "items" in cust_notif_res.json()

        # 4. Mark all read
        mark_all_res = api_client.put("/notifications/read-all", headers=admin_headers)
        assert mark_all_res.status_code == 200
        assert mark_all_res.json()["status"] == "success"

    def test_audit_logs_access_control(
        self, api_client: TestClient, admin_headers: dict, staff_headers: dict, customer_headers: dict
    ):
        # 1. Admin has full access to audit logs
        admin_audit_res = api_client.get("/audit-logs", headers=admin_headers)
        assert admin_audit_res.status_code == 200
        audit_data = admin_audit_res.json()
        assert "items" in audit_data
        assert "total" in audit_data
        assert "page" in audit_data
        assert isinstance(audit_data["items"], list)

        # 2. Staff is strictly forbidden
        staff_audit_res = api_client.get("/audit-logs", headers=staff_headers)
        assert staff_audit_res.status_code == 403, "Staff must never access financial audit logs"

        # 3. Customer is strictly forbidden
        cust_audit_res = api_client.get("/audit-logs", headers=customer_headers)
        assert cust_audit_res.status_code == 403, "Customer must never access financial audit logs"


class TestEnrichedDashboardMetrics:
    """Test suite for advanced analytics on all three dashboards."""

    def test_admin_dashboard_advanced_metrics(self, api_client: TestClient, admin_headers: dict):
        res = api_client.get("/admin/dashboard", headers=admin_headers)
        assert res.status_code == 200
        data = res.json()
        # Verify top customers
        assert "top_customers" in data
        assert isinstance(data["top_customers"], list)
        # Verify pending queues in stats
        stats = data.get("stats", {})
        assert "pending_cheques_count" in stats
        assert "pending_upi_claims_count" in stats

    def test_staff_dashboard_todays_metrics_and_follow_ups(self, api_client: TestClient, staff_headers: dict):
        res = api_client.get("/staff/dashboard", headers=staff_headers)
        assert res.status_code == 200
        data = res.json()
        stats = data.get("stats", {})
        assert "todays_invoices_count" in stats
        assert "todays_invoices_amount" in stats
        assert "todays_collections_count" in stats
        assert "todays_collections_amount" in stats
        assert "pending_follow_ups" in data
        assert isinstance(data["pending_follow_ups"], list)

    def test_customer_dashboard_upcoming_and_overdue(self, api_client: TestClient, customer_headers: dict):
        res = api_client.get("/customer/dashboard", headers=customer_headers)
        assert res.status_code == 200
        data = res.json()
        stats = data.get("stats", {})
        assert "upcoming_due_invoices_count" in stats
        assert "upcoming_due_invoices" in data
        assert "overdue_invoices" in data
        assert isinstance(data["upcoming_due_invoices"], list)
        assert isinstance(data["overdue_invoices"], list)
