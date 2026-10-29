import os
import re
from typing import Optional

from bson import ObjectId
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import PyMongoError


app = FastAPI(
    title="Viora Bills API",
    description="Backend API for the Viora Bills billing system",
    version="1.0.0",
)

# Allow the React frontend to communicate with this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB connection.
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://127.0.0.1:27017/")
client = MongoClient(MONGODB_URL, serverSelectionTimeoutMS=3000)
db = client["viora_bills"]

customers_collection = db["customers"]
products_collection = db["products"]
invoices_collection = db["invoices"]
payments_collection = db["payments"]


# -------------------------
# Request models
# -------------------------

class CustomerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: Optional[str] = Field(default=None, max_length=254)
    phone: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=300)


class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    email: Optional[str] = Field(default=None, max_length=254)
    phone: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=300)


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    price: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=30)
    gst_rate: float = Field(ge=0, le=100)


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    price: Optional[float] = Field(default=None, gt=0)
    unit: Optional[str] = Field(default=None, min_length=1, max_length=30)
    gst_rate: Optional[float] = Field(default=None, ge=0, le=100)


class InvoiceItemCreate(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)


class InvoiceCreate(BaseModel):
    customer_id: str
    items: list[InvoiceItemCreate] = Field(min_length=1)
    discount: float = Field(default=0, ge=0)


class PaymentCreate(BaseModel):
    invoice_id: str
    amount: float = Field(gt=0)
    payment_method: str = Field(min_length=2, max_length=30)
    reference: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=300)


# -------------------------
# Serialization helpers
# -------------------------

def serialize_document(document: dict) -> dict:
    """Return a copy of a MongoDB document with a JSON-safe string ID."""
    result = dict(document)
    object_id = result.pop("_id", None)
    if object_id is not None:
        result["id"] = str(object_id)
    return result


def valid_object_id(value: str, label: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label} ID.")
    return ObjectId(value)


def clean_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


# -------------------------
# General / health endpoints
# -------------------------

@app.get("/")
def home():
    return {
        "message": "Welcome to Viora Bills API",
        "status": "running",
    }


@app.get("/health")
def health_check():
    try:
        client.admin.command("ping")
        return {
            "status": "healthy",
            "application": "Viora Bills",
            "database": "connected",
        }
    except PyMongoError:
        return {
            "status": "unhealthy",
            "application": "Viora Bills",
            "database": "disconnected",
        }


@app.get("/health/database")
def database_health_check():
    try:
        client.admin.command("ping")
        return {
            "database": "viora_bills",
            "connection": "successful",
        }
    except PyMongoError:
        return {
            "database": "viora_bills",
            "connection": "failed",
        }


# -------------------------
# Customer endpoints
# -------------------------

@app.post("/customers", status_code=201)
def create_customer(customer: CustomerCreate):
    name = customer.name.strip()
    if len(name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Customer name must contain at least 2 characters.",
        )

    email = clean_optional(customer.email)
    email = email.lower() if email else None
    phone = clean_optional(customer.phone)
    address = clean_optional(customer.address)

    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(
            status_code=422,
            detail="Please enter a valid email address.",
        )

    try:
        if email and customers_collection.find_one({"email": email}):
            raise HTTPException(
                status_code=409,
                detail="A customer with this email already exists.",
            )

        document = {"name": name}
        if email:
            document["email"] = email
        if phone:
            document["phone"] = phone
        if address:
            document["address"] = address

        result = customers_collection.insert_one(document)
        saved = customers_collection.find_one({"_id": result.inserted_id})
        return serialize_document(saved)

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not save the customer. Check the database connection.",
        )


