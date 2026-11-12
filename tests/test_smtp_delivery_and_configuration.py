import os
import smtplib
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from backend.main import (
    app,
    users_collection,
    customers_collection,
    otps_collection,
    password_hasher,
)
from bson import ObjectId

client = TestClient(app)


@pytest.fixture
def setup_users_and_tokens():
    admin_email = "smtp_admin@viorabills.com"
    cust_email = "smtp_customer@viorabills.com"
    all_test_emails = [
        admin_email,
        cust_email,
        "newuser_smtp@viorabills.com",
        "new_smtp_email@viorabills.com",
        "failtest@viorabills.com",
        "produser@viorabills.com",
    ]

    users_collection.delete_many({"email": {"$in": all_test_emails}})
    customers_collection.delete_many({"email": {"$in": all_test_emails}})
    otps_collection.delete_many({"email": {"$in": all_test_emails}})

    # Admin
    users_collection.insert_one({
        "email": admin_email,
        "password_hash": password_hasher.hash("Admin@12345"),
        "role": "admin",
        "full_name": "SMTP Test Admin",
        "is_active": True,
    })
    admin_login = client.post("/auth/login", json={"email": admin_email, "password": "Admin@12345"})
    admin_token = admin_login.json()["access_token"]

    # Customer
    cust_res = customers_collection.insert_one({
        "name": "SMTP Test Customer",
        "email": cust_email,
        "is_active": True,
    })
    users_collection.insert_one({
        "email": cust_email,
        "password_hash": password_hasher.hash("Customer@12345"),
        "role": "customer",
        "customer_id": str(cust_res.inserted_id),
        "full_name": "SMTP Test Customer",
        "is_active": True,
    })
    cust_login = client.post("/auth/login", json={"email": cust_email, "password": "Customer@12345"})
    cust_token = cust_login.json()["access_token"]

    yield {
        "admin_token": admin_token,
        "customer_token": cust_token,
        "admin_email": admin_email,
        "customer_email": cust_email,
    }

    users_collection.delete_many({"email": {"$in": all_test_emails}})
    customers_collection.delete_many({"email": {"$in": all_test_emails}})
    otps_collection.delete_many({"email": {"$in": all_test_emails}})


