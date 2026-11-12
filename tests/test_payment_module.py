"""
Tests for Complete Payment Module:
- Dynamic UPI payment and verification flow
- Debit/Credit card gateway order creation, HMAC signature verification, and webhooks
- Manual cash entry with staff audit and receipt generation
- Cheque lifecycle (Pending -> Cleared / Bounced / Cancelled) with accounting integrity
- Overpayment protection and idempotent gateway processing
- Payment dashboard summary KPIs and receipt retrieval
"""
import sys
import os
import hmac
import hashlib
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))


def _rand() -> str:
    return uuid.uuid4().hex[:8]


def create_sample_invoice(api_client, admin_headers):
    # Create customer
    c_res = api_client.post(
        "/customers",
        json={
            "name": f"Acme Payments Test Corp {_rand()}",
            "email": f"payments_test_{_rand()}@acme.com",
            "phone": "9876543210",
            "billing_address": "456 Gateway Road, Bangalore",
            "state": "Karnataka",
            "state_code": "29",
        },
        headers=admin_headers,
    )
    cust_id = c_res.json()["id"]

    # Create product
    p_res = api_client.post(
        "/products",
        json={
            "name": f"Cloud Subscription Annual {_rand()}",
            "price": 1000.0,
            "unit": "year",
            "category": "Services",
            "gst_rate": 18.0,
        },
        headers=admin_headers,
    )
    prod_id = p_res.json()["id"]

    # Create invoice (Total = 1000 + 18% GST = 1180.00)
    inv_res = api_client.post(
        "/invoices",
        json={
            "customer_id": cust_id,
            "items": [{"product_id": prod_id, "quantity": 1}],
            "place_of_supply": "Karnataka",
        },
        headers=admin_headers,
    )
    inv = inv_res.json()
    return {"customer_id": cust_id, "invoice_id": inv["id"], "total": inv["total_amount"]}


def test_cash_payment_manual_entry_and_receipt(api_client, staff_headers, admin_headers):
    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]
    total = inv_data["total"]

    # Staff records cash payment of 500.00
    res = api_client.post(
        "/payments",
        json={
            "invoice_id": inv_id,
            "amount": 500.00,
            "payment_method": "Cash",
            "notes": "Direct counter cash collection",
        },
        headers=staff_headers,
    )
    assert res.status_code == 201
    data = res.json()

    payment = data["payment"]
    assert payment["amount"] == 500.00
    assert payment["payment_method"] == "Cash"
    assert payment["status"] == "SUCCESS"
    assert "receipt_number" in payment
    assert payment["receipt_number"].startswith("REC-")
    assert payment["recorded_by"] == "staff@viorabills.com"
    assert payment["recorded_by_role"] == "staff"

    # Invoice balance must immediately be reduced by 500.00
    inv = data["invoice"]
    assert inv["amount_paid"] == 500.00
    assert inv["balance_due"] == round(total - 500.00, 2)
    assert inv["status"] == "PARTIALLY_PAID"

    # Fetch structured receipt
    rec_res = api_client.get(
        f"/payments/{payment['id']}/receipt",
        headers=staff_headers,
    )
    assert rec_res.status_code == 200
    receipt = rec_res.json()
    assert receipt["receipt_number"] == payment["receipt_number"]
    assert receipt["is_cleared"] is True
    assert receipt["invoice"]["id"] == inv_id
    assert "Acme Payments Test Corp" in receipt["customer"]["name"]


def test_cheque_payment_lifecycle(api_client, staff_headers, admin_headers):
    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]

    # Check current invoice balance
    inv_before = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    bal_before = inv_before["balance_due"]
    paid_before = inv_before["amount_paid"]

    # 1. Staff records cheque of 300.00
    res = api_client.post(
        "/payments",
        json={
            "invoice_id": inv_id,
            "amount": 300.00,
            "payment_method": "Cheque",
            "cheque_number": "CHQ-882201",
            "bank_name": "State Bank of India",
            "cheque_date": "2026-11-10",
            "notes": "Post-dated cheque for services",
        },
        headers=staff_headers,
    )
    assert res.status_code == 201
    pay_data = res.json()["payment"]
    payment_id = pay_data["id"]
    assert pay_data["status"] == "PENDING"
    assert pay_data["cheque_number"] == "CHQ-882201"
    assert pay_data["bank_name"] == "State Bank of India"

    # CRITICAL: Pending cheque MUST NOT reduce invoice balance!
    inv_after_pending = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    assert inv_after_pending["balance_due"] == bal_before
    assert inv_after_pending["amount_paid"] == paid_before

    # 2. Bank clears the cheque: Staff/Admin updates status to CLEARED
    patch_res = api_client.patch(
        f"/payments/{payment_id}/status",
        json={"new_status": "CLEARED", "reason": "Bank cleared funds to primary account"},
        headers=admin_headers,
    )
    assert patch_res.status_code == 200
    patch_data = patch_res.json()
    assert patch_data["payment"]["status"] == "CLEARED"

    # Invoice balance MUST NOW be reduced by 300.00!
    inv_after_cleared = patch_data["invoice"]
    assert inv_after_cleared["amount_paid"] == round(paid_before + 300.00, 2)
    assert inv_after_cleared["balance_due"] == round(bal_before - 300.00, 2)