@app.get("/customers")
def list_customers(
    limit: int = Query(default=20, ge=1, le=100),
    skip: int = Query(default=0, ge=0),
):
    try:
        customers = list(
            customers_collection.find().sort("name", 1).skip(skip).limit(limit)
        )
        return {
            "count": len(customers),
            "customers": [serialize_document(c) for c in customers],
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve customers.")


@app.get("/customers/search")
def search_customers(q: str = Query(min_length=1, max_length=100)):
    search_text = re.escape(q.strip())
    if not search_text:
        raise HTTPException(status_code=422, detail="Enter a search term.")

    search_filter = {
        "$or": [
            {"name": {"$regex": search_text, "$options": "i"}},
            {"email": {"$regex": search_text, "$options": "i"}},
            {"phone": {"$regex": search_text, "$options": "i"}},
        ]
    }

    try:
        customers = list(
            customers_collection.find(search_filter).sort("name", 1).limit(100)
        )
        return {
            "query": q,
            "count": len(customers),
            "customers": [serialize_document(c) for c in customers],
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not search customers.")


@app.patch("/customers/{customer_id}")
def update_customer(customer_id: str, customer: CustomerUpdate):
    customer_object_id = valid_object_id(customer_id, "customer")
    updates = customer.model_dump(exclude_unset=True)

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one field to update.",
        )

    if "name" in updates:
        if updates["name"] is None:
            raise HTTPException(status_code=422, detail="Customer name cannot be empty.")
        updates["name"] = updates["name"].strip()
        if len(updates["name"]) < 2:
            raise HTTPException(
                status_code=422,
                detail="Customer name must contain at least 2 characters.",
            )

    if "email" in updates:
        email = clean_optional(updates["email"])
        email = email.lower() if email else None
        if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPException(
                status_code=422,
                detail="Please enter a valid email address.",
            )
        if email:
            try:
                existing = customers_collection.find_one(
                    {"email": email, "_id": {"$ne": customer_object_id}}
                )
            except PyMongoError:
                raise HTTPException(status_code=503, detail="Could not check customer email.")
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail="Another customer already uses this email.",
                )
        updates["email"] = email

    for field in ("phone", "address"):
        if field in updates:
            updates[field] = clean_optional(updates[field])

    set_fields = {k: v for k, v in updates.items() if v is not None}
    unset_fields = {k: "" for k, v in updates.items() if v is None}
    operations = {}
    if set_fields:
        operations["$set"] = set_fields
    if unset_fields:
        operations["$unset"] = unset_fields

    try:
        result = customers_collection.update_one(
            {"_id": customer_object_id}, operations
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Customer not found.")
        updated = customers_collection.find_one({"_id": customer_object_id})
        return serialize_document(updated)
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not update the customer. Check the database connection.",
        )


# -------------------------
# Product endpoints
# -------------------------

@app.post("/products", status_code=201)
def create_product(product: ProductCreate):
    name = product.name.strip()
    unit = product.unit.strip()

    if len(name) < 2:
        raise HTTPException(
            status_code=422,
            detail="Product name must contain at least 2 characters.",
        )
    if not unit:
        raise HTTPException(status_code=422, detail="Product unit cannot be empty.")

    document = {
        "name": name,
        "price": product.price,
        "unit": unit,
        "gst_rate": product.gst_rate,
    }

    try:
        result = products_collection.insert_one(document)
        saved = products_collection.find_one({"_id": result.inserted_id})
        return serialize_document(saved)
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not save the product. Check the database connection.",
        )


@app.get("/products")
def list_products(
    limit: int = Query(default=20, ge=1, le=100),
    skip: int = Query(default=0, ge=0),
):
    try:
        products = list(
            products_collection.find().sort("name", 1).skip(skip).limit(limit)
        )
        return {
            "count": len(products),
            "products": [serialize_document(p) for p in products],
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve products.")


@app.patch("/products/{product_id}")
def update_product(product_id: str, product: ProductUpdate):
    product_object_id = valid_object_id(product_id, "product")
    updates = product.model_dump(exclude_unset=True)

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one field to update.",
        )
    if any(value is None for value in updates.values()):
        raise HTTPException(
            status_code=422,
            detail="Updated fields cannot be null.",
        )

    for field in ("name", "unit"):
        if field in updates:
            updates[field] = updates[field].strip()
            minimum = 2 if field == "name" else 1
            if len(updates[field]) < minimum:
                raise HTTPException(status_code=422, detail=f"Invalid {field}.")

    try:
        result = products_collection.update_one(
            {"_id": product_object_id}, {"$set": updates}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Product not found.")
        updated = products_collection.find_one({"_id": product_object_id})
        return serialize_document(updated)
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not update the product. Check the database connection.",
        )


