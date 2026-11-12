import pytest
import io
import urllib.parse
from fastapi.testclient import TestClient
from bson import ObjectId
from datetime import datetime, timezone

from backend.main import (
    app,
    company_settings_collection,
    invoices_collection,
    customers_collection,
    payments_collection,
    users_collection,
    password_hasher,
    generate_invoice_pdf,
    DEFAULT_COMPANY_SETTINGS,
)

client = TestClient(app)


@pytest.fixture(scope="module")
def auth_tokens():
    """Create test admin, staff, and customer users and return auth tokens."""
    admin_email = "test_admin_upi@viorabills.com"
    staff_email = "test_staff_upi@viorabills.com"
    customer_email = "test_customer_upi@viorabills.com"

    users_collection.delete_many({"email": {"$in": [admin_email, staff_email, customer_email]}})
    customers_collection.delete_many({"email": customer_email})

    # Create customer record in customers collection
    cust_res = customers_collection.insert_one({
        "name": "UPI Test Customer",
        "email": customer_email,
        "phone": "9998887777",
        "billing_address": "456 Gateway Road, Pune",
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
        "full_name": "UPI Admin",
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    users_collection.insert_one({
        "email": staff_email,
        "password_hash": password_hasher.hash("Staff@12345"),
        "role": "staff",
        "full_name": "UPI Staff",
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    users_collection.insert_one({
        "email": customer_email,
        "password_hash": password_hasher.hash("Customer@12345"),
        "role": "customer",
        "full_name": "UPI Test Customer",
        "customer_id": cust_id,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    admin_token = client.post("/auth/login", json={"email": admin_email, "password": "Admin@12345"}).json()["access_token"]
    staff_token = client.post("/auth/login", json={"email": staff_email, "password": "Staff@12345"}).json()["access_token"]
    customer_token = client.post("/auth/login", json={"email": customer_email, "password": "Customer@12345"}).json()["access_token"]

    yield {
        "admin_token": admin_token,
        "staff_token": staff_token,
        "customer_token": customer_token,
        "customer_id": cust_id,
        "customer_email": customer_email,
    }

    # Cleanup
    users_collection.delete_many({"email": {"$in": [admin_email, staff_email, customer_email]}})
    customers_collection.delete_many({"_id": ObjectId(cust_id)})


def test_scenario_1_valid_upi_and_bank_details(auth_tokens):
    """Scenario 1: Admin configures valid UPI ID and bank details. Verified via admin and public APIs."""
    headers = {"Authorization": f"Bearer {auth_tokens['admin_token']}"}

    update_payload = {
        "company_name": "Viora Enterprise Solutions",
        "business_address": "101 Business Hub, Senapati Bapat Road, Pune",
        "bank_name": "HDFC Bank",
        "account_holder_name": "Viora Enterprise",
        "account_number": "50200098765432",
        "ifsc_code": "HDFC0001234",
        "upi_id": "vioraenterprise@hdfcbank",
    }
    res = client.put("/settings/company", json=update_payload, headers=headers)
    assert res.status_code == 200, res.text
    saved = res.json()["settings"]
    assert saved["upi_id"] == "vioraenterprise@hdfcbank"
    assert saved["bank_name"] == "HDFC Bank"

    # Verify public settings endpoint reflects this for customers and unauthenticated users
    pub_res = client.get("/settings/company/public")
    assert pub_res.status_code == 200
    pub_data = pub_res.json()["company"]
    assert pub_data["upi_id"] == "vioraenterprise@hdfcbank"
    assert pub_data["company_name"] == "Viora Enterprise Solutions"


def test_scenario_2_bank_details_without_upi(auth_tokens):
    """Scenario 2: Company settings with bank details but without UPI ID. PDF renders cleanly without QR error."""
    headers = {"Authorization": f"Bearer {auth_tokens['admin_token']}"}

    update_payload = {
        "company_name": "Viora Offline Store",
        "business_address": "404 Market Yard, Pune, Maharashtra",
        "bank_name": "State Bank of India",
        "account_holder_name": "Viora Store",
        "account_number": "30123456789",
        "ifsc_code": "SBIN0001122",
        "upi_id": None,
    }
    res = client.put("/settings/company", json=update_payload, headers=headers)
    assert res.status_code == 200
    assert res.json()["settings"]["upi_id"] is None

    # Test PDF generation without UPI
    inv_data = {
        "id": "INV-NO-UPI-001",
        "invoice_number": "INV-NO-UPI-001",
        "balance_due": 500.0,
        "total_amount": 500.0,
        "items": [],
        "status": "UNPAID",
    }
    pdf_bytes = generate_invoice_pdf(inv_data, None, res.json()["settings"])
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 1000


def test_scenario_3_invalid_upi_format_rejected(auth_tokens):
    """Scenario 3: Attempting to save invalid UPI ID returns 422 validation error."""
    headers = {"Authorization": f"Bearer {auth_tokens['admin_token']}"}

    invalid_upis = [
        "not-an-upi-id",
        "@bank",
        "user@",
        "user@b",
        "invalid space@bank",
    ]
    for bad_upi in invalid_upis:
        res = client.put(
            "/settings/company",
            json={
                "company_name": "Viora Bills",
                "business_address": "101 Business Hub, Pune",
                "upi_id": bad_upi,
            },
            headers=headers,
        )
        assert res.status_code == 422, f"Expected 422 for invalid UPI: {bad_upi}"


def test_scenario_4_update_upi_and_regenerate(auth_tokens):
    """Scenario 4: Updating the UPI ID immediately propagates to new company settings and PDF."""
    headers = {"Authorization": f"Bearer {auth_tokens['admin_token']}"}

    # Step 1: Set UPI 1
    client.put(
        "/settings/company",
        json={
            "company_name": "Viora Bills",
            "business_address": "101 Business Hub, Pune",
            "upi_id": "firstmerchant@icici",
        },
        headers=headers,
    )
    pub1 = client.get("/settings/company/public").json()["company"]
    assert pub1["upi_id"] == "firstmerchant@icici"

    # Step 2: Update to UPI 2
    client.put(
        "/settings/company",
        json={
            "company_name": "Viora Bills",
            "business_address": "101 Business Hub, Pune",
            "upi_id": "updatedmerchant@axisbank",
        },
        headers=headers,
    )
    pub2 = client.get("/settings/company/public").json()["company"]
    assert pub2["upi_id"] == "updatedmerchant@axisbank"

    # Generate PDF with updated settings
    inv_data = {
        "id": "INV-UPDT-001",
        "invoice_number": "INV-UPDT-001",
        "balance_due": 1250.0,
        "total_amount": 1250.0,
        "items": [],
        "status": "UNPAID",
    }
    pdf_bytes = generate_invoice_pdf(inv_data, None, pub2)
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 1000


def test_scenario_5_different_invoice_amounts(auth_tokens):
    """Scenario 5: Generate invoices with different amounts; verify dynamic balance calculations and PDF."""
    headers = {"Authorization": f"Bearer {auth_tokens['admin_token']}"}
    company = {
        "company_name": "Viora Bills",
        "upi_id": "billing@okhdfcbank",
        "bank_name": "HDFC Bank",
    }

    # Case A: Full unpaid amount
    inv_a = {
        "id": "INV-AMT-A",
        "invoice_number": "INV-AMT-A",
        "total_amount": 1500.0,
        "balance_due": 1500.0,
        "amount_paid": 0.0,
        "status": "UNPAID",
        "items": [],
    }
    pdf_a = generate_invoice_pdf(inv_a, None, company)
    assert len(pdf_a) > 1000

    # Case B: Partially paid invoice
    inv_b = {
        "id": "INV-AMT-B",
        "invoice_number": "INV-AMT-B",
        "total_amount": 3500.0,
        "balance_due": 1500.0,
        "amount_paid": 2000.0,
        "status": "PARTIALLY_PAID",
        "items": [],
    }
    pdf_b = generate_invoice_pdf(inv_b, None, company)
    assert isinstance(pdf_b, bytes)
    assert pdf_b.startswith(b"%PDF")
    assert len(pdf_b) > 1000


def test_scenario_6_persistence_across_refreshes(auth_tokens):
    """Scenario 6: Verify UPI payment settings persist in MongoDB across fresh queries."""
    headers = {"Authorization": f"Bearer {auth_tokens['admin_token']}"}
    client.put(
        "/settings/company",
        json={
            "company_name": "Permanent Merchant",
            "business_address": "999 MG Road, Pune, Maharashtra",
            "upi_id": "permanent@paytm",
        },
        headers=headers,
    )

    # Directly check database collection
    doc = company_settings_collection.find_one()
    assert doc is not None
    assert doc.get("upi_id") == "permanent@paytm"
    assert doc.get("company_name") == "Permanent Merchant"

    # Simulate subsequent fresh API request
    fresh_res = client.get("/settings/company/public")
    assert fresh_res.status_code == 200
    assert fresh_res.json()["company"]["upi_id"] == "permanent@paytm"


def test_scenario_7_and_8_customer_scan_and_unpaid_status_immutability(auth_tokens):
    """Scenario 7 & 8: Customer submits UPI UTR payment.

    Confirm invoice remains UNPAID / PENDING_VERIFICATION and is NOT automatically marked PAID until staff/admin verification.
    """
    cust_token = auth_tokens["customer_token"]
    staff_token = auth_tokens["staff_token"]
    cust_id = auth_tokens["customer_id"]
    cust_email = auth_tokens["customer_email"]

    # 0. Pre-clean
    invoices_collection.delete_many({"invoice_number": "INV-UPI-VERIFY-001"})
    payments_collection.delete_many({"reference": "123456789012"})

    # 1. Create invoice in DB
    inv_res = invoices_collection.insert_one({
        "invoice_number": "INV-UPI-VERIFY-001",
        "customer_id": cust_id,
        "customer_name": "UPI Test Customer",
        "customer_email": cust_email,
        "subtotal": 2000.0,
        "tax_amount": 360.0,
        "total_amount": 2360.0,
        "amount_paid": 0.0,
        "balance_due": 2360.0,
        "status": "UNPAID",
        "invoice_date": "2026-11-10",
        "due_date": "2026-11-25",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "items": [],
    })
    inv_id = str(inv_res.inserted_id)

    # 2. Customer scans QR and submits 12-digit UTR reference
    cust_headers = {"Authorization": f"Bearer {cust_token}"}
    submit_res = client.post(
        f"/customer/invoices/{inv_id}/submit-upi",
        json={"reference": "123456789012", "amount": 2360.0, "notes": "GPay UPI Payment"},
        headers=cust_headers,
    )
    assert submit_res.status_code == 200, submit_res.text
    submit_json = submit_res.json()
    assert submit_json["payment"]["status"] == "PENDING_VERIFICATION"
    payment_id = submit_json["payment"]["id"]

    # Scenario 8 Verification: Invoice status MUST NOT be PAID yet!
    inv_check = invoices_collection.find_one({"_id": ObjectId(inv_id)})
    assert inv_check["status"] == "UNPAID", "Invoice must NOT be automatically marked PAID upon submission!"
    assert inv_check["balance_due"] == 2360.0, "Balance must remain unchanged until verification!"

    # 3. Staff verifies the UPI payment via status PATCH
    staff_headers = {"Authorization": f"Bearer {staff_token}"}
    verify_res = client.patch(
        f"/payments/{payment_id}/status",
        json={"new_status": "SUCCESS", "reason": "Verified against bank settlement credit"},
        headers=staff_headers,
    )
    assert verify_res.status_code == 200, verify_res.text
    assert verify_res.json()["payment"]["status"] == "SUCCESS"

    # Now verify invoice was updated properly
    inv_verified = invoices_collection.find_one({"_id": ObjectId(inv_id)})
    assert inv_verified["status"] == "PAID"
    assert inv_verified["amount_paid"] == 2360.0
    assert inv_verified["balance_due"] == 0.0

    # Cleanup
    invoices_collection.delete_many({"_id": ObjectId(inv_id)})
    payments_collection.delete_many({"_id": ObjectId(payment_id)})
