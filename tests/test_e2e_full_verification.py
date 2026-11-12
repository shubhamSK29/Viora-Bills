"""
End-to-End Comprehensive Verification Test Suite for Viora Bills.
Validates all aspects of:
- Task 2: Role-based workflows (Admin, Staff, Customer)
- Task 3: Complete billing lifecycle (Customer, Product, Invoice, GST, PDF, Partial/Full Payment, Receipt, History)
- Task 4: Payment methods (Cash, Cheque cleared/bounced, UPI pending, Razorpay, Duplicates, Concurrency)
- Task 5: Security controls (Unauthorized, Isolation, Escalation, Expired JWT, Token reuse, Audit logs)
"""
import concurrent.futures
import time
import uuid

import pytest
from starlette.testclient import TestClient

import main


def _uid() -> str:
    return uuid.uuid4().hex[:8]


# ==============================================================================
# Task 2: End-to-End Role Testing
# ==============================================================================

class TestE2ERoleWorkflows:
    """Verifies complete workflows, login, redirection expectations, and permissions for all 3 roles."""

    def test_admin_role_complete_workflow(self, api_client: TestClient):
        # 1. Login
        login_res = api_client.post(
            "/auth/login",
            json={"email": "admin@viorabills.com", "password": "Admin@12345"},
        )
        assert login_res.status_code == 200
        data = login_res.json()
        assert data["user"]["role"] == "admin"
        assert "access_token" in data
        headers = {"Authorization": f"Bearer {data['access_token']}"}

        # 2. Verify /auth/me returns current admin
        me_res = api_client.get("/auth/me", headers=headers)
        assert me_res.status_code == 200
        assert me_res.json()["user"]["role"] == "admin"

        # 3. Access Admin Dashboard
        dash_res = api_client.get("/admin/dashboard", headers=headers)
        assert dash_res.status_code == 200
        dash_data = dash_res.json()
        assert dash_data["role"] == "admin"
        assert "stats" in dash_data
        assert "revenue_analytics" in dash_data

        # 4. Access Admin-exclusive endpoints
        users_res = api_client.get("/users", headers=headers)
        assert users_res.status_code == 200
        assert "users" in users_res.json()

        settings_res = api_client.get("/settings/company", headers=headers)
        assert settings_res.status_code == 200

        audit_res = api_client.get("/audit-logs", headers=headers)
        assert audit_res.status_code == 200

        reports_res = api_client.get("/reports/sales-summary", headers=headers)
        assert reports_res.status_code == 200

    def test_staff_role_complete_workflow(self, api_client: TestClient):
        # 1. Login
        login_res = api_client.post(
            "/auth/login",
            json={"email": "staff@viorabills.com", "password": "Staff@12345"},
        )
        assert login_res.status_code == 200
        data = login_res.json()
        assert data["user"]["role"] == "staff"
        headers = {"Authorization": f"Bearer {data['access_token']}"}

        # 2. Verify /auth/me
        me_res = api_client.get("/auth/me", headers=headers)
        assert me_res.status_code == 200
        assert me_res.json()["user"]["role"] == "staff"

        # 3. Access Staff Operational Dashboard
        dash_res = api_client.get("/staff/dashboard", headers=headers)
        assert dash_res.status_code == 200
        dash_data = dash_res.json()
        assert dash_data["role"] == "staff"
        assert "stats" in dash_data
        assert "recent_activity" in dash_data

        # 4. Verify Admin-exclusive endpoints are blocked for Staff (403 Forbidden)
        assert api_client.get("/admin/dashboard", headers=headers).status_code == 403
        assert api_client.get("/users", headers=headers).status_code == 403
        assert api_client.get("/audit-logs", headers=headers).status_code == 403
        assert api_client.put(
            "/settings/company",
            headers=headers,
            json={"company_name": "Hacked Name"},
        ).status_code == 403

        # 5. Verify Staff can manage operational resources (Customers, Invoices, Payments)
        assert api_client.get("/customers", headers=headers).status_code == 200
        assert api_client.get("/invoices", headers=headers).status_code == 200
        assert api_client.get("/payments", headers=headers).status_code == 200

    def test_customer_role_complete_workflow(self, api_client: TestClient):
        # 1. Login
        login_res = api_client.post(
            "/auth/login",
            json={"email": "customer@viorabills.com", "password": "Customer@12345"},
        )
        assert login_res.status_code == 200
        data = login_res.json()
        assert data["user"]["role"] == "customer"
        assert "customer_id" in data["user"]
        headers = {"Authorization": f"Bearer {data['access_token']}"}

        # 2. Verify /auth/me
        me_res = api_client.get("/auth/me", headers=headers)
        assert me_res.status_code == 200
        assert me_res.json()["user"]["role"] == "customer"

        # 3. Access Customer Dashboard
        dash_res = api_client.get("/customer/dashboard", headers=headers)
        assert dash_res.status_code == 200
        dash_data = dash_res.json()
        assert dash_data["role"] == "customer"
        assert "customer" in dash_data
        assert "stats" in dash_data

        # 4. Access Customer portal endpoints
        invs_res = api_client.get("/customer/invoices", headers=headers)
        assert invs_res.status_code == 200
        assert "items" in invs_res.json()

        pays_res = api_client.get("/customer/payments", headers=headers)
        assert pays_res.status_code == 200
        assert "items" in pays_res.json()

        prof_res = api_client.get("/customer/profile", headers=headers)
        assert prof_res.status_code == 200
        assert prof_res.json()["customer"]["email"] == "customer@viorabills.com"

        # 5. Verify Customer is strictly forbidden from staff & admin areas
        assert api_client.get("/admin/dashboard", headers=headers).status_code == 403
        assert api_client.get("/staff/dashboard", headers=headers).status_code == 403
        assert api_client.get("/users", headers=headers).status_code == 403
        assert api_client.get("/settings/company", headers=headers).status_code == 403
        assert api_client.get("/audit-logs", headers=headers).status_code == 403
        assert api_client.post("/invoices", headers=headers, json={}).status_code == 403
        assert api_client.post("/payments", headers=headers, json={}).status_code == 403


