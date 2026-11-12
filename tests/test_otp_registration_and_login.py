import pytest
from fastapi.testclient import TestClient
from backend.main import (
    app,
    users_collection,
    customers_collection,
    otps_collection,
)
from bson import ObjectId

client = TestClient(app)


@pytest.fixture(autouse=True)
def cleanup_test_users():
    test_email = "newcustuser@viorabills.com"
    users_collection.delete_many({"email": test_email})
    customers_collection.delete_many({"email": test_email})
    otps_collection.delete_many({"email": test_email})
    yield
    users_collection.delete_many({"email": test_email})
    customers_collection.delete_many({"email": test_email})
    otps_collection.delete_many({"email": test_email})


def test_full_otp_registration_and_login_workflow():
    test_email = "newcustuser@viorabills.com"
    test_name = "New Test Customer"
    test_password = "SecurePassword@123"

    # 1. Request registration OTP
    otp_res = client.post("/auth/send-registration-otp", json={
        "email": test_email,
        "full_name": test_name,
    })
    assert otp_res.status_code == 200, otp_res.text
    otp_data = otp_res.json()
    assert "dispatched" in otp_data["message"]
    raw_otp = otp_data.get("dev_otp")
    assert raw_otp is not None and len(raw_otp) == 6

    # 2. Cooldown check: requesting another OTP within 60 seconds should fail with 429
    cooldown_res = client.post("/auth/send-registration-otp", json={
        "email": test_email,
        "full_name": test_name,
    })
    assert cooldown_res.status_code == 429

    # 3. Weak password rejection
    weak_res = client.post("/auth/register", json={
        "email": test_email,
        "full_name": test_name,
        "password": "weak",
        "otp": raw_otp,
    })
    assert weak_res.status_code == 422

    # 4. Incorrect OTP rejection
    wrong_otp_res = client.post("/auth/register", json={
        "email": test_email,
        "full_name": test_name,
        "password": test_password,
        "otp": "000000",
    })
    assert wrong_otp_res.status_code == 400
    assert "Invalid verification code" in wrong_otp_res.json()["detail"]

    # 5. Successful registration with correct OTP and secure password
    reg_res = client.post("/auth/register", json={
        "email": test_email,
        "full_name": test_name,
        "phone": "9876543210",
        "password": test_password,
        "otp": raw_otp,
    })
    assert reg_res.status_code == 200, reg_res.text
    reg_data = reg_res.json()
    assert "successfully" in reg_data["message"]
    assert "access_token" in reg_data
    assert reg_data["user"]["role"] == "customer"
    assert reg_data["user"]["email"] == test_email

    # Verify user in database
    saved_user = users_collection.find_one({"email": test_email})
    assert saved_user is not None
    assert saved_user["role"] == "customer"
    assert saved_user.get("customer_id") is not None

    # Verify customer profile in database
    saved_cust = customers_collection.find_one({"_id": ObjectId(saved_user["customer_id"])})
    assert saved_cust is not None
    assert saved_cust["name"] == test_name

    # 6. One-time OTP consumption: reusing the same OTP should be rejected
    reuse_res = client.post("/auth/register", json={
        "email": test_email,
        "full_name": test_name,
        "password": test_password,
        "otp": raw_otp,
    })
    assert reuse_res.status_code in (400, 409)

    # 7. Duplicate email rejection: cannot request registration OTP for already-registered email
    dup_res = client.post("/auth/send-registration-otp", json={
        "email": test_email,
        "full_name": test_name,
    })
    assert dup_res.status_code == 409

    # 8. User Login with the newly created password!
    login_res = client.post("/auth/login", json={
        "email": test_email,
        "password": test_password,
    })
    assert login_res.status_code == 200, login_res.text
    login_data = login_res.json()
    assert "access_token" in login_data
    assert login_data["user"]["role"] == "customer"
    assert login_data["user"]["email"] == test_email

    # Wrong password should fail
    bad_login = client.post("/auth/login", json={
        "email": test_email,
        "password": "WrongPassword@123",
    })
    assert bad_login.status_code == 401

    # 9. Forgot password recovery flow:
    fp_res = client.post("/auth/forgot-password", json={"email": test_email})
    assert fp_res.status_code == 200
    fp_otp = fp_res.json().get("dev_otp")
    assert fp_otp is not None and len(fp_otp) == 6

    # Reset password with OTP
    new_password = "BrandNewPassword@456"
    reset_res = client.post("/auth/reset-password-with-otp", json={
        "email": test_email,
        "otp": fp_otp,
        "new_password": new_password,
    })
    assert reset_res.status_code == 200
    assert "successfully reset" in reset_res.json()["message"]

    # Old password no longer works
    old_pw_login = client.post("/auth/login", json={
        "email": test_email,
        "password": test_password,
    })
    assert old_pw_login.status_code == 401

    # New password logs in successfully
    new_pw_login = client.post("/auth/login", json={
        "email": test_email,
        "password": new_password,
    })
    assert new_pw_login.status_code == 200
    assert new_pw_login.json()["user"]["email"] == test_email

