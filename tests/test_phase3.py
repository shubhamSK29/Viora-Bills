"""
test_phase3.py – Authentication, Authorization & Security tests.

Covers:
- Admin login success
- Staff login success
- Invalid password
- Invalid email (non-existent user)
- Missing token (unauthenticated access)
- Unauthorized endpoint: staff accessing admin-only routes
- Disabled user login
- Password hashing (hash is never plaintext)
- Password change
- Token verification (tampered token)
- Expired token simulation
- User management (CRUD)
- Privilege escalation prevention
- Phase 1/2 API compatibility
"""
import sys
import os
import uuid
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import pytest
import jwt as pyjwt
from fastapi.testclient import TestClient
from main import app, users_collection, password_hasher, JWT_SECRET_KEY, JWT_ALGORITHM

client = TestClient(app)


# ─── Authentication ────────────────────────────────────────────────────────────

def test_admin_login_success():
    res = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": "Admin@12345",
    })
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["role"] == "admin"
    assert data["user"]["email"] == "admin@viorabills.com"
    # Token must be decodeable with the correct secret
    payload = pyjwt.decode(data["access_token"], JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    assert payload["role"] == "admin"
    assert payload["email"] == "admin@viorabills.com"


def test_staff_login_success():
    res = client.post("/auth/login", json={
        "email": "staff@viorabills.com",
        "password": "Staff@12345",
    })
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["user"]["role"] == "staff"


def test_invalid_password():
    res = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": "WrongPassword999",
    })
    assert res.status_code == 401
    assert "Invalid email or password" in res.json()["detail"]


def test_invalid_email_nonexistent():
    res = client.post("/auth/login", json={
        "email": "ghost@nobody.com",
        "password": "SomePassword123",
    })
    assert res.status_code == 401
    assert "Invalid email or password" in res.json()["detail"]


def test_missing_token_on_protected_route():
    # Accessing a protected endpoint without token should return 401
    for endpoint in ["/customers", "/products", "/invoices", "/payments"]:
        res = client.get(endpoint)
        assert res.status_code == 401, f"Expected 401 for {endpoint}, got {res.status_code}"


def test_tampered_token_rejected():
    # Forge a token with wrong secret
    fake_payload = {
        "sub": "000000000000000000000000",
        "email": "admin@viorabills.com",
        "role": "admin",
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
    }
    forged_token = pyjwt.encode(fake_payload, "completely-wrong-secret", algorithm=JWT_ALGORITHM)
    res = client.get("/customers", headers={"Authorization": f"Bearer {forged_token}"})
    assert res.status_code == 401
    assert "Invalid authentication token" in res.json()["detail"]