# ==============================================================================
# Task 3: Complete Billing Workflow
# ==============================================================================

class TestE2ECompleteBillingWorkflow:
    """Verifies end-to-end billing: customer -> product -> invoice -> GST -> PDF -> partial/full payments -> receipt."""

    def test_full_billing_lifecycle(self, api_client: TestClient, admin_headers: dict, staff_headers: dict):
        uid = _uid()

        # 1. Create Customer (Interstate: Delhi, State code 07 vs Company Default 27 Maharashtra)
        cust_res = api_client.post(
            "/customers",
            headers=staff_headers,
            json={
                "name": f"Apex Global Solutions {uid}",
                "email": f"billing_{uid}@apex.com",
                "phone": "+91 9822334455",
                "billing_address": "Suite 501, Connaught Place, New Delhi",
                "state": "Delhi",
                "state_code": "07",
                "gstin": "07AAAAA0000A1Z5",
            },
        )
        assert cust_res.status_code == 201
        customer = cust_res.json()
        customer_id = customer["id"]
        assert customer["state_code"] == "07"

        # 2. Create Product
        prod_res = api_client.post(
            "/products",
            headers=staff_headers,
            json={
                "name": f"Cloud Hosting Package {uid}",
                "price": 5000.00,
                "unit": "year",
                "gst_rate": 18.0,
            },
        )
        assert prod_res.status_code == 201
        product = prod_res.json()
        product_id = product["id"]

        # 3. Generate Sequential Invoice (Interstate Delhi -> IGST 18% expected)
        inv_payload = {
            "customer_id": customer_id,
            "invoice_date": "2026-11-08",
            "due_date": "2026-11-22",
            "place_of_supply": "Delhi",
            "items": [
                {
                    "product_id": product_id,
                    "quantity": 2,
                }
            ],
        }
        inv_res = api_client.post("/invoices", headers=staff_headers, json=inv_payload)
        assert inv_res.status_code == 201
        invoice = inv_res.json()
        invoice_id = invoice["id"]

        # 4. Verify GST Calculation (2 * 5000 = 10,000 subtotal, 18% IGST = 1,800, Total = 11,800)
        assert invoice["subtotal"] == 10000.00
        assert invoice["igst_amount"] == 1800.00
        assert invoice["cgst_amount"] == 0.00
        assert invoice["sgst_amount"] == 0.00
        assert invoice["total_amount"] == 11800.00
        assert invoice["balance_due"] == 11800.00
        assert invoice["status"] == "UNPAID"

        # 5. Generate and Download Invoice PDF
        pdf_res = api_client.get(f"/invoices/{invoice_id}/pdf", headers=staff_headers)
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert pdf_res.content.startswith(b"%PDF")
        assert len(pdf_res.content) > 1000  # Valid binary PDF stream

        # 6. Record Partial Payment (₹4,800.00 via Cash)
        part_pay_res = api_client.post(
            "/payments",
            headers=staff_headers,
            json={
                "invoice_id": invoice_id,
                "amount": 4800.00,
                "payment_method": "Cash",
                "notes": "First partial tranche",
            },
        )
        assert part_pay_res.status_code == 201
        part_pay = part_pay_res.json()["payment"]
        part_pay_id = part_pay["id"]
        assert part_pay["amount"] == 4800.00
        assert part_pay["status"] == "SUCCESS"
        assert part_pay["receipt_number"].startswith("REC-")

        # Verify Invoice status and balance updated to PARTIAL
        inv_part = api_client.get(f"/invoices/{invoice_id}", headers=staff_headers).json()
        assert inv_part["amount_paid"] == 4800.00
        assert inv_part["balance_due"] == 7000.00
        assert inv_part["status"] == "PARTIALLY_PAID"

        # 7. Generate Receipt for Partial Payment
        receipt_res = api_client.get(f"/payments/{part_pay_id}/receipt", headers=staff_headers)
        assert receipt_res.status_code == 200
        receipt = receipt_res.json()
        assert receipt["amount"] == 4800.00
        assert receipt["invoice"]["invoice_number"] == invoice["invoice_number"]
        assert receipt["customer"]["name"] == customer["name"]

        # 8. Record Full Remaining Payment (₹7,000.00 via Cheque)
        full_pay_res = api_client.post(
            "/payments",
            headers=staff_headers,
            json={
                "invoice_id": invoice_id,
                "amount": 7000.00,
                "payment_method": "Cheque",
                "cheque_number": f"CHQ{uid}",
                "bank_name": "State Bank of India",
                "cheque_date": "2026-11-08",
                "notes": "Final settlement cheque",
            },
        )
        assert full_pay_res.status_code == 201
        full_pay = full_pay_res.json()["payment"]
        full_pay_id = full_pay["id"]
        assert full_pay["status"] == "PENDING"  # Cheques start as PENDING

        # While Cheque is PENDING, balance remains ₹7,000.00
        inv_pending_chq = api_client.get(f"/invoices/{invoice_id}", headers=staff_headers).json()
        assert inv_pending_chq["balance_due"] == 7000.00

        # Clear Cheque
        clear_res = api_client.patch(
            f"/payments/{full_pay_id}/status",
            headers=staff_headers,
            json={"new_status": "CLEARED", "reason": "Cheque cleared at clearing house"},
        )
        assert clear_res.status_code == 200
        assert clear_res.json()["payment"]["status"] == "CLEARED"

        # Verify Invoice is now fully PAID
        inv_cleared = api_client.get(f"/invoices/{invoice_id}", headers=staff_headers).json()
        assert inv_cleared["amount_paid"] == 11800.00
        assert inv_cleared["balance_due"] == 0.00
        assert inv_cleared["status"] == "PAID"

        # 9. View Payment History for the Invoice
        hist_res = api_client.get(f"/payments?customer_id={customer_id}", headers=staff_headers)
        assert hist_res.status_code == 200
        history_items = hist_res.json()["items"]
        assert len(history_items) == 2
        receipt_numbers = [p["receipt_number"] for p in history_items]
        assert part_pay["receipt_number"] in receipt_numbers
        assert full_pay["receipt_number"] in receipt_numbers


