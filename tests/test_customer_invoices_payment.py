import pytest
from fastapi.testclient import TestClient
from backend.main import (
    app,
    invoices_collection,
    customers_collection,
    payments_collection,
    users_collection,
    password_hasher,
)
from bson import ObjectId
from datetime import datetime, timezone

client = TestClient(app)


@pytest.fixture
def setup_customer_and_invoice():
    # Setup test customer
    cust_email = "testpaycust@viorabills.com"
    users_collection.delete_many({"email": cust_email})
    customers_collection.delete_many({"email": cust_email})

    cust_res = customers_collection.insert_one({
        "name": "Test Pay Customer",
        "email": cust_email,
        "phone": "9876543210",
        "billing_address": "123 Test Street",
        "state": "Maharashtra",
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    cust_id = str(cust_res.inserted_id)

    users_collection.insert_one({
        "email": cust_email,
        "password_hash": password_hasher.hash("Customer@12345"),
        "role": "customer",
        "full_name": "Test Pay Customer",
        "customer_id": cust_id,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    login_res = client.post("/auth/login", json={"email": cust_email, "password": "Customer@12345"})
    assert login_res.status_code == 200, login_res.text
    token = login_res.json()["access_token"]

    # Setup invoice for this customer
    inv_res = invoices_collection.insert_one({
        "invoice_number": "INV-TEST-PAY-001",
        "customer_id": cust_id,
        "customer_name": "Test Pay Customer",
        "customer_email": cust_email,
        "subtotal": 1000.0,
        "tax_amount": 180.0,
        "total_amount": 1180.0,
        "amount_paid": 0.0,
        "balance_due": 1180.0,
        "status": "UNPAID",
        "invoice_date": "2026-11-08",
        "due_date": "2026-11-20",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "items": [],
    })
    inv_id = str(inv_res.inserted_id)

    yield {
        "token": token,
        "customer_id": cust_id,
        "invoice_id": inv_id,
        "email": cust_email,
    }

    # Cleanup
    invoices_collection.delete_many({"invoice_number": "INV-TEST-PAY-001"})
    payments_collection.delete_many({"invoice_id": inv_id})
    customers_collection.delete_many({"_id": ObjectId(cust_id)})
    users_collection.delete_many({"email": cust_email})


def test_submit_upi_and_card_payment(setup_customer_and_invoice):
    data = setup_customer_and_invoice
    headers = {"Authorization": f"Bearer {data['token']}"}
    inv_id = data["invoice_id"]

    # 1. Test UPI reference submission
    upi_payload = {
        "reference": "UPI987654321012",
        "amount": 500.0,
        "notes": "Paid via Google Pay",
    }
    upi_res = client.post(f"/customer/invoices/{inv_id}/submit-upi", json=upi_payload, headers=headers)
    assert upi_res.status_code == 200, upi_res.text
    upi_json = upi_res.json()
    assert "submitted successfully" in upi_json["message"]
    assert upi_json["payment"]["status"] == "PENDING_VERIFICATION"
    assert upi_json["payment"]["payment_method"] == "UPI"
    assert upi_json["payment"]["amount"] == 500.0

    # 2. Test duplicate UPI reference rejected
    dup_res = client.post(f"/customer/invoices/{inv_id}/submit-upi", json=upi_payload, headers=headers)
    assert dup_res.status_code == 409

    # 3. Test Card submission (PCI compliant)
    card_payload = {
        "card_holder": "Test Pay Customer",
        "card_number": "4111222233334444",
        "expiry": "12/28",
        "cvv": "123",
        "amount": 680.0,
        "notes": "Paid with Visa Card",
    }
    card_res = client.post(f"/customer/invoices/{inv_id}/submit-card", json=card_payload, headers=headers)
    assert card_res.status_code == 200, card_res.text
    card_json = card_res.json()
    assert "submitted successfully" in card_json["message"]
    assert card_json["payment"]["status"] == "PENDING_VERIFICATION"
    assert card_json["payment"]["payment_method"] == "Card"
    assert card_json["payment"]["card_last4"] == "4444"
    assert card_json["payment"]["card_network"] == "Visa"
    assert "cvv" not in card_json["payment"]
    assert "card_number" not in card_json["payment"]

    # 4. Verify PCI compliance in DB: ensure full PAN and CVV are never saved in DB
    saved_card_payment = payments_collection.find_one({"invoice_id": inv_id, "payment_method": "Card"})
    assert saved_card_payment is not None
    assert saved_card_payment["card_last4"] == "4444"
    assert "cvv" not in saved_card_payment
    assert "card_number" not in saved_card_payment

    # 5. Customer isolation check: another customer cannot submit payment for this invoice
    other_cust_email = "otherpaycust@viorabills.com"
    users_collection.delete_many({"email": other_cust_email})
    customers_collection.delete_many({"email": other_cust_email})
    other_c_res = customers_collection.insert_one({"name": "Other", "email": other_cust_email, "is_active": True})
    users_collection.insert_one({
        "email": other_cust_email,
        "password_hash": password_hasher.hash("Other@12345"),
        "role": "customer",
        "customer_id": str(other_c_res.inserted_id),
        "is_active": True,
    })
    other_login = client.post("/auth/login", json={"email": other_cust_email, "password": "Other@12345"})
    assert other_login.status_code == 200
    other_headers = {"Authorization": f"Bearer {other_login.json()['access_token']}"}

    iso_res = client.post(
        f"/customer/invoices/{inv_id}/submit-card",
        json=card_payload,
        headers=other_headers,
    )
    assert iso_res.status_code == 403

    # Cleanup other customer
    customers_collection.delete_many({"email": other_cust_email})
    users_collection.delete_many({"email": other_cust_email})