def test_expired_token_rejected():
    # Create a token that expired in the past
    expired_payload = {
        "sub": "000000000000000000000000",
        "email": "admin@viorabills.com",
        "role": "admin",
        "exp": int(time.time()) - 60,  # 60 seconds in the past
        "iat": int(time.time()) - 120,
    }
    expired_token = pyjwt.encode(expired_payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    res = client.get("/customers", headers={"Authorization": f"Bearer {expired_token}"})
    assert res.status_code == 401
    assert "expired" in res.json()["detail"].lower()


# ─── Role-Based Access Control ─────────────────────────────────────────────────

def test_staff_cannot_access_user_management():
    # Staff login
    login_res = client.post("/auth/login", json={
        "email": "staff@viorabills.com",
        "password": "Staff@12345",
    })
    staff_token = login_res.json()["access_token"]
    staff_headers = {"Authorization": f"Bearer {staff_token}"}

    # Staff should NOT be able to list users
    res = client.get("/users", headers=staff_headers)
    assert res.status_code == 403

    # Staff should NOT be able to create users
    res = client.post("/users", json={
        "full_name": "Injected Admin",
        "email": "injected@evil.com",
        "password": "Password123",
        "role": "admin",
    }, headers=staff_headers)
    assert res.status_code == 403


def test_staff_cannot_update_company_settings():
    login_res = client.post("/auth/login", json={
        "email": "staff@viorabills.com",
        "password": "Staff@12345",
    })
    staff_token = login_res.json()["access_token"]
    staff_headers = {"Authorization": f"Bearer {staff_token}"}

    res = client.put("/settings/company", json={
        "company_name": "Hacked Co",
        "business_address": "123 Hack Street",
    }, headers=staff_headers)
    assert res.status_code == 403
    assert "Admin authorization required" in res.json()["detail"]


def test_staff_can_access_allowed_endpoints():
    login_res = client.post("/auth/login", json={
        "email": "staff@viorabills.com",
        "password": "Staff@12345",
    })
    staff_token = login_res.json()["access_token"]
    staff_headers = {"Authorization": f"Bearer {staff_token}"}

    # Staff CAN access customers, products, invoices, payments
    for endpoint in ["/customers", "/products", "/invoices", "/payments"]:
        res = client.get(endpoint, headers=staff_headers)
        assert res.status_code == 200, f"Staff should access {endpoint}, got {res.status_code}"


# ─── Password Security ─────────────────────────────────────────────────────────

def test_password_is_hashed_in_database():
    # Retrieve admin user from DB and verify hash is NOT plaintext
    admin = users_collection.find_one({"email": "admin@viorabills.com"})
    assert admin is not None
    stored_hash = admin.get("password_hash", "")
    # Must start with argon2id marker
    assert stored_hash.startswith("$argon2id$"), "Password must be Argon2id hashed"
    assert "Admin@12345" not in stored_hash, "Plain text password must NOT appear in hash field"
    # Verify the hash round-trips correctly
    assert password_hasher.verify(stored_hash, "Admin@12345") is True


def test_password_change(admin_headers):
    # First, login with admin to get a token
    login_res = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": "Admin@12345",
    })
    token = login_res.json()["access_token"]
    hdrs = {"Authorization": f"Bearer {token}"}

    # Change password
    change_res = client.post("/auth/change-password", json={
        "current_password": "Admin@12345",
        "new_password": "Admin@12345",  # Same password → should be rejected
    }, headers=hdrs)
    assert change_res.status_code == 400
    assert "identical" in change_res.json()["detail"].lower()

    # Change to a genuinely different password, then revert
    new_pass = "Temp@67890"
    change_res2 = client.post("/auth/change-password", json={
        "current_password": "Admin@12345",
        "new_password": new_pass,
    }, headers=hdrs)
    assert change_res2.status_code == 200

    # Old password should now fail
    fail_res = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": "Admin@12345",
    })
    assert fail_res.status_code == 401

    # New password should work
    new_login = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": new_pass,
    })
    assert new_login.status_code == 200
    new_token = new_login.json()["access_token"]

    # Revert back to original admin password
    revert_res = client.post("/auth/change-password", json={
        "current_password": new_pass,
        "new_password": "Admin@12345",
    }, headers={"Authorization": f"Bearer {new_token}"})
    assert revert_res.status_code == 200

    # Verify original password works again
    final_login = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": "Admin@12345",
    })
    assert final_login.status_code == 200


# ─── User Management ───────────────────────────────────────────────────────────