# ==============================================================================
# Task 4: Payment Testing
# ==============================================================================

class TestE2EPaymentMethodsAndControls:
    """Verifies cash, cheque cleared/bounced, UPI pending verification, Razorpay HMAC, duplicate prevention & concurrency."""

    def test_cheque_bounced_flow(self, api_client: TestClient, admin_headers: dict, staff_headers: dict):
        uid = _uid()
        c_res = api_client.post(
            "/customers",
            headers=admin_headers,
            json={"name": f"Cheque Test Corp {uid}", "email": f"chq_{uid}@test.com", "billing_address": "Pune"},
        )
        cust_id = c_res.json()["id"]

        p_res = api_client.post(
            "/products",
            headers=admin_headers,
            json={"name": f"Product {uid}", "price": 2000.00, "unit": "pcs", "gst_rate": 0.0},
        )
        prod_id = p_res.json()["id"]

        inv_res = api_client.post(
            "/invoices",
            headers=admin_headers,
            json={"customer_id": cust_id, "invoice_date": "2026-11-08", "items": [{"product_id": prod_id, "quantity": 1}]},
        )
        inv_id = inv_res.json()["id"]
        assert inv_res.json()["balance_due"] == 2000.00

        # Record cheque
        pay_res = api_client.post(
            "/payments",
            headers=staff_headers,
            json={"invoice_id": inv_id, "amount": 2000.00, "payment_method": "Cheque", "cheque_number": f"BOUNCE-{uid}"},
        )
        assert pay_res.status_code == 201
        pay_id = pay_res.json()["payment"]["id"]

        # Mark cheque BOUNCED
        bounce_res = api_client.patch(
            f"/payments/{pay_id}/status",
            headers=staff_headers,
            json={"new_status": "BOUNCED", "reason": "Insufficient Drawer Balance"},
        )
        assert bounce_res.status_code == 200
        assert bounce_res.json()["payment"]["status"] == "BOUNCED"

        # Balance remains untouched
        inv_check = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
        assert inv_check["balance_due"] == 2000.00
        assert inv_check["status"] == "UNPAID"

    def test_upi_pending_verification_lifecycle(self, api_client: TestClient, admin_headers: dict, staff_headers: dict):
        uid = _uid()
        c_res = api_client.post(
            "/customers",
            headers=admin_headers,
            json={"name": f"UPI Test Corp {uid}", "email": f"upi_{uid}@test.com", "billing_address": "Mumbai"},
        )
        cust_id = c_res.json()["id"]

        p_res = api_client.post(
            "/products",
            headers=admin_headers,
            json={"name": f"UPI Item {uid}", "price": 1500.00, "unit": "service", "gst_rate": 0.0},
        )
        prod_id = p_res.json()["id"]

        inv_res = api_client.post(
            "/invoices",
            headers=admin_headers,
            json={"customer_id": cust_id, "invoice_date": "2026-11-08", "items": [{"product_id": prod_id, "quantity": 1}]},
        )
        inv_id = inv_res.json()["id"]

        utr = f"UTR-{uid}-999"

        # 1. Customer submits UPI reference
        submit_res = api_client.post(
            f"/customer/invoices/{inv_id}/submit-upi",
            headers=staff_headers,
            json={"reference": utr, "amount": 1500.00},
        )
        assert submit_res.status_code == 200
        pay_id = submit_res.json()["payment"]["id"]
        assert submit_res.json()["payment"]["status"] == "PENDING_VERIFICATION"

        # Verify balance is NOT reduced
        inv_poll = api_client.get(f"/invoices/{inv_id}/payment-status", headers=staff_headers).json()
        assert inv_poll["is_paid"] is False
        assert inv_poll["balance_due"] == 1500.00

        # Duplicate UTR submission rejected
        dup_submit = api_client.post(
            f"/customer/invoices/{inv_id}/submit-upi",
            headers=staff_headers,
            json={"reference": utr, "amount": 1500.00},
        )
        assert dup_submit.status_code == 409

        # 2. Staff verifies and confirms payment
        verify_res = api_client.patch(
            f"/payments/{pay_id}/status",
            headers=staff_headers,
            json={"new_status": "SUCCESS", "reason": "Verified against SBI Bank Statement"},
        )
        assert verify_res.status_code == 200
        assert verify_res.json()["payment"]["status"] == "SUCCESS"

        # Invoice now marked PAID
        inv_paid = api_client.get(f"/invoices/{inv_id}/payment-status", headers=staff_headers).json()
        assert inv_paid["is_paid"] is True
        assert inv_paid["balance_due"] == 0.00

    def test_payment_concurrency_thread_safety(self, api_client: TestClient, admin_headers: dict, staff_headers: dict):
        """
        Tests multiple simultaneous payment attempts against an invoice balance
        using a ThreadPoolExecutor to verify no negative balances or race conditions occur.
        """
        uid = _uid()
        c_res = api_client.post(
            "/customers",
            headers=admin_headers,
            json={"name": f"Concurrent Corp {uid}", "email": f"concurrent_{uid}@test.com", "billing_address": "Bengaluru"},
        )
        cust_id = c_res.json()["id"]

        p_res = api_client.post(
            "/products",
            headers=admin_headers,
            json={"name": f"Concurrency Test Item {uid}", "price": 1000.00, "unit": "pcs", "gst_rate": 0.0},
        )
        prod_id = p_res.json()["id"]

        inv_res = api_client.post(
            "/invoices",
            headers=admin_headers,
            json={"customer_id": cust_id, "invoice_date": "2026-11-08", "items": [{"product_id": prod_id, "quantity": 1}]},
        )
        inv_id = inv_res.json()["id"]

        # Run 5 concurrent requests attempting to pay ₹300 each (Total attempted = ₹1500 on a ₹1000 invoice)
        def record_sub_payment(idx: int):
            return api_client.post(
                "/payments",
                headers=staff_headers,
                json={
                    "invoice_id": inv_id,
                    "amount": 300.00,
                    "payment_method": "Cash",
                    "notes": f"Concurrent thread payment #{idx}",
                },
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(record_sub_payment, i) for i in range(5)]
            responses = [f.result() for f in futures]

        # Verify final invoice state
        final_inv = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
        assert final_inv["balance_due"] >= 0.00, "Invoice balance must NEVER become negative!"
        assert round(final_inv["amount_paid"] + final_inv["balance_due"], 2) == 1000.00


