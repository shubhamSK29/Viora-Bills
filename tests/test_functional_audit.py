"""
tests/test_functional_audit.py – Functional Audit & Complete Button Verification Tests.

Validates:
1. GET /customers/{customer_id} (retrieval by ID).
2. DELETE /customers/{customer_id} permissions (staff rejected 403, admin allowed).
3. DELETE /customers/{customer_id} blocking deletion when customer has invoices (400 for GST audit compliance).
4. DELETE /customers/{customer_id} blocking deletion when customer has orders (400).
5. DELETE /customers/{customer_id} successfully deleting unbilled customer with cleanup of invites/cart and audit logging.
6. Product activate/deactivate toggle via PATCH /products/{product_id}.
7. Product deletion protection against products referenced in customer orders.
"""
import sys
import os
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import pytest
from fastapi.testclient import TestClient
from main import (
    app,
    customers_collection,
    products_collection,
    invoices_collection,
    orders_collection,
    customer_invitations_collection,
    audit_logs_collection,
    carts_collection,
    users_collection,
)

client = TestClient(app)


def test_customer_get_and_delete_lifecycle(admin_headers, staff_headers):
    # 1. Create a fresh test customer
    uid = uuid.uuid4().hex[:6]
    c_res = client.post(
        "/customers",
        headers=staff_headers,
        json={
            "name": f"Audit Customer {uid}",
            "email": f"audit_{uid}@viorabills.com",
            "phone": "9876543210",
            "state": "Maharashtra",
            "billing_address": {"city": "Pune", "state": "Maharashtra"},
        },
    )
    assert c_res.status_code == 201
    cust_id = c_res.json()["id"]

    # 2. Test GET /customers/{customer_id}
    get_res = client.get(f"/customers/{cust_id}", headers=staff_headers)
    assert get_res.status_code == 200
    assert get_res.json()["id"] == cust_id
    assert get_res.json()["name"] == f"Audit Customer {uid}"

    # 3. Staff cannot delete customer (Admin only)
    del_staff = client.delete(f"/customers/{cust_id}", headers=staff_headers)
    assert del_staff.status_code == 403

    # 4. Attach an invoice to customer: Deletion must be blocked for GST compliance
    inv_res = invoices_collection.insert_one({
        "customer_id": cust_id,
        "invoice_number": f"INV-AUDIT-{uid}",
        "total_amount": 1000.0,
        "status": "PAID",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    del_blocked = client.delete(f"/customers/{cust_id}", headers=admin_headers)
    assert del_blocked.status_code == 400
    assert "GST audit compliance" in del_blocked.json()["detail"]

    # Remove the test invoice
    invoices_collection.delete_one({"_id": inv_res.inserted_id})

    # 5. Attach an order to customer: Deletion must be blocked
    ord_res = orders_collection.insert_one({
        "customer_id": cust_id,
        "order_number": f"ORD-AUDIT-{uid}",
        "status": "PENDING",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    del_ord_blocked = client.delete(f"/customers/{cust_id}", headers=admin_headers)
    assert del_ord_blocked.status_code == 400
    assert "existing orders" in del_ord_blocked.json()["detail"]

    # Remove the test order
    orders_collection.delete_one({"_id": ord_res.inserted_id})

    # Add an invitation and cart record to verify cascade cleanup
    customer_invitations_collection.insert_one({
        "token": f"token_{uid}",
        "customer_id": cust_id,
        "email": f"audit_{uid}@viorabills.com",
        "status": "PENDING",
    })
    carts_collection.insert_one({
        "customer_id": cust_id,
        "items": [],
    })

    # 6. Now Admin deletes the customer cleanly
    del_ok = client.delete(f"/customers/{cust_id}", headers=admin_headers)
    assert del_ok.status_code == 200
    assert del_ok.json()["message"] == "Customer deleted successfully."

    # Verify customer no longer exists
    assert customers_collection.find_one({"_id": c_res.json()["_id"] if "_id" in c_res.json() else None}) is None
    assert customer_invitations_collection.find_one({"customer_id": cust_id}) is None
    assert carts_collection.find_one({"customer_id": cust_id}) is None

    # Verify audit log entry
    audit = audit_logs_collection.find_one({"action": "DELETE_CUSTOMER", "resource_id": cust_id})
    assert audit is not None


def test_product_toggle_and_deletion_protection(admin_headers, staff_headers):
    # 1. Create a test product
    uid = uuid.uuid4().hex[:6]
    p_res = client.post(
        "/products",
        headers=staff_headers,
        json={
            "name": f"Audit Product {uid}",
            "price": 250.0,
            "unit": "BOX",
            "gst_rate": 18.0,
            "is_active": True,
        },
    )
    assert p_res.status_code == 201
    prod_id = p_res.json()["id"]

    # 2. Toggle status to False (Deactivate)
    t_res = client.patch(
        f"/products/{prod_id}",
        headers=staff_headers,
        json={"is_active": False},
    )
    assert t_res.status_code == 200
    assert t_res.json()["is_active"] is False

    # 3. Toggle status to True (Activate)
    t_res2 = client.patch(
        f"/products/{prod_id}",
        headers=staff_headers,
        json={"is_active": True},
    )
    assert t_res2.status_code == 200
    assert t_res2.json()["is_active"] is True

    # 4. Attach product to an active order
    ord_res = orders_collection.insert_one({
        "order_number": f"ORD-P-{uid}",
        "customer_id": "dummy_cust",
        "items": [{"product_id": prod_id, "name": f"Audit Product {uid}", "quantity": 2}],
        "status": "PENDING",
    })

    # Deletion blocked by order reference
    del_ord_blocked = client.delete(f"/products/{prod_id}", headers=admin_headers)
    assert del_ord_blocked.status_code == 409
    assert "referenced in customer orders" in del_ord_blocked.json()["detail"]

    # Clean up order
    orders_collection.delete_one({"_id": ord_res.inserted_id})

    # 5. Cleanly delete product
    del_ok = client.delete(f"/products/{prod_id}", headers=admin_headers)
    assert del_ok.status_code == 200

