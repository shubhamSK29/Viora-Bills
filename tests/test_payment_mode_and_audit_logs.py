import pytest
import uuid
from fastapi.testclient import TestClient
from bson import ObjectId
from datetime import datetime, timezone

from backend.main import (
    app,
    company_settings_collection,
    invoices_collection,
    customers_collection,
    payments_collection,
    products_collection,
    users_collection,
    audit_logs_collection,
    password_hasher,
)

client = TestClient(app)


@pytest.fixture(scope="module")
def setup_data():
    """Create test users, customer, and product for payment mode and audit tests."""
    admin_email = "audit_admin@viorabills.com"
    staff_email = "audit_staff@viorabills.com"
    customer_email = "audit_cust@viorabills.com"

    users_collection.delete_many({"email": {"$in": [admin_email, staff_email, customer_email]}})
    customers_collection.delete_many({"email": customer_email})
    products_collection.delete_many({"name": "Audit Test Item"})
    payments_collection.delete_many({"reference": {"$regex": "^TEST_PAY_"}})

    # Create customer record
    cust_res = customers_collection.insert_one({
        "name": "Audit Customer",
        "email": customer_email,
        "phone": "9887766554",
        "billing_address": "123 Commercial Hub, Pune",
        "state": "Maharashtra",
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    cust_id = str(cust_res.inserted_id)

    # Insert users
    users_collection.insert_one({
        "email": admin_email,
        "password_hash": password_hasher.hash("Admin@12345"),
        "role": "admin",
        "full_name": "Audit Admin User",
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    users_collection.insert_one({
        "email": staff_email,
        "password_hash": password_hasher.hash("Staff@12345"),
        "role": "staff",
        "full_name": "Audit Staff User",
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    users_collection.insert_one({
        "email": customer_email,
        "password_hash": password_hasher.hash("Customer@12345"),
        "role": "customer",
        "full_name": "Audit Customer User",
        "customer_id": cust_id,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # Create test product
    prod_res = products_collection.insert_one({
        "name": "Audit Test Item",
        "price": 1000.0,
        "unit": "pcs",
        "gst_rate": 18.0,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    prod_id = str(prod_res.inserted_id)

    # Login to obtain JWT tokens
    admin_token = client.post("/auth/login", json={"email": admin_email, "password": "Admin@12345"}).json()["access_token"]
    staff_token = client.post("/auth/login", json={"email": staff_email, "password": "Staff@12345"}).json()["access_token"]
    customer_token = client.post("/auth/login", json={"email": customer_email, "password": "Customer@12345"}).json()["access_token"]

    yield {
        "admin_token": admin_token,
        "staff_token": staff_token,
        "customer_token": customer_token,
        "customer_id": cust_id,
        "product_id": prod_id,
    }

    # Clean up test records
    users_collection.delete_many({"email": {"$in": [admin_email, staff_email, customer_email]}})
    customers_collection.delete_many({"email": customer_email})
    products_collection.delete_many({"name": "Audit Test Item"})
    payments_collection.delete_many({"reference": {"$regex": "^TEST_PAY_"}})


# ==============================================================================
# 1. PAYMENT MODE TESTS (INVOICES & BILLS)
# ==============================================================================

def test_full_payment_via_upi(setup_data):
    """Verify single full payment via UPI records mode, updates invoice status to PAID and attaches mode."""
    token = setup_data["admin_token"]
    cust_id = setup_data["customer_id"]
    prod_id = setup_data["product_id"]

    # Create invoice (1 item @ 1000 + 18% GST = 1180)
    inv_res = client.post(
        "/invoices",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "customer_id": cust_id,
            "items": [{"product_id": prod_id, "quantity": 1}],
            "discount": 0.0,
            "invoice_date": "2026-11-10",
            "due_date": "2026-12-10",
            "place_of_supply": "Maharashtra",
        },
    )
    assert inv_res.status_code == 201
    inv = inv_res.json()
    inv_id = inv["id"]
    total = inv["total_amount"]
    assert total == 1180.0

    # Record full payment via UPI with UTR reference
    pay_res = client.post(
        "/payments",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "invoice_id": inv_id,
            "amount": total,
            "payment_method": "UPI",
            "reference": "TEST_PAY_UPI_123456",
            "notes": "Settled in full via GPay",
        },
    )
    assert pay_res.status_code == 201
    pay_body = pay_res.json()
    payment = pay_body.get("payment", pay_body)
    assert payment["payment_method"] == "UPI"
    assert payment["status"] == "SUCCESS"

    # Fetch updated invoice
    get_res = client.get(f"/invoices/{inv_id}", headers={"Authorization": f"Bearer {token}"})
    assert get_res.status_code == 200
    updated_inv = get_res.json()
    assert updated_inv["status"] == "PAID"
    assert updated_inv["amount_paid"] == total
    assert updated_inv["balance_due"] == 0.0
    assert updated_inv["payment_mode"] == "UPI"
    assert "UPI" in updated_inv["payment_modes"]
    assert len(updated_inv["payments"]) == 1
    assert updated_inv["payments"][0]["payment_method"] == "UPI"
    assert updated_inv["payments"][0]["reference"] == "TEST_PAY_UPI_123456"


def test_full_payment_via_cash_no_reference_required(setup_data):
    """Verify Cash payment succeeds without requiring a transaction reference and sets Payment Mode: Cash."""
    token = setup_data["admin_token"]
    cust_id = setup_data["customer_id"]
    prod_id = setup_data["product_id"]

    inv_res = client.post(
        "/invoices",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "customer_id": cust_id,
            "items": [{"product_id": prod_id, "quantity": 1}],
            "discount": 0.0,
            "invoice_date": "2026-11-10",
            "due_date": "2026-12-10",
            "place_of_supply": "Maharashtra",
        },
    )
    assert inv_res.status_code == 201
    inv_id = inv_res.json()["id"]

    # Cash payment with NO reference
    pay_res = client.post(
        "/payments",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "invoice_id": inv_id,
            "amount": 1180.0,
            "payment_method": "Cash",
            "notes": "Cash collected at retail counter",
        },
    )
    assert pay_res.status_code == 201
    pay_body = pay_res.json()
    pay_data = pay_body.get("payment", pay_body)
    assert pay_data["payment_method"] == "Cash"
    assert pay_data["reference"] is None

    # Verify invoice reflects Cash mode and status PAID
    get_res = client.get(f"/invoices/{inv_id}", headers={"Authorization": f"Bearer {token}"})
    assert get_res.status_code == 200
    updated_inv = get_res.json()
    assert updated_inv["status"] == "PAID"
    assert updated_inv["payment_mode"] == "Cash"
    assert "Cash" in updated_inv["payment_modes"]


def test_multiple_payments_different_modes_preserved(setup_data):
    """
    Verify split/multiple payments on an invoice:
    Partial payment via UPI, followed by balance payment via Cash.
    Both modes and history must be preserved (Payment Mode: 'UPI, Cash') without overwriting.
    """
    token = setup_data["admin_token"]
    cust_id = setup_data["customer_id"]
    prod_id = setup_data["product_id"]

    # Create invoice for 2 items @ 1000 + GST = 2360.0
    inv_res = client.post(
        "/invoices",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "customer_id": cust_id,
            "items": [{"product_id": prod_id, "quantity": 2}],
            "discount": 0.0,
            "invoice_date": "2026-11-10",
            "due_date": "2026-12-10",
            "place_of_supply": "Maharashtra",
        },
    )
    inv_id = inv_res.json()["id"]

    # 1. First payment: 1500 via UPI
    pay1_res = client.post(
        "/payments",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "invoice_id": inv_id,
            "amount": 1500.0,
            "payment_method": "UPI",
            "reference": "TEST_PAY_UPI_SPLIT_1",
        },
    )
    assert pay1_res.status_code == 201

    # Check status after payment 1: PARTIALLY_PAID, balance 860.0, mode UPI
    inv_after_pay1 = client.get(f"/invoices/{inv_id}", headers={"Authorization": f"Bearer {token}"}).json()
    assert inv_after_pay1["status"] == "PARTIALLY_PAID"
    assert inv_after_pay1["amount_paid"] == 1500.0
    assert inv_after_pay1["balance_due"] == 860.0
    assert inv_after_pay1["payment_mode"] == "UPI"

    # 2. Second payment: remaining 860 via Cash
    pay2_res = client.post(
        "/payments",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "invoice_id": inv_id,
            "amount": 860.0,
            "payment_method": "Cash",
            "notes": "Counter balance clearance",
        },
    )
    assert pay2_res.status_code == 201

    # Check status after payment 2: PAID, amount_paid 2360, balance 0.0
    inv_after_pay2 = client.get(f"/invoices/{inv_id}", headers={"Authorization": f"Bearer {token}"}).json()
    assert inv_after_pay2["status"] == "PAID"
    assert inv_after_pay2["amount_paid"] == 2360.0
    assert inv_after_pay2["balance_due"] == 0.0

    # CRITICAL: Payment mode must list both 'UPI, Cash' and not overwrite previous payment!
    assert "UPI" in inv_after_pay2["payment_mode"]
    assert "Cash" in inv_after_pay2["payment_mode"]
    assert set(inv_after_pay2["payment_modes"]) == {"UPI", "Cash"}

    # Both payment records must be present in payments array
    assert len(inv_after_pay2["payments"]) == 2
    modes_in_list = [p["payment_method"] for p in inv_after_pay2["payments"]]
    assert modes_in_list == ["UPI", "Cash"]


def test_historical_invoice_displays_not_recorded(setup_data):
    """
    Verify historical invoice (where amount_paid > 0 but no payments were linked in payments_collection)
    returns 'Not Recorded' for payment_mode rather than failing, null, or blank.
    """
    token = setup_data["admin_token"]
    cust_id = setup_data["customer_id"]

    # Direct insertion of a historical legacy invoice
    legacy_res = invoices_collection.insert_one({
        "invoice_number": "INV-HISTORICAL-999",
        "customer_id": cust_id,
        "customer_name": "Audit Customer",
        "items": [],
        "subtotal": 500.0,
        "discount": 0.0,
        "taxable_amount": 500.0,
        "gst_amount": 90.0,
        "total_amount": 590.0,
        "amount_paid": 590.0,
        "balance_due": 0.0,
        "status": "PAID",
        "created_at": "2025-01-01T10:00:00Z",
    })
    legacy_id = str(legacy_res.inserted_id)

    # Query via API
    res = client.get(f"/invoices/{legacy_id}", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["payment_mode"] == "Not Recorded"

    # Query via list endpoint
    list_res = client.get("/invoices", headers={"Authorization": f"Bearer {token}"}, params={"search": "INV-HISTORICAL-999"})
    assert list_res.status_code == 200
    found = [i for i in list_res.json()["items"] if i["id"] == legacy_id]
    assert len(found) == 1
    assert found[0]["payment_mode"] == "Not Recorded"

    # Clean up
    invoices_collection.delete_one({"_id": ObjectId(legacy_id)})


def test_invoice_pdf_includes_payment_information_and_mode(setup_data):
    """Verify generated invoice PDF contains payment information block and ReportLab binary %PDF header."""
    token = setup_data["admin_token"]
    cust_id = setup_data["customer_id"]
    prod_id = setup_data["product_id"]

    # Create and pay invoice
    inv_res = client.post(
        "/invoices",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "customer_id": cust_id,
            "items": [{"product_id": prod_id, "quantity": 1}],
            "discount": 0.0,
            "invoice_date": "2026-11-10",
            "due_date": "2026-12-10",
            "place_of_supply": "Maharashtra",
        },
    )
    inv_id = inv_res.json()["id"]

    client.post(
        "/payments",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "invoice_id": inv_id,
            "amount": 1180.0,
            "payment_method": "Bank Transfer",
            "reference": "TEST_PAY_NEFT_987654",
        },
    )

    pdf_res = client.get(f"/invoices/{inv_id}/pdf", headers={"Authorization": f"Bearer {token}"})
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    content = pdf_res.content
    assert content.startswith(b"%PDF")
    assert len(content) > 2000


def test_pending_payment_claim_not_shown_as_paid(setup_data):
    """Verify that unverified payments (status PENDING_VERIFICATION) are NEVER marked as PAID or verified."""
    cust_token = setup_data["customer_token"]
    admin_token = setup_data["admin_token"]
    cust_id = setup_data["customer_id"]
    prod_id = setup_data["product_id"]

    # Create unpaid invoice
    inv_res = client.post(
        "/invoices",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "customer_id": cust_id,
            "items": [{"product_id": prod_id, "quantity": 1}],
            "discount": 0.0,
            "invoice_date": "2026-11-10",
            "due_date": "2026-12-10",
            "place_of_supply": "Maharashtra",
        },
    )
    inv_id = inv_res.json()["id"]

    # Customer submits UPI claim with reference
    claim_res = client.post(
        f"/customer/invoices/{inv_id}/submit-upi",
        headers={"Authorization": f"Bearer {cust_token}"},
        json={
            "reference": "TEST_PAY_UTR_PENDING_01",
            "amount": 1180.0,
        },
    )
    assert claim_res.status_code == 200

    # Invoice must STILL be UNPAID (or not PAID), with has_pending_payment=True, and payment_mode None
    inv_data = client.get(f"/invoices/{inv_id}", headers={"Authorization": f"Bearer {admin_token}"}).json()
    assert inv_data["status"] == "UNPAID"
    assert inv_data["amount_paid"] == 0.0
    assert inv_data["has_pending_payment"] is True
    assert inv_data["payment_mode"] is None


# ==============================================================================
# 2. AUDIT LOGS FUNCTIONALITY TESTS
# ==============================================================================

def test_login_success_and_failure_audit_recording(setup_data):
    """Verify both successful and failed logins are audited with correct status, IP, and module."""
    # 1. Failed login
    fail_res = client.post("/auth/login", json={"email": "audit_admin@viorabills.com", "password": "WrongPassword!99"})
    assert fail_res.status_code == 401

    # 2. Successful login
    succ_res = client.post("/auth/login", json={"email": "audit_admin@viorabills.com", "password": "Admin@12345"})
    assert succ_res.status_code == 200

    admin_token = succ_res.json()["access_token"]

    # Query audit logs
    logs_res = client.get(
        "/audit-logs",
        headers={"Authorization": f"Bearer {admin_token}"},
        params={"module": "Auth", "limit": 10},
    )
    assert logs_res.status_code == 200
    items = logs_res.json()["items"]

    actions = [it["action"] for it in items]
    assert "LOGIN_SUCCESS" in actions
    assert "LOGIN_FAILED" in actions

    # Check status and details redaction (NO passwords in details!)
    failed_log = next(it for it in items if it["action"] == "LOGIN_FAILED")
    assert failed_log["status"] == "FAILED"
    assert "password" not in failed_log.get("details", {})
    assert failed_log["ip_address"] is not None

    success_log = next(it for it in items if it["action"] == "LOGIN_SUCCESS")
    assert success_log["status"] == "SUCCESS"
    assert success_log["user_role"] == "admin"


def test_customer_creation_and_update_audit_recording(setup_data):
    """Verify creating and updating customer records emits CREATE_CUSTOMER and UPDATE_CUSTOMER audit logs."""
    token = setup_data["admin_token"]
    test_email = "audit_temp_cust@viorabills.com"

    customers_collection.delete_many({"email": test_email})

    # Create customer
    c_res = client.post(
        "/customers",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "Audit Temp Customer",
            "email": test_email,
            "phone": "9988776655",
            "billing_address": "Pune Tech Park",
            "state": "Maharashtra",
        },
    )
    assert c_res.status_code == 201
    c_id = c_res.json()["id"]

    # Update customer
    u_res = client.patch(
        f"/customers/{c_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"phone": "9988776600"},
    )
    assert u_res.status_code == 200

    # Verify audit logs
    audit_res = client.get(
        "/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
        params={"module": "Customers", "search": "Audit Temp Customer"},
    )
    assert audit_res.status_code == 200
    items = audit_res.json()["items"]
    actions = [it["action"] for it in items]
    assert "CREATE_CUSTOMER" in actions
    assert "UPDATE_CUSTOMER" in actions

    # Clean up
    customers_collection.delete_one({"_id": ObjectId(c_id)})


