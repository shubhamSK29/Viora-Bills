import os
import smtplib
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from bson import ObjectId

from backend.main import (
    app,
    users_collection,
    customers_collection,
    products_collection,
    invoices_collection,
    payments_collection,
    orders_collection,
    email_delivery_logs_collection,
    password_hasher,
    dispatch_invoice_email,
    dispatch_payment_receipt_email,
)

client = TestClient(app)


@pytest.fixture
def email_test_setup():
    admin_email = "email_test_admin@viorabills.com"
    staff_email = "email_test_staff@viorabills.com"
    cust_email = "email_test_cust@viorabills.com"
    all_emails = [admin_email, staff_email, cust_email]

    users_collection.delete_many({"email": {"$in": all_emails}})
    customers_collection.delete_many({"email": {"$in": all_emails}})
    email_delivery_logs_collection.delete_many({"recipient_email": cust_email})

    # 1. Admin
    users_collection.insert_one({
        "email": admin_email,
        "password_hash": password_hasher.hash("Admin@12345"),
        "role": "admin",
        "full_name": "Email Test Admin",
        "is_active": True,
    })
    adm_res = client.post("/auth/login", json={"email": admin_email, "password": "Admin@12345"})
    admin_token = adm_res.json()["access_token"]

    # 2. Staff
    users_collection.insert_one({
        "email": staff_email,
        "password_hash": password_hasher.hash("Staff@12345"),
        "role": "staff",
        "full_name": "Email Test Staff",
        "is_active": True,
    })
    stf_res = client.post("/auth/login", json={"email": staff_email, "password": "Staff@12345"})
    staff_token = stf_res.json()["access_token"]

    # 3. Customer
    cust_res = customers_collection.insert_one({
        "name": "Automated Email Test Customer",
        "email": cust_email,
        "phone": "9876543210",
        "address": "123 Notification Lane",
        "state": "Maharashtra",
        "is_active": True,
    })
    cust_id = str(cust_res.inserted_id)

    users_collection.insert_one({
        "email": cust_email,
        "password_hash": password_hasher.hash("Cust@12345"),
        "role": "customer",
        "customer_id": cust_id,
        "full_name": "Automated Email Test Customer",
        "is_active": True,
    })
    cust_login_res = client.post("/auth/login", json={"email": cust_email, "password": "Cust@12345"})
    cust_token = cust_login_res.json()["access_token"]

    # 4. Product
    prod_res = products_collection.insert_one({
        "name": "Automated Email Test Product",
        "price": 1000.0,
        "unit": "pcs",
        "gst_rate": 18.0,
        "category": "Electronics",
        "is_active": True,
    })
    prod_id = str(prod_res.inserted_id)

    yield {
        "admin_token": admin_token,
        "staff_token": staff_token,
        "cust_token": cust_token,
        "cust_id": cust_id,
        "cust_email": cust_email,
        "prod_id": prod_id,
    }

    # Teardown
    users_collection.delete_many({"email": {"$in": all_emails}})
    customers_collection.delete_many({"email": {"$in": all_emails}})
    products_collection.delete_one({"_id": ObjectId(prod_id)})
    email_delivery_logs_collection.delete_many({"recipient_email": cust_email})


# ---------------------------------------------------------------------------
# Test 1: Manual Invoice Creation triggers automated Invoice Email with PDF
# ---------------------------------------------------------------------------
def test_create_invoice_triggers_automated_email(email_test_setup):
    headers = {"Authorization": f"Bearer {email_test_setup['admin_token']}"}
    cust_id = email_test_setup["cust_id"]
    prod_id = email_test_setup["prod_id"]

    with patch("backend.main.send_email", return_value=True) as mock_send:
        res = client.post(
            "/invoices",
            headers=headers,
            json={
                "customer_id": cust_id,
                "items": [{"product_id": prod_id, "quantity": 1}],
                "discount": 0.0,
                "place_of_supply": "Maharashtra",
            },
        )
        assert res.status_code == 201
        inv_data = res.json()
        inv_id = inv_data["id"]

        # Background task runs synchronously in TestClient
        assert mock_send.called
        kwargs = mock_send.call_args.kwargs
        assert kwargs["to_email"] == email_test_setup["cust_email"]
        assert inv_data["invoice_number"] in kwargs["subject"]
        assert len(kwargs.get("attachments", [])) == 1
        att = kwargs["attachments"][0]
        assert att["filename"].endswith(".pdf")
        assert len(att["content"]) > 100

        # Check MongoDB email_delivery_logs collection
        log = email_delivery_logs_collection.find_one({"related_invoice_id": inv_id})
        assert log is not None
        assert log["delivery_status"] == "SENT"
        assert log["email_type"] == "INVOICE"
        assert log["recipient_email"] == email_test_setup["cust_email"]


