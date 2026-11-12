import pytest
from datetime import datetime, timezone, timedelta
from bson import ObjectId
from fastapi.testclient import TestClient

from backend.main import (
    app,
    users_collection,
    customers_collection,
    invoices_collection,
    payments_collection,
    orders_collection,
    payment_schedules_collection,
    company_settings_collection,
    password_hasher,
)

client = TestClient(app)

ADMIN_HEADERS = None
STAFF_HEADERS = None
CUSTOMER_HEADERS = None
CUSTOMER_2_HEADERS = None
TEST_CUSTOMER_ID = None
TEST_CUSTOMER_2_ID = None


@pytest.fixture(scope="module", autouse=True)
def setup_test_environment():
    global ADMIN_HEADERS, STAFF_HEADERS, CUSTOMER_HEADERS, CUSTOMER_2_HEADERS
    global TEST_CUSTOMER_ID, TEST_CUSTOMER_2_ID

    # 1. Setup Company Settings
    company_settings_collection.update_one(
        {},
        {
            "$set": {
                "company_name": "Viora Bills Test Corp",
                "email": "billing@viorabills.com",
                "phone": "+91 9876543210",
                "address": "401 Tech Park, Mumbai",
                "gstin": "27ABCDE1234F1Z5",
                "state": "Maharashtra",
            }
        },
        upsert=True,
    )

    # 2. Setup Admin
    admin_pw = password_hasher.hash("Admin@12345")
    users_collection.update_one(
        {"email": "test_admin@viorabills.com"},
        {
            "$set": {
                "full_name": "Test Admin",
                "password_hash": admin_pw,
                "role": "admin",
                "is_active": True,
            }
        },
        upsert=True,
    )
    admin_login = client.post("/auth/login", json={"email": "test_admin@viorabills.com", "password": "Admin@12345"})
    assert admin_login.status_code == 200, admin_login.text
    ADMIN_HEADERS = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

    # 3. Setup Staff
    staff_pw = password_hasher.hash("Staff@12345")
    users_collection.update_one(
        {"email": "test_staff@viorabills.com"},
        {
            "$set": {
                "full_name": "Test Staff",
                "password_hash": staff_pw,
                "role": "staff",
                "is_active": True,
            }
        },
        upsert=True,
    )
    staff_login = client.post("/auth/login", json={"email": "test_staff@viorabills.com", "password": "Staff@12345"})
    assert staff_login.status_code == 200, staff_login.text
    STAFF_HEADERS = {"Authorization": f"Bearer {staff_login.json()['access_token']}"}

    # 4. Setup Customer 1
    cust_res = customers_collection.insert_one({
        "name": "Acme Retailers",
        "email": "test_customer1@viorabills.com",
        "phone": "+91 9988776655",
        "business_name": "Acme Retailers Pvt Ltd",
        "billing_address": "12 Market Street, Pune",
        "gstin": "27AABCA1111A1Z1",
        "state": "Maharashtra",
        "city": "Pune",
        "pincode": "411001",
    })
    TEST_CUSTOMER_ID = str(cust_res.inserted_id)

    cust1_pw = password_hasher.hash("Customer@12345")
    users_collection.update_one(
        {"email": "test_customer1@viorabills.com"},
        {
            "$set": {
                "full_name": "Acme Retailers",
                "password_hash": cust1_pw,
                "role": "customer",
                "customer_id": TEST_CUSTOMER_ID,
                "is_active": True,
            }
        },
        upsert=True,
    )
    cust1_login = client.post("/auth/login", json={"email": "test_customer1@viorabills.com", "password": "Customer@12345"})
    assert cust1_login.status_code == 200, cust1_login.text
    CUSTOMER_HEADERS = {"Authorization": f"Bearer {cust1_login.json()['access_token']}"}

    # 5. Setup Customer 2 (for isolation testing)
    cust2_res = customers_collection.insert_one({
        "name": "Global Traders",
        "email": "test_customer2@viorabills.com",
        "phone": "+91 9123456780",
        "state": "Gujarat",
    })
    TEST_CUSTOMER_2_ID = str(cust2_res.inserted_id)

    cust2_pw = password_hasher.hash("Customer2@12345")
    users_collection.update_one(
        {"email": "test_customer2@viorabills.com"},
        {
            "$set": {
                "full_name": "Global Traders",
                "password_hash": cust2_pw,
                "role": "customer",
                "customer_id": TEST_CUSTOMER_2_ID,
                "is_active": True,
            }
        },
        upsert=True,
    )
    cust2_login = client.post("/auth/login", json={"email": "test_customer2@viorabills.com", "password": "Customer2@12345"})
    assert cust2_login.status_code == 200, cust2_login.text
    CUSTOMER_2_HEADERS = {"Authorization": f"Bearer {cust2_login.json()['access_token']}"}