def test_cheque_payment_bounced_lifecycle(api_client, staff_headers, admin_headers):
    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]
    inv_before = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    bal_before = inv_before["balance_due"]

    # 1. Staff records cheque of 200.00
    res = api_client.post(
        "/payments",
        json={
            "invoice_id": inv_id,
            "amount": 200.00,
            "payment_method": "Cheque",
            "cheque_number": "CHQ-990011",
            "bank_name": "HDFC Bank",
            "cheque_date": "2026-11-05",
        },
        headers=staff_headers,
    )
    assert res.status_code == 201
    payment_id = res.json()["payment"]["id"]

    # 2. Cheque bounces due to insufficient funds
    bounce_res = api_client.patch(
        f"/payments/{payment_id}/status",
        json={"new_status": "BOUNCED", "reason": "Insufficient funds in drawer account"},
        headers=staff_headers,
    )
    assert bounce_res.status_code == 200
    data = bounce_res.json()
    assert data["payment"]["status"] == "BOUNCED"
    assert data["payment"]["bounce_reason"] == "Insufficient funds in drawer account"

    # Invoice balance must remain unpaid (not reduced)
    inv_after_bounce = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    assert inv_after_bounce["balance_due"] == bal_before


def test_upi_payment_unverified_vs_verified(api_client, staff_headers, admin_headers):
    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]
    inv_before = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    bal_before = inv_before["balance_due"]

    utr_number = f"UPI-UTR-{_rand()}"

    # 1. Customer submits UPI transaction UTR (unverified)
    res = api_client.post(
        "/payments",
        json={
            "invoice_id": inv_id,
            "amount": 150.00,
            "payment_method": "UPI",
            "reference": utr_number,
            "is_verified": False,
            "notes": "Paid via Google Pay, awaiting bank settlement",
        },
        headers=staff_headers,
    )
    assert res.status_code == 201
    pay_data = res.json()["payment"]
    pay_id = pay_data["id"]
    assert pay_data["status"] == "PENDING_VERIFICATION"

    # Invoice balance must NOT be reduced while pending verification
    inv_pending = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    assert inv_pending["balance_due"] == bal_before

    # Duplicate UTR submission must be rejected
    dup_res = api_client.post(
        "/payments",
        json={
            "invoice_id": inv_id,
            "amount": 150.00,
            "payment_method": "UPI",
            "reference": utr_number,
            "is_verified": False,
        },
        headers=staff_headers,
    )
    assert dup_res.status_code == 409
    assert "already been recorded" in dup_res.json()["detail"]

    # 2. Staff verifies bank credit and marks as SUCCESS
    verify_res = api_client.patch(
        f"/payments/{pay_id}/status",
        json={"new_status": "SUCCESS", "reason": "Confirmed against bank statement"},
        headers=staff_headers,
    )
    assert verify_res.status_code == 200
    assert verify_res.json()["payment"]["status"] == "SUCCESS"

    # Invoice balance MUST NOW be reduced by 150.00
    inv_verified = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    assert inv_verified["balance_due"] == round(bal_before - 150.00, 2)