# ---------------------------------------------------------------------------
# Test 2: Order Invoice Generation triggers automated Invoice Email with PDF
# ---------------------------------------------------------------------------
def test_order_invoicing_triggers_automated_email(email_test_setup):
    admin_hdr = {"Authorization": f"Bearer {email_test_setup['admin_token']}"}
    cust_hdr = {"Authorization": f"Bearer {email_test_setup['cust_token']}"}
    prod_id = email_test_setup["prod_id"]

    # Customer adds product to cart and places order
    client.delete("/customer/cart", headers=cust_hdr)
    add_res = client.post(
        "/customer/cart/items",
        headers=cust_hdr,
        json={"product_id": prod_id, "quantity": 1},
    )
    assert add_res.status_code == 200

    order_res = client.post(
        "/customer/orders",
        headers=cust_hdr,
        json={"delivery_notes": "Automated email test delivery"},
    )
    assert order_res.status_code == 201
    order_id = order_res.json()["id"]

    # Staff accepts order
    acc_res = client.post(
        f"/orders/{order_id}/accept",
        headers=admin_hdr,
        json={"notes": "Approved for dispatch"},
    )
    assert acc_res.status_code == 200

    # Staff generates invoice for order
    with patch("backend.main.send_email", return_value=True) as mock_send:
        gen_res = client.post(f"/orders/{order_id}/generate-invoice", headers=admin_hdr)
        assert gen_res.status_code == 200
        inv_data = gen_res.json()["invoice"]
        inv_id = inv_data["id"]

        assert mock_send.called
        kwargs = mock_send.call_args.kwargs
        assert kwargs["to_email"] == email_test_setup["cust_email"]
        assert inv_data["invoice_number"] in kwargs["subject"]

        log = email_delivery_logs_collection.find_one({"related_invoice_id": inv_id})
        assert log is not None
        assert log["delivery_status"] == "SENT"


# ---------------------------------------------------------------------------
# Test 3: Successful Payment triggers automated Payment Receipt Email with PDF
# ---------------------------------------------------------------------------
def test_payment_success_triggers_automated_receipt_email(email_test_setup):
    headers = {"Authorization": f"Bearer {email_test_setup['staff_token']}"}
    cust_id = email_test_setup["cust_id"]
    prod_id = email_test_setup["prod_id"]

    # Create an invoice first (without triggering mock inspect)
    with patch("backend.main.send_email", return_value=True):
        inv_res = client.post(
            "/invoices",
            headers=headers,
            json={
                "customer_id": cust_id,
                "items": [{"product_id": prod_id, "quantity": 1}],
                "discount": 0.0,
                "place_of_supply": "Maharashtra",
            },
        )
    assert inv_res.status_code == 201
    inv_id = inv_res.json()["id"]
    balance = inv_res.json()["balance_due"]

    with patch("backend.main.send_email", return_value=True) as mock_send:
        pay_res = client.post(
            "/payments",
            headers=headers,
            json={
                "invoice_id": inv_id,
                "amount": balance,
                "payment_method": "Cash",
                "status": "SUCCESS",
            },
        )
        assert pay_res.status_code == 201
        pay_json = pay_res.json()
        pay_data = pay_json.get("payment", pay_json)
        pay_id = pay_data["id"]

        assert mock_send.called
        kwargs = mock_send.call_args.kwargs
        assert kwargs["to_email"] == email_test_setup["cust_email"]
        assert "Payment Receipt" in kwargs["subject"]
        assert pay_data["receipt_number"] in kwargs["subject"]

        # Verify PDF attachment
        att = kwargs["attachments"][0]
        assert att["filename"] == f"Receipt_{pay_data['receipt_number']}.pdf"
        assert len(att["content"]) > 100

        # Check log in DB
        log = email_delivery_logs_collection.find_one({"related_payment_id": pay_id})
        assert log is not None
        assert log["delivery_status"] == "SENT"
        assert log["email_type"] == "PAYMENT_RECEIPT"