def test_payment_receipt_pdf_generation_and_access_control():
    """Verify that cleared payments generate PDF receipts and enforce customer isolation."""
    # 1. Create invoice for customer 1
    inv_res = invoices_collection.insert_one({
        "invoice_number": f"INV-REC-TEST-{int(datetime.now().timestamp())}",
        "customer_id": ObjectId(TEST_CUSTOMER_ID),
        "customer_name": "Acme Retailers",
        "client_name": "Acme Retailers",
        "total_amount": 1000.0,
        "paid_amount": 0.0,
        "balance_due": 1000.0,
        "status": "UNPAID",
        "invoice_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "due_date": (datetime.now(timezone.utc) + timedelta(days=15)).strftime("%Y-%m-%d"),
        "items": [{"name": "Consulting", "quantity": 1, "unit_price": 1000.0, "total": 1000.0}],
    })
    inv_id = str(inv_res.inserted_id)

    # 2. Record a verified payment
    pay_res = payments_collection.insert_one({
        "invoice_id": ObjectId(inv_id),
        "invoice_number": "INV-REC-TEST",
        "customer_id": ObjectId(TEST_CUSTOMER_ID),
        "customer_name": "Acme Retailers",
        "amount": 500.0,
        "payment_method": "UPI",
        "payment_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "status": "SUCCESS",
        "receipt_number": f"REC-TEST-{int(datetime.now().timestamp())}",
        "reference": "UPI99887766",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    pay_id = str(pay_res.inserted_id)

    # 3. Customer 1 can download receipt PDF
    r1 = client.get(f"/payments/{pay_id}/receipt/pdf", headers=CUSTOMER_HEADERS)
    assert r1.status_code == 200
    assert r1.headers["content-type"] == "application/pdf"
    assert len(r1.content) > 500
    assert r1.content.startswith(b"%PDF")

    # 4. Admin and Staff can download receipt PDF
    r_admin = client.get(f"/payments/{pay_id}/receipt/pdf", headers=ADMIN_HEADERS)
    assert r_admin.status_code == 200
    assert r_admin.headers["content-type"] == "application/pdf"

    # 5. Customer 2 CANNOT access Customer 1's receipt PDF (Isolation check)
    r2 = client.get(f"/payments/{pay_id}/receipt/pdf", headers=CUSTOMER_2_HEADERS)
    assert r2.status_code == 403, "Customer 2 accessed Customer 1 receipt PDF!"

    # 6. Bounced or unconfirmed payment cannot generate official receipt PDF
    bounced_pay = payments_collection.insert_one({
        "invoice_id": ObjectId(inv_id),
        "customer_id": ObjectId(TEST_CUSTOMER_ID),
        "amount": 500.0,
        "payment_method": "Cheque",
        "status": "BOUNCED",
        "receipt_number": "REC-BOUNCED",
    })
    r_bounced = client.get(f"/payments/{str(bounced_pay.inserted_id)}/receipt/pdf", headers=ADMIN_HEADERS)
    assert r_bounced.status_code == 400


def test_customer_profile_editing_and_historical_immutability():
    """Verify customer profile editing, GSTIN validation, and snapshot immutability."""
    # 1. Fetch current profile
    get_res = client.get("/customer/profile", headers=CUSTOMER_HEADERS)
    assert get_res.status_code == 200
    data = get_res.json()
    assert data["customer"]["name"] == "Acme Retailers"

    # 2. Update profile with new business details
    update_payload = {
        "full_name": "Acme Retailers Updated",
        "phone": "+91 9988776600",
        "business_name": "Acme Global Solutions LLP",
        "gstin": "27AAAAA0000A1Z5",
        "business_phone": "020 2567 8900",
        "billing_address": "Suite 500, Cyber Tower, Hinjawadi",
        "city": "Pune",
        "state": "Maharashtra",
        "pincode": "411057",
    }
    patch_res = client.patch("/customer/profile", json=update_payload, headers=CUSTOMER_HEADERS)
    assert patch_res.status_code == 200
    updated_cust = patch_res.json()["customer"]
    assert updated_cust["business_name"] == "Acme Global Solutions LLP"
    assert updated_cust["gstin"] == "27AAAAA0000A1Z5"

    # 3. Verify user document full_name was also synchronized
    user_doc = users_collection.find_one({"email": "test_customer1@viorabills.com"})
    assert user_doc["full_name"] == "Acme Retailers Updated"

    # 4. Verify that existing invoice was NOT altered by profile update (snapshot preservation)
    existing_inv = invoices_collection.find_one({"customer_id": ObjectId(TEST_CUSTOMER_ID)})
    assert existing_inv["customer_name"] == "Acme Retailers", "Invoice snapshot was improperly mutated!"


def test_payment_schedules_lifecycle_and_balance_protection():
    """Verify payment scheduling lifecycle and verify that schedules NEVER reduce invoice balance."""
    # 1. Create an invoice with balance due
    inv_res = invoices_collection.insert_one({
        "invoice_number": f"INV-SCHED-{int(datetime.now().timestamp())}",
        "customer_id": ObjectId(TEST_CUSTOMER_ID),
        "customer_name": "Acme Retailers",
        "total_amount": 2500.0,
        "paid_amount": 500.0,
        "balance_due": 2000.0,
        "status": "PARTIALLY_PAID",
        "invoice_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    })
    inv_id = str(inv_res.inserted_id)

    # 2. Try to schedule payment exceeding balance due -> must fail
    future_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d")
    fail_res = client.post(
        "/payment-schedules",
        json={
            "invoice_id": inv_id,
            "scheduled_date": future_date,
            "planned_amount": 3000.0,
            "payment_method": "UPI",
        },
        headers=CUSTOMER_HEADERS,
    )
    assert fail_res.status_code == 400
    assert "exceeds" in fail_res.json()["detail"].lower()

    # 3. Try to schedule payment in the past -> must fail
    past_date = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%d")
    past_res = client.post(
        "/payment-schedules",
        json={
            "invoice_id": inv_id,
            "scheduled_date": past_date,
            "planned_amount": 1000.0,
            "payment_method": "UPI",
        },
        headers=CUSTOMER_HEADERS,
    )
    assert past_res.status_code == 400
    assert "past" in past_res.json()["detail"].lower()

    # 4. Valid schedule creation by Customer
    create_res = client.post(
        "/payment-schedules",
        json={
            "invoice_id": inv_id,
            "scheduled_date": future_date,
            "planned_amount": 1500.0,
            "payment_method": "UPI",
            "notes": "Will transfer after receipt from client",
        },
        headers=CUSTOMER_HEADERS,
    )
    assert create_res.status_code == 201
    sched = create_res.json()
    sched_id = sched["id"]
    assert sched["status"] == "PLANNED"
    assert sched["planned_amount"] == 1500.0

    # 5. CRITICAL INVARIANCE CHECK: Invoice balance must remain 2000.0 (scheduled payments must NOT reduce balance!)
    inv_after = invoices_collection.find_one({"_id": ObjectId(inv_id)})
    assert float(inv_after["balance_due"]) == 2000.0, "CRITICAL ERROR: Payment schedule reduced invoice balance!"
    assert float(inv_after["paid_amount"]) == 500.0
    assert inv_after["status"] == "PARTIALLY_PAID"

    # 6. Customer 2 CANNOT access Customer 1 schedule
    c2_res = client.get(f"/payment-schedules/{sched_id}", headers=CUSTOMER_2_HEADERS)
    assert c2_res.status_code == 403

    # 7. Customer 1 lists their schedules
    list_res = client.get("/payment-schedules", headers=CUSTOMER_HEADERS)
    assert list_res.status_code == 200
    my_scheds = list_res.json()
    assert any(s["id"] == sched_id for s in my_scheds)

    # 8. Staff / Admin can mark schedule as COMPLETED
    comp_res = client.patch(f"/payment-schedules/{sched_id}/complete", headers=STAFF_HEADERS)
    assert comp_res.status_code == 200
    assert comp_res.json()["status"] == "COMPLETED"


def test_order_summary_pdf_generation():
    """Verify that an order can generate an Order Summary PDF before an invoice exists."""
    # 1. Create an order
    order_res = orders_collection.insert_one({
        "order_number": f"ORD-TEST-{int(datetime.now().timestamp())}",
        "customer_id": ObjectId(TEST_CUSTOMER_ID),
        "customer_name": "Acme Retailers",
        "customer_email": "test_customer1@viorabills.com",
        "items": [
            {
                "product_name": "Premium Keyboard",
                "quantity": 2,
                "unit_price": 1200.0,
                "total": 2400.0,
            }
        ],
        "total_amount": 2400.0,
        "status": "APPROVED",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    order_id = str(order_res.inserted_id)

    # 2. Customer downloads order PDF
    r_cust = client.get(f"/orders/{order_id}/pdf", headers=CUSTOMER_HEADERS)
    assert r_cust.status_code == 200
    assert r_cust.headers["content-type"] == "application/pdf"
    assert r_cust.content.startswith(b"%PDF")

    # 3. Customer 2 is blocked from downloading Customer 1's order PDF
    r_c2 = client.get(f"/orders/{order_id}/pdf", headers=CUSTOMER_2_HEADERS)
    assert r_c2.status_code == 403


def test_smtp_configuration_verification_and_forgot_password():
    """Verify that when SMTP is unconfigured, the system reports it clearly without pretending."""
    res = client.post("/auth/forgot-password", json={"email": "test_customer1@viorabills.com"})
    assert res.status_code == 200
    body = res.json()
    # In local testing without SMTP_HOST set in env:
    assert "smtp_configured" in body
    if not body["smtp_configured"]:
        assert "SMTP email service is currently not configured" in body["message"]
        assert body["email_delivered"] is False