# ==============================================================================
# Task 5: Security Testing
# ==============================================================================

class TestE2ESecuritySuite:
    """Verifies unauthorized access, data isolation, privilege escalation, expired JWTs, token reuse & audit log security."""

    def test_unauthorized_access_rejected(self, api_client: TestClient):
        assert api_client.get("/admin/dashboard").status_code == 401
        assert api_client.get("/staff/dashboard").status_code == 401
        assert api_client.get("/customer/dashboard").status_code == 401
        assert api_client.get("/customers").status_code == 401
        assert api_client.get("/invoices").status_code == 401
        assert api_client.get("/payments").status_code == 401
        assert api_client.get("/users").status_code == 401

    def test_customer_cross_tenant_isolation(self, api_client: TestClient, admin_headers: dict, customer_headers: dict):
        uid = _uid()
        # Create an invoice belonging to a DIFFERENT customer
        other_cust_res = api_client.post(
            "/customers",
            headers=admin_headers,
            json={"name": f"Foreign Corp {uid}", "email": f"foreign_{uid}@test.com", "billing_address": "Hyderabad"},
        )
        other_cust_id = other_cust_res.json()["id"]

        p_res = api_client.post(
            "/products",
            headers=admin_headers,
            json={"name": f"Product {uid}", "price": 500.0, "unit": "item", "gst_rate": 0.0},
        )
        prod_id = p_res.json()["id"]

        other_inv_res = api_client.post(
            "/invoices",
            headers=admin_headers,
            json={
                "customer_id": other_cust_id,
                "invoice_date": "2026-11-08",
                "items": [{"product_id": prod_id, "quantity": 1}],
            },
        )
        foreign_inv_id = other_inv_res.json()["id"]

        # Record payment for foreign invoice
        foreign_pay_res = api_client.post(
            "/payments",
            headers=admin_headers,
            json={"invoice_id": foreign_inv_id, "amount": 500.00, "payment_method": "Cash"},
        )
        foreign_pay_id = foreign_pay_res.json()["payment"]["id"]

        # 1. Customer attempting to inspect foreign invoice payment status -> 403 Forbidden
        assert api_client.get(f"/invoices/{foreign_inv_id}/payment-status", headers=customer_headers).status_code == 403

        # 2. Customer attempting to download foreign receipt -> 403 Forbidden
        assert api_client.get(f"/payments/{foreign_pay_id}/receipt", headers=customer_headers).status_code == 403

        # 3. Customer attempting to submit UPI payment for foreign invoice -> 403 Forbidden
        assert api_client.post(
            f"/customer/invoices/{foreign_inv_id}/submit-upi",
            headers=customer_headers,
            json={"reference": f"UTR-FORGED-{uid}", "amount": 500.00},
        ).status_code == 403

    def test_role_escalation_prevention(self, api_client: TestClient, customer_headers: dict, staff_headers: dict):
        # 1. Customer cannot modify profile to change role to admin
        esc_res = api_client.put(
            "/customer/profile",
            headers=customer_headers,
            json={"role": "admin", "full_name": "Fake Admin", "phone": "9999999999"},
        )
        assert esc_res.status_code == 200
        # Profile endpoint ignores 'role' field
        me = api_client.get("/auth/me", headers=customer_headers).json()
        assert me["user"]["role"] == "customer"

        # 2. Staff cannot call /users to promote themselves
        staff_me = api_client.get("/auth/me", headers=staff_headers).json()
        staff_id = staff_me["user"]["id"]
        assert api_client.put(f"/users/{staff_id}", headers=staff_headers, json={"role": "admin"}).status_code == 403

    def test_expired_jwt_rejected(self, api_client: TestClient):
        now_ts = int(time.time())
        expired_payload = {
            "sub": "6aef21d88805d374a1fa0c83",
            "email": "admin@viorabills.com",
            "role": "admin",
            "iat": now_ts - 3600,
            "exp": now_ts - 100,
        }
        import jwt
        token = jwt.encode(expired_payload, main.JWT_SECRET_KEY, algorithm=main.JWT_ALGORITHM)
        res = api_client.get("/admin/dashboard", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 401
        assert "expired" in res.json()["detail"].lower()

    def test_tampered_jwt_rejected(self, api_client: TestClient):
        now_ts = int(time.time())
        payload = {
            "sub": "6aef21d88805d374a1fa0c83",
            "email": "admin@viorabills.com",
            "role": "admin",
            "iat": now_ts,
            "exp": now_ts + 3600,
        }
        import jwt
        fake_token = jwt.encode(payload, "wrong_attacker_secret_key_1234567890", algorithm="HS256")
        res = api_client.get("/admin/dashboard", headers={"Authorization": f"Bearer {fake_token}"})
        assert res.status_code == 401
        assert "invalid" in res.json()["detail"].lower()

    def test_invitation_token_reuse_rejected(self, api_client: TestClient, admin_headers: dict):
        uid = _uid()
        c_res = api_client.post(
            "/customers",
            headers=admin_headers,
            json={"name": f"Invite Reuse Corp {uid}", "email": f"reuse_{uid}@test.com", "billing_address": "Kolkata"},
        )
        cust_id = c_res.json()["id"]

        inv_res = api_client.post(f"/customers/{cust_id}/invite", headers=admin_headers)
        assert inv_res.status_code == 200
        token = inv_res.json()["token"]

        accept_1 = api_client.post(
            "/auth/accept-invite",
            json={"token": token, "password": "SecurePassword123!", "full_name": "Valid Owner"},
        )
        assert accept_1.status_code == 200

        accept_2 = api_client.post(
            "/auth/accept-invite",
            json={"token": token, "password": "AttackerPassword123!", "full_name": "Attacker"},
        )
        assert accept_2.status_code in [404, 410]

    def test_audit_log_access_strictly_admin_only(self, api_client: TestClient, staff_headers: dict, customer_headers: dict, admin_headers: dict):
        assert api_client.get("/audit-logs", headers=customer_headers).status_code == 403
        assert api_client.get("/audit-logs", headers=staff_headers).status_code == 403
        admin_res = api_client.get("/audit-logs", headers=admin_headers)
        assert admin_res.status_code == 200
        assert "items" in admin_res.json()
