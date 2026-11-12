"""
conftest.py – Shared pytest fixtures for all test modules.
Provides a JWT-authenticated client for admin and staff roles.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import pytest
from fastapi.testclient import TestClient
from main import app

# Create a single shared TestClient
@pytest.fixture(scope="session")
def api_client():
    return TestClient(app, raise_server_exceptions=True)


def _ensure_and_login(client: TestClient, email: str, password: str, role: str, name: str) -> dict:
    from main import users_collection, customers_collection, password_hasher
    cust_id = None
    if role == "customer":
        c = customers_collection.find_one({"email": email})
        if not c:
            c_res = customers_collection.insert_one({
                "name": name or "Acme Retailers Ltd",
                "email": email,
                "phone": "9876543210",
                "state": "Maharashtra",
                "is_active": True,
            })
            cust_id = str(c_res.inserted_id)
        else:
            cust_id = str(c["_id"])
            if name and c.get("name") != name:
                customers_collection.update_one({"_id": c["_id"]}, {"$set": {"name": name}})

    u = users_collection.find_one({"email": email})
    if not u:
        user_doc = {
            "email": email,
            "password_hash": password_hasher.hash(password),
            "role": role,
            "full_name": name,
            "is_active": True,
        }
        if cust_id:
            user_doc["customer_id"] = cust_id
        users_collection.insert_one(user_doc)
    elif role == "customer" and not u.get("customer_id") and cust_id:
        users_collection.update_one({"_id": u["_id"]}, {"$set": {"customer_id": cust_id}})

    res = client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, f"Login failed for {email}: {res.text}"
    return res.json()


@pytest.fixture
def admin_token(api_client):
    data = _ensure_and_login(api_client, "admin@viorabills.com", "Admin@12345", "admin", "Test Admin")
    return data["access_token"]


@pytest.fixture
def staff_token(api_client):
    data = _ensure_and_login(api_client, "staff@viorabills.com", "Staff@12345", "staff", "Test Staff")
    return data["access_token"]


@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def staff_headers(staff_token):
    return {"Authorization": f"Bearer {staff_token}"}


@pytest.fixture
def customer_token(api_client):
    data = _ensure_and_login(api_client, "customer@viorabills.com", "Customer@12345", "customer", "Acme Retailers Ltd")
    return data["access_token"]


@pytest.fixture
def customer_headers(customer_token):
    return {"Authorization": f"Bearer {customer_token}"}