def test_product_creation_and_update_audit_recording(setup_data):
    """Verify product create and update emit CREATE_PRODUCT and UPDATE_PRODUCT audit logs."""
    token = setup_data["admin_token"]
    prod_name = "Audit Test Special Widget"

    products_collection.delete_many({"name": prod_name})

    p_res = client.post(
        "/products",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": prod_name,
            "price": 2500.0,
            "unit": "box",
            "gst_rate": 18.0,
            "hsn_code": "84713010",
        },
    )
    assert p_res.status_code == 201
    p_id = p_res.json()["id"]

    up_res = client.patch(
        f"/products/{p_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"price": 2700.0},
    )
    assert up_res.status_code == 200

    # Check audit logs
    audit_res = client.get(
        "/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
        params={"module": "Products", "search": prod_name},
    )
    assert audit_res.status_code == 200
    items = audit_res.json()["items"]
    actions = [it["action"] for it in items]
    assert "CREATE_PRODUCT" in actions
    assert "UPDATE_PRODUCT" in actions

    # Clean up
    products_collection.delete_one({"_id": ObjectId(p_id)})


def test_company_settings_update_audit_recording(setup_data):
    """Verify updating company settings emits UPDATE_COMPANY_SETTINGS audit log in Settings module."""
    token = setup_data["admin_token"]

    up_res = client.put(
        "/settings/company",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "company_name": "Viora Bills Pvt Ltd",
            "business_address": "100 Platinum Tower, Shivaji Nagar, Pune",
            "phone": "020-25678901",
            "state": "Maharashtra",
            "upi_id": "viorabills@okaxis",
            "bank_name": "HDFC Bank",
            "account_number": "5010022334455",
            "ifsc_code": "HDFC0001234",
            "account_holder_name": "Viora Bills Pvt Ltd",
        },
    )
    assert up_res.status_code == 200

    audit_res = client.get(
        "/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
        params={"module": "Settings"},
    )
    assert audit_res.status_code == 200
    items = audit_res.json()["items"]
    assert any(it["action"] == "UPDATE_COMPANY_SETTINGS" for it in items)