# ---------------------------------------------------------------------------
# Test 4: Cheque PENDING payment does NOT trigger email; CLEARED triggers email
# ---------------------------------------------------------------------------
def test_cheque_pending_no_email_cleared_triggers_receipt_email(email_test_setup):
    headers = {"Authorization": f"Bearer {email_test_setup['admin_token']}"}
    cust_id = email_test_setup["cust_id"]
    prod_id = email_test_setup["prod_id"]

    with patch("backend.main.send_email", return_value=True):
        inv_res = client.post(
            "/invoices",
            headers=headers,
            json={
                "customer_id": cust_id,
                "items": [{"product_id": prod_id, "quantity": 2}],
                "discount": 0.0,
                "place_of_supply": "Maharashtra",
            },
        )
    assert inv_res.status_code == 201
    inv_id = inv_res.json()["id"]
    balance = inv_res.json()["balance_due"]

    # 1. Record Cheque payment with status PENDING
    with patch("backend.main.send_email", return_value=True) as mock_send:
        pay_res = client.post(
            "/payments",
            headers=headers,
            json={
                "invoice_id": inv_id,
                "amount": balance,
                "payment_method": "Cheque",
                "status": "PENDING",
                "cheque_number": "CHQ-998811",
                "bank_name": "State Bank of India",
                "cheque_date": "2026-11-09",
            },
        )
        assert pay_res.status_code == 201
        pay_json = pay_res.json()
        pay_id = pay_json.get("payment", pay_json)["id"]
        # Cheque PENDING must NOT trigger receipt dispatch!
        assert not mock_send.called
        log = email_delivery_logs_collection.find_one({"related_payment_id": pay_id})
        assert log is None

    # 2. Transition Cheque from PENDING -> CLEARED
    with patch("backend.main.send_email", return_value=True) as mock_send_clear:
        patch_res = client.patch(
            f"/payments/{pay_id}/status",
            headers=headers,
            json={
                "new_status": "CLEARED",
                "reason": "Cheque cleared at clearing house",
            },
        )
        assert patch_res.status_code == 200
        assert mock_send_clear.called
        kwargs = mock_send_clear.call_args.kwargs
        assert "Payment Receipt" in kwargs["subject"]

        log = email_delivery_logs_collection.find_one({"related_payment_id": pay_id})
        assert log is not None
        assert log["delivery_status"] == "SENT"


# ---------------------------------------------------------------------------
# Test 5: UPI Claim PENDING_VERIFICATION does NOT send receipt; verification does
# ---------------------------------------------------------------------------
def test_upi_claim_no_receipt_until_verified(email_test_setup):
    adm_hdr = {"Authorization": f"Bearer {email_test_setup['admin_token']}"}
    cust_hdr = {"Authorization": f"Bearer {email_test_setup['cust_token']}"}
    cust_id = email_test_setup["cust_id"]
    prod_id = email_test_setup["prod_id"]

    with patch("backend.main.send_email", return_value=True):
        inv_res = client.post(
            "/invoices",
            headers=adm_hdr,
            json={
                "customer_id": cust_id,
                "items": [{"product_id": prod_id, "quantity": 1}],
                "discount": 0.0,
                "place_of_supply": "Maharashtra",
            },
        )
    assert inv_res.status_code == 201
    inv_id = inv_res.json()["id"]
    balance = inv_res.json()["balance_due"]

    # Customer submits UPI UTR
    import secrets
    unique_ref = f"UPI{secrets.token_hex(6).upper()}"
    with patch("backend.main.send_email", return_value=True) as mock_send_claim:
        claim_res = client.post(
            f"/customer/invoices/{inv_id}/submit-upi",
            headers=cust_hdr,
            json={
                "amount": balance,
                "reference": unique_ref,
                "notes": "Paid via GPay",
            },
        )
        assert claim_res.status_code == 200
        pay_id = claim_res.json()["payment"]["id"]

        # Submitting UPI claim must NOT dispatch receipt
        assert not mock_send_claim.called
        assert email_delivery_logs_collection.find_one({"related_payment_id": pay_id}) is None

    # Staff verifies against bank statement (PENDING_VERIFICATION -> SUCCESS)
    with patch("backend.main.send_email", return_value=True) as mock_send_verify:
        verify_res = client.patch(
            f"/payments/{pay_id}/status",
            headers=adm_hdr,
            json={
                "new_status": "SUCCESS",
                "reason": "Verified matching credits on bank statement",
            },
        )
        assert verify_res.status_code == 200
        assert mock_send_verify.called

        log = email_delivery_logs_collection.find_one({"related_payment_id": pay_id})
        assert log is not None
        assert log["delivery_status"] == "SENT"


# ---------------------------------------------------------------------------
# Test 6: Ineligible payment status (FAILED / BOUNCED) NEVER dispatches receipt
# ---------------------------------------------------------------------------
def test_bounced_or_failed_payment_never_dispatches_receipt(email_test_setup):
    adm_hdr = {"Authorization": f"Bearer {email_test_setup['admin_token']}"}
    cust_id = email_test_setup["cust_id"]
    prod_id = email_test_setup["prod_id"]

    with patch("backend.main.send_email", return_value=True):
        inv_res = client.post(
            "/invoices",
            headers=adm_hdr,
            json={
                "customer_id": cust_id,
                "items": [{"product_id": prod_id, "quantity": 1}],
                "discount": 0.0,
                "place_of_supply": "Maharashtra",
            },
        )
    inv_id = inv_res.json()["id"]
    balance = inv_res.json()["balance_due"]

    with patch("backend.main.send_email", return_value=True):
        pay_res = client.post(
            "/payments",
            headers=adm_hdr,
            json={
                "invoice_id": inv_id,
                "amount": balance,
                "payment_method": "Cheque",
                "status": "PENDING",
            },
        )
    pay_id = pay_res.json().get("payment", pay_res.json())["id"]

    with patch("backend.main.send_email", return_value=True) as mock_send_bounce:
        bounce_res = client.patch(
            f"/payments/{pay_id}/status",
            headers=adm_hdr,
            json={
                "new_status": "BOUNCED",
                "reason": "Cheque bounced due to insufficient funds",
            },
        )
        assert bounce_res.status_code == 200
        assert not mock_send_bounce.called