def test_card_payment_order_and_signature_verification(api_client, staff_headers, admin_headers, monkeypatch):
    import main

    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]
    inv_before = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    bal_before = inv_before["balance_due"]

    # 1. When gateway credentials are not configured, order creation returns 503 and gateway config reports false
    monkeypatch.setattr(main, "RAZORPAY_KEY_ID", "")
    monkeypatch.setattr(main, "RAZORPAY_KEY_SECRET", "")
    unconfigured_res = api_client.post(
        "/payments/card/create-order",
        json={"invoice_id": inv_id, "amount": 100.00},
        headers=staff_headers,
    )
    assert unconfigured_res.status_code == 503
    assert "not configured" in unconfigured_res.json()["detail"]

    config_res = api_client.get("/payments/card/config", headers=staff_headers)
    assert config_res.status_code == 200
    assert config_res.json()["is_configured"] is False

    # 2. When valid credentials are provided in server environment
    test_key_id = "rzp_test_key_123"
    test_key_secret = "viora_sandbox_key_secret_2026"
    monkeypatch.setattr(main, "RAZORPAY_KEY_ID", test_key_id)
    monkeypatch.setattr(main, "RAZORPAY_KEY_SECRET", test_key_secret)

    order_res = api_client.post(
        "/payments/card/create-order",
        json={"invoice_id": inv_id, "amount": 100.00},
        headers=staff_headers,
    )
    assert order_res.status_code == 200
    order_data = order_res.json()
    order_id = order_data["order_id"]
    assert order_data["amount"] == 100.00
    assert order_data["amount_paise"] == 10000

    # 3. Compute genuine cryptographic HMAC SHA-256 signature
    payment_id = f"pay_card_test_{_rand()}"
    mock_secret = test_key_secret.encode("utf-8")
    valid_sig = hmac.new(mock_secret, f"{order_id}|{payment_id}".encode("utf-8"), hashlib.sha256).hexdigest()

    # 4. Verify card payment with valid signature
    verify_res = api_client.post(
        "/payments/card/verify",
        json={
            "invoice_id": inv_id,
            "order_id": order_id,
            "payment_id": payment_id,
            "signature": valid_sig,
            "amount": 100.00,
        },
        headers=staff_headers,
    )
    assert verify_res.status_code == 200
    verify_data = verify_res.json()
    assert verify_data["payment"]["status"] == "SUCCESS"
    assert verify_data["payment"]["gateway_payment_id"] == payment_id
    assert verify_data["invoice"]["balance_due"] == round(bal_before - 100.00, 2)

    # 5. Idempotency check: submitting the same payment_id must succeed idempotently without double-charging
    dup_verify = api_client.post(
        "/payments/card/verify",
        json={
            "invoice_id": inv_id,
            "order_id": order_id,
            "payment_id": payment_id,
            "signature": valid_sig,
            "amount": 100.00,
        },
        headers=staff_headers,
    )
    assert dup_verify.status_code == 200
    assert "idempotent" in dup_verify.json()["message"]
    # Balance must still be the same (not subtracted twice)
    inv_check = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    assert inv_check["balance_due"] == round(bal_before - 100.00, 2)


def test_card_payment_invalid_signature_rejected(api_client, staff_headers, admin_headers, monkeypatch):
    import main
    monkeypatch.setattr(main, "RAZORPAY_KEY_SECRET", "viora_sandbox_key_secret_2026")

    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]

    res = api_client.post(
        "/payments/card/verify",
        json={
            "invoice_id": inv_id,
            "order_id": "order_test_forged",
            "payment_id": "pay_test_forged",
            "signature": "forged_malicious_signature_hash_000000",
            "amount": 50.00,
        },
        headers=staff_headers,
    )
    assert res.status_code == 400
    assert "Invalid payment gateway signature" in res.json()["detail"]


def test_card_payment_webhook(api_client, admin_headers, monkeypatch):
    import json
    import main

    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]
    inv_before = api_client.get(f"/invoices/{inv_id}", headers=admin_headers).json()
    bal_before = inv_before["balance_due"]

    webhook_event = {
        "id": f"evt_{_rand()}",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": f"pay_wh_{_rand()}",
                    "order_id": f"order_wh_{_rand()}",
                    "amount": 8000,  # 80.00 INR
                    "notes": {"invoice_id": inv_id},
                }
            }
        },
    }
    raw_body = json.dumps(webhook_event).encode("utf-8")

    # 1. Unconfigured webhook secret returns 503
    monkeypatch.setattr(main, "RAZORPAY_WEBHOOK_SECRET", "")
    wh_unconf = api_client.post(
        "/payments/card/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json"},
    )
    assert wh_unconf.status_code == 503

    # 2. Configured secret with forged signature returns 400
    wh_secret = "whsec_test_secret_123"
    monkeypatch.setattr(main, "RAZORPAY_WEBHOOK_SECRET", wh_secret)

    wh_bad = api_client.post(
        "/payments/card/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": "bad_sig"},
    )
    assert wh_bad.status_code == 400
    assert "Invalid webhook signature" in wh_bad.json()["detail"]

    # 3. Valid HMAC signature succeeds and reduces balance
    valid_sig = hmac.new(wh_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    wh_res = api_client.post(
        "/payments/card/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": valid_sig},
    )
    assert wh_res.status_code == 200
    assert wh_res.json()["status"] == "ok"

    # Invoice balance must be reduced by 80.00
    inv_after = api_client.get(f"/invoices/{inv_id}", headers=admin_headers).json()
    assert inv_after["balance_due"] == round(bal_before - 80.00, 2)

    # Re-sending same webhook event must be idempotent
    wh_dup = api_client.post(
        "/payments/card/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": valid_sig},
    )
    assert wh_dup.status_code == 200
    assert wh_dup.json()["status"] == "already_processed"