@app.delete("/products/{product_id}")
def delete_product(product_id: str):
    product_object_id = valid_object_id(product_id, "product")

    try:
        if products_collection.find_one({"_id": product_object_id}) is None:
            raise HTTPException(status_code=404, detail="Product not found.")

        # Invoice items store product_id as a string.
        if invoices_collection.find_one({"items.product_id": product_id}):
            raise HTTPException(
                status_code=409,
                detail="This product is used in an invoice and cannot be deleted.",
            )

        products_collection.delete_one({"_id": product_object_id})
        return {"message": "Product deleted successfully.", "id": product_id}
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not delete the product. Check the database connection.",
        )


# -------------------------
# Invoice endpoints
# -------------------------

@app.post("/invoices", status_code=201)
def create_invoice(invoice: InvoiceCreate):
    customer_object_id = valid_object_id(invoice.customer_id, "customer")

    try:
        customer = customers_collection.find_one({"_id": customer_object_id})
        if customer is None:
            raise HTTPException(status_code=404, detail="Customer not found.")

        invoice_items = []
        subtotal = 0.0
        total_gst = 0.0

        for item in invoice.items:
            product_object_id = valid_object_id(item.product_id, "product")
            product = products_collection.find_one({"_id": product_object_id})
            if product is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Product not found: {item.product_id}",
                )

            unit_price = round(float(product["price"]), 2)
            gst_rate = float(product["gst_rate"])
            quantity = item.quantity
            line_subtotal = round(unit_price * quantity, 2)
            line_gst = round(line_subtotal * gst_rate / 100, 2)
            line_total = round(line_subtotal + line_gst, 2)

            subtotal += line_subtotal
            total_gst += line_gst
            invoice_items.append({
                "product_id": item.product_id,
                "product_name": product["name"],
                "unit": product["unit"],
                "quantity": quantity,
                "unit_price": unit_price,
                "gst_rate": gst_rate,
                "subtotal": line_subtotal,
                "gst_amount": line_gst,
                "total": line_total,
            })

        subtotal = round(subtotal, 2)
        total_gst = round(total_gst, 2)
        discount = round(invoice.discount, 2)

        if discount > subtotal:
            raise HTTPException(
                status_code=400,
                detail="Discount cannot exceed the subtotal.",
            )

        # Current project policy: GST is calculated before discount is deducted.
        taxable_amount = round(subtotal - discount, 2)
        total_amount = round(taxable_amount + total_gst, 2)

        document = {
            "customer_id": invoice.customer_id,
            "customer_name": customer["name"],
            "items": invoice_items,
            "subtotal": subtotal,
            "discount": discount,
            "taxable_amount": taxable_amount,
            "gst_amount": total_gst,
            "total_amount": total_amount,
            "amount_paid": 0.0,
            "balance_due": total_amount,
            "status": "UNPAID",
        }

        result = invoices_collection.insert_one(document)
        saved = invoices_collection.find_one({"_id": result.inserted_id})
        return serialize_document(saved)

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not save the invoice. Check the database connection.",
        )


@app.get("/invoices")
def get_invoices(
    limit: int = Query(default=20, ge=1, le=100),
    skip: int = Query(default=0, ge=0),
):
    try:
        total = invoices_collection.count_documents({})
        invoices = list(
            invoices_collection.find().sort("_id", -1).skip(skip).limit(limit)
        )
        return {
            "count": total,
            "invoices": [serialize_document(i) for i in invoices],
        }
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not retrieve invoices. Check the database connection.",
        )


