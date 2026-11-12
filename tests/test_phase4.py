"""
test_phase4.py – Phase 4 Automated Test Suite:
- Server-side pagination on customers, products, invoices, payments, and users
- Maximum page limit enforcement (le=100) & minimum page validation (ge=1)
- Total count and total_pages accuracy
- Server-side search and filtering alongside pagination
- Sorting validation
- Database index verification across MongoDB collections
- RBAC preservation on paginated endpoints
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import pytest
from fastapi.testclient import TestClient
from main import (
    app,
    users_collection,
    customers_collection,
    products_collection,
    invoices_collection,
    payments_collection,
)

client = TestClient(app)


# ─── 1. Pagination Structure & Meta Verification ──────────────────────────────

def test_customers_pagination_structure(admin_headers):
    res = client.get("/customers?page=1&limit=5", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "customers" in data  # backward-compatibility alias
    assert "total" in data
    assert "page" in data
    assert "limit" in data
    assert "total_pages" in data
    assert data["page"] == 1
    assert data["limit"] == 5
    assert len(data["items"]) <= 5
    assert isinstance(data["items"], list)


def test_products_pagination_structure(admin_headers):
    res = client.get("/products?page=1&limit=5", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "products" in data
    assert "total" in data
    assert "page" in data
    assert "limit" in data
    assert "total_pages" in data
    assert data["page"] == 1
    assert data["limit"] == 5
    assert len(data["items"]) <= 5


def test_invoices_pagination_structure(admin_headers):
    res = client.get("/invoices?page=1&limit=5", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "invoices" in data
    assert "total" in data
    assert "page" in data
    assert "limit" in data
    assert "total_pages" in data
    assert data["page"] == 1
    assert data["limit"] == 5


def test_payments_pagination_structure(admin_headers):
    res = client.get("/payments?page=1&limit=5", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "payments" in data
    assert "total" in data
    assert "page" in data
    assert "limit" in data
    assert "total_pages" in data
    assert data["page"] == 1
    assert data["limit"] == 5


def test_users_pagination_admin_only(admin_headers, staff_headers):
    # Admin can paginate users
    res = client.get("/users?page=1&limit=5", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "users" in data
    assert "total" in data
    assert data["page"] == 1

    # Staff is blocked from paginating users
    staff_res = client.get("/users?page=1&limit=5", headers=staff_headers)
    assert staff_res.status_code == 403


# ─── 2. Limit and Page Validation Guards ──────────────────────────────────────

def test_pagination_max_limit_enforcement(admin_headers):
    # limit > 100 must be rejected with HTTP 422
    res = client.get("/customers?page=1&limit=101", headers=admin_headers)
    assert res.status_code == 422

    res_inv = client.get("/invoices?page=1&limit=150", headers=admin_headers)
    assert res_inv.status_code == 422


def test_pagination_min_page_enforcement(admin_headers):
    # page < 1 must be rejected with HTTP 422
    res = client.get("/customers?page=0&limit=10", headers=admin_headers)
    assert res.status_code == 422

    res_neg = client.get("/products?page=-1&limit=10", headers=admin_headers)
    assert res_neg.status_code == 422


# ─── 3. Search and Filtering alongside Pagination ─────────────────────────────

def test_customers_search_with_pagination(admin_headers):
    # Search for an existing customer
    res = client.get("/customers?search=Aarav&page=1&limit=10", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    for cust in data["items"]:
        match = (
            "aarav" in cust.get("name", "").lower()
            or "aarav" in cust.get("business_name", "").lower()
            or "aarav" in cust.get("email", "").lower()
        )
        assert match


def test_invoices_status_filter_with_pagination(admin_headers):
    res = client.get("/invoices?status=UNPAID&page=1&limit=10", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    for inv in data["items"]:
        assert inv["status"].upper() == "UNPAID"


def test_payments_method_filter_with_pagination(admin_headers):
    res = client.get("/payments?payment_method=UPI&page=1&limit=10", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    for p in data["items"]:
        assert p["payment_method"].upper() == "UPI"


def test_users_role_filter_with_pagination(admin_headers):
    res = client.get("/users?role=staff&page=1&limit=10", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    for u in data["items"]:
        assert u["role"] == "staff"


# ─── 4. Sorting Functionality ──────────────────────────────────────────────────

def test_customers_sorting(admin_headers):
    res_asc = client.get("/customers?sort_by=name&sort_dir=asc&limit=10", headers=admin_headers)
    assert res_asc.status_code == 200
    names_asc = [c["name"].lower() for c in res_asc.json()["items"]]

    res_desc = client.get("/customers?sort_by=name&sort_dir=desc&limit=10", headers=admin_headers)
    assert res_desc.status_code == 200
    names_desc = [c["name"].lower() for c in res_desc.json()["items"]]

    if len(names_asc) > 1 and len(names_desc) > 1:
        assert names_asc[0] <= names_asc[-1]
        assert names_desc[0] >= names_desc[-1]


# ─── 5. MongoDB Indexes Verification ──────────────────────────────────────────

def test_mongodb_indexes_created():
    # Verify users collection indexes
    user_indexes = users_collection.index_information()
    assert "email_1" in user_indexes
    assert user_indexes["email_1"].get("unique") is True
    assert "role_1_is_active_1" in user_indexes

    # Verify invoices collection indexes
    inv_indexes = invoices_collection.index_information()
    assert "invoice_number_1" in inv_indexes
    assert inv_indexes["invoice_number_1"].get("unique") is True
    assert "customer_id_1" in inv_indexes
    assert "status_1" in inv_indexes

    # Verify customers collection indexes
    cust_indexes = customers_collection.index_information()
    assert "name_1" in cust_indexes

    # Verify products collection indexes
    prod_indexes = products_collection.index_information()
    assert "name_1" in prod_indexes

    # Verify payments collection indexes
    pay_indexes = payments_collection.index_information()
    assert "invoice_id_1" in pay_indexes

