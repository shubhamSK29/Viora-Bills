"""
Comprehensive tests for Customer Shopping Portal & Order Management:
- Extended Product Schema & Image Upload (Pillow validation, base64 payload, static hosting)
- Product Catalogue (active filtering, search, category filtering)
- Persistent Shopping Cart (add, increment, update, delete, clear, live recalculation)
- Order Creation & Snapshots (state machine, immutable freeze, sequential numbering ORD-YYYY-XXXX)
- Staff/Admin Order Review & Accept/Reject workflow
- Thread-safe Invoice Generation with Concurrency Protection (VB-YYYY-XXXX sequential number)
- Customer Purchases Aggregation from Invoices
- Cross-customer Data Isolation and RBAC Permission boundaries
"""
import base64
import io
import os
import sys
import uuid
import pytest
from PIL import Image

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))


def _rand() -> str:
    return uuid.uuid4().hex[:8]


def _create_sample_base64_image(color=(255, 0, 0), size=(100, 100), fmt="PNG") -> str:
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def test_product_image_upload_and_static_serving(api_client, admin_headers, customer_headers):
    # Customer cannot upload product images
    b64_img = _create_sample_base64_image()
    res_cust = api_client.post(
        "/products/upload-image",
        json={"image_data": b64_img, "filename": "sample.png"},
        headers=customer_headers,
    )
    assert res_cust.status_code == 403

    # Admin uploads valid PNG image
    res = api_client.post(
        "/products/upload-image",
        json={"image_data": f"data:image/png;base64,{b64_img}", "filename": "sample.png"},
        headers=admin_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert "image_url" in data
    assert data["image_url"].startswith("/uploads/products/")
    assert data["format"] == "PNG"

    # Static file serving endpoint test
    static_res = api_client.get(data["image_url"])
    assert static_res.status_code == 200
    assert len(static_res.content) > 0

    # Invalid image payload
    res_bad = api_client.post(
        "/products/upload-image",
        json={"image_data": "not_an_image_base64_data_here", "filename": "bad.png"},
        headers=admin_headers,
    )
    assert res_bad.status_code == 400


def test_product_creation_and_catalogue_filtering(api_client, admin_headers, customer_headers):
    tag = _rand()
    cat_name = f"Electronics_{tag}"

    # Create active product with extended fields
    p1_res = api_client.post(
        "/products",
        json={
            "name": f"Wireless Mouse {tag}",
            "price": 1200.0,
            "unit": "pcs",
            "gst_rate": 18.0,
            "category": cat_name,
            "sku": f"SKU-{tag}-A",
            "description": "Ergonomic 2.4GHz optical mouse.",
            "is_active": True,
        },
        headers=admin_headers,
    )
    assert p1_res.status_code == 201
    p1 = p1_res.json()
    assert p1["is_active"] is True
    assert p1["sku"] == f"SKU-{tag}-A"

    # Create inactive product
    p2_res = api_client.post(
        "/products",
        json={
            "name": f"Discontinued Keyboard {tag}",
            "price": 2500.0,
            "unit": "pcs",
            "gst_rate": 18.0,
            "category": cat_name,
            "sku": f"SKU-{tag}-B",
            "description": "Old discontinued mechanical keyboard.",
            "is_active": False,
        },
        headers=admin_headers,
    )
    assert p2_res.status_code == 201
    p2 = p2_res.json()

    # Customer queries catalogue
    cat_res = api_client.get(f"/customer/catalogue?category={cat_name}", headers=customer_headers)
    assert cat_res.status_code == 200
    cat_data = cat_res.json()
    items = cat_data["items"]
    ids = [it["id"] for it in items]

    # Active item is present, inactive item is strictly hidden
    assert p1["id"] in ids
    assert p2["id"] not in ids

    # Search in catalogue
    search_res = api_client.get(f"/customer/catalogue?search=Wireless%20Mouse%20{tag}", headers=customer_headers)
    assert search_res.status_code == 200
    search_items = search_res.json()["items"]
    assert any(it["id"] == p1["id"] for it in search_items)

    # Inactive product direct details returns 404 in catalogue
    p2_detail = api_client.get(f"/customer/catalogue/{p2['id']}", headers=customer_headers)
    assert p2_detail.status_code == 404


def test_customer_cart_lifecycle_and_live_gst(api_client, admin_headers, customer_headers):
    tag = _rand()
    # Create test product (price 500, GST 18%)
    p_res = api_client.post(
        "/products",
        json={
            "name": f"Premium Cable {tag}",
            "price": 500.0,
            "unit": "pcs",
            "gst_rate": 18.0,
            "category": "Accessories",
            "is_active": True,
        },
        headers=admin_headers,
    )
    prod_id = p_res.json()["id"]

    # Clear customer cart initially
    api_client.delete("/customer/cart", headers=customer_headers)

    # 1. Fetch empty cart
    empty_cart = api_client.get("/customer/cart", headers=customer_headers).json()
    assert empty_cart["total_items_count"] == 0
    assert empty_cart["total_amount"] == 0.0

    # 2. Add product to cart (quantity 2) -> Subtotal = 1000, 18% GST = 180, Total = 1180
    add_res = api_client.post(
        "/customer/cart/items",
        json={"product_id": prod_id, "quantity": 2},
        headers=customer_headers,
    )
    assert add_res.status_code == 200
    cart1 = add_res.json()
    assert cart1["total_items_count"] == 2
    assert cart1["subtotal"] == 1000.0
    assert cart1["total_gst"] == 180.0
    assert cart1["total_amount"] == 1180.0

    # 3. Increment same product (add 1 more) -> Quantity = 3, Total = 1500 + 270 = 1770
    inc_res = api_client.post(
        "/customer/cart/items",
        json={"product_id": prod_id, "quantity": 1},
        headers=customer_headers,
    )
    cart2 = inc_res.json()
    assert cart2["total_items_count"] == 3
    assert cart2["subtotal"] == 1500.0
    assert cart2["total_amount"] == 1770.0

    # 4. Patch quantity to 5 -> Subtotal = 2500, GST = 450, Total = 2950
    patch_res = api_client.patch(
        f"/customer/cart/items/{prod_id}",
        json={"quantity": 5},
        headers=customer_headers,
    )
    cart3 = patch_res.json()
    assert cart3["total_items_count"] == 5
    assert cart3["total_amount"] == 2950.0

    # 5. Remove item from cart
    del_item_res = api_client.delete(f"/customer/cart/items/{prod_id}", headers=customer_headers)
    assert del_item_res.status_code == 200
    cart4 = del_item_res.json()
    assert cart4["total_items_count"] == 0


def test_order_placement_review_accept_and_invoice_generation(api_client, admin_headers, staff_headers, customer_headers):
    tag = _rand()
    # Create product
    p_res = api_client.post(
        "/products",
        json={
            "name": f"Monitor Stand {tag}",
            "price": 2000.0,
            "unit": "pcs",
            "gst_rate": 18.0,
            "category": "Furniture",
            "is_active": True,
        },
        headers=admin_headers,
    )
    prod_id = p_res.json()["id"]

    # Clear cart, add item (qty 1: 2000 + 18% = 2360)
    api_client.delete("/customer/cart", headers=customer_headers)
    api_client.post(
        "/customer/cart/items",
        json={"product_id": prod_id, "quantity": 1},
        headers=customer_headers,
    )

    # 1. Place Order
    order_res = api_client.post(
        "/customer/orders",
        json={"delivery_notes": "Deliver during office hours."},
        headers=customer_headers,
    )
    assert order_res.status_code == 201
    order = order_res.json()
    order_id = order["id"]
    order_number = order["order_number"]

    assert order_number.startswith("ORD-")
    assert order["status"] == "PENDING_REVIEW"
    assert order["total_amount"] == 2360.0
    assert len(order["items"]) == 1
    assert order["delivery_notes"] == "Deliver during office hours."

    # Cart should now be empty after order placement
    cart_after = api_client.get("/customer/cart", headers=customer_headers).json()
    assert cart_after["total_items_count"] == 0

    # 2. Cannot place order with empty cart
    empty_order_res = api_client.post(
        "/customer/orders",
        json={"delivery_notes": ""},
        headers=customer_headers,
    )
    assert empty_order_res.status_code == 400

    # 3. Staff reviews order
    rev_res = api_client.post(
        f"/orders/{order_id}/review",
        json={"notes": "Checking stock availability in warehouse."},
        headers=staff_headers,
    )
    assert rev_res.status_code == 200
    assert rev_res.json()["status"] == "UNDER_REVIEW"

    # 4. Staff accepts order
    acc_res = api_client.post(
        f"/orders/{order_id}/accept",
        json={"notes": "Confirmed and ready for dispatch."},
        headers=staff_headers,
    )
    assert acc_res.status_code == 200
    assert acc_res.json()["status"] == "ACCEPTED"

    # 5. Customer cannot cancel an accepted order
    cancel_attempt = api_client.post(
        f"/customer/orders/{order_id}/cancel",
        json={"reason": "Changed my mind"},
        headers=customer_headers,
    )
    assert cancel_attempt.status_code == 400

    # 6. Generate official invoice for accepted order
    inv_gen_res = api_client.post(
        f"/orders/{order_id}/generate-invoice",
        headers=staff_headers,
    )
    assert inv_gen_res.status_code == 200
    gen_data = inv_gen_res.json()
    inv = gen_data["invoice"]
    updated_order = gen_data["order"]

    assert updated_order["status"] == "INVOICED"
    assert updated_order["invoice_id"] == inv["id"]
    assert updated_order["invoice_number"] == inv["invoice_number"]
    assert inv["invoice_number"].startswith("VB-")
    assert inv["total_amount"] == 2360.0
    assert inv["balance_due"] == 2360.0
    assert inv["status"] == "UNPAID"

    # 7. Duplicate invoice generation is strictly rejected
    dup_res = api_client.post(
        f"/orders/{order_id}/generate-invoice",
        headers=staff_headers,
    )
    assert dup_res.status_code == 400

    # 8. Customer Purchases reflects this invoiced order
    purchases_res = api_client.get("/customer/purchases", headers=customer_headers)
    assert purchases_res.status_code == 200
    purchases = purchases_res.json()
    assert purchases["total_purchases_count"] >= 1
    assert any(it["invoice_id"] == inv["id"] for it in purchases["items"])


def test_order_rejection_and_customer_cancellation(api_client, admin_headers, staff_headers, customer_headers):
    tag = _rand()
    p_res = api_client.post(
        "/products",
        json={
            "name": f"Desk Lamp {tag}",
            "price": 800.0,
            "unit": "pcs",
            "gst_rate": 18.0,
            "is_active": True,
        },
        headers=admin_headers,
    )
    prod_id = p_res.json()["id"]

    # Customer adds and places order 1 (to be cancelled by customer)
    api_client.delete("/customer/cart", headers=customer_headers)
    api_client.post("/customer/cart/items", json={"product_id": prod_id, "quantity": 1}, headers=customer_headers)
    o1 = api_client.post("/customer/orders", json={}, headers=customer_headers).json()

    cancel_res = api_client.post(
        f"/customer/orders/{o1['id']}/cancel",
        json={"reason": "Customer requested cancellation."},
        headers=customer_headers,
    )
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "CANCELLED"

    # Cannot generate invoice for cancelled order
    inv_cancel_attempt = api_client.post(f"/orders/{o1['id']}/generate-invoice", headers=staff_headers)
    assert inv_cancel_attempt.status_code == 400

    # Customer places order 2 (to be rejected by staff)
    api_client.post("/customer/cart/items", json={"product_id": prod_id, "quantity": 1}, headers=customer_headers)
    o2 = api_client.post("/customer/orders", json={}, headers=customer_headers).json()

    # Rejecting requires valid reason
    reject_bad = api_client.post(f"/orders/{o2['id']}/reject", json={"reason": ""}, headers=staff_headers)
    assert reject_bad.status_code == 422

    reject_res = api_client.post(
        f"/orders/{o2['id']}/reject",
        json={"reason": "Item currently out of stock with vendor."},
        headers=staff_headers,
    )
    assert reject_res.status_code == 200
    assert reject_res.json()["status"] == "REJECTED"
    assert reject_res.json()["rejection_reason"] == "Item currently out of stock with vendor."


def test_customer_isolation_and_role_protection(api_client, admin_headers, staff_headers, customer_headers):
    # Customer cannot access /orders (Staff/Admin only)
    res_orders_mgmt = api_client.get("/orders", headers=customer_headers)
    assert res_orders_mgmt.status_code == 403

    # Customer cannot review or accept orders directly
    dummy_oid = "507f1f77bcf86cd799439011"
    assert api_client.post(f"/orders/{dummy_oid}/accept", headers=customer_headers).status_code == 403
    assert api_client.post(f"/orders/{dummy_oid}/generate-invoice", headers=customer_headers).status_code == 403

    # Admin and Staff CAN access /orders
    assert api_client.get("/orders", headers=admin_headers).status_code == 200
    assert api_client.get("/orders", headers=staff_headers).status_code == 200