def test_smtp_status_endpoint(setup_users_and_tokens):
    tokens = setup_users_and_tokens
    headers = {"Authorization": f"Bearer {tokens['admin_token']}"}

    res = client.get("/settings/smtp/status", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert "configured" in data
    assert "port" in data
    assert "tls_enabled" in data
    assert "host" in data
    # Password must NEVER be exposed
    assert "password" not in data
    assert "pass" not in data


def test_mocked_successful_gmail_smtp_delivery_for_all_four_flows(setup_users_and_tokens):
    tokens = setup_users_and_tokens
    admin_headers = {"Authorization": f"Bearer {tokens['admin_token']}"}
    cust_headers = {"Authorization": f"Bearer {tokens['customer_token']}"}

    smtp_env = {
        "SMTP_HOST": "smtp.gmail.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "testsender@gmail.com",
        "SMTP_PASS": "abcd efgh ijkl mnop",  # Google 16-char app password format with spaces
        "SMTP_FROM_EMAIL": "testsender@gmail.com",
        "SMTP_FROM_NAME": "Viora Bills",
        "SMTP_USE_TLS": "true",
        "ENVIRONMENT": "development",
        "ALLOW_DEV_OTP_PREVIEW": "true",
    }

    with patch.dict(os.environ, smtp_env), patch("smtplib.SMTP") as mock_smtp:
        mock_server = MagicMock()
        mock_smtp.return_value = mock_server

        # -------------------------------------------------------------
        # FLOW 1: Registration / Login Verification
        # -------------------------------------------------------------
        reg_email = "newuser_smtp@viorabills.com"
        reg_res = client.post("/auth/send-registration-otp", json={
            "email": reg_email,
            "full_name": "New SMTP User",
        })
        assert reg_res.status_code == 200, reg_res.text
        reg_json = reg_res.json()
        assert reg_json["smtp_configured"] is True
        assert reg_json["email_delivered"] is True

        # Verify SMTP server was called properly with STARTTLS and cleaned app password
        mock_smtp.assert_called_with("smtp.gmail.com", 587, timeout=15)
        mock_server.starttls.assert_called()
        mock_server.login.assert_called_with("testsender@gmail.com", "abcdefghijklmnop")
        mock_server.sendmail.assert_called()
        # Verify recipient in sendmail call
        sendmail_args = mock_server.sendmail.call_args[0]
        assert sendmail_args[0] == "testsender@gmail.com"
        assert reg_email in sendmail_args[1]

        # -------------------------------------------------------------
        # FLOW 2: Forgot Password
        # -------------------------------------------------------------
        mock_server.reset_mock()
        fp_res = client.post("/auth/forgot-password", json={"email": tokens["customer_email"]})
        assert fp_res.status_code == 200, fp_res.text
        fp_json = fp_res.json()
        assert fp_json["smtp_configured"] is True
        assert fp_json["email_delivered"] is True
        mock_server.sendmail.assert_called()

        # -------------------------------------------------------------
        # FLOW 3: Customer Account Activation / Verification OTP
        # -------------------------------------------------------------
        mock_server.reset_mock()
        verify_res = client.post("/auth/send-otp", json={
            "email": tokens["customer_email"],
            "purpose": "VERIFICATION",
        })
        assert verify_res.status_code == 200, verify_res.text
        assert verify_res.json()["email_delivered"] is True
        mock_server.sendmail.assert_called()

        # -------------------------------------------------------------
        # FLOW 4: Email Change Verification
        # -------------------------------------------------------------
        mock_server.reset_mock()
        new_target_email = "new_smtp_email@viorabills.com"
        change_req_res = client.post(
            "/auth/request-email-change",
            json={"new_email": new_target_email},
            headers=cust_headers,
        )
        assert change_req_res.status_code == 200, change_req_res.text
        assert change_req_res.json()["email_delivered"] is True
        mock_server.sendmail.assert_called()

        # Retrieve the generated OTP from otps_collection and complete change
        otp_doc = otps_collection.find_one({"email": new_target_email, "purpose": "EMAIL_CHANGE"})
        assert otp_doc is not None
        # Verify email change endpoint consumes OTP
        otp_raw = change_req_res.json().get("dev_otp")
        if otp_raw:
            confirm_res = client.post(
                "/auth/verify-email-change",
                json={"new_email": new_target_email, "otp": otp_raw},
                headers=cust_headers,
            )
            assert confirm_res.status_code == 200
            assert confirm_res.json()["user"]["email"] == new_target_email

        # -------------------------------------------------------------
        # Admin SMTP Connection Test
        # -------------------------------------------------------------
        mock_server.reset_mock()
        test_email_res = client.post(
            "/settings/smtp/test",
            json={"recipient_email": "admin_verify@gmail.com"},
            headers=admin_headers,
        )
        assert test_email_res.status_code == 200, test_email_res.text
        assert "successfully dispatched" in test_email_res.json()["message"]
        mock_server.sendmail.assert_called()


def test_smtp_authentication_failure_handling(setup_users_and_tokens):
    """
    When Gmail credentials (e.g. App Password) are invalid, smtplib raises SMTPAuthenticationError.
    The system must report failure clearly with 503 instead of falsely claiming email was sent.
    """
    smtp_env = {
        "SMTP_HOST": "smtp.gmail.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "testsender@gmail.com",
        "SMTP_PASS": "invalid_password",
        "SMTP_FROM_EMAIL": "testsender@gmail.com",
        "SMTP_USE_TLS": "true",
    }

    otps_collection.delete_many({"email": "failtest@viorabills.com"})
    with patch.dict(os.environ, smtp_env), patch("smtplib.SMTP") as mock_smtp:
        mock_server = MagicMock()
        mock_server.login.side_effect = smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")
        mock_smtp.return_value = mock_server

        res = client.post("/auth/send-registration-otp", json={
            "email": "failtest@viorabills.com",
            "full_name": "Failure Test",
        })
        assert res.status_code == 503
        assert "Failed to dispatch verification email via SMTP server" in res.json()["detail"]


def test_production_mode_strictly_masks_otp(setup_users_and_tokens):
    """
    In production mode (ENVIRONMENT=production), dev_otp must never be leaked in API responses.
    """
    otps_collection.delete_many({"email": "produser@viorabills.com"})
    prod_env = {
        "SMTP_HOST": "",  # Unconfigured SMTP
        "ENVIRONMENT": "production",
        "ALLOW_DEV_OTP_PREVIEW": "false",
    }

    with patch.dict(os.environ, prod_env):
        res = client.post("/auth/send-registration-otp", json={
            "email": "produser@viorabills.com",
            "full_name": "Prod User",
        })
        assert res.status_code == 200
        data = res.json()
        assert data.get("dev_otp") is None
        assert "dev_otp" not in data or data["dev_otp"] is None
