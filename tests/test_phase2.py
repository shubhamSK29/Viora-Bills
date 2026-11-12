"""
test_phase2.py – Phase 2 tests: Sequential invoice numbers, GSTIN, GST engine, PDF, CSV exports.
All protected endpoints pass JWT Bearer tokens via shared conftest fixtures.
"""
import sys
import os
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

import pytest
from fastapi.testclient import TestClient
from main import app, invoices_collection, customers_collection, products_collection, counters_collection

client = TestClient(app)


def test_next_invoice_number_preview(admin_headers):
    res = client.get("/invoices/next-number", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert "next_invoice_number" in data
    assert data["next_invoice_number"].startswith("VB-")
    assert "financial_year" in data


def test_customer_gstin_validation_and_registration(admin_headers):
    # 1. Valid registered customer with GSTIN (27 = Maharashtra)
    uniq = uuid.uuid4().hex[:8]
    valid_payload = {
        "name": f"Reliance Retail {uniq}",
        "business_name": "Reliance Retail Enterprise",
        "email": f"retail_{uniq}@reliance-test.com",
        "phone": "+91 9820012345",
        "address": "Maker Chambers IV, Nariman Point, Mumbai",
        "state": "Maharashtra",
        "state_code": "27",
        "pincode": "400021",
        "gstin": "27AAACR7055C1ZL",
    }
    res_valid = client.post("/customers", json=valid_payload, headers=admin_headers)
    assert res_valid.status_code == 201
    cust_data = res_valid.json()
    assert cust_data["gstin"] == "27AAACR7055C1ZL"
    assert cust_data["state_code"] == "27"
    assert cust_data["business_name"] == "Reliance Retail Enterprise"

    # 2. Invalid GSTIN format
    bad_gstin = {
        "name": "Invalid GST Customer",
        "gstin": "NOT_A_VALID_GSTIN",
    }
    res_bad = client.post("/customers", json=bad_gstin, headers=admin_headers)
    assert res_bad.status_code == 422
    assert "Invalid GSTIN format" in res_bad.json()["detail"]

    # 3. State code mismatch (GSTIN starts with 27, but state_code passed is 29)
    mismatch_payload = {
        "name": "Mismatch State Customer",
        "gstin": "27AAACR7055C1ZL",
        "state_code": "29",
    }
    res_mismatch = client.post("/customers", json=mismatch_payload, headers=admin_headers)
    assert res_mismatch.status_code == 422
    assert "does not match GSTIN state prefix" in res_mismatch.json()["detail"]

    # 4. Unregistered customer (no GSTIN)
    unreg_payload = {
        "name": f"Rajesh Kumar {uniq} (Unregistered B2C)",
        "email": f"rajesh_{uniq}@test.com",
        "phone": "+91 9123456789",
        "address": "Kothrud, Pune",
        "state": "Maharashtra",
    }
    res_unreg = client.post("/customers", json=unreg_payload, headers=admin_headers)
    assert res_unreg.status_code == 201
    assert res_unreg.json().get("gstin") is None


def test_sequential_invoice_numbering_and_uniqueness(admin_headers):
    # Fetch a customer and product
    customers = client.get("/customers", headers=admin_headers).json()["customers"]
    products = client.get("/products", headers=admin_headers).json()["products"]
    assert len(customers) > 0 and len(products) > 0

    cid = customers[0]["id"]
    pid = products[0]["id"]

    inv_payload1 = {
        "customer_id": cid,
        "items": [{"product_id": pid, "quantity": 1}],
        "discount": 0.0,
        "place_of_supply": "Maharashtra",
    }
    res1 = client.post("/invoices", json=inv_payload1, headers=admin_headers)
    assert res1.status_code == 201
    inv1 = res1.json()
    assert "invoice_number" in inv1
    assert inv1["invoice_number"].startswith("VB-")
    seq1 = int(inv1["invoice_number"].split("-")[-1])

    inv_payload2 = {
        "customer_id": cid,
        "items": [{"product_id": pid, "quantity": 2}],
        "discount": 0.0,
        "place_of_supply": "Maharashtra",
    }
    res2 = client.post("/invoices", json=inv_payload2, headers=admin_headers)
    assert res2.status_code == 201
    inv2 = res2.json()
    seq2 = int(inv2["invoice_number"].split("-")[-1])

    # Must be sequential and distinct
    assert seq2 == seq1 + 1
    assert inv1["invoice_number"] != inv2["invoice_number"]


def test_gst_calculation_engine_intra_and_interstate(admin_headers):
    # Setup test customer
    cust_res = client.post("/customers", json={
        "name": "GST Test Corp",
        "address": "Bangalore, Karnataka",
        "state": "Karnataka",
        "state_code": "29",
    }, headers=admin_headers)
    cust_id = cust_res.json()["id"]

    # Product 1: 18% GST, Price 1000
    p1_res = client.post("/products", json={
        "name": "Cloud Hosting Standard",
        "price": 1000.0,
        "unit": "month",
        "gst_rate": 18.0,
    }, headers=admin_headers)
    p1_id = p1_res.json()["id"]

    # Product 2: 12% GST, Price 500
    p2_res = client.post("/products", json={
        "name": "Hardware Device",
        "price": 500.0,
        "unit": "piece",
        "gst_rate": 12.0,
    }, headers=admin_headers)
    p2_id = p2_res.json()["id"]

    # 1. Test INTRA-STATE supply (Place of supply = Maharashtra, Company = Maharashtra)
    intra_payload = {
        "customer_id": cust_id,
        "place_of_supply": "Maharashtra",
        "items": [
            {"product_id": p1_id, "quantity": 2},  # 2000
            {"product_id": p2_id, "quantity": 1},  # 500
        ],  # Subtotal = 2500
        "discount": 500.0,  # Taxable = 2000
    }
    res_intra = client.post("/invoices", json=intra_payload, headers=admin_headers)
    assert res_intra.status_code == 201
    data_intra = res_intra.json()

    assert data_intra["subtotal"] == 2500.0
    assert data_intra["discount"] == 500.0
    assert data_intra["taxable_amount"] == 2000.0
    assert data_intra["cgst_amount"] == 168.0
    assert data_intra["sgst_amount"] == 168.0
    assert data_intra["igst_amount"] == 0.0
    assert data_intra["gst_amount"] == 336.0
    assert data_intra["total_amount"] == 2336.0

    tb_intra = data_intra["tax_breakdown"]
    assert tb_intra["supply_type"] == "Intra-State"
    assert tb_intra["is_intra_state"] is True
    assert len(tb_intra["rate_summary"]) == 2

    # 2. Test INTER-STATE supply (Place of supply = Karnataka, Company = Maharashtra)
    inter_payload = {
        "customer_id": cust_id,
        "place_of_supply": "Karnataka",
        "items": [
            {"product_id": p1_id, "quantity": 2},  # 2000
            {"product_id": p2_id, "quantity": 1},  # 500
        ],
        "discount": 500.0,
    }
    res_inter = client.post("/invoices", json=inter_payload, headers=admin_headers)
    assert res_inter.status_code == 201
    data_inter = res_inter.json()

    assert data_inter["taxable_amount"] == 2000.0
    assert data_inter["cgst_amount"] == 0.0
    assert data_inter["sgst_amount"] == 0.0
    assert data_inter["igst_amount"] == 336.0
    assert data_inter["gst_amount"] == 336.0
    assert data_inter["total_amount"] == 2336.0

    tb_inter = data_inter["tax_breakdown"]
    assert tb_inter["supply_type"] == "Inter-State"
    assert tb_inter["is_intra_state"] is False


def test_invoice_pdf_download(admin_headers):
    # Fetch existing or create invoice
    invoices = client.get("/invoices", headers=admin_headers).json()["invoices"]
    assert len(invoices) > 0
    inv_id = invoices[0]["id"]

    res = client.get(f"/invoices/{inv_id}/pdf", headers=admin_headers)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF")
    assert len(res.content) > 1000  # Valid generated PDF with tables and QR


def test_csv_export_endpoints(admin_headers):
    # 1. Customers CSV
    res_c = client.get("/customers/csv", headers=admin_headers)
    assert res_c.status_code == 200
    assert res_c.headers["content-type"].startswith("text/csv")
    assert "Customer ID" in res_c.text
    assert "GSTIN" in res_c.text
    assert "State Code" in res_c.text

    # 2. Invoices CSV
    res_i = client.get("/invoices/csv", headers=admin_headers)
    assert res_i.status_code == 200
    assert res_i.headers["content-type"].startswith("text/csv")
    assert "Invoice Number" in res_i.text
    assert "Taxable Amount" in res_i.text
    assert "CGST Amount" in res_i.text
    assert "IGST Amount" in res_i.text

    # 3. Payments CSV
    res_p = client.get("/payments/csv", headers=admin_headers)
    assert res_p.status_code == 200
    assert res_p.headers["content-type"].startswith("text/csv")
    assert "Payment ID" in res_p.text
    assert "Invoice ID" in res_p.text
    assert "Amount" in res_p.text