# ---------------------------------------------------------------------------
# Test 7: Idempotency prevents duplicate emails for same invoice or payment
# ---------------------------------------------------------------------------
def test_idempotency_prevents_duplicate_email_dispatch(email_test_setup):
    adm_hdr = {"Authorization": f"Bearer {email_test_setup['admin_token']}"}
    cust_id = email_test_setup["cust_id"]
    prod_id = email_test_setup["prod_id"]

    with patch("backend.main.send_email", return_value=True) as mock_send:
        inv_res = client.post(
            "/invoices",
            headers=adm_hdr,
            json={
                "customer_id": cust_id,
                "items": [{"product_id": prod_id, "quantity": 1}],
                "discount": 0.0,
                "place_of_supply": "Maharashtra",
            },
        )
        assert inv_res.status_code == 201
        assert mock_send.call_count == 1
        inv_id = inv_res.json()["id"]

    # Call dispatch_invoice_email directly without is_retry=True
    with patch("backend.main.send_email", return_value=True) as mock_send_duplicate:
        result = dispatch_invoice_email(inv_id, is_retry=False)
        # Should return True without dispatching duplicate email
        assert result is True
        assert not mock_send_duplicate.called


# ---------------------------------------------------------------------------
# Test 8: SMTP Failure records FAILED log and does NOT roll back transaction
# ---------------------------------------------------------------------------
def test_smtp_failure_records_failed_log_without_rollback(email_test_setup):
    adm_hdr = {"Authorization": f"Bearer {email_test_setup['admin_token']}"}
    cust_id = email_test_setup["cust_id"]
    prod_id = email_test_setup["prod_id"]

    # Mock send_email raising SMTPException
    with patch("backend.main.send_email", side_effect=smtplib.SMTPConnectError(421, b"Connection refused")):
        inv_res = client.post(
            "/invoices",
            headers=adm_hdr,
            json={
                "customer_id": cust_id,
                "items": [{"product_id": prod_id, "quantity": 1}],
                "discount": 0.0,
                "place_of_supply": "Maharashtra",
            },
        )
        # Invoice transaction MUST succeed
        assert inv_res.status_code == 201
        inv_id = inv_res.json()["id"]

        # Invoice must exist in DB
        assert invoices_collection.find_one({"_id": ObjectId(inv_id)}) is not None

        # Email log must exist and be marked FAILED
        log = email_delivery_logs_collection.find_one({"related_invoice_id": inv_id})
        assert log is not None
        assert log["delivery_status"] == "FAILED"
        assert "Connection refused" in (log.get("last_error") or "")


# ---------------------------------------------------------------------------
# Test 9: RBAC and Retry Email Endpoint (/emails/delivery-logs)
# ---------------------------------------------------------------------------
def test_delivery_logs_rbac_and_retry(email_test_setup):
    adm_hdr = {"Authorization": f"Bearer {email_test_setup['admin_token']}"}
    cust_hdr = {"Authorization": f"Bearer {email_test_setup['cust_token']}"}

    # Customer forbidden
    cust_access = client.get("/emails/delivery-logs", headers=cust_hdr)
    assert cust_access.status_code == 403

    # Admin access allowed
    admin_access = client.get("/emails/delivery-logs", headers=adm_hdr)
    assert admin_access.status_code == 200
    data = admin_access.json()
    assert "items" in data
    assert "total" in data

    # Find a log or create a dummy failed log for testing retry
    failed_log_res = email_delivery_logs_collection.insert_one({
        "email_id": "test_failed_log_123",
        "customer_id": email_test_setup["cust_id"],
        "recipient_email": email_test_setup["cust_email"],
        "email_type": "INVOICE",
        "related_invoice_id": "nonexistent_or_test",
        "delivery_status": "FAILED",
        "attempts": 1,
        "last_error": "Simulated initial SMTP timeout",
    })

    with patch("backend.main.dispatch_invoice_email") as mock_retry_task:
        retry_res = client.post(
            f"/emails/delivery-logs/{failed_log_res.inserted_id}/retry",
            headers=adm_hdr,
        )
        assert retry_res.status_code == 200
        assert mock_retry_task.called