@app.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: str):
    invoice_object_id = valid_object_id(invoice_id, "invoice")
    try:
        invoice = invoices_collection.find_one({"_id": invoice_object_id})
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")
        return serialize_document(invoice)
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not retrieve the invoice. Check the database connection.",
        )


# -------------------------
# Payment endpoints
# -------------------------

@app.post("/payments", status_code=201)
def create_payment(payment: PaymentCreate):
    invoice_object_id = valid_object_id(payment.invoice_id, "invoice")
    amount = round(float(payment.amount), 2)
    payment_method = payment.payment_method.strip()

    if not payment_method:
        raise HTTPException(status_code=422, detail="Payment method cannot be empty.")

    try:
        invoice = invoices_collection.find_one({"_id": invoice_object_id})
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")

        balance_due = round(float(invoice.get("balance_due", 0)), 2)
        old_amount_paid = round(float(invoice.get("amount_paid", 0)), 2)
        old_status = invoice.get("status", "UNPAID")

        if balance_due <= 0:
            raise HTTPException(
                status_code=400,
                detail="This invoice is already fully paid.",
            )
        if amount > balance_due:
            raise HTTPException(
                status_code=400,
                detail=f"Payment exceeds the outstanding balance of {balance_due:.2f}.",
            )

        new_amount_paid = round(old_amount_paid + amount, 2)
        new_balance = round(balance_due - amount, 2)
        new_status = "PAID" if new_balance == 0 else "PARTIALLY_PAID"

        # Only update if the balance still matches what we just read.
        updated_invoice = invoices_collection.find_one_and_update(
            {
                "_id": invoice_object_id,
                "balance_due": balance_due,
                "amount_paid": old_amount_paid,
            },
            {
                "$set": {
                    "amount_paid": new_amount_paid,
                    "balance_due": new_balance,
                    "status": new_status,
                }
            },
            return_document=ReturnDocument.AFTER,
        )

        if updated_invoice is None:
            raise HTTPException(
                status_code=409,
                detail="Invoice balance changed. Retrieve the invoice and retry.",
            )

        payment_document = {
            "invoice_id": payment.invoice_id,
            "customer_id": str(invoice["customer_id"]),
            "amount": amount,
            "payment_method": payment_method,
            "reference": clean_optional(payment.reference),
            "notes": clean_optional(payment.notes),
        }

        try:
            result = payments_collection.insert_one(payment_document)
        except PyMongoError:
            # Best-effort rollback if payment storage fails after invoice update.
            invoices_collection.update_one(
                {
                    "_id": invoice_object_id,
                    "amount_paid": new_amount_paid,
                    "balance_due": new_balance,
                    "status": new_status,
                },
                {
                    "$set": {
                        "amount_paid": old_amount_paid,
                        "balance_due": balance_due,
                        "status": old_status,
                    }
                },
            )
            raise

        # Construct a fresh JSON-safe response. Never return raw MongoDB documents.
        safe_payment = {
            "id": str(result.inserted_id),
            "invoice_id": payment.invoice_id,
            "customer_id": str(invoice["customer_id"]),
            "amount": amount,
            "payment_method": payment_method,
            "reference": clean_optional(payment.reference),
            "notes": clean_optional(payment.notes),
        }

        return {
            "message": "Payment recorded successfully.",
            "payment": safe_payment,
            "invoice": {
                "id": payment.invoice_id,
                "total_amount": float(invoice["total_amount"]),
                "amount_paid": new_amount_paid,
                "balance_due": new_balance,
                "status": new_status,
            },
        }

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Database operation failed while recording the payment.",
        )


@app.get("/payments")
def get_payments(
    limit: int = Query(default=20, ge=1, le=100),
    skip: int = Query(default=0, ge=0),
):
    try:
        total = payments_collection.count_documents({})
        payments = list(
            payments_collection.find().sort("_id", -1).skip(skip).limit(limit)
        )
        return {
            "count": total,
            "payments": [serialize_document(p) for p in payments],
        }
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not retrieve payment records. Check the database connection.",
        )