def test_admin_user_crud():
    # Login as admin
    login_res = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": "Admin@12345",
    })
    admin_token = login_res.json()["access_token"]
    hdrs = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create a new staff user
    uniq = uuid.uuid4().hex[:8]
    new_email = f"teststaff_{uniq}@viorabills.com"
    create_res = client.post("/users", json={
        "full_name": "Test Staff Member",
        "email": new_email,
        "password": "StaffPass@1",
        "role": "staff",
        "is_active": True,
    }, headers=hdrs)
    assert create_res.status_code == 201
    new_user = create_res.json()["user"]
    new_user_id = new_user["id"]
    assert new_user["role"] == "staff"
    assert new_user["email"] == new_email

    # 2. List users – new user appears
    list_res = client.get("/users", headers=hdrs)
    assert list_res.status_code == 200
    emails = [u["email"] for u in list_res.json()["users"]]
    assert new_email in emails

    # 3. Update user – deactivate
    upd_res = client.put(f"/users/{new_user_id}", json={
        "is_active": False,
    }, headers=hdrs)
    assert upd_res.status_code == 200
    assert upd_res.json()["user"]["is_active"] is False

    # 4. Deactivated user cannot log in
    login_attempt = client.post("/auth/login", json={
        "email": new_email,
        "password": "StaffPass@1",
    })
    assert login_attempt.status_code == 403
    assert "deactivated" in login_attempt.json()["detail"].lower()

    # 5. Admin resets staff password
    reset_res = client.post(f"/users/{new_user_id}/reset-password", json={
        "new_password": "ResetPass@2",
    }, headers=hdrs)
    assert reset_res.status_code == 200
    assert "reset successfully" in reset_res.json()["message"]

    # 6. Re-activate then delete
    client.put(f"/users/{new_user_id}", json={"is_active": True}, headers=hdrs)
    del_res = client.delete(f"/users/{new_user_id}", headers=hdrs)
    assert del_res.status_code == 200


def test_admin_cannot_delete_self():
    login_res = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": "Admin@12345",
    })
    token = login_res.json()["access_token"]
    admin_id = login_res.json()["user"]["id"]
    hdrs = {"Authorization": f"Bearer {token}"}

    res = client.delete(f"/users/{admin_id}", headers=hdrs)
    assert res.status_code == 400
    assert "cannot delete their own account" in res.json()["detail"].lower()


def test_privilege_escalation_prevention():
    """Staff user cannot create an admin account."""
    login_res = client.post("/auth/login", json={
        "email": "staff@viorabills.com",
        "password": "Staff@12345",
    })
    staff_token = login_res.json()["access_token"]
    staff_hdrs = {"Authorization": f"Bearer {staff_token}"}

    res = client.post("/users", json={
        "full_name": "Injected Admin",
        "email": "attacker@evil.com",
        "password": "P@ssw0rd1",
        "role": "admin",
    }, headers=staff_hdrs)
    assert res.status_code == 403


def test_me_endpoint_returns_current_user():
    login_res = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": "Admin@12345",
    })
    token = login_res.json()["access_token"]
    res = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    user = res.json()["user"]
    assert user["email"] == "admin@viorabills.com"
    assert "password_hash" not in user
    assert "password" not in user


def test_logout_endpoint():
    login_res = client.post("/auth/login", json={
        "email": "admin@viorabills.com",
        "password": "Admin@12345",
    })
    token = login_res.json()["access_token"]
    res = client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert "logged out" in res.json()["message"].lower()


def test_public_company_endpoint_no_auth_required():
    """Public company endpoint must remain unauthenticated for invoice printing."""
    res = client.get("/settings/company/public")
    assert res.status_code == 200
    data = res.json()
    assert "company" in data


def test_phase1_phase2_compatibility(admin_headers):
    """All Phase 1 & 2 endpoints remain functional with JWT auth."""
    res_customers = client.get("/customers", headers=admin_headers)
    res_products = client.get("/products", headers=admin_headers)
    res_invoices = client.get("/invoices", headers=admin_headers)
    res_payments = client.get("/payments", headers=admin_headers)
    res_reports = client.get("/reports/sales-summary", headers=admin_headers)
    res_gst = client.get("/reports/gst", headers=admin_headers)
    res_aging = client.get("/reports/aging", headers=admin_headers)
    res_next_num = client.get("/invoices/next-number", headers=admin_headers)
    res_settings = client.get("/settings/company", headers=admin_headers)

    for name, res in [
        ("customers", res_customers),
        ("products", res_products),
        ("invoices", res_invoices),
        ("payments", res_payments),
        ("sales-summary", res_reports),
        ("gst", res_gst),
        ("aging", res_aging),
        ("next-number", res_next_num),
        ("settings", res_settings),
    ]:
        assert res.status_code == 200, f"Phase 1/2 compatibility broken: /{name} returned {res.status_code}"