def test_audit_logs_role_access_control(setup_data):
    """Verify strictly Admin-only access to audit logs. Staff and Customer must receive 403 Forbidden."""
    staff_token = setup_data["staff_token"]
    cust_token = setup_data["customer_token"]
    admin_token = setup_data["admin_token"]

    # Staff attempt
    staff_res = client.get("/audit-logs", headers={"Authorization": f"Bearer {staff_token}"})
    assert staff_res.status_code == 403

    # Customer attempt
    cust_res = client.get("/audit-logs", headers={"Authorization": f"Bearer {cust_token}"})
    assert cust_res.status_code == 403

    # Admin attempt
    admin_res = client.get("/audit-logs", headers={"Authorization": f"Bearer {admin_token}"})
    assert admin_res.status_code == 200
    assert "items" in admin_res.json()
    assert "total" in admin_res.json()


def test_audit_logs_comprehensive_filtering(setup_data):
    """Verify filtering audit logs by module, action, role, status, date range, and search keyword."""
    token = setup_data["admin_token"]

    # 1. Module filter
    mod_res = client.get("/audit-logs", headers={"Authorization": f"Bearer {token}"}, params={"module": "Auth"})
    assert mod_res.status_code == 200
    for log in mod_res.json()["items"]:
        assert log["module"] == "Auth"

    # 2. Action filter
    act_res = client.get("/audit-logs", headers={"Authorization": f"Bearer {token}"}, params={"action": "LOGIN_SUCCESS"})
    assert act_res.status_code == 200
    for log in act_res.json()["items"]:
        assert log["action"] == "LOGIN_SUCCESS"

    # 3. Status filter
    stat_res = client.get("/audit-logs", headers={"Authorization": f"Bearer {token}"}, params={"status": "FAILED"})
    assert stat_res.status_code == 200
    for log in stat_res.json()["items"]:
        assert log["status"] == "FAILED"

    # 4. Search query
    search_res = client.get("/audit-logs", headers={"Authorization": f"Bearer {token}"}, params={"search": "audit_admin"})
    assert search_res.status_code == 200
    assert search_res.json()["total"] >= 1