def test_overpayment_prevention(api_client, staff_headers, admin_headers):
    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]
    inv = api_client.get(f"/invoices/{inv_id}", headers=staff_headers).json()
    balance = inv["balance_due"]

    # Try to pay 1 rupee more than the balance due
    res = api_client.post(
        "/payments",
        json={
            "invoice_id": inv_id,
            "amount": balance + 1.0,
            "payment_method": "Cash",
        },
        headers=staff_headers,
    )
    assert res.status_code == 400
    assert "exceeds the outstanding balance" in res.json()["detail"]


def test_payments_summary_kpis(api_client, staff_headers):
    res = api_client.get("/payments/summary", headers=staff_headers)
    assert res.status_code == 200
    summary = res.json()

    assert "total_received" in summary
    assert "total_pending" in summary
    assert "total_cash" in summary
    assert "total_upi" in summary
    assert "total_card" in summary
    assert "total_cleared_cheque" in summary
    assert "total_pending_cheque" in summary
    assert "total_bounced_failed" in summary
    assert "counts" in summary
    assert summary["total_received"] >= 0.0


def test_payment_authorization_controls(api_client, admin_headers):
    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]

    # Unauthenticated request rejected
    res = api_client.post(
        "/payments",
        json={"invoice_id": inv_id, "amount": 10.0, "payment_method": "Cash"},
    )
    assert res.status_code == 401


def test_upi_dynamic_qr_polling_and_auto_confirmation(
    api_client, staff_headers, admin_headers
):
    """
    Verify payment status polling endpoint, rejection of simulation backdoor,
    ensuring pending UPI does not reduce balance, and verifying staff approval marks payment SUCCESS.
    """
    inv_data = create_sample_invoice(api_client, admin_headers)
    inv_id = inv_data["invoice_id"]

    # 1. Initial payment status check (polling with staff auth)
    status_res = api_client.get(f"/invoices/{inv_id}/payment-status", headers=staff_headers)
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["is_paid"] is False
    assert status_data["balance_due"] > 0
    assert status_data["latest_payment"] is None

    # 2. Triggering legacy/backdoor simulation endpoint is strictly blocked with HTTP 403 Forbidden
    sim_res = api_client.post(
        "/payments/upi/simulate-confirmation",
        json={
            "invoice_id": inv_id,
            "amount": status_data["balance_due"],
            "utr": "UPI-TEST-123456",
        },
        headers=staff_headers,
    )
    assert sim_res.status_code == 403
    assert "disabled for security reasons" in sim_res.json()["detail"]

    # 3. Genuine UPI flow: record pending verification payment
    utr_number = f"UPI-TEST-{_rand()}"
    record_res = api_client.post(
        "/payments",
        json={
            "invoice_id": inv_id,
            "amount": status_data["balance_due"],
            "payment_method": "UPI",
            "reference": utr_number,
            "is_verified": False,
            "notes": "Customer submitted UPI reference",
        },
        headers=staff_headers,
    )
    assert record_res.status_code == 201
    pay_id = record_res.json()["payment"]["id"]
    assert record_res.json()["payment"]["status"] == "PENDING_VERIFICATION"

    # Polling during pending state: payment recorded but invoice is NOT marked paid
    pending_status = api_client.get(f"/invoices/{inv_id}/payment-status", headers=staff_headers).json()
    assert pending_status["is_paid"] is False
    assert pending_status["balance_due"] == status_data["balance_due"]
    assert pending_status["latest_payment"] is None

    # 4. Authorized Staff verifies payment against genuine bank credit
    verify_res = api_client.patch(
        f"/payments/{pay_id}/status",
        json={"new_status": "SUCCESS", "reason": "Verified with bank credit alert"},
        headers=staff_headers,
    )
    assert verify_res.status_code == 200
    assert verify_res.json()["payment"]["status"] == "SUCCESS"

    # 5. Subsequent payment status polling returns confirmed paid status
    new_status_res = api_client.get(f"/invoices/{inv_id}/payment-status", headers=staff_headers)
    assert new_status_res.status_code == 200
    new_status_data = new_status_res.json()
    assert new_status_data["is_paid"] is True
    assert new_status_data["balance_due"] == 0.0
    assert new_status_data["status"] == "PAID"
    assert new_status_data["latest_payment"]["reference"] == utr_number
