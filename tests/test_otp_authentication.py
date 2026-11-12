"""
tests/test_otp_authentication.py – Comprehensive Email OTP Verification & Recovery Tests.

Covers:
1. Valid OTP generation and email dispatch logic.
2. 60-second cooldown rate limiting (HTTP 429).
3. Incorrect OTP handling and remaining attempts tracking.
4. Maximum 3 incorrect attempts locks and invalidates OTP.
5. Expired OTP rejection (10-minute expiry simulation).
6. Single-use consumption (reuse prevention).
7. Purpose binding (preventing cross-purpose replay attacks).
8. Centralized password policy enforcement (length, upper, lower, digits, weak word rejection).
9. Account enumeration protection on forgot-password endpoint.
10. End-to-end forgot-password and reset-with-otp recovery flow.
11. Session revocation: verifying prior JWT tokens are invalidated via token_version.
12. Deactivated accounts cannot perform password resets.
13. Customer invite verification and activation via OTP.
"""
import sys
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import pytest
from fastapi.testclient import TestClient
from main import (
    app,
    users_collection,
    otps_collection,
    customers_collection,
    customer_invitations_collection,
    password_hasher,
    hash_otp,
    generate_secure_otp,
    issue_otp_for_email,
    verify_and_consume_otp,
    create_access_token,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def cleanup_otps():
    """Ensure clean test state for test email addresses."""
    test_emails = [
        "otp_test@example.com",
        "forgot_test@example.com",
        "deactivated_test@example.com",
        "session_test@example.com",
        "invite_otp_test@example.com",
    ]
    otps_collection.delete_many({"email": {"$in": test_emails}})
    users_collection.delete_many({"email": {"$in": test_emails}})
    yield
    otps_collection.delete_many({"email": {"$in": test_emails}})
    users_collection.delete_many({"email": {"$in": test_emails}})


# ─── 1. OTP Generation & Cooldown Tests ──────────────────────────────────────────

def test_send_otp_success_and_cooldown():
    email = "otp_test@example.com"
    # First send should succeed
    res1 = client.post("/auth/send-otp", json={"email": email, "purpose": "VERIFICATION"})
    assert res1.status_code == 200
    data1 = res1.json()
    assert "verification code has been sent" in data1["message"]
    assert data1["cooldown_seconds"] == 60

    # Immediate second request should be rate-limited with HTTP 429
    res2 = client.post("/auth/send-otp", json={"email": email, "purpose": "VERIFICATION"})
    assert res2.status_code == 429
    assert "Please wait" in res2.json()["detail"]


def test_invalid_otp_purpose_rejected():
    res = client.post("/auth/send-otp", json={"email": "otp_test@example.com", "purpose": "UNKNOWN_PURPOSE"})
    assert res.status_code == 400
    assert "Invalid OTP purpose" in res.json()["detail"]


# ─── 2. OTP Verification & Attempt Tracking ─────────────────────────────────────

def test_incorrect_otp_tracks_attempts_and_locks():
    email = "otp_test@example.com"
    # Issue OTP directly in test environment
    issuance = issue_otp_for_email(email, "VERIFICATION")
    raw_otp = issuance["raw_otp"]

    # Wrong OTP 1: remaining 2 attempts
    with pytest.raises(Exception) as exc_info:
        verify_and_consume_otp(email, "000000", "VERIFICATION")
    assert "2 attempt(s) remaining" in str(exc_info.value)

    # Wrong OTP 2: remaining 1 attempt
    with pytest.raises(Exception) as exc_info:
        verify_and_consume_otp(email, "000000", "VERIFICATION")
    assert "1 attempt(s) remaining" in str(exc_info.value)

    # Wrong OTP 3: maximum attempts reached, OTP invalidated
    with pytest.raises(Exception) as exc_info:
        verify_and_consume_otp(email, "000000", "VERIFICATION")
    assert "Maximum attempts reached" in str(exc_info.value)

    # Even if correct OTP is supplied now, it is locked
    with pytest.raises(Exception) as exc_info:
        verify_and_consume_otp(email, raw_otp, "VERIFICATION")
    assert "Maximum incorrect attempts exceeded" in str(exc_info.value) or "No active verification code found" in str(exc_info.value)


# ─── 3. Expiration and Single-Use Consumption ───────────────────────────────────

def test_expired_otp_rejected():
    email = "otp_test@example.com"
    issuance = issue_otp_for_email(email, "VERIFICATION")
    raw_otp = issuance["raw_otp"]

    # Backdate expiration by 15 minutes
    past_time = datetime.now(timezone.utc) - timedelta(minutes=15)
    otps_collection.update_one(
        {"email": email, "is_consumed": False},
        {"$set": {"expires_at": past_time.isoformat()}}
    )

    with pytest.raises(Exception) as exc_info:
        verify_and_consume_otp(email, raw_otp, "VERIFICATION")
    assert "expired" in str(exc_info.value).lower()


def test_single_use_otp_cannot_be_reused():
    email = "otp_test@example.com"
    issuance = issue_otp_for_email(email, "VERIFICATION")
    raw_otp = issuance["raw_otp"]

    # First consumption succeeds
    assert verify_and_consume_otp(email, raw_otp, "VERIFICATION") is True

    # Re-use should fail
    with pytest.raises(Exception) as exc_info:
        verify_and_consume_otp(email, raw_otp, "VERIFICATION")
    assert "No active verification code found" in str(exc_info.value) or "already used" in str(exc_info.value)


# ─── 4. Purpose Binding Prevention ──────────────────────────────────────────────

def test_purpose_binding_cross_attack_prevention():
    email = "otp_test@example.com"
    # Issue code for VERIFICATION
    issuance = issue_otp_for_email(email, "VERIFICATION")
    raw_otp = issuance["raw_otp"]

    # Attempt to consume this code for PASSWORD_RESET
    with pytest.raises(Exception) as exc_info:
        verify_and_consume_otp(email, raw_otp, "PASSWORD_RESET")
    assert "No active verification code found" in str(exc_info.value)


# ─── 5. Password Policy Enforcement ─────────────────────────────────────────────

@pytest.mark.parametrize("weak_pass,expected_snippet", [
    ("short1A", "at least 8 characters"),
    ("alllowercase123", "at least one uppercase letter"),
    ("ALLUPPERCASE123", "at least one lowercase letter"),
    ("NoNumbersHere!", "at least one numerical digit"),
    ("Password123", "too common and insecure"),
    ("Admin12345", "too common and insecure"),
])
def test_password_policy_rejection(weak_pass, expected_snippet):
    email = "otp_test@example.com"
    issuance = issue_otp_for_email(email, "PASSWORD_RESET")
    raw_otp = issuance["raw_otp"]

    users_collection.insert_one({
        "email": email,
        "password_hash": password_hasher.hash("Initial@Pass123"),
        "role": "customer",
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    res = client.post("/auth/reset-password-with-otp", json={
        "email": email,
        "otp": raw_otp,
        "new_password": weak_pass,
    })
    assert res.status_code == 422
    detail_str = str(res.json()["detail"]).lower()
    assert expected_snippet.lower() in detail_str


# ─── 6. Account Enumeration Protection ──────────────────────────────────────────

def test_forgot_password_enumeration_protection():
    # 1. Non-existent email
    res1 = client.post("/auth/forgot-password", json={"email": "nonexistent_random_user_99@viorabills.com"})
    assert res1.status_code == 200
    msg1 = res1.json()["message"]

    # 2. Existing active user
    email = "forgot_test@example.com"
    users_collection.insert_one({
        "email": email,
        "password_hash": password_hasher.hash("Existing@Pass123"),
        "role": "staff",
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    res2 = client.post("/auth/forgot-password", json={"email": email})
    assert res2.status_code == 200
    msg2 = res2.json()["message"]

    # Both responses must be identical to defeat timing/enumeration attacks
    assert msg1 == msg2
    assert "If an account is associated" in msg1


# ─── 7. End-to-End Forgot Password & Session Revocation ─────────────────────────

def test_forgot_password_and_session_revocation():
    email = "session_test@example.com"
    initial_password = "OldStrongPassword@1"
    new_password = "NewStrongPassword@2"

    # Create active user
    users_collection.insert_one({
        "email": email,
        "password_hash": password_hasher.hash(initial_password),
        "full_name": "Session Test User",
        "role": "staff",
        "is_active": True,
        "token_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # Step 1: User logs in with old password and gets active session
    login_res = client.post("/auth/login", json={"email": email, "password": initial_password})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    hdrs = {"Authorization": f"Bearer {token}"}

    # Step 2: Validate token works
    me_res = client.get("/auth/me", headers=hdrs)
    assert me_res.status_code == 200
    assert me_res.json()["user"]["email"] == email

    # Step 3: Trigger forgot-password
    fp_res = client.post("/auth/forgot-password", json={"email": email})
    assert fp_res.status_code == 200

    # Retrieve OTP from database (simulating email receipt)
    otp_doc = otps_collection.find_one({"email": email, "purpose": "PASSWORD_RESET", "is_consumed": False})
    assert otp_doc is not None
    # We can use issue_otp_for_email or fetch directly
    # Since hash is HMAC, issue a known OTP or clear cooldown
    otps_collection.delete_many({"email": email})
    issuance = issue_otp_for_email(email, "PASSWORD_RESET")
    valid_otp = issuance["raw_otp"]

    # Step 4: Reset password with OTP
    reset_res = client.post("/auth/reset-password-with-otp", json={
        "email": email,
        "otp": valid_otp,
        "new_password": new_password,
    })
    assert reset_res.status_code == 200
    assert "successfully reset" in reset_res.json()["message"].lower()

    # Step 5: Prior JWT session MUST be immediately revoked (token_version mismatch)
    old_session_check = client.get("/auth/me", headers=hdrs)
    assert old_session_check.status_code == 401
    assert "expired" in old_session_check.json()["detail"].lower()

    # Step 6: Old password no longer works
    old_login_res = client.post("/auth/login", json={"email": email, "password": initial_password})
    assert old_login_res.status_code == 401

    # Step 7: New password works and generates a valid token
    new_login_res = client.post("/auth/login", json={"email": email, "password": new_password})
    assert new_login_res.status_code == 200
    new_token = new_login_res.json()["access_token"]
    new_me_res = client.get("/auth/me", headers={"Authorization": f"Bearer {new_token}"})
    assert new_me_res.status_code == 200


# ─── 8. Deactivated User Protection ─────────────────────────────────────────────

def test_deactivated_user_cannot_reset_password():
    email = "deactivated_test@example.com"
    users_collection.insert_one({
        "email": email,
        "password_hash": password_hasher.hash("Deactivated@Pass123"),
        "role": "staff",
        "is_active": False,  # Deactivated account
        "token_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # Forgot password returns generic message but no active OTP is generated
    res = client.post("/auth/forgot-password", json={"email": email})
    assert res.status_code == 200
    otp_doc = otps_collection.find_one({"email": email})
    assert otp_doc is None

    # Manually attempting reset with a fabricated OTP returns 403 Deactivated
    issuance = issue_otp_for_email(email, "PASSWORD_RESET")
    reset_res = client.post("/auth/reset-password-with-otp", json={
        "email": email,
        "otp": issuance["raw_otp"],
        "new_password": "NewValidPass@123",
    })
    assert reset_res.status_code == 403
    assert "deactivated" in reset_res.json()["detail"].lower()


# ─── 9. Customer Invite Onboarding via OTP ──────────────────────────────────────

def test_customer_invite_verification_via_otp():
    uid = uuid.uuid4().hex[:6]
    cust_email = f"client_{uid}@viorabills.com"

    # Create customer record
    ins_cust = customers_collection.insert_one({
        "name": f"Enterprise Client {uid}",
        "email": cust_email,
        "phone": "9876543210",
        "billing_address": {"city": "Mumbai", "state": "Maharashtra"},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    cust_id = str(ins_cust.inserted_id)

    # Create invitation token
    invite_token = f"inv_{uuid.uuid4().hex}"
    customer_invitations_collection.insert_one({
        "token": invite_token,
        "customer_id": cust_id,
        "customer_name": f"Enterprise Client {uid}",
        "email": cust_email,
        "status": "PENDING",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # Issue verification OTP
    issuance = issue_otp_for_email(cust_email, "VERIFICATION")
    raw_otp = issuance["raw_otp"]

    # Submit verification and set password
    set_res = client.post("/auth/verify-otp-and-set-password", json={
        "email": cust_email,
        "otp": raw_otp,
        "password": "CustomerSecure@123",
        "token": invite_token,
        "full_name": f"Enterprise Client {uid}",
    })
    assert set_res.status_code == 200
    assert set_res.json()["role"] == "customer"
    assert set_res.json()["customer_id"] == cust_id

    # Invitation is marked ACCEPTED
    inv_doc = customer_invitations_collection.find_one({"token": invite_token})
    assert inv_doc["status"] == "ACCEPTED"

    # Customer user can immediately log in
    cust_login = client.post("/auth/login", json={
        "email": cust_email,
        "password": "CustomerSecure@123",
    })
    assert cust_login.status_code == 200
    assert cust_login.json()["user"]["role"] == "customer"