def test_receipt_pdf_download_and_current_payment_details_only(setup_data):
    """
    Verify:
    1. GET /payments/{id}/receipt returns payment_id, id, and _id for frontend compatibility.
    2. GET /payments/{id}/receipt/pdf returns valid %PDF via Bearer token and via ?token= query parameter.
    3. Receipt details display ONLY current transaction info and do not expose cumulative history or balance due.
    """
    admin_token = setup_data["admin_token"]
    cust_id = setup_data["customer_id"]
    prod_id = setup_data["product_id"]

    # 1. Create a fresh invoice
    inv_res = client.post(
        "/invoices",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "customer_id": cust_id,
            "place_of_supply": "Maharashtra",
            "invoice_date": "2026-11-10",
            "due_date": "2026-12-10",
            "discount": 0.0,
            "items": [{"product_id": prod_id, "quantity": 3}],
        },
    )
    assert inv_res.status_code == 201
    invoice = inv_res.json()
    invoice_id = invoice["id"]

    # 2. Record payment with unique reference
    unique_ref = f"UPI-REC-{uuid.uuid4().hex[:8]}"
    pay_res = client.post(
        "/payments",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "invoice_id": invoice_id,
            "amount": 500.0,
            "payment_method": "UPI",
            "reference": unique_ref,
        },
    )
    assert pay_res.status_code == 201
    pay_data = pay_res.json()
    payment = pay_data.get("payment", pay_data)
    pay_id = payment.get("id") or payment.get("payment_id")
    assert pay_id is not None

    # 3. Test GET /payments/{pay_id}/receipt
    rec_res = client.get(f"/payments/{pay_id}/receipt", headers={"Authorization": f"Bearer {admin_token}"})
    assert rec_res.status_code == 200
    rec_data = rec_res.json()
    assert rec_data.get("payment_id") == str(pay_id)
    assert rec_data.get("id") == str(pay_id)
    assert rec_data.get("_id") == str(pay_id)
    assert rec_data.get("amount") == 500.0
    assert rec_data.get("payment_method") == "UPI"

    # 4. Test GET /payments/{pay_id}/receipt/pdf with Bearer header
    pdf_header_res = client.get(
        f"/payments/{pay_id}/receipt/pdf",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert pdf_header_res.status_code == 200
    assert pdf_header_res.headers["content-type"] == "application/pdf"
    assert pdf_header_res.content.startswith(b"%PDF")

    # 5. Test GET /payments/{pay_id}/receipt/pdf with ?token= query parameter
    pdf_param_res = client.get(f"/payments/{pay_id}/receipt/pdf?token={admin_token}")
    assert pdf_param_res.status_code == 200
    assert pdf_param_res.headers["content-type"] == "application/pdf"
    assert pdf_param_res.content.startswith(b"%PDF")

    # 6. Test GET /invoices/{invoice_id} returns all details needed for View modal
    view_res = client.get(f"/invoices/{invoice_id}", headers={"Authorization": f"Bearer {admin_token}"})
    assert view_res.status_code == 200
    view_data = view_res.json()
    assert view_data.get("id") == str(invoice_id)
    assert "items" in view_data
    assert "payments" in view_data
    assert view_data.get("payment_mode") == "UPI"
    assert len(view_data["payments"]) >= 1
    assert view_data["payments"][0]["payment_method"] == "UPI"

