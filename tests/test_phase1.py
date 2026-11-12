"""
test_phase1.py – Phase 1 (Company Settings & Reports) tests.
All protected endpoints pass JWT Bearer tokens via shared conftest fixtures.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["database"] == "connected"


def test_company_settings_get(admin_headers):
    response = client.get("/settings/company", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert "settings" in data
    assert "company_name" in data["settings"]
    assert "gstin" in data["settings"]
    assert "upi_id" in data["settings"]


def test_company_settings_public():
    # Public endpoint – no auth required
    response = client.get("/settings/company/public")
    assert response.status_code == 200
    data = response.json()
    assert "company" in data
    assert "company_name" in data["company"]


def test_company_settings_update_validation(admin_headers):
    # Test invalid GSTIN
    bad_payload = {
        "company_name": "Test Company",
        "business_address": "123 Test Street",
        "gstin": "INVALID_GST",
    }
    response = client.put("/settings/company", json=bad_payload, headers=admin_headers)
    assert response.status_code == 422
    assert "Invalid GSTIN" in response.json()["detail"]

    # Test invalid IFSC
    bad_ifsc = {
        "company_name": "Test Company",
        "business_address": "123 Test Street",
        "ifsc_code": "INVALID",
    }
    response = client.put("/settings/company", json=bad_ifsc, headers=admin_headers)
    assert response.status_code == 422
    assert "Invalid IFSC" in response.json()["detail"]

    # Test invalid UPI ID
    bad_upi = {
        "company_name": "Test Company",
        "business_address": "123 Test Street",
        "upi_id": "badupi",
    }
    response = client.put("/settings/company", json=bad_upi, headers=admin_headers)
    assert response.status_code == 422
    assert "Invalid UPI" in response.json()["detail"]


def test_company_settings_role_protection(staff_headers):
    # Staff should NOT be able to update company settings
    payload = {
        "company_name": "Unauthorized Update",
        "business_address": "123 Test Street",
    }
    response = client.put("/settings/company", json=payload, headers=staff_headers)
    assert response.status_code == 403
    assert "Admin authorization required" in response.json()["detail"]


def test_company_settings_valid_update(admin_headers):
    valid_payload = {
        "company_name": "Viora Bills Pvt Ltd",
        "business_address": "Plot 42, Tech Park, Pune, Maharashtra",
        "gstin": "27AABCU9603R1ZM",
        "phone": "+91 9876543210",
        "email": "billing@viorabills.com",
        "state": "Maharashtra",
        "pincode": "411001",
        "bank_name": "HDFC Bank",
        "account_holder_name": "Viora Bills Pvt Ltd",
        "account_number": "50200098765432",
        "ifsc_code": "HDFC0001234",
        "upi_id": "viorabills@hdfcbank",
    }
    response = client.put("/settings/company", json=valid_payload, headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Company profile and bank details updated successfully."
    assert data["settings"]["company_name"] == "Viora Bills Pvt Ltd"
    assert data["settings"]["upi_id"] == "viorabills@hdfcbank"


def test_reports_sales_summary(admin_headers):
    response = client.get("/reports/sales-summary", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert "summary" in data
    assert "total_sales" in data["summary"]
    assert "total_invoices" in data["summary"]
    assert "paid_amount" in data["summary"]


def test_reports_gst(admin_headers):
    response = client.get("/reports/gst", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert "summary" in data
    assert "cgst_collected" in data["summary"]
    assert "sgst_collected" in data["summary"]
    assert "igst_collected" in data["summary"]


def test_reports_gst_csv(admin_headers):
    response = client.get("/reports/gst/csv", headers=admin_headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "CGST" in response.text
    assert "SGST" in response.text


def test_reports_aging(admin_headers):
    response = client.get("/reports/aging", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert "summary" in data
    assert "total_receivable" in data["summary"]
    assert "invoices" in data
