"""
test_existing_endpoints.py – Legacy endpoint regression tests.
All protected endpoints now pass a JWT Bearer token via shared conftest fixtures.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_customers_listing_and_search(admin_headers):
    res = client.get("/customers", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "customers" in data
    assert isinstance(data["customers"], list)

    # Search with a query
    res_search = client.get("/customers/search?q=Aarav", headers=admin_headers)
    assert res_search.status_code == 200
    assert "customers" in res_search.json()


def test_products_listing(admin_headers):
    res = client.get("/products", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "products" in data
    assert len(data["products"]) > 0


def test_invoices_listing_and_dates(admin_headers):
    res = client.get("/invoices", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "invoices" in data
    for inv in data["invoices"]:
        # Verify backward compatible date normalization
        assert "created_at" in inv
        assert "due_date" in inv
        assert "total_amount" in inv
        assert "status" in inv


def test_payments_listing(admin_headers):
    res = client.get("/payments", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "payments" in data
    for pay in data["payments"]:
        assert "amount" in pay
        assert "payment_method" in pay
