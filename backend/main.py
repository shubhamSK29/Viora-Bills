import base64
from collections import defaultdict
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
import smtplib
from typing import Optional, List, Dict, Any
import urllib.parse

from dotenv import load_dotenv

# Load local environment variables from .env file if present
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()

from bson import ObjectId
from fastapi import FastAPI, HTTPException, Query, Header, Response, Depends, Security, Request, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
import PIL
from PIL import Image as PILImage

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("viora_bills")
logger.setLevel(logging.INFO)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import PyMongoError

import argon2
import jwt

import qrcode
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Image as RLImage,
    HRFlowable,
)


app = FastAPI(
    title="Viora Bills API",
    description="Backend API for the Viora Bills billing system",
    version="1.0.0",
)

# Allow the React frontend to communicate with this API securely.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
PRODUCT_UPLOAD_DIR = os.path.join(UPLOAD_DIR, "products")
os.makedirs(PRODUCT_UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# MongoDB connection.
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://127.0.0.1:27017/")
client = MongoClient(MONGODB_URL, serverSelectionTimeoutMS=3000)
db = client["viora_bills"]

customers_collection = db["customers"]
products_collection = db["products"]
invoices_collection = db["invoices"]
payments_collection = db["payments"]
company_settings_collection = db["company_settings"]
counters_collection = db["counters"]
users_collection = db["users"]
customer_invitations_collection = db["customer_invitations"]
notifications_collection = db["notifications"]
audit_logs_collection = db["audit_logs"]
orders_collection = db["orders"]
carts_collection = db["carts"]
otps_collection = db["email_otps"]
payment_schedules_collection = db["payment_schedules"]
email_delivery_logs_collection = db["email_delivery_logs"]

def setup_database_indexes():
    """
    Sets up all required database indexes for performance optimization and uniqueness constraints.
    Idempotent and safe against existing collections.
    """
    try:
        # Users indexes: unique email lookup, role + status filtering, creation date sorting
        users_collection.create_index("email", unique=True)
        users_collection.create_index([("role", 1), ("is_active", 1)])
        users_collection.create_index("created_at")

        # Invoices indexes: unique sequential numbers, customer references, date & status queries
        invoices_collection.create_index("invoice_number", unique=True, sparse=True)
        invoices_collection.create_index("customer_id")
        invoices_collection.create_index("status")
        invoices_collection.create_index([("invoice_date", -1), ("status", 1)])
        invoices_collection.create_index("created_at")

        # Customers indexes: name searches, GSTIN lookups, contact data, creation order
        customers_collection.create_index("name")
        customers_collection.create_index("gstin", sparse=True)
        customers_collection.create_index("email", sparse=True)
        customers_collection.create_index("phone", sparse=True)
        customers_collection.create_index("created_at")

        # Products indexes: catalog searching, category filtering, pricing
        products_collection.create_index("name")
        products_collection.create_index("category", sparse=True)
        products_collection.create_index("price")

        # Payments indexes: invoice lookups, date sorting, payment method filtering, status, receipts
        payments_collection.create_index("invoice_id")
        payments_collection.create_index("customer_id", sparse=True)
        payments_collection.create_index("payment_date")
        payments_collection.create_index("payment_method")
        payments_collection.create_index("status")
        payments_collection.create_index("receipt_number", sparse=True)
        payments_collection.create_index("gateway_payment_id", sparse=True)
        payments_collection.create_index("created_at")

        # Customer Invitations indexes
        customer_invitations_collection.create_index("token", unique=True)
        customer_invitations_collection.create_index("customer_id")
        customer_invitations_collection.create_index("status")

        # Notifications indexes
        notifications_collection.create_index([("recipient_role", 1), ("is_read", 1)])
        notifications_collection.create_index([("recipient_user_id", 1), ("is_read", 1)])
        notifications_collection.create_index([("customer_id", 1), ("is_read", 1)])
        notifications_collection.create_index("created_at")

        # Audit Logs indexes
        audit_logs_collection.create_index("actor_id")
        audit_logs_collection.create_index("user_id")
        audit_logs_collection.create_index("module")
        audit_logs_collection.create_index("action")
        audit_logs_collection.create_index("status")
        audit_logs_collection.create_index("resource_type")
        audit_logs_collection.create_index("created_at")
        audit_logs_collection.create_index([("module", 1), ("created_at", -1)])

        # Orders indexes: unique sequential numbers, customer references, date & status queries
        orders_collection.create_index("order_number", unique=True, sparse=True)
        orders_collection.create_index("customer_id")
        orders_collection.create_index("status")
        orders_collection.create_index("created_at")
        orders_collection.create_index("invoice_id", sparse=True)

        # Carts indexes: unique per customer
        carts_collection.create_index("customer_id", unique=True)

        # Email OTP indexes: lookup by email + purpose + consumed state, and TTL expiration
        otps_collection.create_index("email")
        otps_collection.create_index([("email", 1), ("purpose", 1), ("is_consumed", 1)])
        otps_collection.create_index("expires_at", expireAfterSeconds=0)

        # Payment Schedules indexes
        payment_schedules_collection.create_index("customer_id")
        payment_schedules_collection.create_index("invoice_id")
        payment_schedules_collection.create_index("scheduled_date")
        payment_schedules_collection.create_index("status")

        # Email Delivery Logs indexes
        email_delivery_logs_collection.create_index("email_id", unique=True, sparse=True)
        email_delivery_logs_collection.create_index("idempotency_key", sparse=True)
        email_delivery_logs_collection.create_index("customer_id")
        email_delivery_logs_collection.create_index("delivery_status")
        email_delivery_logs_collection.create_index("email_type")
        email_delivery_logs_collection.create_index([("created_at", -1)])
    except Exception as e:
        logger.warning(f"Database index setup notice: {e}")


def infer_audit_module(action: str, resource_type: str) -> str:
    act = (action or "").upper()
    res = (resource_type or "").lower()
    if any(k in act for k in ["LOGIN", "LOGOUT", "PASSWORD", "OTP", "AUTH", "INVITE", "TOKEN"]):
        return "Auth"
    if "CUSTOMER" in act or "customer" in res:
        return "Customers"
    if "PRODUCT" in act or "product" in res:
        return "Products"
    if "ORDER" in act or "order" in res:
        return "Orders"
    if "INVOICE" in act or "invoice" in res:
        return "Invoices"
    if "PAYMENT" in act or "payment" in res or "UPI" in act or "CARD" in act or "CHEQUE" in act:
        return "Payments"
    if "SETTING" in act or "company" in res:
        return "Settings"
    if "USER" in act or "user" in res or "STAFF" in act:
        return "Users"
    return "General"


def sanitize_audit_details(details: Optional[dict]) -> dict:
    if not isinstance(details, dict):
        return {}
    clean = {}
    SENSITIVE_KEYS = {
        "password", "password_hash", "new_password", "current_password",
        "confirm_password", "otp", "token", "access_token", "secret",
        "card_number", "cvv", "smtp_password", "app_password"
    }
    for k, v in details.items():
        if any(sk in k.lower() for sk in SENSITIVE_KEYS):
            clean[k] = "[REDACTED]"
        elif isinstance(v, dict):
            clean[k] = sanitize_audit_details(v)
        else:
            clean[k] = v
    return clean


def log_audit_event(
    actor: Optional[dict] = None,
    action: str = "",
    resource_type: str = "",
    resource_id: Optional[str] = None,
    details: Optional[dict] = None,
    module: Optional[str] = None,
    description: Optional[str] = None,
    status: str = "SUCCESS",
    ip_address: Optional[str] = None,
    request: Optional[Request] = None,
):
    """
    Asynchronously / reliably records a financial, administrative or governance action in the audit log.
    Ensures safe redaction of credentials and standardizes audit fields.
    """
    try:
        actor_dict = actor if isinstance(actor, dict) else {}
        user_id = str(actor_dict.get("id") or actor_dict.get("_id") or "")
        user_email = actor_dict.get("email") or "system"
        user_name = actor_dict.get("full_name") or actor_dict.get("name") or user_email
        user_role = actor_dict.get("role") or "system"

        computed_module = module or infer_audit_module(action, resource_type)

        # Extract client IP if request is provided
        client_ip = ip_address
        if not client_ip and request:
            try:
                forwarded = request.headers.get("x-forwarded-for")
                if forwarded:
                    client_ip = forwarded.split(",")[0].strip()
                elif request.client and request.client.host:
                    client_ip = request.client.host
            except Exception:
                client_ip = "127.0.0.1"
        if not client_ip:
            client_ip = "127.0.0.1"

        clean_details = sanitize_audit_details(details)

        # Generate a human readable description if omitted
        if not description:
            clean_act = action.replace("_", " ").title()
            res_label = f" {resource_type}" if resource_type else ""
            res_id_label = f" #{str(resource_id)[:8]}" if resource_id else ""
            description = f"{clean_act} performed on{res_label}{res_id_label} by {user_name} ({user_role})."

        now_iso = datetime.now(timezone.utc).isoformat()
        audit_doc = {
            "user_id": user_id,
            "user_name": user_name,
            "user_email": user_email,
            "user_role": user_role,
            "actor_id": user_id,
            "actor_email": user_email,
            "actor_role": user_role,
            "action": action,
            "module": computed_module,
            "description": description,
            "entity_type": resource_type,
            "entity_id": str(resource_id) if resource_id else None,
            "resource_type": resource_type,
            "resource_id": str(resource_id) if resource_id else None,
            "status": (status or "SUCCESS").upper(),
            "ip_address": client_ip,
            "details": clean_details,
            "created_at": now_iso,
        }
        audit_logs_collection.insert_one(audit_doc)
    except Exception as e:
        logger.warning(f"Audit log recording error: {e}")


def create_notification(
    title: str,
    message: str,
    recipient_role: Optional[str] = None,
    recipient_user_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    notification_type: str = "general",
    link: Optional[str] = None,
):
    """
    Dispatches an in-app notification to target user or role.
    """
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        notifications_collection.insert_one({
            "title": title,
            "message": message,
            "recipient_role": recipient_role,
            "recipient_user_id": str(recipient_user_id) if recipient_user_id else None,
            "customer_id": str(customer_id) if customer_id else None,
            "notification_type": notification_type,
            "link": link,
            "is_read": False,
            "created_at": now_iso,
        })
    except Exception as e:
        logger.warning(f"Notification creation error: {e}")


try:
    setup_database_indexes()
except Exception:
    pass

# -------------------------
# Security & Cryptography Configuration
# -------------------------
password_hasher = argon2.PasswordHasher()
JWT_SECRET_KEY = os.getenv(
    "JWT_SECRET_KEY",
    "viora_bills_super_secure_jwt_secret_key_2026_phase3_deepmind_agy_prod_min_32_chars",
)
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8 hours

# Payment Gateway Configuration (e.g. Razorpay)
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")

# In-memory sliding-window login rate limiter (brute-force prevention)
LOGIN_ATTEMPTS: Dict[str, List[float]] = {}
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_SECONDS = 300  # 5 minutes

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


def check_login_rate_limit(key: str) -> None:
    now = time.time()
    attempts = LOGIN_ATTEMPTS.get(key, [])
    valid_attempts = [t for t in attempts if now - t < LOCKOUT_SECONDS]
    LOGIN_ATTEMPTS[key] = valid_attempts
    if len(valid_attempts) >= MAX_FAILED_ATTEMPTS:
        remaining_seconds = max(1, int(LOCKOUT_SECONDS - (now - valid_attempts[0])))
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed login attempts. Please try again after {remaining_seconds} seconds.",
        )


def record_failed_login(key: str) -> None:
    now = time.time()
    attempts = LOGIN_ATTEMPTS.get(key, [])
    attempts.append(now)
    LOGIN_ATTEMPTS[key] = attempts


def clear_failed_logins(key: str) -> None:
    LOGIN_ATTEMPTS.pop(key, None)


# -------------------------
# SMTP & Email Dispatcher Configuration
# -------------------------
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASS = os.getenv("SMTP_PASS", "").strip()
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USER or "noreply@viorabills.com").strip()
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Viora Bills").strip()
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in ("true", "1", "yes")
ALLOW_DEV_OTP_PREVIEW = os.getenv("ALLOW_DEV_OTP_PREVIEW", "true").lower() in ("true", "1", "yes")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower().strip()


def is_dev_otp_allowed() -> bool:
    """
    Returns True only if development preview of OTP is explicitly enabled
    AND the environment is NOT production. Never leaks OTPs in production.
    """
    env = os.getenv("ENVIRONMENT", "development").lower().strip()
    dev_preview = os.getenv("ALLOW_DEV_OTP_PREVIEW", "true").lower() in ("true", "1", "yes")
    return dev_preview and env != "production"


def get_smtp_config() -> dict:
    """
    Dynamically retrieves active SMTP settings from environment and backend/.env.
    Supports live reloading if backend/.env is updated while the server is running.
    """
    host = os.getenv("SMTP_HOST", "").strip()
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
    except (ValueError, TypeError):
        port = 587
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASS", "").strip()
    from_email = os.getenv("SMTP_FROM_EMAIL", "").strip()
    from_name = os.getenv("SMTP_FROM_NAME", "").strip()
    use_tls_val = os.getenv("SMTP_USE_TLS", "").strip()

    # If credentials are not set in os.environ, inspect backend/.env on disk dynamically
    if not (user and password):
        env_file = os.path.join(os.path.dirname(__file__), ".env")
        if os.path.exists(env_file):
            from dotenv import dotenv_values
            disk_vals = dotenv_values(env_file)
            host = host or (disk_vals.get("SMTP_HOST") or "").strip()
            user = user or (disk_vals.get("SMTP_USER") or "").strip()
            password = password or (disk_vals.get("SMTP_PASS") or "").strip()
            from_email = from_email or (disk_vals.get("SMTP_FROM_EMAIL") or "").strip()
            from_name = from_name or (disk_vals.get("SMTP_FROM_NAME") or "").strip()
            if not use_tls_val and "SMTP_USE_TLS" in disk_vals:
                use_tls_val = disk_vals.get("SMTP_USE_TLS")

    from_email = from_email or user or "noreply@viorabills.com"
    from_name = from_name or "Viora Bills"
    use_tls = use_tls_val.lower() in ("true", "1", "yes") if use_tls_val else True

    return {
        "host": host,
        "port": port,
        "user": user,
        "pass": password,
        "from_email": from_email,
        "from_name": from_name,
        "use_tls": use_tls,
    }


def is_smtp_configured() -> bool:
    """
    Returns True if SMTP is fully configured with host, user, and password.
    Partial configurations (e.g. host without credentials) are considered unconfigured.
    """
    cfg = get_smtp_config()
    return bool(cfg["host"] and cfg["user"] and cfg["pass"])


def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> bool:
    """
    Dispatches transactional emails via authenticated SMTP with STARTTLS or SSL.
    Fully supports Gmail SMTP (smtp.gmail.com:587 with STARTTLS or 465 with SSL).
    Handles network and authentication failures safely without ever logging credentials or secret contents.
    Automatically normalizes 16-character Google App Passwords (stripping any accidental spaces).
    Supports optional binary file attachments (e.g. PDF invoices and receipts).
    """
    if not is_smtp_configured():
        logger.warning(f"SMTP is not fully configured (missing host, user, or pass). Email delivery to {to_email} was skipped.")
        return False

    cfg = get_smtp_config()
    host = cfg["host"]

    try:
        sender_email = cfg["from_email"] or cfg["user"] or "noreply@viorabills.com"

        if attachments:
            msg = MIMEMultipart("mixed")
            body_part = MIMEMultipart("alternative")
            if text_content:
                body_part.attach(MIMEText(text_content, "plain", "utf-8"))
            if html_content:
                body_part.attach(MIMEText(html_content, "html", "utf-8"))
            msg.attach(body_part)

            for att in attachments:
                att_content = att.get("content")
                att_filename = att.get("filename", "document.pdf")
                if att_content:
                    part = MIMEApplication(att_content, _subtype="pdf")
                    part.add_header("Content-Disposition", "attachment", filename=att_filename)
                    msg.attach(part)
        else:
            msg = MIMEMultipart("alternative")
            if text_content:
                msg.attach(MIMEText(text_content, "plain", "utf-8"))
            if html_content:
                msg.attach(MIMEText(html_content, "html", "utf-8"))

        msg["Subject"] = subject
        msg["From"] = f"{cfg['from_name']} <{sender_email}>"
        msg["To"] = to_email

        clean_pass = cfg["pass"].replace(" ", "").strip()
        port = cfg["port"]

        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=15)
            server.ehlo()
        else:
            server = smtplib.SMTP(host, port, timeout=15)
            server.ehlo()
            if cfg["use_tls"]:
                server.starttls()
                server.ehlo()

        if cfg["user"] and clean_pass:
            server.login(cfg["user"], clean_pass)

        server.sendmail(sender_email, [to_email], msg.as_string())
        server.quit()
        logger.info(f"Email successfully delivered to {to_email} (attachments: {len(attachments) if attachments else 0})")
        return True
    except smtplib.SMTPAuthenticationError as auth_err:
        logger.error(f"SMTP authentication failed for {cfg.get('user')}: {auth_err.smtp_code} {auth_err.smtp_error}")
        return False
    except Exception as e:
        logger.error(f"Failed to deliver email to {to_email}: {type(e).__name__} - {e}")
        return False


def validate_password_policy(password: str) -> None:
    """
    Centralized password policy:
    - Minimum 8 characters
    - Maximum 128 characters
    - At least 1 uppercase letter (A-Z)
    - At least 1 lowercase letter (a-z)
    - At least 1 numerical digit (0-9)
    - Rejection of excessively common weak passwords
    """
    if not password:
        raise HTTPException(status_code=422, detail="Password cannot be empty.")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters long.")
    if len(password) > 128:
        raise HTTPException(status_code=422, detail="Password cannot exceed 128 characters.")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=422, detail="Password must contain at least one uppercase letter (A-Z).")
    if not re.search(r"[a-z]", password):
        raise HTTPException(status_code=422, detail="Password must contain at least one lowercase letter (a-z).")
    if not re.search(r"[0-9]", password):
        raise HTTPException(status_code=422, detail="Password must contain at least one numerical digit (0-9).")

    weak_passwords = {"password", "12345678", "password123", "qwerty123", "admin12345", "viorabills"}
    if password.strip().lower() in weak_passwords:
        raise HTTPException(status_code=422, detail="This password is too common and insecure. Please choose a stronger password.")


OTP_LOCKOUT_SECONDS = 60  # 60 seconds resend cooldown
OTP_EXPIRY_MINUTES = 10
OTP_MAX_ATTEMPTS = 3


def generate_secure_otp() -> str:
    """Generates a cryptographically random 6-digit numeric OTP."""
    return f"{secrets.randbelow(900000) + 100000}"


def hash_otp(email: str, otp: str, purpose: str) -> str:
    """
    Computes HMAC-SHA256 of OTP bound to user's email and purpose.
    Prevents cross-purpose replay attacks.
    """
    msg = f"{email.strip().lower()}:{otp.strip()}:{purpose.strip().upper()}".encode("utf-8")
    return hmac.new(JWT_SECRET_KEY.encode("utf-8"), msg, hashlib.sha256).hexdigest()


class OtpIssuanceResult(tuple):
    def __new__(cls, raw_otp: str, email_sent: bool):
        return super().__new__(cls, (raw_otp, email_sent))

    def __init__(self, raw_otp: str, email_sent: bool):
        self.raw_otp = raw_otp
        self.email_sent = email_sent

    def __getitem__(self, key):
        if isinstance(key, str):
            if key == "raw_otp":
                return self.raw_otp
            elif key == "email_sent":
                return self.email_sent
            raise KeyError(key)
        return super().__getitem__(key)

    def get(self, key, default=None):
        if key == "raw_otp":
            return self.raw_otp
        if key == "email_sent":
            return self.email_sent
        return default


def validate_password_strength(password: str) -> None:
    if not password or len(password) < 8:
        raise HTTPException(
            status_code=422,
            detail="Password must be at least 8 characters long.",
        )
    if not any(c.isupper() for c in password):
        raise HTTPException(
            status_code=422,
            detail="Password must contain at least one uppercase letter.",
        )
    if not any(c.islower() for c in password):
        raise HTTPException(
            status_code=422,
            detail="Password must contain at least one lowercase letter.",
        )
    if not any(c.isdigit() for c in password):
        raise HTTPException(
            status_code=422,
            detail="Password must contain at least one numerical digit.",
        )
    common_passwords = {"password123", "admin12345", "12345678", "qwertyuiop", "viorabills123"}
    if password.strip().lower() in common_passwords:
        raise HTTPException(
            status_code=422,
            detail="This password is too common and insecure. Please choose a more complex password.",
        )


def issue_otp_for_email(email: str, purpose: str):
    """
    Issues a fresh 6-digit OTP for the given email and purpose.
    Enforces 60-second cooldown and invalidates previous unconsumed codes.
    Dispatches via email service.
    """
    clean_email = email.strip().lower()
    clean_purpose = purpose.strip().upper()
    now_dt = datetime.now(timezone.utc)

    # 1. Enforce 60-second cooldown per email and purpose
    recent_otp = otps_collection.find_one(
        {"email": clean_email, "purpose": clean_purpose, "is_consumed": False},
        sort=[("created_at", -1)]
    )
    if recent_otp:
        created_at = recent_otp.get("created_at")
        if isinstance(created_at, str):
            try:
                created_at = datetime.fromisoformat(created_at)
            except Exception:
                created_at = None
        if created_at:
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            elapsed = (now_dt - created_at).total_seconds()
            if elapsed < OTP_LOCKOUT_SECONDS:
                remaining = int(OTP_LOCKOUT_SECONDS - elapsed)
                raise HTTPException(
                    status_code=429,
                    detail=f"Please wait {remaining} seconds before requesting another code.",
                )

    # 2. Invalidate previous outstanding OTPs for this email and purpose
    otps_collection.update_many(
        {"email": clean_email, "purpose": clean_purpose, "is_consumed": False},
        {"$set": {"is_consumed": True, "invalidated_at": now_dt.isoformat()}}
    )

    # 3. Generate new 6-digit OTP and compute hash
    raw_otp = generate_secure_otp()
    hashed = hash_otp(clean_email, raw_otp, clean_purpose)
    expires_dt = now_dt + timedelta(minutes=OTP_EXPIRY_MINUTES)

    otp_doc = {
        "email": clean_email,
        "hashed_otp": hashed,
        "purpose": clean_purpose,
        "attempts_used": 0,
        "max_attempts": OTP_MAX_ATTEMPTS,
        "is_consumed": False,
        "created_at": now_dt,
        "expires_at": expires_dt,
    }
    otps_collection.insert_one(otp_doc)

    # 4. Dispatch email with purpose-specific subject and template
    if clean_purpose == "REGISTRATION":
        subject = "Your Viora Bills Registration Verification Code"
        action_text = "complete your Viora Bills account registration"
    elif clean_purpose == "VERIFICATION":
        subject = "Your Viora Bills Account Verification Code"
        action_text = "verify and activate your Viora Bills account"
    elif clean_purpose == "EMAIL_CHANGE":
        subject = "Your Viora Bills Email Change Verification Code"
        action_text = "verify your new email address for Viora Bills"
    elif clean_purpose == "LOGIN_2FA":
        subject = "Your Viora Bills Login Verification Code"
        action_text = "verify your login session"
    else:
        subject = "Your Viora Bills Password Reset Code"
        action_text = "reset your account password"

    html_content = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 10px 18px; border-radius: 8px; font-weight: 800; font-size: 18px; letter-spacing: 0.5px;">Viora Bills</div>
        </div>
        <h2 style="color: #0f172a; margin: 0 0 12px; font-size: 20px; font-weight: 700; text-align: center;">Security Verification Code</h2>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px; text-align: center;">
            You requested a verification code to {action_text} (<strong>{clean_email}</strong>).
        </p>
        <div style="background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 2px dashed #cbd5e1; padding: 20px; border-radius: 10px; text-align: center; margin: 24px 0;">
            <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 1px; margin-bottom: 6px;">Your 6-Digit Code</div>
            <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1e3a8a; font-family: 'Courier New', monospace;">{raw_otp}</span>
        </div>
        <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0 0 16px; text-align: center;">
            ⏱️ This code will expire in <strong>{OTP_EXPIRY_MINUTES} minutes</strong>. Please enter this code manually into Viora Bills to confirm.
        </p>
        <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 16px; margin: 0; text-align: center;">
            If you did not make this request, please disregard this email. Never share this code with anyone.
        </p>
    </div>
    """
    text_content = f"Viora Bills Security Code: {raw_otp}\n\nUse this code to {action_text}. Valid for {OTP_EXPIRY_MINUTES} minutes. If you did not request this, please ignore this email."

    email_sent = send_email(clean_email, subject, html_content, text_content)
    if is_smtp_configured() and not email_sent:
        logger.warning(f"SMTP delivery failed for {clean_email}")

    return OtpIssuanceResult(raw_otp, email_sent)


def verify_and_consume_otp(email: str, otp: str, purpose: str) -> bool:
    """
    Atomically verifies and consumes a 6-digit OTP.
    Validates expiration, attempt counts, and purpose binding.
    """
    clean_email = email.strip().lower()
    clean_purpose = purpose.strip().upper()
    now_dt = datetime.now(timezone.utc)

    doc = otps_collection.find_one(
        {"email": clean_email, "purpose": clean_purpose, "is_consumed": False},
        sort=[("created_at", -1)]
    )
    if not doc:
        raise HTTPException(
            status_code=400,
            detail="No active verification code found. Please request a new code.",
        )

    # 1. Check expiration
    expires_at = doc.get("expires_at")
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except Exception:
            expires_at = None
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if now_dt > expires_at:
            otps_collection.update_one({"_id": doc["_id"]}, {"$set": {"is_consumed": True}})
            raise HTTPException(
                status_code=400,
                detail="Verification code has expired. Please request a new code.",
            )

    # 2. Check maximum attempts
    attempts_used = int(doc.get("attempts_used", 0))
    max_attempts = int(doc.get("max_attempts", OTP_MAX_ATTEMPTS))
    if attempts_used >= max_attempts:
        otps_collection.update_one({"_id": doc["_id"]}, {"$set": {"is_consumed": True}})
        raise HTTPException(
            status_code=400,
            detail="Maximum incorrect attempts exceeded. This code is now invalid. Please request a new code.",
        )

    # 3. Verify hash using constant-time comparison
    expected_hash = hash_otp(clean_email, otp.strip(), clean_purpose)
    if not hmac.compare_digest(doc.get("hashed_otp", ""), expected_hash):
        new_attempts = attempts_used + 1
        update_fields = {"attempts_used": new_attempts}
        if new_attempts >= max_attempts:
            update_fields["is_consumed"] = True
        otps_collection.update_one({"_id": doc["_id"]}, {"$set": update_fields})
        remaining = max(0, max_attempts - new_attempts)
        if remaining > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid verification code. {remaining} attempt(s) remaining.",
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Invalid verification code. Maximum attempts reached. Please request a new code.",
            )

    # 4. Atomically consume OTP
    consumed = otps_collection.find_one_and_update(
        {"_id": doc["_id"], "is_consumed": False},
        {"$set": {"is_consumed": True, "consumed_at": now_dt.isoformat()}}
    )
    if not consumed:
        raise HTTPException(
            status_code=400,
            detail="Verification code was already used or invalidated.",
        )

    return True

INDIAN_STATES = {
    "01": "Jammu and Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu",
    "27": "Maharashtra",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman and Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
    "97": "Other Territory",
}

GSTIN_REGEX = r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$"


# -------------------------
# Request models
# -------------------------

class CustomerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    business_name: Optional[str] = Field(default=None, max_length=150)
    email: Optional[str] = Field(default=None, max_length=254)
    phone: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=300)
    state: Optional[str] = Field(default=None, max_length=50)
    state_code: Optional[str] = Field(default=None, max_length=10)
    pincode: Optional[str] = Field(default=None, max_length=15)
    gstin: Optional[str] = Field(default=None, max_length=20)


class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    business_name: Optional[str] = Field(default=None, max_length=150)
    email: Optional[str] = Field(default=None, max_length=254)
    phone: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=300)
    state: Optional[str] = Field(default=None, max_length=50)
    state_code: Optional[str] = Field(default=None, max_length=10)
    pincode: Optional[str] = Field(default=None, max_length=15)
    gstin: Optional[str] = Field(default=None, max_length=20)


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    price: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=30)
    gst_rate: float = Field(ge=0, le=100)
    description: Optional[str] = Field(default=None, max_length=1000)
    sku: Optional[str] = Field(default=None, max_length=50)
    category: Optional[str] = Field(default=None, max_length=50)
    image_url: Optional[str] = Field(default=None, max_length=500)
    is_active: bool = Field(default=True)


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    price: Optional[float] = Field(default=None, gt=0)
    unit: Optional[str] = Field(default=None, min_length=1, max_length=30)
    gst_rate: Optional[float] = Field(default=None, ge=0, le=100)
    description: Optional[str] = Field(default=None, max_length=1000)
    sku: Optional[str] = Field(default=None, max_length=50)
    category: Optional[str] = Field(default=None, max_length=50)
    image_url: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None


class ProductImageUpload(BaseModel):
    image_data: str = Field(min_length=10)
    filename: Optional[str] = "image.png"


class CartItemAdd(BaseModel):
    product_id: str
    quantity: int = Field(default=1, gt=0)


class CartItemUpdate(BaseModel):
    quantity: int = Field(gt=0)


class OrderCreate(BaseModel):
    delivery_notes: Optional[str] = Field(default=None, max_length=500)


class OrderReviewAction(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=500)


class OrderRejectAction(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class OrderCancelAction(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class InvoiceItemCreate(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)


class InvoiceCreate(BaseModel):
    customer_id: str
    items: list[InvoiceItemCreate] = Field(min_length=1)
    discount: float = Field(default=0, ge=0)
    due_date: Optional[str] = None
    invoice_date: Optional[str] = None
    place_of_supply: Optional[str] = None


class PaymentCreate(BaseModel):
    invoice_id: str
    amount: float = Field(gt=0)
    payment_method: str = Field(min_length=2, max_length=30)
    reference: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=300)
    payment_date: Optional[str] = None
    # Cheque-specific fields
    cheque_number: Optional[str] = Field(default=None, max_length=50)
    bank_name: Optional[str] = Field(default=None, max_length=100)
    cheque_date: Optional[str] = None
    # UPI / Bank transfer verification flag
    is_verified: Optional[bool] = None


class PaymentStatusUpdate(BaseModel):
    new_status: str = Field(min_length=3, max_length=30)
    reason: Optional[str] = Field(default=None, max_length=300)


class CardOrderCreate(BaseModel):
    invoice_id: str
    amount: Optional[float] = Field(default=None, gt=0)


class CardPaymentVerify(BaseModel):
    invoice_id: str
    order_id: str
    payment_id: str
    signature: str
    amount: Optional[float] = Field(default=None, gt=0)


class CompanySettingsUpdate(BaseModel):
    company_name: str = Field(min_length=2, max_length=120)
    business_address: str = Field(min_length=3, max_length=300)
    gstin: Optional[str] = Field(default=None, max_length=20)
    phone: Optional[str] = Field(default=None, max_length=25)
    email: Optional[str] = Field(default=None, max_length=254)
    state: Optional[str] = Field(default=None, max_length=50)
    pincode: Optional[str] = Field(default=None, max_length=15)
    logo_url: Optional[str] = Field(default=None)
    bank_name: Optional[str] = Field(default=None, max_length=100)
    account_holder_name: Optional[str] = Field(default=None, max_length=100)
    account_number: Optional[str] = Field(default=None, max_length=50)
    ifsc_code: Optional[str] = Field(default=None, max_length=20)
    upi_id: Optional[str] = Field(default=None, max_length=100)


# -------------------------
# User & Authentication Schemas
# -------------------------

class UserLogin(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=6, max_length=128)
    role: str = Field(default="staff")
    customer_id: Optional[str] = None
    is_active: bool = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    email: Optional[str] = Field(default=None, min_length=5, max_length=254)
    role: Optional[str] = None
    customer_id: Optional[str] = None
    is_active: Optional[bool] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class CustomerInviteRequest(BaseModel):
    customer_id: str


class AcceptInviteRequest(BaseModel):
    token: str
    password: str = Field(min_length=6, max_length=128)
    full_name: Optional[str] = Field(default=None, max_length=100)


def serialize_user(user: dict) -> dict:
    """Return public representation of user. Password hash is strictly excluded."""
    if not user:
        return {}
    return {
        "id": str(user.get("_id") or user.get("id")),
        "full_name": user.get("full_name", ""),
        "email": user.get("email", ""),
        "role": user.get("role", "staff"),
        "customer_id": str(user.get("customer_id")) if user.get("customer_id") else None,
        "is_active": user.get("is_active", True),
        "created_at": user.get("created_at", ""),
        "updated_at": user.get("updated_at", ""),
    }


def create_access_token(user: dict, expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user.get("_id") or user.get("id")),
        "email": user.get("email", "").lower(),
        "role": user.get("role", "staff"),
        "customer_id": str(user.get("customer_id")) if user.get("customer_id") else None,
        "full_name": user.get("full_name", ""),
        "token_version": user.get("token_version", 1),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


security_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_scheme),
    auth_header: Optional[str] = Header(None, alias="Authorization"),
    token_param: Optional[str] = Query(None, alias="token"),
) -> dict:
    token = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    elif auth_header:
        parts = auth_header.strip().split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
        elif len(parts) == 1:
            token = parts[0]
    elif token_param:
        token = token_param

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Authentication token is missing. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Authentication token has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    user_email = payload.get("email")

    user = None
    if user_id:
        try:
            user = users_collection.find_one({"_id": ObjectId(user_id)})
        except Exception:
            pass
        if not user:
            user = users_collection.find_one({"_id": user_id})
    if not user and user_email:
        user = users_collection.find_one({"email": user_email.lower()})

    if not user:
        raise HTTPException(
            status_code=401,
            detail="User account associated with this token no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.get("is_active", True):
        raise HTTPException(
            status_code=403,
            detail="This user account has been deactivated. Please contact an administrator.",
        )

    user_token_version = user.get("token_version", 1)
    payload_token_version = payload.get("token_version")
    if payload_token_version is not None and payload_token_version != user_token_version:
        raise HTTPException(
            status_code=401,
            detail="Session has expired due to password reset or security revocation. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return serialize_user(user)


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin authorization required to perform this action.",
        )
    return current_user


def require_admin_settings(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin authorization required to modify company profile and payment settings.",
        )
    return current_user


def require_staff_or_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") not in ["admin", "staff"]:
        raise HTTPException(
            status_code=403,
            detail="Access forbidden: insufficient permissions.",
        )
    return current_user


def require_customer(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "customer":
        raise HTTPException(
            status_code=403,
            detail="Customer authorization required to access this portal.",
        )
    return current_user


def require_customer_or_staff_or_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") not in ["admin", "staff", "customer"]:
        raise HTTPException(
            status_code=403,
            detail="Access forbidden: insufficient permissions.",
        )
    return current_user



def bootstrap_users() -> None:
    """Safe bootstrap of initial Admin, Staff, and Customer accounts if not existing."""
    try:
        admin_email = os.getenv("ADMIN_EMAIL", "capra6xymovshubham@viva-technology.org").strip().lower()
        admin_password = os.getenv("ADMIN_PASSWORD", "Admin@12345")
        admin_name = os.getenv("ADMIN_NAME", "Shubham Kamble")

        now_str = datetime.now(timezone.utc).isoformat()
        existing_admin = users_collection.find_one({"email": admin_email})
        if not existing_admin:
            hashed_admin = password_hasher.hash(admin_password)
            admin_doc = {
                "full_name": admin_name,
                "email": admin_email,
                "password_hash": hashed_admin,
                "role": "admin",
                "is_active": True,
                "created_at": now_str,
                "updated_at": now_str,
            }
            users_collection.insert_one(admin_doc)

        # Staff user: Harshada Kamble
        staff_email = "harshadakamble1985@gmail.com"
        existing_staff = users_collection.find_one({"email": staff_email})
        if not existing_staff:
            hashed_staff = password_hasher.hash("Harshada@12345")
            staff_doc = {
                "full_name": "Harshada Kamble",
                "email": staff_email,
                "password_hash": hashed_staff,
                "role": "staff",
                "is_active": True,
                "created_at": now_str,
                "updated_at": now_str,
            }
            users_collection.insert_one(staff_doc)

        # Customer & Customer user: Shubham Kamble
        cust_email = "shubhamkamble290505@gmail.com"
        sample_cust = customers_collection.find_one({"email": cust_email})
        if not sample_cust:
            sample_cust_doc = {
                "name": "Shubham Kamble",
                "business_name": "svk",
                "email": cust_email,
                "phone": "9867294278",
                "address": "Goregaon",
                "state": "Maharashtra",
                "state_code": "27",
                "pincode": "400104",
                "created_at": now_str,
                "updated_at": now_str,
            }
            c_res = customers_collection.insert_one(sample_cust_doc)
            cust_id = str(c_res.inserted_id)
        else:
            cust_id = str(sample_cust["_id"])

        existing_cust_user = users_collection.find_one({"email": cust_email})
        if not existing_cust_user:
            hashed_cust = password_hasher.hash("Customer@12345")
            cust_user_doc = {
                "full_name": "Shubham Kamble",
                "email": cust_email,
                "password_hash": hashed_cust,
                "role": "customer",
                "customer_id": cust_id,
                "is_active": True,
                "created_at": now_str,
                "updated_at": now_str,
            }
            users_collection.insert_one(cust_user_doc)
        elif not existing_cust_user.get("customer_id"):
            users_collection.update_one(
                {"_id": existing_cust_user["_id"]},
                {"$set": {"customer_id": cust_id, "role": "customer", "full_name": "Shubham Kamble"}},
            )
    except Exception as e:
        print(f"[SECURITY] User bootstrap notice: {e}")


# Run initial user bootstrap
bootstrap_users()


@app.on_event("startup")
def on_app_startup():
    bootstrap_users()
    setup_database_indexes()


# -------------------------
# Serialization helpers & defaults
# -------------------------

DEFAULT_COMPANY_SETTINGS = {
    "company_name": "Viora Bills",
    "business_address": "101, Business Park, Pune, Maharashtra",
    "gstin": "27AABCU9603R1ZM",
    "phone": "+91 9876543210",
    "email": "contact@viorabills.com",
    "state": "Maharashtra",
    "pincode": "411001",
    "logo_url": None,
    "bank_name": "HDFC Bank",
    "account_holder_name": "Viora Bills Solutions Pvt Ltd",
    "account_number": "50200012345678",
    "ifsc_code": "HDFC0001234",
    "upi_id": "viorabills@upi",
}


def serialize_document(document: dict) -> dict:
    """Return a copy of a MongoDB document with a JSON-safe string ID and normalized dates."""
    def _convert(val):
        if isinstance(val, ObjectId):
            return str(val)
        if isinstance(val, dict):
            return {k: _convert(v) for k, v in val.items()}
        if isinstance(val, list):
            return [_convert(v) for v in val]
        return val

    result = {k: _convert(v) for k, v in document.items()}
    object_id = result.pop("_id", None)
    if object_id is not None:
        result["id"] = str(object_id)
        if "created_at" not in result:
            try:
                result["created_at"] = ObjectId(object_id).generation_time.isoformat()
            except Exception:
                pass
        if "due_date" not in result:
            try:
                result["due_date"] = (ObjectId(object_id).generation_time + timedelta(days=30)).strftime("%Y-%m-%d")
            except Exception:
                pass
        if "invoice_number" not in result:
            result["invoice_number"] = None
    return result


def get_invoice_datetime(invoice: dict) -> datetime:
    if "created_at" in invoice and invoice["created_at"]:
        try:
            return datetime.fromisoformat(str(invoice["created_at"]).replace("Z", "+00:00"))
        except Exception:
            pass
    if "_id" in invoice and isinstance(invoice["_id"], ObjectId):
        return invoice["_id"].generation_time
    return datetime.now(timezone.utc)


def get_invoice_due_date(invoice: dict, inv_dt: datetime) -> datetime:
    if "due_date" in invoice and invoice["due_date"]:
        try:
            return datetime.strptime(str(invoice["due_date"])[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            pass
    return inv_dt + timedelta(days=30)


def valid_object_id(value: str, label: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label} ID.")
    return ObjectId(value)


def clean_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


def get_financial_year(dt: datetime) -> str:
    """Indian Financial Year (April 1 to March 31). E.g. Nov 2026 -> 2026, Feb 2026 -> 2025."""
    if dt.month >= 4:
        return str(dt.year)
    return str(dt.year - 1)


def generate_next_invoice_number(dt: Optional[datetime] = None) -> str:
    """Atomically generate the next sequential invoice number in format VB-YYYY-0001."""
    if dt is None:
        dt = datetime.now(timezone.utc)
    fy = get_financial_year(dt)
    counter = counters_collection.find_one_and_update(
        {"_id": f"invoice_counter_{fy}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = counter.get("seq", 1)
    return f"VB-{fy}-{seq:04d}"


def get_prospective_invoice_number(dt: Optional[datetime] = None) -> dict:
    """Inspect upcoming sequential invoice number without consuming counter sequence."""
    if dt is None:
        dt = datetime.now(timezone.utc)
    fy = get_financial_year(dt)
    counter = counters_collection.find_one({"_id": f"invoice_counter_{fy}"})
    next_seq = (counter.get("seq", 0) + 1) if counter else 1
    return {
        "next_invoice_number": f"VB-{fy}-{next_seq:04d}",
        "financial_year": fy,
    }


def get_next_receipt_number(dt: Optional[datetime] = None) -> str:
    """Atomically generate the next sequential payment receipt number in format REC-YYYY-0001."""
    if dt is None:
        dt = datetime.now(timezone.utc)
    fy = get_financial_year(dt)
    counter = counters_collection.find_one_and_update(
        {"_id": f"receipt_counter_{fy}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = counter.get("seq", 1)
    return f"REC-{fy}-{seq:04d}"


def generate_next_order_number(dt: Optional[datetime] = None) -> str:
    """Atomically generate the next sequential purchase order number in format ORD-YYYY-0001."""
    if dt is None:
        dt = datetime.now(timezone.utc)
    fy = get_financial_year(dt)
    counter = counters_collection.find_one_and_update(
        {"_id": f"order_counter_{fy}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = counter.get("seq", 1)
    return f"ORD-{fy}-{seq:04d}"


_invoice_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
_locks_mutex = threading.Lock()


def get_invoice_lock(invoice_id: str) -> threading.Lock:
    """Thread-safe acquisition of a per-invoice synchronization lock to prevent payment race conditions."""
    with _locks_mutex:
        return _invoice_locks[str(invoice_id)]


def recalculate_invoice_payment_status(invoice_object_id: ObjectId) -> Optional[dict]:
    """
    Recalculates an invoice's total paid amount, outstanding balance, and status
    based on verified and cleared payments in payments_collection.

    Accounting Rules:
    - Successfully received payments: status in ["SUCCESS", "CLEARED"]
    - Uncredited / pending: status in ["PENDING", "PENDING_VERIFICATION", "BOUNCED", "FAILED", "CANCELLED"]
    - Legacy payments without status field default to "SUCCESS"
    """
    invoice = invoices_collection.find_one({"_id": invoice_object_id})
    if not invoice:
        return None

    total_amount = round(float(invoice.get("total_amount", 0)), 2)
    inv_str_id = str(invoice_object_id)

    # Query all payments for this invoice
    all_payments = list(payments_collection.find({"invoice_id": inv_str_id}).sort("created_at", 1))

    total_paid = 0.0
    successful_payments = []
    for p in all_payments:
        st = p.get("status", "SUCCESS")
        if st in ["SUCCESS", "CLEARED"]:
            amt = round(float(p.get("amount", 0)), 2)
            total_paid += amt
            method = p.get("payment_method") or "Not Recorded"
            successful_payments.append({
                "id": str(p["_id"]),
                "payment_method": method,
                "amount": amt,
                "payment_date": p.get("payment_date") or str(p.get("created_at", ""))[:10],
                "reference": p.get("reference") or p.get("transaction_id") or "—",
                "receipt_number": p.get("receipt_number") or "",
                "status": st,
            })

    total_paid = round(total_paid, 2)
    balance_due = max(0.0, round(total_amount - total_paid, 2))

    if balance_due <= 0:
        new_status = "PAID"
    elif total_paid > 0:
        new_status = "PARTIALLY_PAID"
    else:
        new_status = "UNPAID"

    # Compile unique payment modes
    modes = []
    for sp in successful_payments:
        m = sp["payment_method"]
        if m and m not in modes:
            modes.append(m)

    payment_mode_summary = ", ".join(modes) if modes else ("Not Recorded" if total_paid > 0 else None)
    has_pending = any(p.get("status") in ["PENDING", "PENDING_VERIFICATION"] for p in all_payments)

    invoices_collection.update_one(
        {"_id": invoice_object_id},
        {
            "$set": {
                "amount_paid": total_paid,
                "balance_due": balance_due,
                "status": new_status,
                "payment_mode": payment_mode_summary,
                "payment_modes": modes,
                "payments": successful_payments,
                "has_pending_payment": has_pending,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )

    old_status = invoice.get("status")
    if old_status and old_status != new_status:
        log_audit_event(
            actor={"email": "system", "role": "system"},
            action="INVOICE_STATUS_CHANGED",
            module="Invoices",
            resource_type="invoice",
            resource_id=inv_str_id,
            description=f"Invoice {invoice.get('invoice_number', inv_str_id)} status changed from {old_status} to {new_status}.",
            details={
                "invoice_number": invoice.get("invoice_number", inv_str_id),
                "old_status": old_status,
                "new_status": new_status,
                "total_paid": total_paid,
                "balance_due": balance_due,
                "payment_modes": modes,
            },
        )

    updated = invoices_collection.find_one({"_id": invoice_object_id})
    return serialize_document(updated) if updated else None


def verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """
    Verifies Razorpay HMAC SHA256 payment signature using the server secret key.
    Rejects any unverified, simulated, or missing signature.
    """
    secret = RAZORPAY_KEY_SECRET
    if not secret:
        return False
    payload = f"{order_id}|{payment_id}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)



def validate_and_normalize_gstin(
    gstin: Optional[str],
    state_code: Optional[str] = None,
    state: Optional[str] = None,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Validate Indian 15-char GSTIN and ensure state code consistency."""
    if not gstin:
        clean_code = clean_optional(state_code)
        if clean_code and len(clean_code) == 1:
            clean_code = f"0{clean_code}"
        clean_st = clean_optional(state)
        if not clean_st and clean_code:
            clean_st = INDIAN_STATES.get(clean_code)
        return None, clean_code, clean_st

    gstin = gstin.strip().upper()
    if not re.fullmatch(GSTIN_REGEX, gstin):
        raise HTTPException(
            status_code=422,
            detail="Invalid GSTIN format. Expected 15 characters (e.g. 27AABCU9603R1ZM).",
        )

    gst_prefix = gstin[:2]
    clean_code = clean_optional(state_code)
    if clean_code:
        if len(clean_code) == 1:
            clean_code = f"0{clean_code}"
        if clean_code != gst_prefix:
            raise HTTPException(
                status_code=422,
                detail=f"State code '{clean_code}' does not match GSTIN state prefix '{gst_prefix}'.",
            )
    else:
        clean_code = gst_prefix

    clean_st = clean_optional(state)
    if not clean_st:
        clean_st = INDIAN_STATES.get(clean_code)

    return gstin, clean_code, clean_st


def calculate_invoice_taxes(
    items_raw: list[dict],
    discount: float,
    place_of_supply: str,
    company_state: str,
) -> dict:
    """Centralized GST calculation engine supporting intra-state, interstate, multi-rates, and discounts."""
    pos_clean = (place_of_supply or "").strip()
    c_state_clean = (company_state or "").strip()
    is_intra_state = (pos_clean.lower() == c_state_clean.lower()) if (pos_clean and c_state_clean) else True
    supply_type = "Intra-State" if is_intra_state else "Inter-State"

    subtotal = round(sum(it["unit_price"] * it["quantity"] for it in items_raw), 2)
    discount = round(min(discount, subtotal), 2)
    taxable_amount = round(subtotal - discount, 2)

    invoice_items = []
    accumulated_discount = 0.0
    num_items = len(items_raw)

    for i, it in enumerate(items_raw):
        line_subtotal = round(it["unit_price"] * it["quantity"], 2)
        if subtotal > 0 and discount > 0:
            if i == num_items - 1:
                line_discount = round(discount - accumulated_discount, 2)
            else:
                line_discount = round(discount * (line_subtotal / subtotal), 2)
                accumulated_discount += line_discount
        else:
            line_discount = 0.0

        line_taxable = round(line_subtotal - line_discount, 2)
        gst_rate = float(it["gst_rate"])

        if is_intra_state:
            cgst_rate = round(gst_rate / 2.0, 2)
            sgst_rate = round(gst_rate / 2.0, 2)
            igst_rate = 0.0
            line_cgst = round(line_taxable * (cgst_rate / 100.0), 2)
            line_sgst = round(line_taxable * (sgst_rate / 100.0), 2)
            line_igst = 0.0
        else:
            cgst_rate = 0.0
            sgst_rate = 0.0
            igst_rate = round(gst_rate, 2)
            line_cgst = 0.0
            line_sgst = 0.0
            line_igst = round(line_taxable * (igst_rate / 100.0), 2)

        line_gst = round(line_cgst + line_sgst + line_igst, 2)
        line_total = round(line_taxable + line_gst, 2)

        invoice_items.append({
            "product_id": it["product_id"],
            "product_name": it["product_name"],
            "unit": it["unit"],
            "quantity": it["quantity"],
            "unit_price": it["unit_price"],
            "gst_rate": gst_rate,
            "subtotal": line_subtotal,
            "discount": line_discount,
            "taxable_amount": line_taxable,
            "cgst_rate": cgst_rate,
            "cgst_amount": line_cgst,
            "sgst_rate": sgst_rate,
            "sgst_amount": line_sgst,
            "igst_rate": igst_rate,
            "igst_amount": line_igst,
            "gst_amount": line_gst,
            "total": line_total,
        })

    total_cgst = round(sum(it["cgst_amount"] for it in invoice_items), 2)
    total_sgst = round(sum(it["sgst_amount"] for it in invoice_items), 2)
    total_igst = round(sum(it["igst_amount"] for it in invoice_items), 2)
    total_gst = round(total_cgst + total_sgst + total_igst, 2)
    total_amount = round(taxable_amount + total_gst, 2)

    # Compile rate breakdown summary
    rate_map = {}
    for it in invoice_items:
        r = it["gst_rate"]
        if r not in rate_map:
            rate_map[r] = {
                "gst_rate": r,
                "taxable_amount": 0.0,
                "cgst_amount": 0.0,
                "sgst_amount": 0.0,
                "igst_amount": 0.0,
                "tax_amount": 0.0,
            }
        rate_map[r]["taxable_amount"] = round(rate_map[r]["taxable_amount"] + it["taxable_amount"], 2)
        rate_map[r]["cgst_amount"] = round(rate_map[r]["cgst_amount"] + it["cgst_amount"], 2)
        rate_map[r]["sgst_amount"] = round(rate_map[r]["sgst_amount"] + it["sgst_amount"], 2)
        rate_map[r]["igst_amount"] = round(rate_map[r]["igst_amount"] + it["igst_amount"], 2)
        rate_map[r]["tax_amount"] = round(rate_map[r]["tax_amount"] + it["gst_amount"], 2)

    rate_summary = sorted(rate_map.values(), key=lambda x: x["gst_rate"])

    tax_breakdown = {
        "supply_type": supply_type,
        "place_of_supply": pos_clean,
        "company_state": c_state_clean,
        "is_intra_state": is_intra_state,
        "subtotal": subtotal,
        "discount": discount,
        "taxable_amount": taxable_amount,
        "cgst_amount": total_cgst,
        "sgst_amount": total_sgst,
        "igst_amount": total_igst,
        "total_gst": total_gst,
        "total_amount": total_amount,
        "rate_summary": rate_summary,
    }

    return {
        "items": invoice_items,
        "subtotal": subtotal,
        "discount": discount,
        "taxable_amount": taxable_amount,
        "cgst_amount": total_cgst,
        "sgst_amount": total_sgst,
        "igst_amount": total_igst,
        "gst_amount": total_gst,
        "total_amount": total_amount,
        "tax_breakdown": tax_breakdown,
    }


def generate_invoice_pdf(
    invoice: dict,
    customer: Optional[dict],
    company: dict,
    doc_type: str = "INVOICE",
    payment: Optional[dict] = None,
) -> bytes:
    """
    SINGLE SOURCE OF TRUTH for all Viora Bills billing PDFs (Tax Invoices and Payment Receipts).
    Standardized to match the reference design of Invoice-VB-2026-0917.pdf.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=28,
        rightMargin=28,
        topMargin=26,
        bottomMargin=26,
    )

    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        'InvBody',
        parent=styles['Normal'],
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor('#334155'),
    )
    right_style = ParagraphStyle('InvRight', parent=body_style, alignment=TA_RIGHT)
    center_style = ParagraphStyle('InvCenter', parent=body_style, alignment=TA_CENTER)

    story = []

    comp_name = company.get("company_name") or "Viora Bills"
    comp_addr = company.get("business_address") or "101, Business Park, Pune, Maharashtra"
    comp_state = company.get("state") or "Maharashtra"
    comp_pin = company.get("pincode") or "411001"
    comp_phone = company.get("phone") or "+91 9876543210"
    comp_email = company.get("email") or "contact@viorabills.com"
    comp_gstin = company.get("gstin") or ""

    inv_num = invoice.get("invoice_number") or invoice.get("id") or "INV-DRAFT"
    inv_date = str(invoice.get("invoice_date") or invoice.get("created_at") or "")[:10]
    inv_due = str(invoice.get("due_date") or "")[:10]
    inv_status = str(invoice.get("status") or "UNPAID").upper()

    tb = invoice.get("tax_breakdown") or {}
    pos = invoice.get("place_of_supply") or tb.get("place_of_supply") or comp_state
    supply_type = tb.get("supply_type") or ("Intra-State" if pos.strip().lower() == comp_state.strip().lower() else "Inter-State")

    comp_info_html = (
        f"<font size='13' color='#0f172a'><b>{comp_name}</b></font><br/>"
        f"{comp_addr}<br/>"
        f"State: {comp_state}" + (f" — PIN: {comp_pin}" if comp_pin else "") + "<br/>"
        f"Phone: {comp_phone} | Email: {comp_email}<br/>"
        + (f"<b>GSTIN: {comp_gstin}</b>" if comp_gstin else "")
    )

    # Document Type Differentiation (Invoice vs Payment Receipt)
    is_receipt = (doc_type == "PAYMENT_RECEIPT" or payment is not None)
    if is_receipt:
        pay = payment or {}
        rec_num = pay.get("receipt_number") or f"REC-{str(pay.get('_id', pay.get('id', '')))[-6:]}"
        pay_date = str(pay.get("payment_date") or pay.get("created_at") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))[:10]
        pay_method = str(pay.get("payment_method") or "UPI").upper()
        pay_amount = float(pay.get("amount", 0))
        pay_status = str(pay.get("status", "SUCCESS")).upper()
        is_confirmed = pay_status in ["SUCCESS", "CLEARED"]
        is_bounced = pay_status in ["BOUNCED", "FAILED", "REJECTED"]

        if is_confirmed:
            status_label = "PAYMENT CONFIRMED"
            status_color = "#16a34a"
        elif is_bounced:
            status_label = f"BOUNCED: {pay.get('bounce_reason') or 'DISHONOURED'}"
            status_color = "#dc2626"
        else:
            status_label = "PENDING BANK VERIFICATION"
            status_color = "#d97706"

        doc_meta_html = (
            f"<font size='16' color='{status_color}'><b>PAYMENT RECEIPT</b></font><br/><br/>"
            f"<b>Receipt No:</b> <font color='#0f172a'><b>{rec_num}</b></font><br/>"
            f"<b>Related Invoice:</b> <font color='#2563eb'><b>{inv_num}</b></font><br/>"
            f"<b>Payment Date:</b> {pay_date}<br/>"
            f"<b>Payment Mode:</b> <b>{pay_method}</b><br/>"
            f"<b>Status:</b> <font color='{status_color}'><b>{status_label}</b></font>"
        )
    else:
        status_color = "#16a34a" if inv_status == "PAID" else ("#d97706" if "PARTIAL" in inv_status else "#dc2626")
        doc_meta_html = (
            f"<font size='16' color='#2563eb'><b>TAX INVOICE</b></font><br/><br/>"
            f"<b>Invoice No:</b> {inv_num}<br/>"
            f"<b>Invoice Date:</b> {inv_date}<br/>"
            f"<b>Due Date:</b> {inv_due}<br/>"
            f"<b>Place of Supply:</b> {pos}<br/>"
            f"<b>Status:</b> <font color='{status_color}'><b>{inv_status}</b></font>"
        )

    logo_flowable = None
    logo_data = company.get("logo_url")
    if logo_data and isinstance(logo_data, str) and logo_data.startswith("data:image"):
        try:
            comma_idx = logo_data.find(",")
            if comma_idx != -1:
                raw_bytes = base64.b64decode(logo_data[comma_idx + 1:])
                logo_buf = io.BytesIO(raw_bytes)
                logo_flowable = RLImage(logo_buf, width=48, height=48)
        except Exception:
            logo_flowable = None

    if logo_flowable:
        comp_cell = Table([[logo_flowable, Paragraph(comp_info_html, body_style)]], colWidths=[55, 275])
        comp_cell.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0),
        ]))
    else:
        comp_cell = Paragraph(comp_info_html, body_style)

    top_table = Table([[comp_cell, Paragraph(doc_meta_html, right_style)]], colWidths=[330, 209])
    top_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(top_table)
    story.append(HRFlowable(width='100%', thickness=1.5, color=colors.HexColor('#e2e8f0'), spaceAfter=10, spaceBefore=4))

    cust_name = invoice.get("customer_name") or (customer.get("name") if customer else "Valued Customer")
    cust_bname = customer.get("business_name") if customer else None
    cust_addr = customer.get("address") if customer else (customer.get("billing_address") if customer else "")
    cust_state = customer.get("state") if customer else ""
    cust_code = customer.get("state_code") if customer else ""
    cust_pin = customer.get("pincode") if customer else ""
    cust_gstin = customer.get("gstin") if customer else None

    cust_display_name = f"<b>{cust_name}</b>" + (f" ({cust_bname})" if cust_bname else "")
    cust_details_html = (
        f"<b>BILL TO:</b><br/>"
        f"{cust_display_name}<br/>"
        f"{cust_addr or '—'}<br/>"
        f"State: {cust_state or pos}" + (f" (Code: {cust_code})" if cust_code else "") + (f" — PIN: {cust_pin}" if cust_pin else "") + "<br/>"
        + (f"GSTIN: <b>{cust_gstin}</b>" if cust_gstin else "GST Status: <b>Unregistered / B2C</b>")
    )

    if is_receipt:
        pay = payment or {}
        ref_details = []
        if pay.get("reference"):
            ref_details.append(f"Ref/UTR: {pay.get('reference')}")
        if pay.get("cheque_number"):
            ref_details.append(f"Cheque #{pay.get('cheque_number')} ({pay.get('bank_name', 'Bank')})")
        if pay.get("gateway_payment_id"):
            ref_details.append(f"PG ID: {pay.get('gateway_payment_id')}")
        if not ref_details:
            ref_details.append("Cash / Direct Settlement" if "CASH" in pay_method else "Direct Settlement")
        ref_str = " | ".join(ref_details)

        supply_info_html = (
            f"<b>RECEIPT & TRANSACTION DETAILS:</b><br/>"
            f"<b>Payment Mode:</b> {pay_method}<br/>"
            f"<b>Transaction Ref:</b> {ref_str}<br/>"
            f"<b>Place of Supply:</b> {pos}<br/>"
            f"<b>Billing Currency:</b> Indian Rupee (INR — ₹)"
        )
    else:
        supply_info_html = (
            f"<b>SUPPLY INFORMATION:</b><br/>"
            f"<b>Supply Type:</b> {supply_type}<br/>"
            f"<b>Place of Supply:</b> {pos}<br/>"
            f"<b>Reverse Charge:</b> Applicable: No<br/>"
            f"<b>Billing Currency:</b> Indian Rupee (INR — ₹)"
        )

    bill_table = Table([[Paragraph(cust_details_html, body_style), Paragraph(supply_info_html, body_style)]], colWidths=[310, 229])
    bill_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(bill_table)
    story.append(Spacer(1, 10))

    is_intra = (supply_type == "Intra-State")
    if is_intra:
        headers = ['#', 'Item Description', 'Qty', 'Unit Price', 'Taxable Val', 'GST %', 'CGST', 'SGST', 'Total']
        col_widths = [18, 155, 42, 54, 60, 42, 45, 45, 78]
    else:
        headers = ['#', 'Item Description', 'Qty', 'Unit Price', 'Taxable Val', 'GST %', 'IGST', 'Total']
        col_widths = [18, 195, 45, 58, 65, 45, 50, 63]

    item_rows = [headers]
    items = invoice.get("items") or []
    if items:
        for idx, it in enumerate(items, 1):
            pname = it.get("product_name") or "Product"
            qty_unit = f"{it.get('quantity', 1)} {it.get('unit', '')}".strip()
            uprice = f"{float(it.get('unit_price', 0)):,.2f}"
            taxable = f"{float(it.get('taxable_amount', it.get('subtotal', 0))):,.2f}"
            grate = f"{float(it.get('gst_rate', 0)):.1f}%".replace(".0%", "%")
            tot = f"{float(it.get('total', 0)):,.2f}"

            if is_intra:
                cgst_val = f"{float(it.get('cgst_amount', 0)):,.2f}"
                sgst_val = f"{float(it.get('sgst_amount', 0)):,.2f}"
                item_rows.append([str(idx), pname, qty_unit, uprice, taxable, grate, cgst_val, sgst_val, tot])
            else:
                igst_val = f"{float(it.get('igst_amount', it.get('gst_amount', 0))):,.2f}"
                item_rows.append([str(idx), pname, qty_unit, uprice, taxable, grate, igst_val, tot])
    else:
        # Fallback settlement item row if invoice items array is not populated
        tot_amt_val = float(invoice.get("total_amount", payment.get("amount", 0) if payment else 0))
        desc = f"Payment Settlement for Invoice {inv_num}"
        if is_intra:
            item_rows.append(["1", desc, "1 Unit", f"{tot_amt_val:,.2f}", f"{tot_amt_val:,.2f}", "0%", "0.00", "0.00", f"{tot_amt_val:,.2f}"])
        else:
            item_rows.append(["1", desc, "1 Unit", f"{tot_amt_val:,.2f}", f"{tot_amt_val:,.2f}", "0%", "0.00", f"{tot_amt_val:,.2f}"])

    t_items = Table(item_rows, colWidths=col_widths)
    t_items.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1e293b')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('ALIGN', (0,0), (0,-1), 'CENTER'),
        ('ALIGN', (2,0), (-1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f8fafc')]),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_items)
    story.append(Spacer(1, 10))

    b_name = company.get("bank_name") or "—"
    b_holder = company.get("account_holder_name") or comp_name
    b_acc = company.get("account_number") or "—"
    b_ifsc = company.get("ifsc_code") or "—"
    b_upi = company.get("upi_id") or ""

    bal_due = float(invoice.get("balance_due", 0))
    tot_amt = float(invoice.get("total_amount", 0))
    amt_paid = float(invoice.get("amount_paid", 0))
    subtotal = float(invoice.get("subtotal", 0))
    discount = float(invoice.get("discount", 0))
    taxable_val = float(invoice.get("taxable_amount", subtotal - discount))

    qr_flowable = None
    if b_upi:
        try:
            pay_amt = bal_due if bal_due > 0 else tot_amt
            inv_ref = invoice.get("invoice_number") or invoice.get("id") or "INV"
            encoded_comp_name = urllib.parse.quote(str(comp_name))
            encoded_note = urllib.parse.quote(f"Invoice {inv_ref}")
            encoded_ref = urllib.parse.quote(str(inv_ref))
            upi_uri = f"upi://pay?pa={b_upi}&pn={encoded_comp_name}&am={pay_amt:.2f}&cu=INR&tr={encoded_ref}&tn={encoded_note}"
            qr = qrcode.QRCode(box_size=4, border=1)
            qr.add_data(upi_uri)
            qr.make(fit=True)
            qr_img = qr.make_image(fill_color="black", back_color="white")
            qr_buf = io.BytesIO()
            qr_img.save(qr_buf, format="PNG")
            qr_buf.seek(0)
            qr_flowable = RLImage(qr_buf, width=68, height=68)
        except Exception:
            qr_flowable = None

    bank_html = (
        f"<b>BANK PAYMENT DETAILS:</b><br/>"
        f"Bank: <b>{b_name}</b><br/>"
        f"A/C Name: {b_holder}<br/>"
        f"A/C No: <b>{b_acc}</b><br/>"
        f"IFSC Code: <b>{b_ifsc}</b><br/>"
        + (f"UPI ID: <b>{b_upi}</b>" if b_upi else "UPI ID: Not configured")
    )
    bank_p = Paragraph(bank_html, body_style)

    if qr_flowable:
        qr_caption = Paragraph("<font size='7' color='#64748b'>Scan & Pay via UPI</font>", center_style)
        qr_box = Table([[qr_flowable], [qr_caption]], colWidths=[74])
        qr_box.setStyle(TableStyle([
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ]))
        b_table = Table([[bank_p, qr_box]], colWidths=[185, 78])
    else:
        b_table = Table([[bank_p]], colWidths=[263])

    b_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
        ('PADDING', (0,0), (-1,-1), 6),
    ]))

    totals_data = [
        ['Subtotal:', f"{subtotal:,.2f}"],
        ['Discount:', f"− {discount:,.2f}"],
        ['Taxable Amount:', f"{taxable_val:,.2f}"],
    ]
    if is_intra:
        cgst_tot = float(tb.get("cgst_amount", float(invoice.get("gst_amount", 0)) / 2.0))
        sgst_tot = float(tb.get("sgst_amount", float(invoice.get("gst_amount", 0)) - cgst_tot))
        totals_data.append(['CGST Total:', f"+ {cgst_tot:,.2f}"])
        totals_data.append(['SGST Total:', f"+ {sgst_tot:,.2f}"])
    else:
        igst_tot = float(tb.get("igst_amount", invoice.get("gst_amount", 0)))
        totals_data.append(['IGST Total:', f"+ {igst_tot:,.2f}"])

    totals_data.append(['Total Invoice Amount:', f"₹ {tot_amt:,.2f}"])

    if is_receipt:
        pay = payment or {}
        pay_amount_val = float(pay.get("amount", 0))
        rem_balance = bal_due
        prev_balance = round(rem_balance + pay_amount_val, 2)
        totals_data.append(['Amount Received (This Receipt):', f"₹ {pay_amount_val:,.2f}"])
        totals_data.append(['Previous Outstanding Balance:', f"₹ {prev_balance:,.2f}"])
        totals_data.append(['Remaining Balance Due:', f"₹ {rem_balance:,.2f}"])
    else:
        totals_data.append(['Amount Paid:', f"₹ {amt_paid:,.2f}"])
        totals_data.append(['Balance Due:', f"₹ {bal_due:,.2f}"])

    num_rows = len(totals_data)
    inv_line_idx = num_rows - 4 if is_receipt else num_rows - 3
    t_totals = Table(totals_data, colWidths=[145, 115])
    t_totals_style = [
        ('ALIGN', (0,0), (0,-1), 'LEFT'),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 2.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2.5),
        ('LINEABOVE', (0, inv_line_idx), (-1, inv_line_idx), 1, colors.HexColor('#cbd5e1')),
        ('FONTNAME', (0, inv_line_idx), (-1, inv_line_idx), 'Helvetica-Bold'),
        ('FONTSIZE', (0, inv_line_idx), (-1, inv_line_idx), 9),
        ('LINEBELOW', (0, inv_line_idx), (-1, inv_line_idx), 1, colors.HexColor('#cbd5e1')),
        ('LINEABOVE', (0, num_rows - 1), (-1, num_rows - 1), 1, colors.HexColor('#cbd5e1')),
        ('FONTNAME', (0, num_rows - 1), (-1, num_rows - 1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, num_rows - 1), (-1, num_rows - 1), 9.5),
        ('TEXTCOLOR', (0, num_rows - 1), (-1, num_rows - 1), colors.HexColor('#dc2626') if bal_due > 0 else colors.HexColor('#16a34a')),
    ]
    if is_receipt:
        rec_line_idx = num_rows - 3
        t_totals_style.extend([
            ('FONTNAME', (0, rec_line_idx), (-1, rec_line_idx), 'Helvetica-Bold'),
            ('TEXTCOLOR', (0, rec_line_idx), (-1, rec_line_idx), colors.HexColor('#16a34a')),
        ])
    t_totals.setStyle(TableStyle(t_totals_style))

    bottom_summary = Table([[b_table, t_totals]], colWidths=[269, 270])
    bottom_summary.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(bottom_summary)

    # -------------------------------------------------------------
    # Payment Information & Payment History Section
    # -------------------------------------------------------------
    payments_list = invoice.get("payments")
    if payments_list is None:
        inv_id_val = str(invoice.get("id") or invoice.get("_id") or "")
        if inv_id_val:
            try:
                raw_p = list(payments_collection.find({"invoice_id": inv_id_val}).sort("created_at", 1))
                payments_list = [
                    {
                        "payment_method": p.get("payment_method") or "Not Recorded",
                        "amount": float(p.get("amount", 0)),
                        "payment_date": p.get("payment_date") or str(p.get("created_at", ""))[:10],
                        "reference": p.get("reference") or p.get("transaction_id") or "—",
                        "receipt_number": p.get("receipt_number") or "",
                        "status": p.get("status", "SUCCESS"),
                    }
                    for p in raw_p
                ]
            except Exception:
                payments_list = []
        else:
            payments_list = []

    # Successful/verified payments only
    valid_payments = [p for p in (payments_list or []) if p.get("status", "SUCCESS") in ["SUCCESS", "CLEARED"]]

    if is_receipt:
        pay = payment or {}
        pay_amount_val = float(pay.get("amount", 0))
        pay_method_val = str(pay.get("payment_method", "UPI")).upper()
        ref_val = pay.get("reference") or pay.get("cheque_number") or pay.get("gateway_payment_id") or "Direct Settlement"
        rec_status_color = "#16a34a" if is_confirmed else ("#dc2626" if is_bounced else "#d97706")
        pay_summary_html = (
            f"<b>PAYMENT RECEIPT:</b> &nbsp;&nbsp;&nbsp;&nbsp;"
            f"Receipt No: <b>{rec_num}</b> &nbsp;|&nbsp; "
            f"Mode: <b>{pay_method_val}</b> &nbsp;|&nbsp; "
            f"Reference: <b>{ref_val}</b> &nbsp;|&nbsp; "
            f"Amount Received: <font color='{rec_status_color}'><b>₹ {pay_amount_val:,.2f}</b></font> &nbsp;|&nbsp; "
            f"Remaining Balance: <b>₹ {bal_due:,.2f}</b>"
        )
    else:
        if valid_payments:
            modes_seen = []
            for vp in valid_payments:
                m = vp.get("payment_method") or "Not Recorded"
                if m not in modes_seen:
                    modes_seen.append(m)
            pmode_str = ", ".join(modes_seen)
        elif amt_paid > 0:
            pmode_str = invoice.get("payment_mode") or "Not Recorded"
        else:
            pmode_str = "None (Awaiting Payment)"

        status_color = "#16a34a" if inv_status == "PAID" else ("#d97706" if "PARTIAL" in inv_status else "#dc2626")
        pay_summary_html = (
            f"<b>PAYMENT INFORMATION:</b> &nbsp;&nbsp;&nbsp;&nbsp;"
            f"Status: <font color='{status_color}'><b>{inv_status}</b></font> &nbsp;|&nbsp; "
            f"Payment Mode: <b>{pmode_str}</b> &nbsp;|&nbsp; "
            f"Amount Paid: <b>₹ {amt_paid:,.2f}</b> &nbsp;|&nbsp; "
            f"Balance Due: <b>₹ {bal_due:,.2f}</b>"
        )

    pay_story_cells = [[Paragraph(pay_summary_html, body_style)]]

    # Show verified payments table
    display_payments = valid_payments if valid_payments else ([payment] if payment else [])
    if display_payments:
        p_rows = [["Date", "Payment Mode", "Reference / UTR", "Receipt #", "Amount Paid"]]
        for vp in display_payments:
            p_rows.append([
                str(vp.get("payment_date", "—")),
                str(vp.get("payment_method", "Not Recorded")),
                str(vp.get("reference", "—")),
                str(vp.get("receipt_number", "—")),
                f"₹ {float(vp.get('amount', 0)):,.2f}",
            ])
        p_table = Table(p_rows, colWidths=[85, 120, 140, 100, 94])
        p_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f1f5f9')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.HexColor('#0f172a')),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 7.5),
            ('ALIGN', (0,0), (0,-1), 'LEFT'),
            ('ALIGN', (-1,0), (-1,-1), 'RIGHT'),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ]))
        pay_story_cells.append([p_table])

    t_payment_box = Table(pay_story_cells, colWidths=[539])
    t_payment_box.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f8fafc')),
        ('PADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(Spacer(1, 10))
    story.append(t_payment_box)

    if is_receipt:
        pay = payment or {}
        rec_by = pay.get("recorded_by_name") or pay.get("recorded_by") or "Staff"
        sign_table = Table([[
            Paragraph(f"<b>Recorded by:</b> {rec_by}<br/><b>Verification Mode:</b> {pay.get('payment_method', 'Online')}", body_style),
            Paragraph(f"For <b>{comp_name}</b><br/><br/><br/><b>Authorized Signatory</b>", right_style),
        ]], colWidths=[270, 269])
        story.append(Spacer(1, 10))
        story.append(sign_table)
        story.append(Spacer(1, 10))
        story.append(Paragraph(
            "<i>This is a computer-generated digital payment receipt issued by Viora Bills in accordance with the Goods and Services Tax Act. Retain for tax & accounting records.</i>",
            ParagraphStyle('Footer', parent=body_style, alignment=TA_CENTER, textColor=colors.HexColor('#94a3b8'), fontSize=7.5),
        ))
    else:
        story.append(Spacer(1, 14))
        story.append(Paragraph(
            "<i>This is a computer-generated tax invoice issued in accordance with the Goods and Services Tax Act. Thank you for your business!</i>",
            ParagraphStyle('Footer', parent=body_style, alignment=TA_CENTER, textColor=colors.HexColor('#94a3b8'), fontSize=7.5),
        ))

    doc.build(story)
    return buffer.getvalue()


def generate_payment_receipt_pdf(payment: dict, invoice: dict, customer: dict, company: dict) -> bytes:
    """Generate high-fidelity, printable A4 payment receipt PDF using standardized invoice visual template."""
    return generate_invoice_pdf(
        invoice=invoice or {},
        customer=customer or {},
        company=company or {},
        doc_type="PAYMENT_RECEIPT",
        payment=payment,
    )


def generate_order_pdf(order: dict, customer: dict, company: dict) -> bytes:
    """Generate clean, printable A4 Purchase Order / Summary PDF."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=28,
        rightMargin=28,
        topMargin=26,
        bottomMargin=26,
    )

    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        'OrderBody',
        parent=styles['Normal'],
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor('#334155'),
    )
    right_style = ParagraphStyle('OrderRight', parent=body_style, alignment=TA_RIGHT)
    center_style = ParagraphStyle('OrderCenter', parent=body_style, alignment=TA_CENTER)

    story = []

    comp_name = company.get("company_name") or "Viora Bills"
    comp_addr = company.get("business_address") or "101, Business Park, Pune, Maharashtra"
    comp_state = company.get("state") or "Maharashtra"
    comp_pin = company.get("pincode") or "411001"
    comp_phone = company.get("phone") or "+91 9876543210"
    comp_email = company.get("email") or "billing@viorabills.com"
    comp_gstin = company.get("gstin") or ""

    ord_num = order.get("order_number") or f"ORD-{str(order.get('_id', order.get('id', '')))[-6:]}"
    ord_date = str(order.get("created_at") or "")[:10]
    ord_status = str(order.get("status") or "PENDING").upper()
    has_invoice = bool(order.get("invoice_id"))
    inv_ref = order.get("invoice_number") or ""

    comp_info_html = (
        f"<font size='13' color='#0f172a'><b>{comp_name}</b></font><br/>"
        f"{comp_addr}<br/>"
        f"State: {comp_state}" + (f" — PIN: {comp_pin}" if comp_pin else "") + "<br/>"
        f"Phone: {comp_phone} | Email: {comp_email}<br/>"
        + (f"<b>GSTIN: {comp_gstin}</b>" if comp_gstin else "")
    )

    doc_title = "TAX INVOICE ATTACHED ORDER" if has_invoice else "PURCHASE ORDER SUMMARY"
    title_color = "#2563eb" if has_invoice else "#475569"

    meta_html = (
        f"<font size='14' color='{title_color}'><b>{doc_title}</b></font><br/>"
        f"<font size='8' color='#64748b'><i>{'Billed Tax Document' if has_invoice else 'Document Type: Purchase Summary (Not a Tax Invoice)'}</i></font><br/><br/>"
        f"<b>Order No:</b> <font color='#1e293b'><b>{ord_num}</b></font><br/>"
        f"<b>Order Date:</b> {ord_date}<br/>"
        + (f"<b>Tax Invoice Ref:</b> <font color='#2563eb'><b>{inv_ref}</b></font><br/>" if has_invoice else "")
        + f"<b>Order Status:</b> <b>{ord_status}</b>"
    )

    logo_flowable = None
    logo_data = company.get("logo_url")
    if logo_data and isinstance(logo_data, str) and logo_data.startswith("data:image"):
        try:
            comma_idx = logo_data.find(",")
            if comma_idx != -1:
                raw_bytes = base64.b64decode(logo_data[comma_idx + 1:])
                logo_buf = io.BytesIO(raw_bytes)
                logo_flowable = RLImage(logo_buf, width=48, height=48)
        except Exception:
            logo_flowable = None

    if logo_flowable:
        comp_cell = Table([[logo_flowable, Paragraph(comp_info_html, body_style)]], colWidths=[55, 275])
        comp_cell.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0),
        ]))
    else:
        comp_cell = Paragraph(comp_info_html, body_style)

    top_table = Table([[comp_cell, Paragraph(meta_html, right_style)]], colWidths=[330, 209])
    top_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(top_table)
    story.append(HRFlowable(width='100%', thickness=1.5, color=colors.HexColor('#e2e8f0'), spaceAfter=10, spaceBefore=4))

    cust_name = customer.get("name") or order.get("customer_name") or "Valued Customer"
    cust_bname = customer.get("business_name")
    cust_addr = customer.get("address") or customer.get("billing_address") or order.get("delivery_address") or ""
    cust_phone = customer.get("phone") or ""
    cust_email = customer.get("email") or ""
    cust_gstin = customer.get("gstin")

    cust_display = f"<b>{cust_name}</b>" + (f" ({cust_bname})" if cust_bname else "")
    cust_html = (
        f"<b>ORDER PLACED BY:</b><br/>"
        f"{cust_display}<br/>"
        f"Delivery / Billing: {cust_addr or '—'}<br/>"
        + (f"Phone: {cust_phone} | Email: {cust_email}<br/>" if cust_phone or cust_email else "")
        + (f"GSTIN: <b>{cust_gstin}</b>" if cust_gstin else "GST Status: <b>Unregistered / B2C</b>")
    )

    order_details_html = (
        f"<b>DELIVERY & FULFILLMENT:</b><br/>"
        f"<b>Order Status:</b> {ord_status}<br/>"
        f"<b>Delivery Notes:</b> {order.get('delivery_notes') or 'Standard dispatch'}<br/>"
        f"<b>Billing Currency:</b> Indian Rupee (INR — ₹)"
    )

    parties_table = Table([[Paragraph(cust_html, body_style), Paragraph(order_details_html, body_style)]], colWidths=[310, 229])
    parties_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(parties_table)
    story.append(Spacer(1, 12))

    headers = ['#', 'Product Item', 'Qty', 'Unit Price', 'GST Rate', 'Line Total']
    col_widths = [24, 215, 60, 80, 60, 100]

    item_rows = [headers]
    items = order.get("items") or []
    subtotal = float(order.get("subtotal", 0))
    gst_total = float(order.get("gst_amount", 0))
    grand_total = float(order.get("grand_total", order.get("total_amount", subtotal + gst_total)))

    for idx, it in enumerate(items, 1):
        pname = it.get("name") or it.get("product_name") or "Product"
        qty = it.get("quantity", 1)
        uprice = float(it.get("unit_price", it.get("price", 0)))
        grate = float(it.get("gst_rate", 0))
        tot = float(it.get("total", it.get("line_total", uprice * qty * (1 + grate / 100.0))))
        item_rows.append([str(idx), pname, str(qty), f"₹ {uprice:,.2f}", f"{grate:g}%", f"₹ {tot:,.2f}"])

    t_items = Table(item_rows, colWidths=col_widths)
    t_items.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1e293b')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('ALIGN', (0,0), (-1,0), 'LEFT'),
        ('ALIGN', (2,0), (-1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f8fafc')]),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_items)
    story.append(Spacer(1, 12))

    totals_data = [
        ['Subtotal (Excl. Tax):', f"₹ {subtotal:,.2f}"],
        ['Estimated GST Total:', f"₹ {gst_total:,.2f}"],
        ['Order Grand Total:', f"₹ {grand_total:,.2f}"],
    ]
    t_totals = Table(totals_data, colWidths=[380, 159])
    t_totals.setStyle(TableStyle([
        ('ALIGN', (0,0), (0,-1), 'LEFT'),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('FONTSIZE', (0,0), (-1,-1), 8.5),
        ('PADDING', (0,0), (-1,-1), 3),
        ('FONTNAME', (0,2), (-1,2), 'Helvetica-Bold'),
        ('FONTSIZE', (0,2), (-1,2), 9.5),
        ('TEXTCOLOR', (0,2), (-1,2), colors.HexColor('#2563eb')),
        ('LINEABOVE', (0,2), (-1,2), 1, colors.HexColor('#cbd5e1')),
    ]))
    story.append(t_totals)
    story.append(Spacer(1, 14))

    story.append(Paragraph(
        "<i>This purchase summary reflects customer purchase order submissions. Official tax invoices with GST input credits are issued upon management approval.</i>",
        center_style,
    ))

    doc.build(story)
    return buffer.getvalue()


# -------------------------
# General / health endpoints
# -------------------------

# ---------------------------------------------------------------------------
# Automated Invoice & Payment Receipt Email Delivery Service
# ---------------------------------------------------------------------------

def dispatch_invoice_email(invoice_id: str, is_retry: bool = False) -> bool:
    """
    Asynchronously generates and emails the official invoice PDF to the customer upon invoice generation.
    Enforces idempotency to prevent duplicate emails for the same invoice unless explicitly retried.
    Logs delivery status, attempts, and error details in email_delivery_logs.
    """
    idempotency_key = f"INVOICE:{invoice_id}"
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Idempotency Check
    if not is_retry:
        existing = email_delivery_logs_collection.find_one({
            "email_type": "INVOICE",
            "related_invoice_id": invoice_id,
            "delivery_status": "SENT",
        })
        if existing:
            logger.info(f"[EMAIL_DISPATCH] Invoice email already sent for invoice {invoice_id}. Skipping duplicate.")
            return True

    # 2. Fetch Invoice
    try:
        inv_obj_id = valid_object_id(invoice_id, "invoice")
        invoice = invoices_collection.find_one({"_id": inv_obj_id})
    except Exception as e:
        logger.error(f"[EMAIL_DISPATCH] Invalid invoice ID {invoice_id}: {e}")
        return False

    if not invoice:
        logger.error(f"[EMAIL_DISPATCH] Invoice record not found for {invoice_id}")
        return False

    # 3. Resolve Customer & Email
    cust_id = invoice.get("customer_id")
    customer = None
    if cust_id:
        try:
            c_oid = ObjectId(cust_id) if ObjectId.is_valid(cust_id) else cust_id
            customer = customers_collection.find_one({"_id": c_oid})
        except Exception:
            customer = None

    recipient_email = (customer.get("email") if customer else None) or ""
    if not recipient_email and cust_id:
        user_match = users_collection.find_one({"customer_id": str(cust_id)})
        if user_match:
            recipient_email = user_match.get("email", "")
    recipient_email = recipient_email.strip().lower()

    customer_name = invoice.get("customer_name") or (customer.get("name") if customer else "Valued Client")
    inv_number = invoice.get("invoice_number", f"INV-{invoice_id[-6:]}")
    subject = f"Your Viora Bills Invoice – {inv_number}"

    # 4. Upsert Email Delivery Log Record
    existing_log = email_delivery_logs_collection.find_one({"idempotency_key": idempotency_key})
    if not existing_log:
        log_doc = {
            "email_id": f"eml_{secrets.token_hex(8)}",
            "customer_id": str(cust_id) if cust_id else None,
            "customer_name": customer_name,
            "recipient_email": recipient_email,
            "email_type": "INVOICE",
            "related_invoice_id": invoice_id,
            "related_payment_id": None,
            "reference_number": inv_number,
            "subject": subject,
            "delivery_status": "PENDING",
            "attempts": 1,
            "last_error": None,
            "idempotency_key": idempotency_key,
            "created_at": now_iso,
            "sent_at": None,
            "updated_at": now_iso,
        }
        ins_res = email_delivery_logs_collection.insert_one(log_doc)
        log_oid = ins_res.inserted_id
    else:
        log_oid = existing_log["_id"]
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {
                "$inc": {"attempts": 1},
                "$set": {
                    "delivery_status": "PENDING",
                    "recipient_email": recipient_email,
                    "updated_at": now_iso,
                },
            },
        )

    # 5. Handle missing recipient email
    if not recipient_email or "@" not in recipient_email:
        err_msg = "Customer has no valid registered email address in database."
        logger.warning(f"[EMAIL_DISPATCH] {err_msg} for invoice {inv_number}")
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {"$set": {"delivery_status": "FAILED", "last_error": err_msg, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return False

    # 6. Generate Invoice PDF
    company = company_settings_collection.find_one() or DEFAULT_COMPANY_SETTINGS
    company_name = company.get("company_name", "Viora Bills")
    try:
        serialized_inv = serialize_document(invoice)
        pdf_bytes = generate_invoice_pdf(serialized_inv, customer, company)
    except Exception as pdf_err:
        err_msg = f"Failed to generate invoice PDF attachment: {str(pdf_err)}"
        logger.error(f"[EMAIL_DISPATCH] {err_msg}")
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {"$set": {"delivery_status": "FAILED", "last_error": err_msg, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return False

    # 7. Build Professional HTML and Text Email Templates
    inv_date = invoice.get("invoice_date", now_iso[:10])
    due_date = invoice.get("due_date", "Upon Receipt")
    total_amount = float(invoice.get("total_amount", 0.0))

    html_content = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
        <div style="text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px;">
            <div style="font-size: 24px; font-weight: 800; color: #1e3a8a; letter-spacing: 0.5px;">{company_name}</div>
            <p style="margin: 4px 0 0; font-size: 13px; color: #64748b;">Official Tax Invoice & Billing Notification</p>
        </div>
        <p style="font-size: 15px; color: #334155; margin: 0 0 16px;">Dear <strong>{customer_name}</strong>,</p>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px;">
            Your new tax invoice <strong>{inv_number}</strong> has been generated and is attached to this email as a PDF.
        </p>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                    <td style="padding: 6px 0; color: #64748b;">Invoice Number:</td>
                    <td style="padding: 6px 0; font-weight: 700; color: #0f172a; text-align: right;">{inv_number}</td>
                </tr>
                <tr>
                    <td style="padding: 6px 0; color: #64748b;">Invoice Date:</td>
                    <td style="padding: 6px 0; font-weight: 600; color: #0f172a; text-align: right;">{inv_date}</td>
                </tr>
                <tr>
                    <td style="padding: 6px 0; color: #64748b;">Payment Due Date:</td>
                    <td style="padding: 6px 0; font-weight: 600; color: #dc2626; text-align: right;">{due_date}</td>
                </tr>
                <tr style="border-top: 1px solid #cbd5e1;">
                    <td style="padding: 10px 0 4px; font-weight: 700; color: #0f172a; font-size: 15px;">Total Amount:</td>
                    <td style="padding: 10px 0 4px; font-weight: 800; color: #1e3a8a; font-size: 17px; text-align: right;">₹{total_amount:,.2f}</td>
                </tr>
            </table>
        </div>
        <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0 0 20px;">
            📎 An authentic, GST-compliant invoice PDF is attached for your records and accounting. You can also view, pay online, or download this invoice from your <a href="http://localhost:5173/customer/invoices" style="color: #2563eb; text-decoration: underline;">Customer Portal</a>.
        </p>
        <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center;">
            Thank you for your business! If you have any billing inquiries, please contact our support team.
        </div>
    </div>
    """

    text_content = (
        f"Dear {customer_name},\n\n"
        f"Your tax invoice {inv_number} of ₹{total_amount:,.2f} from {company_name} has been generated.\n\n"
        f"Invoice Date: {inv_date}\n"
        f"Due Date: {due_date}\n"
        f"Total Due: ₹{total_amount:,.2f}\n\n"
        f"The official invoice PDF is attached to this email. You can also access your account at http://localhost:5173/customer/invoices\n\n"
        f"Thank you for choosing {company_name}."
    )

    attachments = [{
        "filename": f"Invoice_{inv_number}.pdf",
        "content": pdf_bytes,
        "content_type": "application/pdf",
    }]

    # 8. Dispatch Email via Authenticated SMTP
    try:
        dispatched = send_email(
            to_email=recipient_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            attachments=attachments,
        )
        send_exc = None
    except Exception as exc:
        dispatched = False
        send_exc = exc

    now_done_iso = datetime.now(timezone.utc).isoformat()
    if dispatched:
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {"$set": {"delivery_status": "SENT", "sent_at": now_done_iso, "last_error": None, "updated_at": now_done_iso}},
        )
        logger.info(f"[EMAIL_DISPATCH] Successfully delivered invoice email {inv_number} to {recipient_email}")
        return True
    else:
        err_msg = f"SMTP delivery failed: {send_exc}" if send_exc else "SMTP delivery failed. Check SMTP configuration in backend/.env."
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {"$set": {"delivery_status": "FAILED", "last_error": err_msg, "updated_at": now_done_iso}},
        )
        logger.warning(f"[EMAIL_DISPATCH] Failed to deliver invoice email {inv_number} to {recipient_email}")
        return False


def dispatch_payment_receipt_email(payment_id: str, is_retry: bool = False) -> bool:
    """
    Asynchronously generates and emails the official payment receipt PDF to the customer
    whenever a payment is verified in a genuinely eligible status: SUCCESS or CLEARED.
    Pending, unverified, failed, or bounced payments are never dispatched.
    Enforces idempotency to prevent duplicate receipt emails for the same payment unless retried.
    Logs delivery status, attempts, and error details in email_delivery_logs.
    """
    idempotency_key = f"PAYMENT_RECEIPT:{payment_id}"
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Fetch Payment
    try:
        pay_obj_id = valid_object_id(payment_id, "payment")
        payment = payments_collection.find_one({"_id": pay_obj_id})
    except Exception as e:
        logger.error(f"[EMAIL_DISPATCH] Invalid payment ID {payment_id}: {e}")
        return False

    if not payment:
        logger.error(f"[EMAIL_DISPATCH] Payment record not found for {payment_id}")
        return False

    # 2. Status Eligibility Check: ONLY SUCCESS or CLEARED
    status = (payment.get("status") or "").upper()
    if status not in ("SUCCESS", "CLEARED"):
        logger.info(f"[EMAIL_DISPATCH] Payment {payment_id} has status '{status}'. Ineligible for receipt email.")
        return False

    # 3. Idempotency Check
    if not is_retry:
        existing = email_delivery_logs_collection.find_one({
            "email_type": "PAYMENT_RECEIPT",
            "related_payment_id": payment_id,
            "delivery_status": "SENT",
        })
        if existing:
            logger.info(f"[EMAIL_DISPATCH] Payment receipt email already sent for payment {payment_id}. Skipping duplicate.")
            return True

    # 4. Resolve Invoice and Customer
    invoice_id = payment.get("invoice_id")
    invoice = None
    if invoice_id:
        try:
            inv_obj_id = valid_object_id(invoice_id, "invoice")
            invoice = invoices_collection.find_one({"_id": inv_obj_id})
        except Exception:
            invoice = None

    cust_id = payment.get("customer_id") or (invoice.get("customer_id") if invoice else None)
    customer = None
    if cust_id:
        try:
            c_oid = ObjectId(cust_id) if ObjectId.is_valid(cust_id) else cust_id
            customer = customers_collection.find_one({"_id": c_oid})
        except Exception:
            customer = None

    recipient_email = (customer.get("email") if customer else None) or ""
    if not recipient_email and cust_id:
        user_match = users_collection.find_one({"customer_id": str(cust_id)})
        if user_match:
            recipient_email = user_match.get("email", "")
    recipient_email = recipient_email.strip().lower()

    customer_name = (
        payment.get("customer_name")
        or (customer.get("name") if customer else None)
        or (invoice.get("customer_name") if invoice else "Valued Client")
    )
    rec_number = payment.get("receipt_number") or f"REC-{payment_id[-6:]}"
    inv_number = payment.get("invoice_number") or (invoice.get("invoice_number") if invoice else "N/A")
    subject = f"Payment Receipt – Viora Bills – {rec_number}"

    # 5. Upsert Email Delivery Log Record
    existing_log = email_delivery_logs_collection.find_one({"idempotency_key": idempotency_key})
    if not existing_log:
        log_doc = {
            "email_id": f"eml_{secrets.token_hex(8)}",
            "customer_id": str(cust_id) if cust_id else None,
            "customer_name": customer_name,
            "recipient_email": recipient_email,
            "email_type": "PAYMENT_RECEIPT",
            "related_invoice_id": invoice_id,
            "related_payment_id": payment_id,
            "reference_number": rec_number,
            "subject": subject,
            "delivery_status": "PENDING",
            "attempts": 1,
            "last_error": None,
            "idempotency_key": idempotency_key,
            "created_at": now_iso,
            "sent_at": None,
            "updated_at": now_iso,
        }
        ins_res = email_delivery_logs_collection.insert_one(log_doc)
        log_oid = ins_res.inserted_id
    else:
        log_oid = existing_log["_id"]
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {
                "$inc": {"attempts": 1},
                "$set": {
                    "delivery_status": "PENDING",
                    "recipient_email": recipient_email,
                    "updated_at": now_iso,
                },
            },
        )

    # 6. Handle missing recipient email
    if not recipient_email or "@" not in recipient_email:
        err_msg = "Customer has no valid registered email address in database."
        logger.warning(f"[EMAIL_DISPATCH] {err_msg} for payment receipt {rec_number}")
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {"$set": {"delivery_status": "FAILED", "last_error": err_msg, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return False

    # 7. Generate Payment Receipt PDF
    company = company_settings_collection.find_one() or DEFAULT_COMPANY_SETTINGS
    company_name = company.get("company_name", "Viora Bills")
    try:
        pdf_bytes = generate_payment_receipt_pdf(payment, invoice or {}, customer or {}, company)
    except Exception as pdf_err:
        err_msg = f"Failed to generate receipt PDF attachment: {str(pdf_err)}"
        logger.error(f"[EMAIL_DISPATCH] {err_msg}")
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {"$set": {"delivery_status": "FAILED", "last_error": err_msg, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return False

    # 8. Build Professional HTML and Text Email Templates
    pay_amount = float(payment.get("amount", 0.0))
    pay_method = payment.get("payment_method", "Payment")
    pay_ref = payment.get("reference") or payment.get("cheque_number") or payment.get("gateway_payment_id") or "N/A"
    pay_date = payment.get("payment_date", now_iso[:10])
    balance_due = float(invoice.get("balance_due", 0.0)) if invoice else 0.0

    html_content = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background-color: #ffffff;">
        <div style="text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 16px; margin-bottom: 24px;">
            <div style="font-size: 24px; font-weight: 800; color: #166534; letter-spacing: 0.5px;">{company_name}</div>
            <p style="margin: 4px 0 0; font-size: 13px; color: #64748b;">Official Payment Receipt & Acknowledgment</p>
        </div>
        <p style="font-size: 15px; color: #334155; margin: 0 0 16px;">Dear <strong>{customer_name}</strong>,</p>
        <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px;">
            Thank you! We have received and verified your payment of <strong>₹{pay_amount:,.2f}</strong> for Invoice <strong>{inv_number}</strong>.
        </p>
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 18px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                    <td style="padding: 6px 0; color: #64748b;">Receipt Number:</td>
                    <td style="padding: 6px 0; font-weight: 700; color: #166534; text-align: right;">{rec_number}</td>
                </tr>
                <tr>
                    <td style="padding: 6px 0; color: #64748b;">Invoice Reference:</td>
                    <td style="padding: 6px 0; font-weight: 600; color: #0f172a; text-align: right;">{inv_number}</td>
                </tr>
                <tr>
                    <td style="padding: 6px 0; color: #64748b;">Payment Date:</td>
                    <td style="padding: 6px 0; font-weight: 600; color: #0f172a; text-align: right;">{pay_date}</td>
                </tr>
                <tr>
                    <td style="padding: 6px 0; color: #64748b;">Payment Method:</td>
                    <td style="padding: 6px 0; font-weight: 600; color: #0f172a; text-align: right;">{pay_method}</td>
                </tr>
                <tr>
                    <td style="padding: 6px 0; color: #64748b;">Transaction Reference:</td>
                    <td style="padding: 6px 0; font-family: monospace; color: #334155; text-align: right;">{pay_ref}</td>
                </tr>
                <tr style="border-top: 1px solid #86efac;">
                    <td style="padding: 10px 0 4px; font-weight: 700; color: #166534; font-size: 15px;">Amount Paid:</td>
                    <td style="padding: 10px 0 4px; font-weight: 800; color: #15803d; font-size: 17px; text-align: right;">₹{pay_amount:,.2f}</td>
                </tr>
                <tr>
                    <td style="padding: 4px 0; color: #64748b; font-size: 12px;">Remaining Balance Due:</td>
                    <td style="padding: 4px 0; font-weight: 600; color: #64748b; font-size: 12px; text-align: right;">₹{balance_due:,.2f}</td>
                </tr>
            </table>
        </div>
        <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0 0 20px;">
            📎 Your official payment receipt PDF is attached to this email. You can also view or download all past receipts from your <a href="http://localhost:5173/customer/payments" style="color: #16a34a; text-decoration: underline;">Customer Portal</a>.
        </p>
        <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center;">
            This is an automated confirmation of payment receipt from {company_name}.
        </div>
    </div>
    """

    text_content = (
        f"Dear {customer_name},\n\n"
        f"Thank you for your payment of ₹{pay_amount:,.2f} for Invoice {inv_number}.\n\n"
        f"Receipt Number: {rec_number}\n"
        f"Payment Method: {pay_method}\n"
        f"Transaction Reference: {pay_ref}\n"
        f"Payment Date: {pay_date}\n"
        f"Remaining Balance Due: ₹{balance_due:,.2f}\n\n"
        f"Your official payment receipt PDF is attached to this email. View all receipts at http://localhost:5173/customer/payments\n\n"
        f"Thank you, {company_name}."
    )

    attachments = [{
        "filename": f"Receipt_{rec_number}.pdf",
        "content": pdf_bytes,
        "content_type": "application/pdf",
    }]

    # 9. Dispatch Email via Authenticated SMTP
    try:
        dispatched = send_email(
            to_email=recipient_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            attachments=attachments,
        )
        send_exc = None
    except Exception as exc:
        dispatched = False
        send_exc = exc

    now_done_iso = datetime.now(timezone.utc).isoformat()
    if dispatched:
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {"$set": {"delivery_status": "SENT", "sent_at": now_done_iso, "last_error": None, "updated_at": now_done_iso}},
        )
        logger.info(f"[EMAIL_DISPATCH] Successfully delivered payment receipt email {rec_number} to {recipient_email}")
        return True
    else:
        err_msg = f"SMTP delivery failed: {send_exc}" if send_exc else "SMTP delivery failed. Check SMTP configuration in backend/.env."
        email_delivery_logs_collection.update_one(
            {"_id": log_oid},
            {"$set": {"delivery_status": "FAILED", "last_error": err_msg, "updated_at": now_done_iso}},
        )
        logger.warning(f"[EMAIL_DISPATCH] Failed to deliver payment receipt email {rec_number} to {recipient_email}")
        return False


# ---------------------------------------------------------------------------
# Email Delivery Log Endpoints
# ---------------------------------------------------------------------------

@app.get("/emails/delivery-logs")
def list_email_delivery_logs(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    search: Optional[str] = None,
    status: Optional[str] = None,
    email_type: Optional[str] = None,
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_staff_or_admin),
):
    """
    Returns paginated email delivery audit records with filtering and retry status.
    Accessible to Staff and Admin. Customers are denied access.
    """
    filter_q: Dict[str, Any] = {}
    if status and status.upper() != "ALL":
        filter_q["delivery_status"] = status.upper().strip()
    if email_type and email_type.upper() != "ALL":
        filter_q["email_type"] = email_type.upper().strip()
    if customer_id:
        filter_q["customer_id"] = customer_id.strip()

    if search:
        search_rgx = {"$regex": re.escape(search.strip()), "$options": "i"}
        filter_q["$or"] = [
            {"customer_name": search_rgx},
            {"recipient_email": search_rgx},
            {"reference_number": search_rgx},
            {"subject": search_rgx},
        ]

    total = email_delivery_logs_collection.count_documents(filter_q)
    skip = (page - 1) * limit
    logs_cursor = email_delivery_logs_collection.find(filter_q).sort("created_at", -1).skip(skip).limit(limit)
    items = [serialize_document(log) for log in logs_cursor]

    import math
    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": math.ceil(total / limit) if limit else 1,
    }


@app.post("/emails/delivery-logs/{log_id}/retry")
def retry_failed_email_delivery(
    log_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_staff_or_admin),
):
    """
    Retries dispatch of a failed or pending email delivery log record.
    Accessible to Staff and Admin.
    """
    query: Dict[str, Any] = {}
    if ObjectId.is_valid(log_id):
        query["_id"] = ObjectId(log_id)
    else:
        query["email_id"] = log_id

    log_doc = email_delivery_logs_collection.find_one(query)
    if not log_doc:
        raise HTTPException(status_code=404, detail="Email delivery log record not found.")

    email_type = log_doc.get("email_type")
    if email_type == "INVOICE":
        inv_id = log_doc.get("related_invoice_id")
        if not inv_id:
            raise HTTPException(status_code=400, detail="Cannot retry: missing related invoice reference.")
        background_tasks.add_task(dispatch_invoice_email, inv_id, is_retry=True)
    elif email_type == "PAYMENT_RECEIPT":
        pay_id = log_doc.get("related_payment_id")
        if not pay_id:
            raise HTTPException(status_code=400, detail="Cannot retry: missing related payment reference.")
        background_tasks.add_task(dispatch_payment_receipt_email, pay_id, is_retry=True)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported email type '{email_type}' for retry.")

    log_audit_event(
        actor=current_user,
        action="RETRY_EMAIL_DELIVERY",
        resource_type="email_log",
        resource_id=str(log_doc.get("email_id", log_id)),
        details={"email_type": email_type, "recipient": log_doc.get("recipient_email")},
    )

    return {
        "message": f"Retry queued for {email_type.replace('_', ' ').title()} email to {log_doc.get('recipient_email')}.",
        "log_id": str(log_doc["_id"]),
    }


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
# Authentication Endpoints
# -------------------------

@app.post("/auth/login")
def login(request: UserLogin, req: Request):
    email = request.email.strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    check_login_rate_limit(email)

    user = users_collection.find_one({"email": email})
    if not user:
        record_failed_login(email)
        log_audit_event(
            actor={"email": email, "role": "unknown"},
            action="LOGIN_FAILED",
            module="Auth",
            status="FAILED",
            description=f"Failed login attempt for '{email}': User does not exist.",
            request=req,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    try:
        password_hasher.verify(user.get("password_hash", ""), request.password)
    except Exception:
        record_failed_login(email)
        log_audit_event(
            actor=user,
            action="LOGIN_FAILED",
            module="Auth",
            status="FAILED",
            description=f"Failed login attempt for '{email}': Invalid password provided.",
            request=req,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not user.get("is_active", True):
        log_audit_event(
            actor=user,
            action="LOGIN_FAILED",
            module="Auth",
            status="FAILED",
            description=f"Deactivated user '{email}' attempted to log in.",
            request=req,
        )
        raise HTTPException(
            status_code=403,
            detail="Your account has been deactivated. Please contact an administrator.",
        )

    clear_failed_logins(email)
    token = create_access_token(user)
    log_audit_event(
        actor=user,
        action="LOGIN_SUCCESS",
        module="Auth",
        status="SUCCESS",
        description=f"User '{email}' ({user.get('full_name', 'User')}) logged in successfully as {user.get('role', 'user')}.",
        request=req,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": serialize_user(user),
    }


@app.get("/auth/me")
def get_current_user_profile(current_user: dict = Depends(get_current_user)):
    return {"user": current_user}


@app.post("/auth/change-password")
def change_password(
    request: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
    req: Request = None,
):
    user = None
    try:
        user = users_collection.find_one({"_id": ObjectId(current_user["id"])})
    except Exception:
        pass
    if not user:
        user = users_collection.find_one({"email": current_user["email"].lower()})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    try:
        password_hasher.verify(user.get("password_hash", ""), request.current_password)
    except Exception:
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    if request.current_password == request.new_password:
        raise HTTPException(status_code=400, detail="New password cannot be identical to current password.")

    if len(request.new_password) < 6:
        raise HTTPException(status_code=422, detail="New password must be at least 6 characters long.")

    new_hash = password_hasher.hash(request.new_password)
    users_collection.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "password_hash": new_hash,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    log_audit_event(
        actor=current_user,
        action="CHANGE_PASSWORD",
        module="Auth",
        description=f"Password updated successfully for {current_user.get('email')}.",
        request=req,
    )
    return {"message": "Password updated successfully."}


@app.post("/auth/logout")
def logout(current_user: dict = Depends(get_current_user), req: Request = None):
    log_audit_event(
        actor=current_user,
        action="LOGOUT",
        module="Auth",
        description=f"User '{current_user.get('email')}' logged out successfully.",
        request=req,
    )
    return {"message": "Successfully logged out."}
    return {"message": "Successfully logged out."}


# -------------------------
# Email OTP Authentication & Password Recovery Endpoints
# -------------------------

class SendOtpRequest(BaseModel):
    email: str
    purpose: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordWithOtpRequest(BaseModel):
    email: str
    otp: str
    new_password: str

class SendRegistrationOtpRequest(BaseModel):
    email: str
    full_name: Optional[str] = None

class RegisterUserRequest(BaseModel):
    email: str
    password: str
    full_name: str
    otp: str
    phone: Optional[str] = None
    company_name: Optional[str] = None

class VerifyOtpAndSetPasswordRequest(BaseModel):
    email: str
    otp: str
    password: str
    token: str
    full_name: Optional[str] = None

class EmailChangeRequest(BaseModel):
    new_email: str

class VerifyEmailChangeRequest(BaseModel):
    new_email: str
    otp: str

class SmtpTestRequest(BaseModel):
    recipient_email: str


@app.post("/auth/send-otp")
def send_otp(req: SendOtpRequest):
    clean_purpose = req.purpose.strip().upper()
    if clean_purpose not in ("VERIFICATION", "PASSWORD_RESET", "REGISTRATION", "EMAIL_CHANGE", "LOGIN_2FA"):
        raise HTTPException(
            status_code=400,
            detail="Invalid OTP purpose. Must be VERIFICATION, PASSWORD_RESET, REGISTRATION, or EMAIL_CHANGE.",
        )
    clean_email = req.email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=422, detail="Invalid email address.")

    issuance_res = issue_otp_for_email(clean_email, clean_purpose)
    smtp_configured = is_smtp_configured()

    if smtp_configured and not issuance_res.email_sent:
        raise HTTPException(
            status_code=503,
            detail="Failed to dispatch verification email via SMTP server. Please verify your SMTP settings in backend/.env.",
        )

    return {
        "message": f"A 6-digit verification code has been sent to {clean_email}." if smtp_configured else "A 6-digit verification code has been generated (no verification code has been sent via email; SMTP is not configured in backend/.env).",
        "cooldown_seconds": OTP_LOCKOUT_SECONDS,
        "smtp_configured": smtp_configured,
        "email_delivered": issuance_res.email_sent,
        "dev_otp": issuance_res.raw_otp if is_dev_otp_allowed() else None,
    }


@app.post("/auth/send-registration-otp")
def send_registration_otp(req: SendRegistrationOtpRequest):
    clean_email = req.email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=422, detail="Please provide a valid email address.")

    existing_user = users_collection.find_one({"email": clean_email})
    if existing_user and existing_user.get("is_active") is not False:
        raise HTTPException(
            status_code=409,
            detail="An account with this email address already exists. Please sign in or reset your password.",
        )

    issuance_res = issue_otp_for_email(clean_email, "REGISTRATION")
    smtp_configured = is_smtp_configured()

    if smtp_configured and not issuance_res.email_sent:
        raise HTTPException(
            status_code=503,
            detail="Failed to dispatch verification email via SMTP server. Please verify your SMTP settings in backend/.env.",
        )

    return {
        "message": f"A 6-digit verification code has been dispatched to {clean_email}." if smtp_configured else "A 6-digit verification code has been generated. Please note: Email was not dispatched because SMTP credentials are not configured in backend/.env.",
        "cooldown_seconds": OTP_LOCKOUT_SECONDS,
        "smtp_configured": smtp_configured,
        "email_delivered": issuance_res.email_sent,
        "dev_otp": issuance_res.raw_otp if is_dev_otp_allowed() else None,
    }


@app.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest):
    clean_email = req.email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=422, detail="Invalid email address.")

    smtp_configured = is_smtp_configured()
    email_delivered = False
    dev_otp = None

    user = users_collection.find_one({"email": clean_email})
    if user and user.get("is_active") is not False:
        try:
            issuance_res = issue_otp_for_email(clean_email, "PASSWORD_RESET")
            email_delivered = issuance_res.email_sent
            if is_dev_otp_allowed():
                dev_otp = issuance_res.raw_otp
        except HTTPException as he:
            if he.status_code == 429:
                raise

    if not smtp_configured:
        return {
            "message": "If an account is associated with this email address, a password recovery code has been generated. Note: SMTP email service is currently not configured on this server.",
            "smtp_configured": False,
            "email_delivered": False,
            "cooldown_seconds": OTP_LOCKOUT_SECONDS,
            "dev_otp": dev_otp if is_dev_otp_allowed() else None,
        }

    if user and user.get("is_active") is not False and not email_delivered:
        raise HTTPException(
            status_code=503,
            detail="Failed to deliver password reset email through SMTP server. Please verify your SMTP settings in backend/.env.",
        )

    return {
        "message": "If an account is associated with this email address, a password recovery code has been sent to your email.",
        "smtp_configured": True,
        "email_delivered": True,
        "cooldown_seconds": OTP_LOCKOUT_SECONDS,
        "dev_otp": dev_otp if is_dev_otp_allowed() else None,
    }


@app.post("/auth/reset-password-with-otp")
def reset_password_with_otp(req: ResetPasswordWithOtpRequest):
    validate_password_strength(req.new_password)
    clean_email = req.email.strip().lower()

    user = users_collection.find_one({"email": clean_email})
    if user and user.get("is_active") is False:
        raise HTTPException(
            status_code=403,
            detail="Your user account has been deactivated. Please contact your system administrator.",
        )
    if not user:
        raise HTTPException(status_code=404, detail="User account not found.")

    verify_and_consume_otp(clean_email, req.otp, "PASSWORD_RESET")

    new_hash = password_hasher.hash(req.new_password)
    users_collection.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": new_hash}, "$inc": {"token_version": 1}},
    )

    log_audit_event(
        actor=user,
        action="RESET_PASSWORD_WITH_OTP",
        resource_type="user",
        resource_id=str(user["_id"]),
        details={"email": clean_email},
    )

    return {"message": "Password has been successfully reset. Please log in with your new password."}


@app.post("/auth/verify-otp-and-set-password")
def verify_otp_and_set_password(req: VerifyOtpAndSetPasswordRequest):
    validate_password_strength(req.password)
    clean_email = req.email.strip().lower()

    invite = customer_invitations_collection.find_one({"token": req.token.strip()})
    if not invite or invite.get("status") != "PENDING":
        raise HTTPException(status_code=400, detail="Invalid or expired invitation token.")

    verify_and_consume_otp(clean_email, req.otp, "VERIFICATION")

    customer_invitations_collection.update_one(
        {"_id": invite["_id"]},
        {"$set": {"status": "ACCEPTED", "accepted_at": datetime.now(timezone.utc).isoformat()}},
    )

    cust_id = invite.get("customer_id")
    now_iso = datetime.now(timezone.utc).isoformat()
    new_user = {
        "email": clean_email,
        "full_name": req.full_name or invite.get("customer_name") or "Customer",
        "role": "customer",
        "customer_id": cust_id,
        "password_hash": password_hasher.hash(req.password),
        "is_active": True,
        "token_version": 1,
        "created_at": now_iso,
    }
    res = users_collection.insert_one(new_user)
    new_user["_id"] = res.inserted_id

    log_audit_event(
        actor=new_user,
        action="ACCEPT_CUSTOMER_INVITE_WITH_OTP",
        resource_type="customer",
        resource_id=cust_id,
        details={"email": clean_email},
    )

    return serialize_document(new_user)


@app.post("/auth/register")
def register_user(req: RegisterUserRequest):
    """
    Self-service registration for new users / customers:
    1. Validates full name and password strength.
    2. Enforces email verification via 6-digit OTP dispatched to user's email.
    3. Prevents duplicate registrations.
    4. Automatically links or provisions customer record.
    5. Returns JWT access token and user credentials.
    """
    clean_email = req.email.strip().lower()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=422, detail="Please provide a valid email address.")

    clean_name = req.full_name.strip()
    if len(clean_name) < 2:
        raise HTTPException(status_code=422, detail="Please enter your full name (at least 2 characters).")

    validate_password_strength(req.password)

    existing_user = users_collection.find_one({"email": clean_email})
    if existing_user and existing_user.get("is_active") is not False:
        raise HTTPException(
            status_code=409,
            detail="An account with this email address already exists. Please sign in.",
        )

    clean_otp = req.otp.strip()
    if not clean_otp or len(clean_otp) != 6:
        raise HTTPException(status_code=422, detail="Please provide a valid 6-digit verification code.")

    # Verify and consume OTP under REGISTRATION or VERIFICATION purpose
    otp_doc = otps_collection.find_one(
        {"email": clean_email, "purpose": {"$in": ["REGISTRATION", "VERIFICATION"]}, "is_consumed": False},
        sort=[("created_at", -1)],
    )
    if not otp_doc:
        raise HTTPException(status_code=400, detail="No active verification code found. Please request a new code.")

    verify_and_consume_otp(clean_email, clean_otp, otp_doc.get("purpose", "REGISTRATION"))

    now_iso = datetime.now(timezone.utc).isoformat()

    # Link existing customer record or create new customer profile
    cust = customers_collection.find_one({"email": clean_email})
    if cust:
        cust_id = str(cust["_id"])
        if not cust.get("name"):
            customers_collection.update_one({"_id": cust["_id"]}, {"$set": {"name": clean_name, "updated_at": now_iso}})
    else:
        new_cust_doc = {
            "name": req.company_name.strip() if req.company_name and req.company_name.strip() else clean_name,
            "email": clean_email,
            "phone": (req.phone or "").strip(),
            "billing_address": "",
            "state": "",
            "is_active": True,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        res_c = customers_collection.insert_one(new_cust_doc)
        cust_id = str(res_c.inserted_id)

    new_user = {
        "email": clean_email,
        "full_name": clean_name,
        "role": "customer",
        "customer_id": cust_id,
        "password_hash": password_hasher.hash(req.password),
        "is_active": True,
        "token_version": 1,
        "created_at": now_iso,
    }
    res_u = users_collection.insert_one(new_user)
    new_user["_id"] = res_u.inserted_id

    log_audit_event(
        actor=new_user,
        action="REGISTER_USER_WITH_OTP",
        resource_type="user",
        resource_id=str(new_user["_id"]),
        details={"email": clean_email, "customer_id": cust_id},
    )

    token = create_access_token({
        "sub": clean_email,
        "email": clean_email,
        "role": "customer",
        "customer_id": cust_id,
        "full_name": clean_name,
        "token_version": 1,
    })

    safe_user = serialize_document(new_user)
    safe_user.pop("password_hash", None)

    return {
        "message": "Account created and email verified successfully! Welcome to Viora Bills.",
        "access_token": token,
        "token_type": "bearer",
        "user": safe_user,
    }


@app.post("/auth/request-email-change")
def request_email_change(
    req: EmailChangeRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Initiates an email address update for the authenticated user by sending an OTP to the new email.
    """
    clean_new = req.new_email.strip().lower()
    if not clean_new or "@" not in clean_new:
        raise HTTPException(status_code=422, detail="Please provide a valid new email address.")
    if clean_new == current_user.get("email"):
        raise HTTPException(status_code=400, detail="New email must be different from your current email.")

    existing = users_collection.find_one({"email": clean_new})
    if existing:
        raise HTTPException(status_code=409, detail="An account is already registered with this new email address.")

    issuance_res = issue_otp_for_email(clean_new, "EMAIL_CHANGE")
    smtp_configured = is_smtp_configured()

    if smtp_configured and not issuance_res.email_sent:
        raise HTTPException(
            status_code=503,
            detail="Failed to dispatch verification email via SMTP server. Please verify your SMTP settings in backend/.env.",
        )

    return {
        "message": f"Verification code dispatched to {clean_new}. Please enter the code to confirm email change." if smtp_configured else "Verification code generated. Please note: Email was not dispatched because SMTP credentials are not configured in backend/.env.",
        "cooldown_seconds": OTP_LOCKOUT_SECONDS,
        "smtp_configured": smtp_configured,
        "email_delivered": issuance_res.email_sent,
        "dev_otp": issuance_res.raw_otp if is_dev_otp_allowed() else None,
    }


@app.post("/auth/verify-email-change")
def verify_email_change(
    req: VerifyEmailChangeRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Confirms email address update using the OTP dispatched to the new email address.
    """
    clean_new = req.new_email.strip().lower()
    clean_otp = req.otp.strip()
    if len(clean_otp) != 6:
        raise HTTPException(status_code=422, detail="Invalid 6-digit verification code.")

    verify_and_consume_otp(clean_new, clean_otp, "EMAIL_CHANGE")

    old_email = current_user.get("email")
    user_id = current_user.get("id") or current_user.get("_id")
    user_oid = ObjectId(user_id) if isinstance(user_id, str) and ObjectId.is_valid(user_id) else user_id

    now_iso = datetime.now(timezone.utc).isoformat()
    users_collection.update_one(
        {"_id": user_oid},
        {"$set": {"email": clean_new, "updated_at": now_iso}, "$inc": {"token_version": 1}},
    )

    cust_id = current_user.get("customer_id")
    if cust_id:
        cust_oid = ObjectId(cust_id) if isinstance(cust_id, str) and ObjectId.is_valid(cust_id) else cust_id
        customers_collection.update_one(
            {"_id": cust_oid},
            {"$set": {"email": clean_new, "updated_at": now_iso}},
        )

    log_audit_event(
        actor=current_user,
        action="CHANGE_EMAIL_WITH_OTP",
        resource_type="user",
        resource_id=str(user_oid),
        details={"old_email": old_email, "new_email": clean_new},
    )

    new_token = create_access_token({
        "sub": clean_new,
        "email": clean_new,
        "role": current_user.get("role"),
        "customer_id": cust_id,
        "full_name": current_user.get("full_name"),
        "token_version": current_user.get("token_version", 1) + 1,
    })

    return {
        "message": f"Email successfully updated to {clean_new}.",
        "access_token": new_token,
        "user": {
            "id": str(user_oid),
            "email": clean_new,
            "role": current_user.get("role"),
            "full_name": current_user.get("full_name"),
        },
    }


@app.get("/settings/smtp/status")
def get_smtp_status(current_user: dict = Depends(require_staff_or_admin)):
    """
    Returns current SMTP configuration status (never reveals passwords).
    """
    cfg = get_smtp_config()
    return {
        "configured": is_smtp_configured(),
        "host": cfg["host"] or None,
        "port": cfg["port"],
        "from_email": cfg["from_email"] or cfg["user"] or None,
        "from_name": cfg["from_name"],
        "tls_enabled": cfg["use_tls"],
    }


@app.post("/settings/smtp/test")
def test_smtp_connection(
    req: SmtpTestRequest,
    current_user: dict = Depends(require_admin),
):
    """
    Sends a test verification email via configured SMTP (Admin only).
    """
    clean_recip = req.recipient_email.strip().lower()
    if not clean_recip or "@" not in clean_recip:
        raise HTTPException(status_code=422, detail="Invalid recipient email address.")
    if not is_smtp_configured():
        raise HTTPException(status_code=503, detail="SMTP is not fully configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS in backend/.env.")
    cfg = get_smtp_config()

    subject = "Viora Bills SMTP Connection Test"
    html_content = f"""
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e3a8a; margin-top: 0;">Viora Bills - SMTP Connection Test</h2>
        <p style="font-size: 15px; color: #334155;">Congratulations! Your SMTP email server connection is working properly.</p>
        <p style="font-size: 13px; color: #64748b;">Dispatched via <strong>{cfg['host']}:{cfg['port']}</strong> to {clean_recip}.</p>
    </div>
    """
    text_content = f"Viora Bills SMTP Test Email. Your SMTP connection ({cfg['host']}:{cfg['port']}) is working properly."
    sent = send_email(clean_recip, subject, html_content, text_content)
    if not sent:
        raise HTTPException(status_code=502, detail="SMTP delivery failed. Please check your credentials, App Password, and port.")
    return {
        "message": f"Test email successfully dispatched to {clean_recip} via {cfg['host']}:{cfg['port']}.",
        "smtp_host": cfg["host"],
        "smtp_port": cfg["port"],
        "sender": cfg["from_email"] or cfg["user"],
    }


# -------------------------
# User Management Endpoints (Admin Only)
# -------------------------

@app.get("/users")
def list_users(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    search: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    current_user: dict = Depends(require_admin),
):
    query = {}
    if search:
        s = re.escape(search.strip())
        query["$or"] = [
            {"full_name": {"$regex": s, "$options": "i"}},
            {"email": {"$regex": s, "$options": "i"}},
        ]
    if role:
        query["role"] = role.strip().lower()
    if is_active is not None:
        query["is_active"] = is_active

    valid_sorts = {"created_at": "created_at", "full_name": "full_name", "email": "email", "role": "role"}
    sort_field = valid_sorts.get(sort_by, "created_at")
    sort_order = -1 if sort_dir.lower() == "desc" else 1

    total = users_collection.count_documents(query)
    skip = (page - 1) * limit
    users = list(users_collection.find(query).sort(sort_field, sort_order).skip(skip).limit(limit))
    serialized = [serialize_user(u) for u in users]
    total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

    return {
        "items": serialized,
        "users": serialized,
        "total": total,
        "count": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
    }


@app.post("/users", status_code=201)
def create_user(
    user_in: UserCreate,
    current_user: dict = Depends(require_admin),
):
    email = user_in.email.strip().lower()
    if not EMAIL_REGEX.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address format.")

    if users_collection.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="A user with this email address already exists.")

    role = user_in.role.strip().lower()
    if role not in ["admin", "staff", "customer"]:
        raise HTTPException(status_code=422, detail="Role must be 'admin', 'staff', or 'customer'.")

    cust_id = None
    if role == "customer":
        if user_in.customer_id:
            cust_obj_id = valid_object_id(user_in.customer_id, "customer")
            cust = customers_collection.find_one({"_id": cust_obj_id})
            if not cust:
                raise HTTPException(status_code=404, detail="Associated customer record not found.")
            cust_id = str(cust["_id"])
        else:
            # Look up customer by email if not explicitly provided
            cust = customers_collection.find_one({"email": email})
            if cust:
                cust_id = str(cust["_id"])

    if len(user_in.password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters long.")

    now_str = datetime.now(timezone.utc).isoformat()
    new_doc = {
        "full_name": user_in.full_name.strip(),
        "email": email,
        "password_hash": password_hasher.hash(user_in.password),
        "role": role,
        "customer_id": cust_id,
        "is_active": bool(user_in.is_active),
        "created_at": now_str,
        "updated_at": now_str,
    }
    res = users_collection.insert_one(new_doc)
    new_doc["_id"] = res.inserted_id
    log_audit_event(
        actor=current_user,
        action="CREATE_USER",
        module="Users",
        resource_type="user",
        resource_id=str(res.inserted_id),
        description=f"User account '{email}' created with role '{role}'.",
        details={"email": email, "role": role, "full_name": user_in.full_name.strip()},
    )
    return {
        "user": serialize_user(new_doc),
        "message": "User created successfully.",
    }


@app.get("/users/{user_id}")
def get_user_by_id(
    user_id: str,
    current_user: dict = Depends(require_admin),
):
    user = None
    try:
        user = users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    if not user:
        user = users_collection.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"user": serialize_user(user)}


@app.put("/users/{user_id}")
def update_user(
    user_id: str,
    user_in: UserUpdate,
    current_user: dict = Depends(require_admin),
):
    user = None
    try:
        user = users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    if not user:
        user = users_collection.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    is_self = str(user["_id"]) == str(current_user["id"])

    # Prevent admin from deactivating or demoting themselves
    if is_self:
        if user_in.is_active is False:
            raise HTTPException(status_code=400, detail="Administrators cannot deactivate their own account.")
        if user_in.role and user_in.role.lower() != "admin":
            raise HTTPException(status_code=400, detail="Administrators cannot demote their own role.")

    update_fields = {}
    if user_in.full_name is not None:
        name = user_in.full_name.strip()
        if len(name) < 2:
            raise HTTPException(status_code=422, detail="Full name must be at least 2 characters.")
        update_fields["full_name"] = name

    if user_in.email is not None:
        email = user_in.email.strip().lower()
        if not EMAIL_REGEX.match(email):
            raise HTTPException(status_code=422, detail="Invalid email format.")
        existing = users_collection.find_one({"email": email, "_id": {"$ne": user["_id"]}})
        if existing:
            raise HTTPException(status_code=409, detail="A user with this email address already exists.")
        update_fields["email"] = email

    if user_in.role is not None:
        role = user_in.role.strip().lower()
        if role not in ["admin", "staff", "customer"]:
            raise HTTPException(status_code=422, detail="Role must be 'admin', 'staff', or 'customer'.")
        update_fields["role"] = role

    if user_in.customer_id is not None:
        if user_in.customer_id.strip():
            cust_obj_id = valid_object_id(user_in.customer_id, "customer")
            cust = customers_collection.find_one({"_id": cust_obj_id})
            if not cust:
                raise HTTPException(status_code=404, detail="Associated customer record not found.")
            update_fields["customer_id"] = str(cust["_id"])
        else:
            update_fields["customer_id"] = None

    if user_in.is_active is not None:
        update_fields["is_active"] = bool(user_in.is_active)

    if not update_fields:
        return {"user": serialize_user(user), "message": "No changes requested."}

    update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    users_collection.update_one({"_id": user["_id"]}, {"$set": update_fields})
    updated_user = users_collection.find_one({"_id": user["_id"]})
    log_audit_event(
        actor=current_user,
        action="UPDATE_USER",
        module="Users",
        resource_type="user",
        resource_id=user_id,
        description=f"User account '{user.get('email')}' updated.",
        details={"updated_fields": list(update_fields.keys())},
    )
    return {"user": serialize_user(updated_user), "message": "User updated successfully."}


@app.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: str,
    reset_in: ResetPasswordRequest,
    current_user: dict = Depends(require_admin),
):
    user = None
    try:
        user = users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    if not user:
        user = users_collection.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if len(reset_in.new_password) < 6:
        raise HTTPException(status_code=422, detail="New password must be at least 6 characters long.")

    new_hash = password_hasher.hash(reset_in.new_password)
    users_collection.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "password_hash": new_hash,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    log_audit_event(
        actor=current_user,
        action="RESET_PASSWORD_ADMIN",
        module="Users",
        resource_type="user",
        resource_id=user_id,
        description=f"Administrator reset password for user '{user.get('email')}'.",
        details={"email": user.get("email")},
    )
    return {"message": f"Password for user {user.get('email')} has been reset successfully."}


@app.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    current_user: dict = Depends(require_admin),
):
    user = None
    try:
        user = users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        pass
    if not user:
        user = users_collection.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if str(user["_id"]) == str(current_user["id"]):
        raise HTTPException(status_code=400, detail="Administrators cannot delete their own account.")

    users_collection.delete_one({"_id": user["_id"]})
    log_audit_event(
        actor=current_user,
        action="DELETE_USER",
        module="Users",
        resource_type="user",
        resource_id=user_id,
        description=f"User account '{user.get('email')}' deleted.",
        details={"email": user.get("email"), "role": user.get("role")},
    )
    return {"message": "User deleted successfully."}


# -------------------------
# Customer endpoints
# -------------------------

@app.post("/customers", status_code=201)
def create_customer(
    customer: CustomerCreate,
    current_user: dict = Depends(require_staff_or_admin),
):
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
    business_name = clean_optional(customer.business_name)
    pincode = clean_optional(customer.pincode)

    gstin, state_code, state = validate_and_normalize_gstin(
        customer.gstin, customer.state_code, customer.state
    )

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

        document = {
            "name": name,
            "business_name": business_name,
            "email": email,
            "phone": phone,
            "address": address,
            "state": state,
            "state_code": state_code,
            "pincode": pincode,
            "gstin": gstin,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        clean_doc = {k: v for k, v in document.items() if v is not None}

        result = customers_collection.insert_one(clean_doc)
        log_audit_event(
            actor=current_user,
            action="CREATE_CUSTOMER",
            module="Customers",
            resource_type="customer",
            resource_id=str(result.inserted_id),
            description=f"Customer '{name}' ({email or 'No email'}) created.",
            details={"name": name, "email": email, "phone": phone, "state": state},
        )
        saved = customers_collection.find_one({"_id": result.inserted_id})
        return serialize_document(saved)

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not save the customer. Check the database connection.",
        )


@app.get("/customers/csv")
def export_customers_csv(current_user: dict = Depends(require_staff_or_admin)):
    try:
        customers = list(customers_collection.find().sort("name", 1))
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Customer ID",
            "Name",
            "Business Name",
            "GSTIN",
            "Phone",
            "Email",
            "Billing Address",
            "State",
            "State Code",
            "PIN Code",
            "Created At",
        ])
        for c in customers:
            writer.writerow([
                str(c.get("_id", "")),
                c.get("name", ""),
                c.get("business_name", ""),
                c.get("gstin", ""),
                c.get("phone", ""),
                c.get("email", ""),
                c.get("address", ""),
                c.get("state", ""),
                c.get("state_code", ""),
                c.get("pincode", ""),
                c.get("created_at", ""),
            ])
        csv_data = output.getvalue()
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=viora_customers.csv"},
        )
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not export customers to CSV.")


@app.get("/customers")
def list_customers(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    skip: Optional[int] = Query(default=None, ge=0),
    search: Optional[str] = None,
    sort_by: str = "name",
    sort_dir: str = "asc",
    current_user: dict = Depends(require_staff_or_admin),
):
    try:
        query = {}
        if search:
            s = re.escape(search.strip())
            query["$or"] = [
                {"name": {"$regex": s, "$options": "i"}},
                {"business_name": {"$regex": s, "$options": "i"}},
                {"email": {"$regex": s, "$options": "i"}},
                {"phone": {"$regex": s, "$options": "i"}},
                {"gstin": {"$regex": s, "$options": "i"}},
            ]

        valid_sorts = {"name": "name", "created_at": "created_at", "business_name": "business_name", "state": "state"}
        sort_field = valid_sorts.get(sort_by, "name")
        sort_order = -1 if sort_dir.lower() == "desc" else 1

        total = customers_collection.count_documents(query)
        actual_skip = skip if skip is not None else (page - 1) * limit
        actual_page = (actual_skip // limit) + 1 if skip is not None else page

        customers = list(
            customers_collection.find(query).sort(sort_field, sort_order).skip(actual_skip).limit(limit)
        )
        serialized = [serialize_document(c) for c in customers]
        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        return {
            "items": serialized,
            "customers": serialized,
            "total": total,
            "count": total,
            "page": actual_page,
            "limit": limit,
            "total_pages": total_pages,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve customers.")


@app.get("/customers/search")
def search_customers(
    q: str = Query(min_length=1, max_length=100),
    current_user: dict = Depends(require_staff_or_admin),
):
    search_text = re.escape(q.strip())
    if not search_text:
        raise HTTPException(status_code=422, detail="Enter a search term.")

    search_filter = {
        "$or": [
            {"name": {"$regex": search_text, "$options": "i"}},
            {"business_name": {"$regex": search_text, "$options": "i"}},
            {"gstin": {"$regex": search_text, "$options": "i"}},
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
def update_customer(
    customer_id: str,
    customer: CustomerUpdate,
    current_user: dict = Depends(require_staff_or_admin),
):
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

    if "gstin" in updates or "state_code" in updates or "state" in updates:
        curr_cust = customers_collection.find_one({"_id": customer_object_id}) or {}
        g_val = updates.get("gstin", curr_cust.get("gstin"))
        sc_val = updates.get("state_code", curr_cust.get("state_code"))
        st_val = updates.get("state", curr_cust.get("state"))
        gstin, state_code, state = validate_and_normalize_gstin(g_val, sc_val, st_val)
        updates["gstin"] = gstin
        updates["state_code"] = state_code
        updates["state"] = state

    for field in ("phone", "address", "business_name", "pincode"):
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
        log_audit_event(
            actor=current_user,
            action="UPDATE_CUSTOMER",
            module="Customers",
            resource_type="customer",
            resource_id=customer_id,
            description=f"Customer '{updated.get('name')}' updated.",
            details={"updated_fields": list(updates.keys())},
        )
        return serialize_document(updated)
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not update the customer. Check the database connection.",
        )


@app.get("/customers/{customer_id}")
def get_customer(
    customer_id: str,
    current_user: dict = Depends(require_staff_or_admin),
):
    customer_object_id = valid_object_id(customer_id, "customer")
    try:
        cust = customers_collection.find_one({"_id": customer_object_id})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found.")
        return serialize_document(cust)
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve the customer.")


@app.delete("/customers/{customer_id}")
def delete_customer(
    customer_id: str,
    current_user: dict = Depends(require_admin),
):
    customer_object_id = valid_object_id(customer_id, "customer")
    try:
        cust = customers_collection.find_one({"_id": customer_object_id})
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found.")

        # Check if customer has historical invoices (preserve for GST compliance)
        if invoices_collection.find_one({"customer_id": customer_id}):
            raise HTTPException(
                status_code=400,
                detail="Cannot delete customer with existing invoices. Historical invoices must be preserved for GST audit compliance.",
            )

        # Check if customer has historical/active orders
        if orders_collection.find_one({"customer_id": customer_id}):
            raise HTTPException(
                status_code=400,
                detail="Cannot delete customer with existing orders. Order history must be preserved.",
            )

        # Remove associated invitations, cart, and portal user accounts
        customer_invitations_collection.delete_many({"customer_id": customer_id})
        users_collection.delete_many({"customer_id": customer_id, "role": "customer"})
        carts_collection.delete_many({"customer_id": customer_id})

        customers_collection.delete_one({"_id": customer_object_id})

        log_audit_event(
            actor=current_user,
            action="DELETE_CUSTOMER",
            resource_type="customer",
            resource_id=customer_id,
            details={"name": cust.get("name"), "email": cust.get("email")},
        )

        return {"message": "Customer deleted successfully.", "id": customer_id}
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not delete customer.")


# -------------------------
# Product endpoints
# -------------------------

@app.post("/products", status_code=201)
def create_product(
    product: ProductCreate,
    current_user: dict = Depends(require_staff_or_admin),
):
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
        "description": product.description.strip() if product.description else None,
        "sku": product.sku.strip() if product.sku else None,
        "category": product.category.strip() if product.category else None,
        "image_url": product.image_url.strip() if product.image_url else None,
        "is_active": product.is_active if product.is_active is not None else True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        result = products_collection.insert_one(document)
        log_audit_event(
            actor=current_user,
            action="CREATE_PRODUCT",
            module="Products",
            resource_type="product",
            resource_id=str(result.inserted_id),
            description=f"Product '{name}' created at ₹{product.price} ({product.gst_rate}% GST).",
            details={"name": name, "price": product.price, "gst_rate": product.gst_rate, "unit": unit},
        )
        saved = products_collection.find_one({"_id": result.inserted_id})
        return serialize_document(saved)
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not save the product. Check the database connection.",
        )


@app.get("/products")
def list_products(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    skip: Optional[int] = Query(default=None, ge=0),
    search: Optional[str] = None,
    category: Optional[str] = None,
    sort_by: str = "name",
    sort_dir: str = "asc",
    current_user: dict = Depends(require_staff_or_admin),
):
    try:
        query = {}
        if search:
            s = re.escape(search.strip())
            query["$or"] = [
                {"name": {"$regex": s, "$options": "i"}},
                {"category": {"$regex": s, "$options": "i"}},
            ]
        if category:
            query["category"] = category.strip()

        valid_sorts = {"name": "name", "price": "price", "gst_rate": "gst_rate", "created_at": "created_at"}
        sort_field = valid_sorts.get(sort_by, "name")
        sort_order = -1 if sort_dir.lower() == "desc" else 1

        total = products_collection.count_documents(query)
        actual_skip = skip if skip is not None else (page - 1) * limit
        actual_page = (actual_skip // limit) + 1 if skip is not None else page

        products = list(
            products_collection.find(query).sort(sort_field, sort_order).skip(actual_skip).limit(limit)
        )
        serialized = [serialize_document(p) for p in products]
        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        return {
            "items": serialized,
            "products": serialized,
            "total": total,
            "count": total,
            "page": actual_page,
            "limit": limit,
            "total_pages": total_pages,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve products.")


@app.patch("/products/{product_id}")
def update_product(
    product_id: str,
    product: ProductUpdate,
    current_user: dict = Depends(require_staff_or_admin),
):
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

    for field in ("name", "unit", "description", "sku", "category", "image_url"):
        if field in updates and isinstance(updates[field], str):
            updates[field] = updates[field].strip()
            minimum = 2 if field == "name" else (1 if field == "unit" else 0)
            if len(updates[field]) < minimum:
                raise HTTPException(status_code=422, detail=f"Invalid {field}.")

    try:
        result = products_collection.update_one(
            {"_id": product_object_id}, {"$set": updates}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Product not found.")
        updated = products_collection.find_one({"_id": product_object_id})
        log_audit_event(
            actor=current_user,
            action="UPDATE_PRODUCT",
            module="Products",
            resource_type="product",
            resource_id=product_id,
            description=f"Product '{updated.get('name')}' updated.",
            details={"updated_fields": list(updates.keys())},
        )
        return serialize_document(updated)
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not update the product. Check the database connection.",
        )


@app.post("/products/upload-image")
def upload_product_image(
    payload: ProductImageUpload,
    current_user: dict = Depends(require_staff_or_admin),
):
    """
    Safely validates and stores product images.
    Accepts base64 image data (optionally with data:image/... prefix).
    Validates format (JPEG, PNG, WEBP) and size (<= 5MB).
    """
    raw_data = payload.image_data.strip()
    if "," in raw_data and raw_data.startswith("data:"):
        raw_data = raw_data.split(",", 1)[1]

    try:
        decoded_bytes = base64.b64decode(raw_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data.")

    if len(decoded_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image size exceeds maximum limit of 5MB.")

    try:
        image = PILImage.open(io.BytesIO(decoded_bytes))
        img_format = (image.format or "").upper()
        if img_format not in ["JPEG", "JPG", "PNG", "WEBP"]:
            raise HTTPException(status_code=400, detail="Unsupported image format. Allowed formats: JPEG, PNG, WEBP.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode valid image file.")

    ext_map = {"JPEG": "jpg", "JPG": "jpg", "PNG": "png", "WEBP": "webp"}
    ext = ext_map.get(img_format, "png")
    filename = f"prod_{secrets.token_hex(8)}.{ext}"
    target_path = os.path.join(PRODUCT_UPLOAD_DIR, filename)

    try:
        with open(target_path, "wb") as f:
            f.write(decoded_bytes)
    except Exception as e:
        logger.error(f"Failed to save product image: {e}")
        raise HTTPException(status_code=500, detail="Failed to save image to disk.")

    return {
        "filename": filename,
        "image_url": f"/uploads/products/{filename}",
        "size_bytes": len(decoded_bytes),
        "format": img_format,
    }


@app.delete("/products/{product_id}")
def delete_product(
    product_id: str,
    current_user: dict = Depends(require_admin),
):
    product_object_id = valid_object_id(product_id, "product")

    try:
        product = products_collection.find_one({"_id": product_object_id})
        if product is None:
            raise HTTPException(status_code=404, detail="Product not found.")

        # Invoice items store product_id as a string.
        if invoices_collection.find_one({"items.product_id": product_id}):
            raise HTTPException(
                status_code=409,
                detail="This product is used in an invoice and cannot be deleted.",
            )

        if orders_collection.find_one({"items.product_id": product_id}):
            raise HTTPException(
                status_code=409,
                detail="This product is referenced in customer orders and cannot be deleted.",
            )

        products_collection.delete_one({"_id": product_object_id})

        log_audit_event(
            actor=current_user,
            action="DELETE_PRODUCT",
            resource_type="product",
            resource_id=product_id,
            details={"name": product.get("name")},
        )

        return {"message": "Product deleted successfully.", "id": product_id}
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not delete the product. Check the database connection.",
        )


# -------------------------
# Invoice endpoints
# -------------------------

@app.get("/invoices/next-number")
def get_next_invoice_number_preview(current_user: dict = Depends(require_staff_or_admin)):
    """Returns prospective invoice number for frontend display prior to creation."""
    return get_prospective_invoice_number()


@app.get("/invoices/csv")
def export_invoices_csv(current_user: dict = Depends(require_staff_or_admin)):
    """Export invoices to CSV with full GST and status breakdown."""
    try:
        invoices = list(invoices_collection.find().sort("_id", -1))
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Invoice Number",
            "Invoice ID",
            "Customer Name",
            "Customer ID",
            "Invoice Date",
            "Due Date",
            "Supply Type",
            "Place of Supply",
            "Subtotal",
            "Discount",
            "Taxable Amount",
            "CGST Amount",
            "SGST Amount",
            "IGST Amount",
            "Total GST",
            "Total Amount",
            "Amount Paid",
            "Balance Due",
            "Status",
        ])
        for inv in invoices:
            tb = inv.get("tax_breakdown") or {}
            inv_dt = get_invoice_datetime(inv)
            inv_date_str = str(inv.get("invoice_date") or inv.get("created_at") or inv_dt.strftime("%Y-%m-%d"))[:10]
            due_date_str = str(inv.get("due_date") or "")[:10]
            inv_num = inv.get("invoice_number") or ""
            gst_tot = float(inv.get("gst_amount", 0))

            cgst = float(inv.get("cgst_amount", tb.get("cgst_amount", gst_tot / 2.0 if tb.get("supply_type") == "Intra-State" else 0.0)))
            sgst = float(inv.get("sgst_amount", tb.get("sgst_amount", gst_tot - cgst if tb.get("supply_type") == "Intra-State" else 0.0)))
            igst = float(inv.get("igst_amount", tb.get("igst_amount", gst_tot if tb.get("supply_type") == "Inter-State" else 0.0)))

            writer.writerow([
                inv_num,
                str(inv.get("_id", "")),
                inv.get("customer_name", ""),
                str(inv.get("customer_id", "")),
                inv_date_str,
                due_date_str,
                tb.get("supply_type", "Intra-State"),
                inv.get("place_of_supply", tb.get("place_of_supply", "")),
                inv.get("subtotal", 0.0),
                inv.get("discount", 0.0),
                inv.get("taxable_amount", 0.0),
                round(cgst, 2),
                round(sgst, 2),
                round(igst, 2),
                round(gst_tot, 2),
                inv.get("total_amount", 0.0),
                inv.get("amount_paid", 0.0),
                inv.get("balance_due", 0.0),
                inv.get("status", "UNPAID"),
            ])
        csv_data = output.getvalue()
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=viora_invoices.csv"},
        )
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not export invoices to CSV.")


@app.post("/invoices", status_code=201)
def create_invoice(
    invoice: InvoiceCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_staff_or_admin),
):
    customer_object_id = valid_object_id(invoice.customer_id, "customer")

    try:
        customer = customers_collection.find_one({"_id": customer_object_id})
        if customer is None:
            raise HTTPException(status_code=404, detail="Customer not found.")

        settings = company_settings_collection.find_one() or DEFAULT_COMPANY_SETTINGS
        company_state = (settings.get("state") or "Maharashtra").strip()

        # Determine place of supply: explicit -> customer state -> company state
        place_of_supply = clean_optional(invoice.place_of_supply)
        if not place_of_supply:
            place_of_supply = clean_optional(customer.get("state")) or company_state

        raw_items = []
        for item in invoice.items:
            product_object_id = valid_object_id(item.product_id, "product")
            product = products_collection.find_one({"_id": product_object_id})
            if product is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Product not found: {item.product_id}",
                )

            raw_items.append({
                "product_id": item.product_id,
                "product_name": product["name"],
                "unit": product["unit"],
                "quantity": item.quantity,
                "unit_price": round(float(product["price"]), 2),
                "gst_rate": float(product["gst_rate"]),
            })

        subtotal_check = round(sum(it["unit_price"] * it["quantity"] for it in raw_items), 2)
        discount = round(invoice.discount, 2)
        if discount > subtotal_check:
            raise HTTPException(
                status_code=400,
                detail="Discount cannot exceed the subtotal.",
            )

        # Centralized GST engine calculation
        calc = calculate_invoice_taxes(
            items_raw=raw_items,
            discount=discount,
            place_of_supply=place_of_supply,
            company_state=company_state,
        )

        now_dt = datetime.now(timezone.utc)
        inv_date_str = clean_optional(invoice.invoice_date)
        if inv_date_str:
            if not re.fullmatch(r"^\d{4}-\d{2}-\d{2}$", inv_date_str):
                raise HTTPException(status_code=422, detail="Invoice date must be in YYYY-MM-DD format.")
            inv_dt = datetime.strptime(inv_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        else:
            inv_dt = now_dt
            inv_date_str = now_dt.strftime("%Y-%m-%d")

        # Generate atomic, collision-free sequential invoice number (e.g. VB-2026-0001)
        invoice_number = generate_next_invoice_number(inv_dt)

        due_date_str = clean_optional(invoice.due_date)
        if due_date_str:
            if not re.fullmatch(r"^\d{4}-\d{2}-\d{2}$", due_date_str):
                raise HTTPException(status_code=422, detail="Due date must be in YYYY-MM-DD format.")
        else:
            due_date_str = (inv_dt + timedelta(days=30)).strftime("%Y-%m-%d")

        document = {
            "invoice_number": invoice_number,
            "customer_id": invoice.customer_id,
            "customer_name": customer["name"],
            "items": calc["items"],
            "subtotal": calc["subtotal"],
            "discount": calc["discount"],
            "taxable_amount": calc["taxable_amount"],
            "cgst_amount": calc["cgst_amount"],
            "sgst_amount": calc["sgst_amount"],
            "igst_amount": calc["igst_amount"],
            "gst_amount": calc["gst_amount"],
            "total_amount": calc["total_amount"],
            "amount_paid": 0.0,
            "balance_due": calc["total_amount"],
            "status": "UNPAID",
            "payment_mode": None,
            "payment_modes": [],
            "payments": [],
            "has_pending_payment": False,
            "invoice_date": inv_date_str,
            "due_date": due_date_str,
            "place_of_supply": calc["tax_breakdown"]["place_of_supply"],
            "tax_breakdown": calc["tax_breakdown"],
            "created_at": now_dt.isoformat(),
            "updated_at": now_dt.isoformat(),
        }

        result = invoices_collection.insert_one(document)
        saved = invoices_collection.find_one({"_id": result.inserted_id})

        log_audit_event(
            actor=current_user,
            action="CREATE_INVOICE",
            resource_type="invoice",
            resource_id=str(result.inserted_id),
            details={
                "invoice_number": invoice_number,
                "customer_name": customer.get("name"),
                "total_amount": float(document["total_amount"]),
            },
        )
        create_notification(
            title=f"New Invoice Issued: {invoice_number}",
            message=f"Invoice {invoice_number} of ₹{float(document['total_amount']):,.2f} has been generated for your account.",
            recipient_role="customer",
            customer_id=str(customer["_id"]),
            notification_type="invoice",
            link="/customer/invoices",
        )

        # Automatically dispatch invoice PDF via email in background
        background_tasks.add_task(dispatch_invoice_email, str(result.inserted_id))

        return serialize_document(saved)

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not save the invoice. Check the database connection.",
        )


@app.get("/invoices")
def get_invoices(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    skip: Optional[int] = Query(default=None, ge=0),
    search: Optional[str] = None,
    status: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    customer_id: Optional[str] = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    current_user: dict = Depends(require_staff_or_admin),
):
    try:
        query = {}
        if search:
            s = re.escape(search.strip())
            query["$or"] = [
                {"invoice_number": {"$regex": s, "$options": "i"}},
                {"customer_name": {"$regex": s, "$options": "i"}},
            ]
        if status and status.upper() != "ALL":
            query["status"] = {"$regex": f"^{re.escape(status.strip())}$", "$options": "i"}
        if customer_id:
            query["customer_id"] = customer_id.strip()

        date_conditions = {}
        if start_date:
            date_conditions["$gte"] = start_date.strip()
        if end_date:
            date_conditions["$lte"] = end_date.strip()
        if date_conditions:
            query["invoice_date"] = date_conditions

        valid_sorts = {
            "created_at": "created_at",
            "_id": "_id",
            "invoice_date": "invoice_date",
            "total_amount": "total_amount",
            "balance_due": "balance_due",
            "invoice_number": "invoice_number",
        }
        sort_field = valid_sorts.get(sort_by, "created_at")
        sort_order = -1 if sort_dir.lower() == "desc" else 1

        total = invoices_collection.count_documents(query)
        actual_skip = skip if skip is not None else (page - 1) * limit
        actual_page = (actual_skip // limit) + 1 if skip is not None else page

        invoices = list(
            invoices_collection.find(query).sort(sort_field, sort_order).skip(actual_skip).limit(limit)
        )
        serialized = []
        for i in invoices:
            doc = serialize_document(i)
            amt_paid = float(doc.get("amount_paid", 0))
            if not doc.get("payment_mode"):
                if amt_paid > 0:
                    doc["payment_mode"] = "Not Recorded"
                else:
                    doc["payment_mode"] = None
            serialized.append(doc)
        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        return {
            "items": serialized,
            "invoices": serialized,
            "total": total,
            "count": total,
            "page": actual_page,
            "limit": limit,
            "total_pages": total_pages,
        }
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not retrieve invoices. Check the database connection.",
        )


@app.get("/invoices/{invoice_id}")
def get_invoice(
    invoice_id: str,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    invoice_object_id = valid_object_id(invoice_id, "invoice")
    try:
        invoice = invoices_collection.find_one({"_id": invoice_object_id})
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")

        # Enforce Customer Data Isolation
        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(invoice.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to view this invoice.",
                )

        serialized = serialize_document(invoice)

        # Dynamically attach verified payments, modes, and pending status
        all_payments = list(payments_collection.find({"invoice_id": str(invoice_object_id)}).sort("created_at", 1))
        successful_payments = []
        for p in all_payments:
            st = p.get("status", "SUCCESS")
            if st in ["SUCCESS", "CLEARED"]:
                successful_payments.append({
                    "id": str(p["_id"]),
                    "payment_method": p.get("payment_method") or "Not Recorded",
                    "amount": round(float(p.get("amount", 0)), 2),
                    "payment_date": p.get("payment_date") or str(p.get("created_at", ""))[:10],
                    "reference": p.get("reference") or p.get("transaction_id") or "—",
                    "receipt_number": p.get("receipt_number") or "",
                    "status": st,
                })

        modes = []
        for sp in successful_payments:
            m = sp["payment_method"]
            if m and m not in modes:
                modes.append(m)

        amt_paid = float(serialized.get("amount_paid", 0))
        serialized["payments"] = successful_payments
        serialized["payment_modes"] = modes
        serialized["payment_mode"] = ", ".join(modes) if modes else ("Not Recorded" if amt_paid > 0 else None)
        serialized["has_pending_payment"] = any(p.get("status") in ["PENDING", "PENDING_VERIFICATION"] for p in all_payments)

        return serialized
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not retrieve the invoice. Check the database connection.",
        )


@app.get("/invoices/{invoice_id}/payment-status")
def get_invoice_payment_status(
    invoice_id: str,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Lightweight, real-time polling endpoint to check invoice payment settlement status.
    Strictly protected: customers may only inspect status for their own invoices.
    """
    invoice_object_id = valid_object_id(invoice_id, "invoice")
    try:
        invoice = invoices_collection.find_one({"_id": invoice_object_id})
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")

        # Enforce Customer Data Isolation
        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(invoice.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to inspect this invoice.",
                )

        # Find any recent verified payment for this invoice
        latest_payment = payments_collection.find_one(
            {"invoice_id": invoice_id, "status": {"$in": ["SUCCESS", "CLEARED"]}},
            sort=[("created_at", -1)],
        )

        bal = round(float(invoice.get("balance_due", 0)), 2)
        paid = round(float(invoice.get("amount_paid", 0)), 2)
        tot = round(float(invoice.get("total_amount", 0)), 2)
        status = invoice.get("status", "UNPAID")

        return {
            "invoice_id": invoice_id,
            "invoice_number": invoice.get("invoice_number", ""),
            "total_amount": tot,
            "amount_paid": paid,
            "balance_due": bal,
            "status": status,
            "is_paid": bal <= 0,
            "latest_payment": serialize_document(latest_payment) if latest_payment else None,
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve invoice payment status.")


class CustomerUpiSubmission(BaseModel):
    reference: str = Field(..., min_length=4, max_length=50, description="12-digit UPI UTR or bank transaction reference")
    amount: Optional[float] = Field(None, gt=0)
    notes: Optional[str] = Field(None, max_length=200)


@app.post("/customer/invoices/{invoice_id}/submit-upi")
def submit_customer_upi_payment(
    invoice_id: str,
    payload: CustomerUpiSubmission,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Allows a customer to submit their UPI UTR / Transaction Reference after scanning the dynamic QR code.
    Enforces customer isolation, prevents duplicates, and records payment as PENDING_VERIFICATION.
    The invoice balance is NOT reduced until verified by authorized staff/admin against bank statement.
    """
    inv_obj_id = valid_object_id(invoice_id, "invoice")
    try:
        invoice = invoices_collection.find_one({"_id": inv_obj_id})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found.")

        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(invoice.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to pay this invoice.",
                )

        balance = round(float(invoice.get("balance_due", 0)), 2)
        if balance <= 0:
            raise HTTPException(status_code=400, detail="This invoice is already fully paid.")

        pay_amount = round(payload.amount if payload.amount else balance, 2)
        if pay_amount <= 0 or pay_amount > balance:
            raise HTTPException(
                status_code=400,
                detail=f"Payment amount {pay_amount:.2f} cannot exceed outstanding balance {balance:.2f}.",
            )

        clean_ref = (payload.reference or "").strip()
        if len(clean_ref) < 4:
            raise HTTPException(
                status_code=422,
                detail="Please provide a valid UPI transaction reference or bank UTR number (at least 4 characters).",
            )

        existing = payments_collection.find_one({
            "reference": clean_ref,
            "status": {"$in": ["SUCCESS", "PENDING_VERIFICATION", "CLEARED"]},
        })
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"A payment with reference '{clean_ref}' has already been submitted or recorded.",
            )

        now_dt = datetime.now(timezone.utc)
        receipt_num = get_next_receipt_number(now_dt)

        cust_id = invoice.get("customer_id")
        customer_name = ""
        if cust_id:
            try:
                c = customers_collection.find_one({"_id": ObjectId(cust_id) if isinstance(cust_id, str) and ObjectId.is_valid(cust_id) else cust_id})
                if c:
                    customer_name = c.get("name", "")
            except Exception:
                pass

        payment_doc = {
            "invoice_id": invoice_id,
            "invoice_number": invoice.get("invoice_number", ""),
            "customer_id": str(invoice["customer_id"]),
            "customer_name": customer_name,
            "receipt_number": receipt_num,
            "amount": pay_amount,
            "payment_method": "UPI",
            "status": "PENDING_VERIFICATION",
            "reference": clean_ref,
            "notes": clean_optional(payload.notes) or "Customer submitted UPI reference via portal",
            "payment_date": now_dt.strftime("%Y-%m-%d"),
            "recorded_by": current_user.get("email"),
            "recorded_by_name": current_user.get("full_name", current_user.get("email")),
            "recorded_by_role": current_user.get("role", "customer"),
            "status_history": [
                {
                    "from_status": None,
                    "to_status": "PENDING_VERIFICATION",
                    "changed_by": current_user.get("email"),
                    "changed_at": now_dt.isoformat(),
                    "reason": "Customer submitted UPI reference; awaiting staff verification against bank statement",
                }
            ],
            "created_at": now_dt.isoformat(),
            "updated_at": now_dt.isoformat(),
        }

        res = payments_collection.insert_one(payment_doc)
        updated_invoice = recalculate_invoice_payment_status(inv_obj_id)

        log_audit_event(
            actor=current_user,
            action="SUBMIT_UPI_CLAIM",
            resource_type="payment",
            resource_id=str(res.inserted_id),
            details={
                "invoice_id": invoice_id,
                "invoice_number": invoice.get("invoice_number", ""),
                "amount": pay_amount,
                "reference": clean_ref,
                "status": "PENDING_VERIFICATION",
            },
        )
        create_notification(
            title=f"New UPI Claim Submitted: ₹{pay_amount:,.2f}",
            message=f"Customer submitted UPI transaction reference '{clean_ref}' for Invoice {invoice.get('invoice_number', invoice_id)}. Verification required.",
            recipient_role="staff",
            notification_type="payment",
            link="/payments",
        )

        safe_p = serialize_document(payment_doc)
        safe_p["id"] = str(res.inserted_id)
        return {
            "message": f"UPI transaction reference '{clean_ref}' submitted successfully. Your payment is PENDING verification by our accounts team.",
            "payment": safe_p,
            "invoice": updated_invoice,
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Database operation failed while submitting UPI reference.")


class CustomerCardSubmission(BaseModel):
    amount: Optional[float] = Field(None, gt=0)
    card_holder: str = Field(..., min_length=2, max_length=150)
    card_number: str = Field(..., min_length=12, max_length=24)
    expiry: str = Field(..., min_length=3, max_length=7)
    cvv: Optional[str] = Field(None, max_length=4)
    notes: Optional[str] = Field(None, max_length=200)


@app.post("/customer/invoices/{invoice_id}/submit-card")
def submit_customer_card_payment(
    invoice_id: str,
    payload: CustomerCardSubmission,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Allows a customer to submit their credit/debit card payment details.
    Enforces customer isolation, validates outstanding balance, extracts masked card info
    (only card_last4 and card_network are stored for strict PCI DSS compliance - no raw PAN or CVV is persisted),
    generates receipt number, and records payment as PENDING_VERIFICATION.
    """
    inv_obj_id = valid_object_id(invoice_id, "invoice")
    try:
        invoice = invoices_collection.find_one({"_id": inv_obj_id})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found.")

        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(invoice.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to pay this invoice.",
                )

        balance = round(float(invoice.get("balance_due", 0)), 2)
        if balance <= 0:
            raise HTTPException(status_code=400, detail="This invoice is already fully paid.")

        pay_amount = round(payload.amount if payload.amount else balance, 2)
        if pay_amount <= 0 or pay_amount > balance:
            raise HTTPException(
                status_code=400,
                detail=f"Payment amount {pay_amount:.2f} cannot exceed outstanding balance {balance:.2f}.",
            )

        clean_pan = re.sub(r"\D", "", payload.card_number or "")
        if len(clean_pan) < 12 or len(clean_pan) > 19:
            raise HTTPException(
                status_code=422,
                detail="Please provide a valid card number (12 to 19 digits).",
            )

        # Detect card network
        card_network = "Card"
        if clean_pan.startswith("4"):
            card_network = "Visa"
        elif clean_pan.startswith(("51", "52", "53", "54", "55")) or (
            len(clean_pan) >= 4 and 2221 <= int(clean_pan[:4]) <= 2720
        ):
            card_network = "Mastercard"
        elif clean_pan.startswith(("60", "65", "81", "82", "508")):
            card_network = "RuPay"
        elif clean_pan.startswith(("34", "37")):
            card_network = "Amex"

        card_last4 = clean_pan[-4:]
        clean_holder = (payload.card_holder or "").strip()
        if len(clean_holder) < 2:
            raise HTTPException(status_code=422, detail="Please provide a valid cardholder name.")

        now_dt = datetime.now(timezone.utc)
        receipt_num = get_next_receipt_number(now_dt)
        ref_code = f"CARD-{secrets.token_hex(4).upper()}"

        cust_id = invoice.get("customer_id")
        customer_name = ""
        if cust_id:
            try:
                c = customers_collection.find_one({"_id": ObjectId(cust_id) if isinstance(cust_id, str) and ObjectId.is_valid(cust_id) else cust_id})
                if c:
                    customer_name = c.get("name", "")
            except Exception:
                pass

        payment_doc = {
            "invoice_id": invoice_id,
            "invoice_number": invoice.get("invoice_number", ""),
            "customer_id": str(invoice["customer_id"]),
            "customer_name": customer_name,
            "receipt_number": receipt_num,
            "amount": pay_amount,
            "payment_method": "Card",
            "status": "PENDING_VERIFICATION",
            "reference": ref_code,
            "card_last4": card_last4,
            "card_network": card_network,
            "card_holder": clean_holder,
            "expiry": payload.expiry.strip(),
            "notes": clean_optional(payload.notes) or f"Customer submitted Card ({card_network} ****{card_last4}) via portal",
            "payment_date": now_dt.strftime("%Y-%m-%d"),
            "recorded_by": current_user.get("email"),
            "recorded_by_name": current_user.get("full_name", current_user.get("email")),
            "recorded_by_role": current_user.get("role", "customer"),
            "status_history": [
                {
                    "from_status": None,
                    "to_status": "PENDING_VERIFICATION",
                    "changed_by": current_user.get("email"),
                    "changed_at": now_dt.isoformat(),
                    "reason": f"Customer authorized card ({card_network} ****{card_last4}); awaiting settlement/gateway verification",
                }
            ],
            "created_at": now_dt.isoformat(),
            "updated_at": now_dt.isoformat(),
        }

        res = payments_collection.insert_one(payment_doc)
        updated_invoice = recalculate_invoice_payment_status(inv_obj_id)

        log_audit_event(
            actor=current_user,
            action="SUBMIT_CARD_CLAIM",
            resource_type="payment",
            resource_id=str(res.inserted_id),
            details={
                "invoice_id": invoice_id,
                "invoice_number": invoice.get("invoice_number", ""),
                "amount": pay_amount,
                "card_last4": card_last4,
                "card_network": card_network,
                "reference": ref_code,
                "status": "PENDING_VERIFICATION",
            },
        )
        create_notification(
            title=f"New Card Payment Submitted: ₹{pay_amount:,.2f}",
            message=f"Customer submitted card payment ({card_network} ****{card_last4}) for Invoice {invoice.get('invoice_number', invoice_id)}. Verification required.",
            recipient_role="staff",
            notification_type="payment",
            link="/payments",
        )

        safe_p = serialize_document(payment_doc)
        safe_p["id"] = str(res.inserted_id)
        return {
            "message": f"Card payment of ₹{pay_amount:,.2f} ({card_network} ending in {card_last4}) submitted successfully. Your payment is PENDING verification by our accounts team.",
            "payment": safe_p,
            "invoice": updated_invoice,
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Database operation failed while submitting card payment.")


class UpiSimulationPayload(BaseModel):
    invoice_id: str
    amount: Optional[float] = None
    utr: Optional[str] = None


@app.post("/payments/upi/simulate-confirmation")
def simulate_upi_payment_confirmation(payload: UpiSimulationPayload):
    """
    Deprecated / disabled: Simulated UPI auto-confirmation is blocked for payment security.
    All payments must be verified by authorized staff/admin or through official bank webhooks.
    """
    raise HTTPException(
        status_code=403,
        detail="Simulated UPI payment auto-confirmation is disabled for security reasons. Payments must be verified through authorized staff/admin verification against bank records.",
    )


@app.get("/invoices/{invoice_id}/pdf")
def download_invoice_pdf(
    invoice_id: str,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    invoice_object_id = valid_object_id(invoice_id, "invoice")
    try:
        invoice = invoices_collection.find_one({"_id": invoice_object_id})
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")

        # Enforce Customer Data Isolation
        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(invoice.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to download this invoice.",
                )

        customer = None
        cust_id = invoice.get("customer_id")
        if cust_id and ObjectId.is_valid(cust_id):
            customer = customers_collection.find_one({"_id": ObjectId(cust_id)})

        company = company_settings_collection.find_one() or DEFAULT_COMPANY_SETTINGS
        serialized_inv = serialize_document(invoice)

        pdf_bytes = generate_invoice_pdf(serialized_inv, customer, company)
        inv_num = serialized_inv.get("invoice_number") or serialized_inv.get("id")
        filename = f"Invoice_{inv_num}.pdf"
        log_audit_event(
            actor=current_user,
            action="DOWNLOAD_INVOICE_PDF",
            module="Invoices",
            resource_type="invoice",
            resource_id=invoice_id,
            description=f"Invoice PDF {inv_num} downloaded by {current_user.get('email')}.",
            details={"invoice_number": inv_num},
        )
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate invoice PDF: {str(e)}")


# -------------------------
# Payment endpoints
# -------------------------

@app.post("/payments", status_code=201)
def create_payment(
    payment: PaymentCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_staff_or_admin),
):
    invoice_object_id = valid_object_id(payment.invoice_id, "invoice")
    amount = round(float(payment.amount), 2)
    payment_method = payment.payment_method.strip()

    if not payment_method:
        raise HTTPException(status_code=422, detail="Payment method cannot be empty.")

    inv_lock = get_invoice_lock(str(invoice_object_id))
    with inv_lock:
        try:
            invoice = invoices_collection.find_one({"_id": invoice_object_id})
            if invoice is None:
                raise HTTPException(status_code=404, detail="Invoice not found.")

            balance_due = round(float(invoice.get("balance_due", 0)), 2)

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

            # Prevent duplicate UPI transaction references
            clean_ref = clean_optional(payment.reference)
            norm_method = payment_method.upper()
            if "UPI" in norm_method and clean_ref:
                existing_upi = payments_collection.find_one({
                    "payment_method": {"$regex": "^UPI$", "$options": "i"},
                    "reference": clean_ref,
                    "status": {"$in": ["SUCCESS", "PENDING_VERIFICATION"]},
                })
                if existing_upi:
                    raise HTTPException(
                        status_code=409,
                        detail=f"UPI transaction with reference '{clean_ref}' has already been recorded.",
                    )

            now_dt = datetime.now(timezone.utc)
            payment_date_str = payment.payment_date
            if payment_date_str:
                payment_date_str = payment_date_str.strip()
                if not re.fullmatch(r"^\d{4}-\d{2}-\d{2}$", payment_date_str):
                    raise HTTPException(status_code=422, detail="Payment date must be in YYYY-MM-DD format.")
            else:
                payment_date_str = now_dt.strftime("%Y-%m-%d")

            receipt_number = get_next_receipt_number(now_dt)

            # Lookup customer name and invoice number for denormalized audit safety
            invoice_number = invoice.get("invoice_number", "")
            customer_name = ""
            cust_id = invoice.get("customer_id")
            if cust_id:
                try:
                    cust_obj = customers_collection.find_one({"_id": ObjectId(cust_id) if isinstance(cust_id, str) and ObjectId.is_valid(cust_id) else cust_id})
                    if cust_obj:
                        customer_name = cust_obj.get("name", "")
                except Exception:
                    customer_name = ""

            # Status rules:
            # Cheque: initially PENDING (does not reduce invoice balance until cleared)
            # UPI with is_verified=False: PENDING_VERIFICATION (needs staff UTR verification)
            # Cash, Card, Bank Transfer: SUCCESS
            if "CHEQUE" in norm_method:
                status = "PENDING"
            elif "UPI" in norm_method and payment.is_verified is False:
                status = "PENDING_VERIFICATION"
            else:
                status = "SUCCESS"

            payment_document = {
                "invoice_id": payment.invoice_id,
                "invoice_number": invoice_number,
                "customer_id": str(invoice["customer_id"]),
                "customer_name": customer_name,
                "receipt_number": receipt_number,
                "amount": amount,
                "payment_method": payment_method,
                "status": status,
                "reference": clean_ref,
                "notes": clean_optional(payment.notes),
                "payment_date": payment_date_str,
                "recorded_by": current_user.get("email"),
                "recorded_by_name": current_user.get("full_name", current_user.get("email")),
                "recorded_by_role": current_user.get("role", "staff"),
                "cheque_number": clean_optional(payment.cheque_number),
                "bank_name": clean_optional(payment.bank_name),
                "cheque_date": clean_optional(payment.cheque_date),
                "status_history": [
                    {
                        "from_status": None,
                        "to_status": status,
                        "changed_by": current_user.get("email"),
                        "changed_at": now_dt.isoformat(),
                        "reason": "Payment recorded",
                    }
                ],
                "created_at": now_dt.isoformat(),
                "updated_at": now_dt.isoformat(),
            }

            result = payments_collection.insert_one(payment_document)

            log_audit_event(
                actor=current_user,
                action="RECORD_PAYMENT",
                resource_type="payment",
                resource_id=str(result.inserted_id),
                details={
                    "amount": amount,
                    "payment_method": payment_method,
                    "status": status,
                    "receipt_number": receipt_number,
                    "invoice_number": invoice_number,
                    "customer_name": customer_name,
                },
            )
            create_notification(
                title=f"Payment Recorded ({payment_method}): ₹{amount:,.2f}",
                message=f"{payment_method} payment of ₹{amount:,.2f} recorded for Invoice {invoice_number}.",
                recipient_role="admin",
                customer_id=str(cust_id) if cust_id else None,
                notification_type="payment",
                link="/customer/payments",
            )

            # Synchronize invoice paid amounts and balance due according to verified payments
            updated_invoice = recalculate_invoice_payment_status(invoice_object_id)
            if updated_invoice is None:
                updated_invoice = serialize_document(invoices_collection.find_one({"_id": invoice_object_id}))

            safe_payment = serialize_document(payment_document)
            safe_payment["id"] = str(result.inserted_id)

            # Automatically dispatch payment receipt PDF via email for successful payments
            if status in ("SUCCESS", "CLEARED"):
                background_tasks.add_task(dispatch_payment_receipt_email, str(result.inserted_id))

            return {
                "message": "Payment recorded successfully.",
                "payment": safe_payment,
                "invoice": {
                    "id": payment.invoice_id,
                    "total_amount": float(updated_invoice["total_amount"]),
                    "amount_paid": float(updated_invoice.get("amount_paid", 0)),
                    "balance_due": float(updated_invoice.get("balance_due", 0)),
                    "status": updated_invoice.get("status", "UNPAID"),
                },
            }

        except HTTPException:
            raise
        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail="Database operation failed while recording the payment.",
            )


@app.patch("/payments/{payment_id}/status")
def update_payment_status(
    payment_id: str,
    status_update: PaymentStatusUpdate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_staff_or_admin),
):
    """
    Transition a payment's status (e.g. Cheque: PENDING -> CLEARED, BOUNCED, CANCELLED;
    UPI: PENDING_VERIFICATION -> SUCCESS, FAILED).
    Updates invoice balance atomically.
    """
    pay_obj_id = valid_object_id(payment_id, "payment")
    new_status = status_update.new_status.strip().upper()
    valid_statuses = {"PENDING", "CLEARED", "BOUNCED", "CANCELLED", "SUCCESS", "FAILED"}
    if new_status not in valid_statuses:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status '{new_status}'. Must be one of: {', '.join(sorted(valid_statuses))}",
        )

    try:
        payment = payments_collection.find_one({"_id": pay_obj_id})
        if not payment:
            raise HTTPException(status_code=404, detail="Payment record not found.")

        old_status = payment.get("status", "SUCCESS")
        if old_status == new_status:
            return {
                "message": f"Payment is already in status '{new_status}'.",
                "payment": serialize_document(payment),
            }

        now_iso = datetime.now(timezone.utc).isoformat()
        history_entry = {
            "from_status": old_status,
            "to_status": new_status,
            "changed_by": current_user.get("email"),
            "changed_at": now_iso,
            "reason": clean_optional(status_update.reason),
        }

        update_fields: dict[str, Any] = {
            "status": new_status,
            "updated_at": now_iso,
        }
        if new_status == "CLEARED":
            update_fields["cleared_at"] = now_iso
        elif new_status == "BOUNCED":
            update_fields["bounced_at"] = now_iso
            update_fields["bounce_reason"] = clean_optional(status_update.reason)

        payments_collection.update_one(
            {"_id": pay_obj_id},
            {
                "$set": update_fields,
                "$push": {"status_history": history_entry},
            },
        )

        # Recalculate invoice outstanding balance and payment status
        invoice_str_id = payment.get("invoice_id")
        updated_invoice = None
        if invoice_str_id:
            try:
                inv_obj_id = valid_object_id(invoice_str_id, "invoice")
                updated_invoice = recalculate_invoice_payment_status(inv_obj_id)
            except Exception as e:
                logger.warning(f"Could not recalculate invoice {invoice_str_id}: {e}")

        saved_payment = payments_collection.find_one({"_id": pay_obj_id})

        log_audit_event(
            actor=current_user,
            action="UPDATE_PAYMENT_STATUS",
            resource_type="payment",
            resource_id=payment_id,
            details={
                "from_status": old_status,
                "to_status": new_status,
                "reason": status_update.reason,
                "amount": payment.get("amount"),
            },
        )
        create_notification(
            title=f"Payment Status: {new_status}",
            message=f"Payment {payment.get('receipt_number', payment_id)} changed from {old_status} to {new_status}.",
            recipient_role="staff",
            customer_id=str(payment.get("customer_id")) if payment.get("customer_id") else None,
            notification_type="payment_status",
            link="/payments",
        )

        # Automatically dispatch payment receipt PDF via email upon verification success/cleared
        if new_status in ("SUCCESS", "CLEARED"):
            background_tasks.add_task(dispatch_payment_receipt_email, payment_id)

        return {
            "message": f"Payment status successfully updated to '{new_status}'.",
            "payment": serialize_document(saved_payment),
            "invoice": updated_invoice,
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Database operation failed while updating payment status.")


@app.get("/payments/card/config")
def get_card_gateway_config(current_user: dict = Depends(require_customer_or_staff_or_admin)):
    """
    Returns payment gateway configuration status without leaking secret credentials.
    Allows frontend to dynamically show whether real card checkout is available.
    """
    is_live = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)
    return {
        "is_configured": is_live,
        "gateway_name": "Razorpay" if is_live else None,
        "key_id": RAZORPAY_KEY_ID if is_live else None,
    }


@app.post("/payments/card/create-order")
def create_card_order(
    payload: CardOrderCreate,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Creates a secure payment gateway order for card payments based on exact invoice balance.
    Requires live gateway credentials in the server environment.
    """
    if not (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET):
        raise HTTPException(
            status_code=503,
            detail="Online Card Payment Gateway is not configured. Please contact the administrator to set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
        )

    inv_obj_id = valid_object_id(payload.invoice_id, "invoice")
    try:
        invoice = invoices_collection.find_one({"_id": inv_obj_id})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found.")

        # Customer isolation
        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(invoice.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to pay this invoice.",
                )

        balance = round(float(invoice.get("balance_due", 0)), 2)
        if balance <= 0:
            raise HTTPException(status_code=400, detail="This invoice is already fully paid.")

        order_amount = round(payload.amount if payload.amount else balance, 2)
        if order_amount > balance:
            raise HTTPException(
                status_code=400,
                detail=f"Payment amount {order_amount:.2f} exceeds outstanding balance {balance:.2f}.",
            )

        amount_paise = int(order_amount * 100)
        now_ts = int(datetime.now(timezone.utc).timestamp())

        order_id = f"order_rzp_{payload.invoice_id[-6:]}_{now_ts}"

        return {
            "order_id": order_id,
            "amount": order_amount,
            "amount_paise": amount_paise,
            "currency": "INR",
            "key_id": RAZORPAY_KEY_ID,
            "invoice_id": payload.invoice_id,
            "invoice_number": invoice.get("invoice_number", ""),
            "is_test_mode": False,
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Database query failed while creating card order.")


@app.post("/payments/card/verify")
def verify_card_payment(
    payload: CardPaymentVerify,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Verifies cryptographic signature from gateway checkout and records verified card payment.
    Enforces idempotency to prevent duplicate transaction recording.
    """
    inv_obj_id = valid_object_id(payload.invoice_id, "invoice")
    try:
        invoice = invoices_collection.find_one({"_id": inv_obj_id})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found.")

        # Customer isolation
        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(invoice.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to pay this invoice.",
                )

        # 1. Cryptographic signature check
        if not verify_razorpay_signature(payload.order_id, payload.payment_id, payload.signature):
            raise HTTPException(status_code=400, detail="Invalid payment gateway signature. Verification failed.")

        # 2. Idempotency check: prevent duplicate gateway payment processing
        existing = payments_collection.find_one({"gateway_payment_id": payload.payment_id})
        if existing:
            return {
                "message": "Payment has already been verified and recorded (idempotent).",
                "payment": serialize_document(existing),
                "invoice": serialize_document(invoice),
            }

        balance = round(float(invoice.get("balance_due", 0)), 2)
        pay_amount = round(payload.amount if payload.amount else balance, 2)
        if pay_amount <= 0 or pay_amount > balance:
            pay_amount = balance

        now_dt = datetime.now(timezone.utc)
        receipt_number = get_next_receipt_number(now_dt)

        customer_name = ""
        cust_id = invoice.get("customer_id")
        if cust_id:
            try:
                cust_obj = customers_collection.find_one({"_id": ObjectId(cust_id) if isinstance(cust_id, str) and ObjectId.is_valid(cust_id) else cust_id})
                if cust_obj:
                    customer_name = cust_obj.get("name", "")
            except Exception:
                customer_name = ""

        payment_doc = {
            "invoice_id": payload.invoice_id,
            "invoice_number": invoice.get("invoice_number", ""),
            "customer_id": str(invoice["customer_id"]),
            "customer_name": customer_name,
            "receipt_number": receipt_number,
            "amount": pay_amount,
            "payment_method": "Card",
            "status": "SUCCESS",
            "gateway_name": "razorpay",
            "gateway_order_id": payload.order_id,
            "gateway_payment_id": payload.payment_id,
            "reference": payload.payment_id,
            "notes": f"Gateway Card Payment (Order: {payload.order_id})",
            "payment_date": now_dt.strftime("%Y-%m-%d"),
            "recorded_by": current_user.get("email"),
            "recorded_by_name": current_user.get("full_name", current_user.get("email")),
            "recorded_by_role": current_user.get("role", "staff"),
            "status_history": [
                {
                    "from_status": None,
                    "to_status": "SUCCESS",
                    "changed_by": current_user.get("email"),
                    "changed_at": now_dt.isoformat(),
                    "reason": "Card gateway payment captured and signature verified",
                }
            ],
            "created_at": now_dt.isoformat(),
            "updated_at": now_dt.isoformat(),
        }

        res = payments_collection.insert_one(payment_doc)
        updated_invoice = recalculate_invoice_payment_status(inv_obj_id)
        saved_payment = payments_collection.find_one({"_id": res.inserted_id})
        background_tasks.add_task(dispatch_payment_receipt_email, str(res.inserted_id))

        return {
            "message": "Card payment verified and recorded successfully.",
            "payment": serialize_document(saved_payment),
            "invoice": updated_invoice,
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Database error during card verification.")


@app.post("/payments/card/webhook")
async def card_payment_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receives and processes server-to-server Razorpay webhooks.
    Validates X-Razorpay-Signature header against RAZORPAY_WEBHOOK_SECRET.
    """
    body = await request.body()
    webhook_sig = request.headers.get("X-Razorpay-Signature", "")
    if not RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Webhook processing is disabled: RAZORPAY_WEBHOOK_SECRET is not configured on the server.",
        )
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, webhook_sig):
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    try:
        data = json.loads(body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload.")

    event = data.get("event")
    event_id = data.get("id", "")

    # Idempotent webhook handling
    if event_id:
        existing_wh = counters_collection.find_one({"_id": f"webhook_{event_id}"})
        if existing_wh:
            return {"status": "already_processed"}
        counters_collection.insert_one({
            "_id": f"webhook_{event_id}",
            "processed_at": datetime.now(timezone.utc).isoformat(),
        })

    if event in ["payment.captured", "order.paid"]:
        payment_entity = data.get("payload", {}).get("payment", {}).get("entity", {})
        payment_id = payment_entity.get("id")
        order_id = payment_entity.get("order_id")
        notes = payment_entity.get("notes", {})
        invoice_id = notes.get("invoice_id")
        amount = round(float(payment_entity.get("amount", 0)) / 100.0, 2)

        if invoice_id and payment_id:
            try:
                inv_obj_id = valid_object_id(invoice_id, "invoice")
                existing = payments_collection.find_one({"gateway_payment_id": payment_id})
                if not existing:
                    inv = invoices_collection.find_one({"_id": inv_obj_id})
                    if inv:
                        now_dt = datetime.now(timezone.utc)
                        doc = {
                            "invoice_id": invoice_id,
                            "invoice_number": inv.get("invoice_number", ""),
                            "customer_id": str(inv["customer_id"]),
                            "receipt_number": get_next_receipt_number(now_dt),
                            "amount": amount,
                            "payment_method": "Card",
                            "status": "SUCCESS",
                            "gateway_name": "razorpay",
                            "gateway_order_id": order_id,
                            "gateway_payment_id": payment_id,
                            "reference": payment_id,
                            "notes": "Verified via Razorpay Webhook",
                            "payment_date": now_dt.strftime("%Y-%m-%d"),
                            "recorded_by": "webhook@razorpay",
                            "recorded_by_name": "Razorpay Webhook",
                            "status_history": [
                                {
                                    "from_status": None,
                                    "to_status": "SUCCESS",
                                    "changed_by": "webhook@razorpay",
                                    "changed_at": now_dt.isoformat(),
                                    "reason": f"Captured via webhook event {event}",
                                }
                            ],
                            "created_at": now_dt.isoformat(),
                            "updated_at": now_dt.isoformat(),
                        }
                        res_insert = payments_collection.insert_one(doc)
                        recalculate_invoice_payment_status(inv_obj_id)
                        background_tasks.add_task(dispatch_payment_receipt_email, str(res_insert.inserted_id))
            except Exception as e:
                logger.error(f"Webhook processing error for invoice {invoice_id}: {e}")

    return {"status": "ok"}


@app.get("/payments/summary")
def get_payments_summary(current_user: dict = Depends(require_staff_or_admin)):
    """Aggregates payment statistics for the Payment Dashboard."""
    try:
        all_payments = list(payments_collection.find())

        total_received = 0.0
        total_pending = 0.0
        total_cash = 0.0
        total_upi = 0.0
        total_card = 0.0
        total_cleared_cheque = 0.0
        total_pending_cheque = 0.0
        total_bounced_failed = 0.0

        counts = {
            "total": len(all_payments),
            "received": 0,
            "pending": 0,
            "bounced_failed": 0,
            "cash": 0,
            "upi": 0,
            "card": 0,
            "cheque": 0,
        }

        for p in all_payments:
            amt = round(float(p.get("amount", 0)), 2)
            st = p.get("status", "SUCCESS").upper()
            meth = p.get("payment_method", "").upper()

            if st in ["SUCCESS", "CLEARED"]:
                total_received += amt
                counts["received"] += 1
            elif st in ["PENDING", "PENDING_VERIFICATION"]:
                total_pending += amt
                counts["pending"] += 1
            elif st in ["BOUNCED", "FAILED", "CANCELLED"]:
                total_bounced_failed += amt
                counts["bounced_failed"] += 1

            if "CASH" in meth and st == "SUCCESS":
                total_cash += amt
                counts["cash"] += 1
            elif "UPI" in meth:
                if st == "SUCCESS":
                    total_upi += amt
                counts["upi"] += 1
            elif "CARD" in meth:
                if st == "SUCCESS":
                    total_card += amt
                counts["card"] += 1
            elif "CHEQUE" in meth:
                counts["cheque"] += 1
                if st == "CLEARED":
                    total_cleared_cheque += amt
                elif st == "PENDING":
                    total_pending_cheque += amt

        return {
            "total_received": round(total_received, 2),
            "total_pending": round(total_pending, 2),
            "total_cash": round(total_cash, 2),
            "total_upi": round(total_upi, 2),
            "total_card": round(total_card, 2),
            "total_cleared_cheque": round(total_cleared_cheque, 2),
            "total_pending_cheque": round(total_pending_cheque, 2),
            "total_bounced_failed": round(total_bounced_failed, 2),
            "counts": counts,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not calculate payment summary.")


@app.get("/payments/{payment_id}/receipt")
def get_payment_receipt(
    payment_id: str,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """Generates structured receipt data for a payment."""
    pay_obj_id = valid_object_id(payment_id, "payment")
    try:
        payment = payments_collection.find_one({"_id": pay_obj_id})
        if not payment:
            raise HTTPException(status_code=404, detail="Payment record not found.")

        # Enforce Customer Data Isolation
        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(payment.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to view this receipt.",
                )

        inv_obj_id = valid_object_id(payment["invoice_id"], "invoice")
        invoice = invoices_collection.find_one({"_id": inv_obj_id})
        if not invoice:
            raise HTTPException(status_code=404, detail="Associated invoice not found.")

        customer = None
        cust_id = invoice.get("customer_id")
        if cust_id:
            try:
                customer = customers_collection.find_one({"_id": ObjectId(cust_id) if isinstance(cust_id, str) and ObjectId.is_valid(cust_id) else cust_id})
            except Exception:
                customer = None
        customer = customer or {}

        company = company_settings_collection.find_one() or DEFAULT_COMPANY_SETTINGS

        st = payment.get("status", "SUCCESS")
        is_cleared = st in ["SUCCESS", "CLEARED"]

        inv_due = float(invoice.get("balance_due", 0.0))
        pay_amount = float(payment.get("amount", 0.0))
        previous_balance = round(inv_due + pay_amount, 2)
        remaining_balance = round(inv_due, 2)

        invoice_data = serialize_document(invoice)
        invoice_data["id"] = str(invoice["_id"])
        invoice_data["_id"] = str(invoice["_id"])
        invoice_data["total_amount"] = round(float(invoice.get("total_amount", 0)), 2)
        invoice_data["amount_paid"] = round(float(invoice.get("amount_paid", 0)), 2)
        invoice_data["balance_due"] = round(inv_due, 2)

        return {
            "id": str(pay_obj_id),
            "_id": str(pay_obj_id),
            "payment_id": str(pay_obj_id),
            "receipt_number": payment.get("receipt_number", f"REC-{str(pay_obj_id)[-6:]}"),
            "payment_date": payment.get("payment_date"),
            "payment_method": payment.get("payment_method"),
            "amount": round(pay_amount, 2),
            "status": st,
            "is_cleared": is_cleared,
            "reference": payment.get("reference"),
            "transaction_id": payment.get("transaction_id") or payment.get("reference"),
            "notes": payment.get("notes"),
            "recorded_by": payment.get("recorded_by"),
            "recorded_by_name": payment.get("recorded_by_name"),
            "recorded_by_role": payment.get("recorded_by_role"),
            "cheque_number": payment.get("cheque_number"),
            "bank_name": payment.get("bank_name"),
            "cheque_date": payment.get("cheque_date"),
            "bounce_reason": payment.get("bounce_reason"),
            "gateway_order_id": payment.get("gateway_order_id"),
            "gateway_payment_id": payment.get("gateway_payment_id"),
            "created_at": payment.get("created_at"),
            "previous_balance": previous_balance,
            "remaining_balance": remaining_balance,
            "invoice": invoice_data,
            "customer": {
                "id": str(customer.get("_id", "")) if customer.get("_id") else "",
                "name": customer.get("name", invoice.get("customer_name", "")),
                "email": customer.get("email", invoice.get("customer_email", "")),
                "phone": customer.get("phone", invoice.get("customer_phone", "")),
                "gstin": customer.get("gstin", invoice.get("customer_gstin", "")),
                "address": customer.get("billing_address", invoice.get("billing_address", "")),
            },
            "company": {
                "company_name": company.get("company_name", "Viora Bills"),
                "business_address": company.get("business_address", ""),
                "gstin": company.get("gstin", ""),
                "phone": company.get("phone", ""),
                "email": company.get("email", ""),
                "bank_name": company.get("bank_name", ""),
                "account_number": company.get("account_number", ""),
                "ifsc_code": company.get("ifsc_code", ""),
                "upi_id": company.get("upi_id", ""),
                "logo_url": company.get("logo_url", ""),
            },
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Database query failed while generating receipt.")


@app.get("/payments/{payment_id}/receipt/pdf")
def download_payment_receipt_pdf(
    payment_id: str,
    token: Optional[str] = Query(None),
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Generates and downloads an authentic, GST-compliant payment receipt PDF.
    Enforces customer isolation (customers can only access receipts for their own invoices).
    """
    pay_obj_id = valid_object_id(payment_id, "payment")
    try:
        payment = payments_collection.find_one({"_id": pay_obj_id})
        if not payment:
            raise HTTPException(status_code=404, detail="Payment record not found.")

        # Enforce Customer Data Isolation
        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(payment.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to view or download this receipt.",
                )

        pay_status = (payment.get("status") or "").upper()
        if pay_status in ("BOUNCED", "FAILED", "CANCELLED", "REJECTED"):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot generate official receipt for a {pay_status} payment transaction.",
            )

        inv_obj_id = valid_object_id(payment["invoice_id"], "invoice")
        invoice = invoices_collection.find_one({"_id": inv_obj_id})
        if not invoice:
            raise HTTPException(status_code=404, detail="Associated invoice not found.")

        customer = None
        cust_id = invoice.get("customer_id")
        if cust_id:
            try:
                customer = customers_collection.find_one({"_id": ObjectId(cust_id) if isinstance(cust_id, str) and ObjectId.is_valid(cust_id) else cust_id})
            except Exception:
                customer = None
        customer = customer or {}

        company = company_settings_collection.find_one() or DEFAULT_COMPANY_SETTINGS

        pdf_bytes = generate_payment_receipt_pdf(payment, invoice, customer, company)
        rec_num = payment.get("receipt_number") or f"REC-{str(pay_obj_id)[-6:]}"
        filename = f"Receipt_{rec_num}.pdf"

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate receipt PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate payment receipt PDF: {str(e)}")


@app.get("/payments/csv")
def export_payments_csv(current_user: dict = Depends(require_staff_or_admin)):
    """Export payments history to CSV."""
    try:
        payments = list(payments_collection.find().sort("_id", -1))
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Payment ID",
            "Receipt Number",
            "Invoice ID",
            "Invoice Number",
            "Customer ID",
            "Customer Name",
            "Payment Date",
            "Amount",
            "Payment Method",
            "Status",
            "Reference",
            "Recorded By",
            "Notes",
            "Recorded At",
        ])
        for p in payments:
            writer.writerow([
                str(p.get("_id", "")),
                p.get("receipt_number", ""),
                p.get("invoice_id", ""),
                p.get("invoice_number", ""),
                p.get("customer_id", ""),
                p.get("customer_name", ""),
                p.get("payment_date", ""),
                p.get("amount", 0.0),
                p.get("payment_method", ""),
                p.get("status", "SUCCESS"),
                p.get("reference", ""),
                p.get("recorded_by", ""),
                p.get("notes", ""),
                p.get("created_at", ""),
            ])
        csv_data = output.getvalue()
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=viora_payments.csv"},
        )
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not export payments to CSV.")


@app.get("/payments")
def get_payments(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    skip: Optional[int] = Query(default=None, ge=0),
    search: Optional[str] = None,
    payment_method: Optional[str] = None,
    status: Optional[str] = None,
    customer_id: Optional[str] = None,
    recorded_by: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    current_user: dict = Depends(require_staff_or_admin),
):
    try:
        query: dict[str, Any] = {}
        if search:
            s = re.escape(search.strip())
            query["$or"] = [
                {"invoice_id": {"$regex": s, "$options": "i"}},
                {"invoice_number": {"$regex": s, "$options": "i"}},
                {"receipt_number": {"$regex": s, "$options": "i"}},
                {"customer_name": {"$regex": s, "$options": "i"}},
                {"reference": {"$regex": s, "$options": "i"}},
                {"cheque_number": {"$regex": s, "$options": "i"}},
                {"notes": {"$regex": s, "$options": "i"}},
            ]
        if payment_method and payment_method.upper() != "ALL":
            query["payment_method"] = {"$regex": f"^{re.escape(payment_method.strip())}$", "$options": "i"}

        if status and status.upper() != "ALL":
            query["status"] = {"$regex": f"^{re.escape(status.strip())}$", "$options": "i"}

        if customer_id and customer_id.upper() != "ALL":
            query["customer_id"] = customer_id.strip()

        if recorded_by and recorded_by.upper() != "ALL":
            query["recorded_by"] = {"$regex": re.escape(recorded_by.strip()), "$options": "i"}

        date_conditions = {}
        if start_date:
            date_conditions["$gte"] = start_date.strip()
        if end_date:
            date_conditions["$lte"] = end_date.strip()
        if date_conditions:
            query["payment_date"] = date_conditions

        valid_sorts = {
            "created_at": "created_at",
            "_id": "_id",
            "payment_date": "payment_date",
            "amount": "amount",
            "payment_method": "payment_method",
            "status": "status",
            "receipt_number": "receipt_number",
        }
        sort_field = valid_sorts.get(sort_by, "created_at")
        sort_order = -1 if sort_dir.lower() == "desc" else 1

        total = payments_collection.count_documents(query)
        actual_skip = skip if skip is not None else (page - 1) * limit
        actual_page = (actual_skip // limit) + 1 if skip is not None else page

        payments = list(
            payments_collection.find(query).sort(sort_field, sort_order).skip(actual_skip).limit(limit)
        )
        serialized = []
        for p in payments:
            sp = serialize_document(p)
            if "status" not in sp or not sp["status"]:
                sp["status"] = "SUCCESS"
            serialized.append(sp)

        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        return {
            "items": serialized,
            "payments": serialized,
            "total": total,
            "count": total,
            "page": actual_page,
            "limit": limit,
            "total_pages": total_pages,
        }
    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Could not retrieve payment records. Check the database connection.",
        )


# -------------------------
# Company settings endpoints
# -------------------------

@app.get("/settings/company")
def get_company_settings(current_user: dict = Depends(require_staff_or_admin)):
    try:
        settings = company_settings_collection.find_one()
        if settings is None:
            return {"settings": dict(DEFAULT_COMPANY_SETTINGS)}
        return {"settings": serialize_document(settings)}
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve company settings.")


@app.get("/settings/company/public")
def get_public_company_settings():
    """Exposes strictly public company and payment details necessary for invoice rendering and payments."""
    try:
        settings = company_settings_collection.find_one() or DEFAULT_COMPANY_SETTINGS
        public_data = {
            "company_name": settings.get("company_name", "Viora Bills"),
            "business_address": settings.get("business_address", ""),
            "state": settings.get("state", ""),
            "pincode": settings.get("pincode", ""),
            "gstin": settings.get("gstin", ""),
            "phone": settings.get("phone", ""),
            "email": settings.get("email", ""),
            "logo_url": settings.get("logo_url"),
            "bank_name": settings.get("bank_name", ""),
            "account_holder_name": settings.get("account_holder_name", ""),
            "account_number": settings.get("account_number", ""),
            "ifsc_code": settings.get("ifsc_code", ""),
            "upi_id": settings.get("upi_id", ""),
        }
        return {"company": public_data}
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve public company details.")


@app.put("/settings/company")
def update_company_settings(
    settings_in: CompanySettingsUpdate,
    current_user: dict = Depends(require_admin_settings),
):

    company_name = settings_in.company_name.strip()
    business_address = settings_in.business_address.strip()
    gstin = clean_optional(settings_in.gstin)
    phone = clean_optional(settings_in.phone)
    email = clean_optional(settings_in.email)
    state = clean_optional(settings_in.state)
    pincode = clean_optional(settings_in.pincode)
    logo_url = clean_optional(settings_in.logo_url)
    bank_name = clean_optional(settings_in.bank_name)
    account_holder_name = clean_optional(settings_in.account_holder_name)
    account_number = clean_optional(settings_in.account_number)
    ifsc_code = clean_optional(settings_in.ifsc_code)
    upi_id = clean_optional(settings_in.upi_id)

    if gstin:
        gstin = gstin.upper().strip()
        if not re.fullmatch(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$", gstin):
            raise HTTPException(
                status_code=422,
                detail="Invalid GSTIN format. Expected 15 characters (e.g. 27AABCU9603R1ZM).",
            )

    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="Please enter a valid email address.")

    if phone and not re.fullmatch(r"^[0-9+\-\s()]{7,25}$", phone):
        raise HTTPException(status_code=422, detail="Please enter a valid contact phone number.")

    if ifsc_code:
        ifsc_code = ifsc_code.upper().strip()
        if not re.fullmatch(r"^[A-Z]{4}0[A-Z0-9]{6}$", ifsc_code):
            raise HTTPException(
                status_code=422,
                detail="Invalid IFSC code format. Expected 11 characters (e.g. HDFC0001234).",
            )

    if upi_id:
        upi_id = upi_id.lower().strip()
        if not re.fullmatch(r"^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$", upi_id):
            raise HTTPException(
                status_code=422,
                detail="Invalid UPI ID format. Expected format like name@upi or phone@bank.",
            )

    doc = {
        "company_name": company_name,
        "business_address": business_address,
        "gstin": gstin,
        "phone": phone,
        "email": email,
        "state": state,
        "pincode": pincode,
        "logo_url": logo_url,
        "bank_name": bank_name,
        "account_holder_name": account_holder_name,
        "account_number": account_number,
        "ifsc_code": ifsc_code,
        "upi_id": upi_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        existing = company_settings_collection.find_one()
        if existing:
            company_settings_collection.update_one({"_id": existing["_id"]}, {"$set": doc})
            updated = company_settings_collection.find_one({"_id": existing["_id"]})
        else:
            res = company_settings_collection.insert_one(doc)
            updated = company_settings_collection.find_one({"_id": res.inserted_id})

        log_audit_event(
            actor=current_user,
            action="UPDATE_COMPANY_SETTINGS",
            resource_type="company_settings",
            details={"company_name": company_name, "gstin": gstin, "upi_id": upi_id},
        )
        return {
            "message": "Company profile and bank details updated successfully.",
            "settings": serialize_document(updated),
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not save company settings.")


# -------------------------
# Reports & Analytics endpoints
# -------------------------

@app.get("/reports/sales-summary")
def get_sales_summary(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    current_user: dict = Depends(require_staff_or_admin),
):
    try:
        invoices = list(invoices_collection.find())
        filtered = []
        for inv in invoices:
            inv_dt = get_invoice_datetime(inv)
            inv_date_str = inv_dt.strftime("%Y-%m-%d")
            if start_date and inv_date_str < start_date:
                continue
            if end_date and inv_date_str > end_date:
                continue
            filtered.append((inv, inv_dt, inv_date_str))

        total_sales = round(sum(float(inv.get("total_amount", 0)) for inv, _, _ in filtered), 2)
        total_invoices = len(filtered)
        paid_amount = round(sum(float(inv.get("amount_paid", 0)) for inv, _, _ in filtered), 2)
        pending_amount = round(sum(float(inv.get("balance_due", 0)) for inv, _, _ in filtered), 2)
        taxable_sales = round(sum(float(inv.get("taxable_amount", 0)) for inv, _, _ in filtered), 2)
        total_gst = round(sum(float(inv.get("gst_amount", 0)) for inv, _, _ in filtered), 2)
        total_discount = round(sum(float(inv.get("discount", 0)) for inv, _, _ in filtered), 2)

        weekly_map = {}
        monthly_map = {}
        daily_map = {}

        for inv, inv_dt, date_str in filtered:
            iso_year, iso_week, _ = inv_dt.isocalendar()
            week_key = f"{iso_year}-W{iso_week:02d}"
            month_key = inv_dt.strftime("%Y-%m")
            amt = float(inv.get("total_amount", 0))
            paid = float(inv.get("amount_paid", 0))

            if week_key not in weekly_map:
                weekly_map[week_key] = {"week": week_key, "sales": 0.0, "paid": 0.0, "count": 0}
            weekly_map[week_key]["sales"] = round(weekly_map[week_key]["sales"] + amt, 2)
            weekly_map[week_key]["paid"] = round(weekly_map[week_key]["paid"] + paid, 2)
            weekly_map[week_key]["count"] += 1

            if month_key not in monthly_map:
                monthly_map[month_key] = {
                    "month": month_key,
                    "label": inv_dt.strftime("%b %Y"),
                    "sales": 0.0,
                    "paid": 0.0,
                    "count": 0,
                }
            monthly_map[month_key]["sales"] = round(monthly_map[month_key]["sales"] + amt, 2)
            monthly_map[month_key]["paid"] = round(monthly_map[month_key]["paid"] + paid, 2)
            monthly_map[month_key]["count"] += 1

            if date_str not in daily_map:
                daily_map[date_str] = {"date": date_str, "sales": 0.0, "paid": 0.0, "count": 0}
            daily_map[date_str]["sales"] = round(daily_map[date_str]["sales"] + amt, 2)
            daily_map[date_str]["paid"] = round(daily_map[date_str]["paid"] + paid, 2)
            daily_map[date_str]["count"] += 1

        weekly_sales = sorted(weekly_map.values(), key=lambda x: x["week"])
        monthly_sales = sorted(monthly_map.values(), key=lambda x: x["month"])
        sales_trend = sorted(daily_map.values(), key=lambda x: x["date"])

        return {
            "summary": {
                "total_sales": total_sales,
                "total_invoices": total_invoices,
                "paid_amount": paid_amount,
                "pending_amount": pending_amount,
                "taxable_sales": taxable_sales,
                "total_gst": total_gst,
                "total_discount": total_discount,
                "start_date": start_date,
                "end_date": end_date,
            },
            "weekly_sales": weekly_sales,
            "monthly_sales": monthly_sales,
            "sales_trend": sales_trend,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not generate sales summary.")


@app.get("/reports/gst")
def get_gst_report(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    current_user: dict = Depends(require_staff_or_admin),
):
    try:
        settings = company_settings_collection.find_one() or DEFAULT_COMPANY_SETTINGS
        company_state = (settings.get("state") or "Maharashtra").strip().lower()

        customers = {str(c["_id"]): c for c in customers_collection.find()}
        invoices = list(invoices_collection.find())

        monthly_map = {}
        invoices_breakdown = []

        total_taxable = 0.0
        total_cgst_billed = 0.0
        total_cgst_collected = 0.0
        total_cgst_liability = 0.0
        total_sgst_billed = 0.0
        total_sgst_collected = 0.0
        total_sgst_liability = 0.0
        total_igst_billed = 0.0
        total_igst_collected = 0.0
        total_igst_liability = 0.0

        for inv in invoices:
            inv_dt = get_invoice_datetime(inv)
            inv_date_str = inv_dt.strftime("%Y-%m-%d")
            if start_date and inv_date_str < start_date:
                continue
            if end_date and inv_date_str > end_date:
                continue

            cust_id = str(inv.get("customer_id", ""))
            cust = customers.get(cust_id, {})
            cust_addr = (cust.get("address") or "").lower()
            is_intra = (company_state in cust_addr) if cust_addr else True

            inv_taxable = round(float(inv.get("taxable_amount", 0)), 2)
            inv_gst = round(float(inv.get("gst_amount", 0)), 2)
            inv_total = round(float(inv.get("total_amount", 0)), 2)
            inv_paid = round(float(inv.get("amount_paid", 0)), 2)

            paid_ratio = min(1.0, max(0.0, inv_paid / inv_total)) if inv_total > 0 else (1.0 if inv.get("balance_due", 0) <= 0 else 0.0)

            if is_intra:
                supply_type = "Intra-State"
                cgst_b = round(inv_gst / 2.0, 2)
                sgst_b = round(inv_gst - cgst_b, 2)
                igst_b = 0.0
            else:
                supply_type = "Inter-State"
                cgst_b = 0.0
                sgst_b = 0.0
                igst_b = inv_gst

            cgst_c = round(cgst_b * paid_ratio, 2)
            cgst_l = round(cgst_b - cgst_c, 2)
            sgst_c = round(sgst_b * paid_ratio, 2)
            sgst_l = round(sgst_b - sgst_c, 2)
            igst_c = round(igst_b * paid_ratio, 2)
            igst_l = round(igst_b - igst_c, 2)

            total_taxable += inv_taxable
            total_cgst_billed += cgst_b
            total_cgst_collected += cgst_c
            total_cgst_liability += cgst_l
            total_sgst_billed += sgst_b
            total_sgst_collected += sgst_c
            total_sgst_liability += sgst_l
            total_igst_billed += igst_b
            total_igst_collected += igst_c
            total_igst_liability += igst_l

            m_key = inv_dt.strftime("%Y-%m")
            if m_key not in monthly_map:
                monthly_map[m_key] = {
                    "month": m_key,
                    "label": inv_dt.strftime("%b %Y"),
                    "taxable_sales": 0.0,
                    "cgst_collected": 0.0,
                    "cgst_liability": 0.0,
                    "sgst_collected": 0.0,
                    "sgst_liability": 0.0,
                    "igst_collected": 0.0,
                    "igst_liability": 0.0,
                    "total_gst_collected": 0.0,
                    "total_gst_liability": 0.0,
                }
            monthly_map[m_key]["taxable_sales"] = round(monthly_map[m_key]["taxable_sales"] + inv_taxable, 2)
            monthly_map[m_key]["cgst_collected"] = round(monthly_map[m_key]["cgst_collected"] + cgst_c, 2)
            monthly_map[m_key]["cgst_liability"] = round(monthly_map[m_key]["cgst_liability"] + cgst_l, 2)
            monthly_map[m_key]["sgst_collected"] = round(monthly_map[m_key]["sgst_collected"] + sgst_c, 2)
            monthly_map[m_key]["sgst_liability"] = round(monthly_map[m_key]["sgst_liability"] + sgst_l, 2)
            monthly_map[m_key]["igst_collected"] = round(monthly_map[m_key]["igst_collected"] + igst_c, 2)
            monthly_map[m_key]["igst_liability"] = round(monthly_map[m_key]["igst_liability"] + igst_l, 2)
            monthly_map[m_key]["total_gst_collected"] = round(monthly_map[m_key]["total_gst_collected"] + cgst_c + sgst_c + igst_c, 2)
            monthly_map[m_key]["total_gst_liability"] = round(monthly_map[m_key]["total_gst_liability"] + cgst_l + sgst_l + igst_l, 2)

            invoices_breakdown.append({
                "invoice_id": str(inv["_id"]),
                "customer_name": inv.get("customer_name", "—"),
                "date": inv_date_str,
                "supply_type": supply_type,
                "taxable_amount": inv_taxable,
                "cgst_billed": cgst_b,
                "cgst_collected": cgst_c,
                "cgst_liability": cgst_l,
                "sgst_billed": sgst_b,
                "sgst_collected": sgst_c,
                "sgst_liability": sgst_l,
                "igst_billed": igst_b,
                "igst_collected": igst_c,
                "igst_liability": igst_l,
                "total_gst_billed": inv_gst,
                "total_gst_collected": round(cgst_c + sgst_c + igst_c, 2),
                "total_gst_liability": round(cgst_l + sgst_l + igst_l, 2),
                "status": inv.get("status", "UNPAID"),
            })

        monthly_breakdown = sorted(monthly_map.values(), key=lambda x: x["month"])

        return {
            "summary": {
                "total_taxable_sales": round(total_taxable, 2),
                "total_gst_collected": round(total_cgst_collected + total_sgst_collected + total_igst_collected, 2),
                "total_gst_liability": round(total_cgst_liability + total_sgst_liability + total_igst_liability, 2),
                "cgst_collected": round(total_cgst_collected, 2),
                "cgst_liability": round(total_cgst_liability, 2),
                "sgst_collected": round(total_sgst_collected, 2),
                "sgst_liability": round(total_sgst_liability, 2),
                "igst_collected": round(total_igst_collected, 2),
                "igst_liability": round(total_igst_liability, 2),
                "company_state": settings.get("state") or "Maharashtra",
                "start_date": start_date,
                "end_date": end_date,
            },
            "monthly_breakdown": monthly_breakdown,
            "invoices_breakdown": invoices_breakdown,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not generate GST report.")


@app.get("/reports/gst/csv")
def export_gst_csv(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    current_user: dict = Depends(require_staff_or_admin),
):
    report = get_gst_report(start_date=start_date, end_date=end_date, current_user=current_user)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Invoice ID",
        "Customer Name",
        "Invoice Date",
        "Supply Type",
        "Taxable Amount",
        "CGST Billed",
        "CGST Collected",
        "CGST Liability",
        "SGST Billed",
        "SGST Collected",
        "SGST Liability",
        "IGST Billed",
        "IGST Collected",
        "IGST Liability",
        "Total GST Billed",
        "Total GST Collected",
        "Total GST Liability",
        "Status",
    ])
    for row in report.get("invoices_breakdown", []):
        writer.writerow([
            row["invoice_id"],
            row["customer_name"],
            row["date"],
            row["supply_type"],
            row["taxable_amount"],
            row["cgst_billed"],
            row["cgst_collected"],
            row["cgst_liability"],
            row["sgst_billed"],
            row["sgst_collected"],
            row["sgst_liability"],
            row["igst_billed"],
            row["igst_collected"],
            row["igst_liability"],
            row["total_gst_billed"],
            row["total_gst_collected"],
            row["total_gst_liability"],
            row["status"],
        ])
    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=viora_gst_tax_report.csv"},
    )


@app.get("/reports/aging")
def get_accounts_receivable_aging(
    as_of_date: Optional[str] = Query(default=None),
    customer_id: Optional[str] = Query(default=None),
    current_user: dict = Depends(require_staff_or_admin),
):
    try:
        now_utc = datetime.now(timezone.utc)
        if as_of_date:
            try:
                as_of_dt = datetime.strptime(as_of_date.strip()[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except ValueError:
                raise HTTPException(status_code=422, detail="as_of_date must be in YYYY-MM-DD format.")
        else:
            as_of_dt = now_utc

        query = {"balance_due": {"$gt": 0}}
        if customer_id:
            query["customer_id"] = customer_id

        unpaid_invoices = list(invoices_collection.find(query).sort("due_date", 1))

        total_receivable = 0.0
        total_0_30 = 0.0
        total_31_60 = 0.0
        total_61_plus = 0.0

        invoice_details = []

        for inv in unpaid_invoices:
            inv_dt = get_invoice_datetime(inv)
            due_dt = get_invoice_due_date(inv, inv_dt)
            due_date_str = due_dt.strftime("%Y-%m-%d")
            created_at_str = inv_dt.strftime("%Y-%m-%d")

            balance = round(float(inv.get("balance_due", 0)), 2)
            total_amount = round(float(inv.get("total_amount", 0)), 2)
            amount_paid = round(float(inv.get("amount_paid", 0)), 2)

            diff_days = (as_of_dt.date() - due_dt.date()).days
            overdue_days = max(0, diff_days)

            if overdue_days <= 30:
                bucket = "0-30 days"
                total_0_30 += balance
            elif overdue_days <= 60:
                bucket = "31-60 days"
                total_31_60 += balance
            else:
                bucket = "61+ days"
                total_61_plus += balance

            total_receivable += balance

            invoice_details.append({
                "invoice_id": str(inv["_id"]),
                "customer_name": inv.get("customer_name", "—"),
                "customer_id": str(inv.get("customer_id", "")),
                "total_amount": total_amount,
                "amount_paid": amount_paid,
                "balance_due": balance,
                "created_at": created_at_str,
                "due_date": due_date_str,
                "overdue_days": overdue_days,
                "bucket": bucket,
                "status": inv.get("status", "UNPAID"),
            })

        return {
            "summary": {
                "as_of_date": as_of_dt.strftime("%Y-%m-%d"),
                "total_receivable": round(total_receivable, 2),
                "total_0_30": round(total_0_30, 2),
                "total_31_60": round(total_31_60, 2),
                "total_61_plus": round(total_61_plus, 2),
                "unpaid_invoices_count": len(invoice_details),
                "customer_id_filter": customer_id,
            },
            "invoices": invoice_details,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not generate accounts receivable aging report.")


# ---------------------------------------------------------------------------
# Role-Based Dashboard & Customer Portal Endpoints
# ---------------------------------------------------------------------------

class CustomerProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=25)
    billing_address: Optional[str] = Field(default=None, max_length=500)
    business_name: Optional[str] = Field(default=None, max_length=150)
    gstin: Optional[str] = Field(default=None, max_length=20)
    business_phone: Optional[str] = Field(default=None, max_length=25)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=100)
    pincode: Optional[str] = Field(default=None, max_length=10)
    profile_image: Optional[str] = Field(default=None, max_length=2_000_000)


@app.get("/admin/dashboard")
def get_admin_dashboard(current_user: dict = Depends(require_admin)):
    """
    Business-level monitoring & analytics dashboard exclusively for Administrators.
    Aggregated from real MongoDB collections.
    """
    try:
        now_utc = datetime.now(timezone.utc)
        today_str = now_utc.strftime("%Y-%m-%d")

        all_invoices = list(invoices_collection.find())
        all_payments = list(payments_collection.find())

        # 1. High-level Summary Metrics
        total_invoices_count = len(all_invoices)
        total_invoiced_amount = round(sum(float(i.get("total_amount", 0)) for i in all_invoices), 2)

        cleared_payments = [p for p in all_payments if p.get("status") in ["SUCCESS", "CLEARED"]]
        total_revenue = round(sum(float(p.get("amount", 0)) for p in cleared_payments), 2)
        total_payments_received_count = len(cleared_payments)

        pending_invoices = [i for i in all_invoices if float(i.get("balance_due", 0)) > 0]
        pending_payments_amount = round(sum(float(i.get("balance_due", 0)) for i in pending_invoices), 2)
        pending_payments_count = len(pending_invoices)

        overdue_invoices = [
            i for i in pending_invoices
            if (i.get("due_date") or today_str) < today_str
        ]
        overdue_invoices_count = len(overdue_invoices)
        overdue_invoices_amount = round(sum(float(i.get("balance_due", 0)) for i in overdue_invoices), 2)

        total_customers = customers_collection.count_documents({})
        total_products = products_collection.count_documents({})
        total_staff_members = users_collection.count_documents({"role": "staff", "is_active": True})
        total_admin_members = users_collection.count_documents({"role": "admin", "is_active": True})

        # 2. Revenue Analytics - Monthly Trend (Last 6 Months)
        monthly_trend = []
        for m_offset in range(5, -1, -1):
            # Compute approximate month
            m_year = now_utc.year
            m_month = now_utc.month - m_offset
            while m_month <= 0:
                m_month += 12
                m_year -= 1
            m_prefix = f"{m_year:04d}-{m_month:02d}"
            m_label = datetime(m_year, m_month, 1).strftime("%b %Y")

            m_revenue = round(sum(
                float(p.get("amount", 0)) for p in cleared_payments
                if (p.get("payment_date") or "").startswith(m_prefix)
            ), 2)

            m_inv_count = sum(
                1 for i in all_invoices
                if (i.get("invoice_date") or "").startswith(m_prefix)
            )

            monthly_trend.append({
                "month": m_label,
                "revenue": m_revenue,
                "invoices_count": m_inv_count,
            })

        # 3. Revenue Analytics - Weekly Overview (Last 4 Weeks)
        weekly_trend = []
        for w in range(3, -1, -1):
            start_w = now_utc - timedelta(days=(w + 1) * 7)
            end_w = now_utc - timedelta(days=w * 7)
            w_rev = round(sum(
                float(p.get("amount", 0)) for p in cleared_payments
                if start_w.strftime("%Y-%m-%d") <= (p.get("payment_date") or "") <= end_w.strftime("%Y-%m-%d")
            ), 2)
            weekly_trend.append({
                "week": f"Week {4 - w}",
                "revenue": w_rev,
            })

        # 4. Payment Method Distribution
        method_counts: Dict[str, dict] = {
            "UPI": {"amount": 0.0, "count": 0},
            "Card": {"amount": 0.0, "count": 0},
            "Cash": {"amount": 0.0, "count": 0},
            "Cheque": {"amount": 0.0, "count": 0},
            "Bank Transfer": {"amount": 0.0, "count": 0},
        }
        for p in cleared_payments:
            pm = (p.get("payment_method") or "Cash").strip()
            # Normalize to key
            found_key = "Cash"
            for k in method_counts.keys():
                if k.lower() in pm.lower():
                    found_key = k
                    break
            method_counts[found_key]["amount"] += float(p.get("amount", 0))
            method_counts[found_key]["count"] += 1

        payment_methods = []
        for k, v in method_counts.items():
            amt = round(v["amount"], 2)
            pct = round((amt / total_revenue * 100) if total_revenue > 0 else 0, 1)
            payment_methods.append({
                "method": k,
                "amount": amt,
                "count": v["count"],
                "percentage": pct,
            })

        # 5. Invoice Status Breakdown
        paid_inv_count = sum(1 for i in all_invoices if float(i.get("balance_due", 0)) <= 0)
        paid_inv_amount = round(sum(float(i.get("amount_paid", 0)) for i in all_invoices if float(i.get("balance_due", 0)) <= 0), 2)

        partially_paid_count = sum(1 for i in all_invoices if 0 < float(i.get("balance_due", 0)) < float(i.get("total_amount", 0)))
        unpaid_count = sum(1 for i in all_invoices if float(i.get("amount_paid", 0)) == 0)

        invoice_status_breakdown = [
            {"status": "Paid", "count": paid_inv_count, "amount": paid_inv_amount},
            {"status": "Partially Paid", "count": partially_paid_count, "amount": round(sum(float(i.get("balance_due", 0)) for i in all_invoices if 0 < float(i.get("balance_due", 0)) < float(i.get("total_amount", 0))), 2)},
            {"status": "Unpaid", "count": unpaid_count, "amount": round(sum(float(i.get("balance_due", 0)) for i in all_invoices if float(i.get("amount_paid", 0)) == 0), 2)},
            {"status": "Overdue", "count": overdue_invoices_count, "amount": overdue_invoices_amount},
        ]

        # 6. Top Customers by Purchase Amount
        top_customers_agg = list(invoices_collection.aggregate([
            {
                "$group": {
                    "_id": "$customer_id",
                    "total_purchases": {"$sum": "$total_amount"},
                    "total_paid": {"$sum": "$amount_paid"},
                    "total_invoices": {"$sum": 1},
                }
            },
            {"$sort": {"total_purchases": -1}},
            {"$limit": 5},
        ]))

        top_customers = []
        for item in top_customers_agg:
            cid = item.get("_id")
            c_name = "Valued Customer"
            if cid and ObjectId.is_valid(cid):
                c_doc = customers_collection.find_one({"_id": ObjectId(cid)})
                if c_doc:
                    c_name = c_doc.get("name", "Valued Customer")
            top_customers.append({
                "customer_id": str(cid),
                "customer_name": c_name,
                "total_purchases": round(float(item["total_purchases"]), 2),
                "total_paid": round(float(item["total_paid"]), 2),
                "total_invoices": item["total_invoices"],
            })

        pending_cheques_count = payments_collection.count_documents({"payment_method": "Cheque", "status": "PENDING"})
        pending_upi_claims_count = payments_collection.count_documents({"payment_method": "UPI", "status": "PENDING_VERIFICATION"})

        # 7. Recent Activity
        recent_invoices = list(invoices_collection.find().sort("created_at", -1).limit(5))
        recent_payments = list(payments_collection.find().sort("created_at", -1).limit(5))

        return {
            "role": "admin",
            "stats": {
                "total_revenue": total_revenue,
                "total_invoices": total_invoices_count,
                "total_invoices_count": total_invoices_count,
                "total_invoiced_amount": total_invoiced_amount,
                "total_customers": total_customers,
                "total_products": total_products,
                "total_payments_received": total_revenue,
                "total_payments_received_count": total_payments_received_count,
                "total_payments_received_amount": total_revenue,
                "pending_payments": pending_payments_amount,
                "pending_payments_count": pending_payments_count,
                "pending_payments_amount": pending_payments_amount,
                "paid_invoices_count": paid_inv_count,
                "paid_invoices_amount": paid_inv_amount,
                "unpaid_invoices_count": unpaid_count,
                "partially_paid_invoices_count": partially_paid_count,
                "overdue_invoices": overdue_invoices_count,
                "overdue_invoices_count": overdue_invoices_count,
                "overdue_invoices_amount": overdue_invoices_amount,
                "total_staff": total_staff_members,
                "total_staff_members": total_staff_members,
                "total_admin_members": total_admin_members,
                "pending_cheques_count": pending_cheques_count,
                "pending_upi_claims_count": pending_upi_claims_count,
            },
            "revenue_analytics": {
                "monthly_trend": monthly_trend,
                "monthly_revenue": monthly_trend,
                "weekly_trend": weekly_trend,
                "weekly_revenue": weekly_trend,
                "payment_methods": payment_methods,
                "invoice_status": invoice_status_breakdown,
                "paid_vs_pending": {
                    "paid_amount": total_revenue,
                    "pending_amount": pending_payments_amount,
                    "paid_count": total_payments_received_count,
                    "pending_count": pending_payments_count,
                },
                "top_customers": top_customers,
            },
            "top_customers": top_customers,
            "recent_activity": {
                "recent_invoices": [serialize_document(i) for i in recent_invoices],
                "recent_payments": [serialize_document(p) for p in recent_payments],
            },
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not load Admin dashboard analytics.")


@app.get("/staff/dashboard")
def get_staff_dashboard(current_user: dict = Depends(require_staff_or_admin)):
    """
    Daily operational metrics and billing workbench dashboard for Staff.
    """
    try:
        user_id = str(current_user["id"])
        user_email = current_user.get("email", "").lower()
        now_utc = datetime.now(timezone.utc)
        today_str = now_utc.strftime("%Y-%m-%d")

        all_invoices = list(invoices_collection.find())
        all_payments = list(payments_collection.find())

        # Invoices and payments recorded by this staff member
        my_invoices = [
            i for i in all_invoices
            if str(i.get("created_by", "")) == user_id or str(i.get("created_by_name", "")).lower() == current_user.get("full_name", "").lower()
        ]
        my_invoices_count = len(my_invoices)
        my_invoices_amount = round(sum(float(i.get("total_amount", 0)) for i in my_invoices), 2)

        my_payments = [
            p for p in all_payments
            if str(p.get("recorded_by", "")) == user_id or str(p.get("recorded_by", "")).lower() == user_email
        ]
        my_payments_count = len(my_payments)
        my_payments_amount = round(sum(
            float(p.get("amount", 0)) for p in my_payments
            if p.get("status") in ["SUCCESS", "CLEARED"]
        ), 2)

        # Today's created invoices
        todays_invoices = [
            i for i in all_invoices
            if (i.get("invoice_date") or (i.get("created_at") or "")[:10]) == today_str
        ]
        todays_invoices_count = len(todays_invoices)
        todays_invoices_amount = round(sum(float(i.get("total_amount", 0)) for i in todays_invoices), 2)

        # Today's collections
        todays_payments = [
            p for p in all_payments
            if (p.get("payment_date") or (p.get("created_at") or "")[:10]) == today_str and p.get("status") in ["SUCCESS", "CLEARED"]
        ]
        todays_collections_count = len(todays_payments)
        todays_collections_amount = round(sum(float(p.get("amount", 0)) for p in todays_payments), 2)

        # Operational queues and pending actions
        pending_invoices = [i for i in all_invoices if float(i.get("balance_due", 0)) > 0]
        pending_payments_amount = round(sum(float(i.get("balance_due", 0)) for i in pending_invoices), 2)
        partially_paid_count = sum(1 for i in all_invoices if 0 < float(i.get("balance_due", 0)) < float(i.get("total_amount", 0)))
        overdue_invoices = [
            i for i in pending_invoices
            if (i.get("due_date") or today_str) < today_str
        ]
        overdue_count = len(overdue_invoices)
        total_customers = customers_collection.count_documents({})
        total_products = products_collection.count_documents({})

        pending_cheques_count = payments_collection.count_documents({"payment_method": "Cheque", "status": "PENDING"})
        pending_upi_claims_count = payments_collection.count_documents({"payment_method": "UPI", "status": "PENDING_VERIFICATION"})

        # Pending Payment Follow-ups
        pending_follow_ups = []
        for inv in overdue_invoices[:5]:
            c_name = inv.get("customer_name", "Valued Client")
            cid = inv.get("customer_id")
            phone = ""
            if cid and ObjectId.is_valid(cid):
                c_doc = customers_collection.find_one({"_id": ObjectId(cid)})
                if c_doc:
                    c_name = c_doc.get("name", c_name)
                    phone = c_doc.get("phone", "")
            pending_follow_ups.append({
                "invoice_id": str(inv["_id"]),
                "invoice_number": inv.get("invoice_number", ""),
                "customer_name": c_name,
                "phone": phone,
                "balance_due": float(inv.get("balance_due", 0)),
                "due_date": inv.get("due_date", "Immediate"),
            })

        recent_invoices = list(invoices_collection.find().sort("created_at", -1).limit(5))
        recent_payments = list(payments_collection.find().sort("created_at", -1).limit(5))

        return {
            "role": "staff",
            "stats": {
                "invoices_created_by_me_count": my_invoices_count,
                "invoices_created_by_me_amount": my_invoices_amount,
                "payments_recorded_by_me_count": my_payments_count,
                "payments_recorded_by_me_amount": my_payments_amount,
                "todays_invoices_count": todays_invoices_count,
                "todays_invoices_amount": todays_invoices_amount,
                "todays_collections_count": todays_collections_count,
                "todays_collections_amount": todays_collections_amount,
                "pending_payments_amount": pending_payments_amount,
                "partially_paid_invoices_count": partially_paid_count,
                "overdue_invoices_count": overdue_count,
                "total_customers_managed": total_customers,
                "total_products_count": total_products,
                "pending_cheques_count": pending_cheques_count,
                "pending_upi_claims_count": pending_upi_claims_count,
            },
            "pending_follow_ups": pending_follow_ups,
            "recent_activity": {
                "recent_invoices": [serialize_document(i) for i in recent_invoices],
                "recent_payments": [serialize_document(p) for p in recent_payments],
            },
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not load Staff operational dashboard.")


@app.get("/customer/dashboard")
def get_customer_dashboard(
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Self-service portal dashboard showing exclusively the customer's own invoices and payments.
    """
    try:
        user_role = current_user.get("role")
        if user_role == "customer":
            cust_id = current_user.get("customer_id")
            if not cust_id:
                raise HTTPException(status_code=403, detail="No customer profile linked to this user account.")
        else:
            # Admin/Staff preview mode
            cust_id = customer_id
            if not cust_id:
                first_cust = customers_collection.find_one()
                cust_id = str(first_cust["_id"]) if first_cust else None

        if not cust_id:
            raise HTTPException(status_code=404, detail="Customer record not found.")

        cust_obj_id = valid_object_id(cust_id, "customer")
        customer = customers_collection.find_one({"_id": cust_obj_id})
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found.")

        now_utc = datetime.now(timezone.utc)
        today_str = now_utc.strftime("%Y-%m-%d")

        cust_invoices = list(invoices_collection.find({"customer_id": str(cust_id)}).sort("created_at", -1))
        cust_payments = list(payments_collection.find({"customer_id": str(cust_id)}).sort("created_at", -1))

        total_invoices_count = len(cust_invoices)
        total_invoiced_amount = round(sum(float(i.get("total_amount", 0)) for i in cust_invoices), 2)
        outstanding_amount = round(sum(float(i.get("balance_due", 0)) for i in cust_invoices), 2)

        paid_invoices_count = sum(1 for i in cust_invoices if float(i.get("balance_due", 0)) <= 0)
        paid_invoices_amount = round(sum(float(i.get("amount_paid", 0)) for i in cust_invoices), 2)

        unpaid_invoices_count = sum(1 for i in cust_invoices if float(i.get("amount_paid", 0)) == 0)
        partially_paid_count = sum(1 for i in cust_invoices if 0 < float(i.get("balance_due", 0)) < float(i.get("total_amount", 0)))
        overdue_invoices_count = sum(
            1 for i in cust_invoices
            if float(i.get("balance_due", 0)) > 0 and (i.get("due_date") or today_str) < today_str
        )

        upcoming_due_invoices = [
            serialize_document(i) for i in cust_invoices
            if float(i.get("balance_due", 0)) > 0 and (i.get("due_date") or today_str) >= today_str
        ]
        overdue_invoices = [
            serialize_document(i) for i in cust_invoices
            if float(i.get("balance_due", 0)) > 0 and (i.get("due_date") or today_str) < today_str
        ]

        cleared_payments = [p for p in cust_payments if p.get("status") in ["SUCCESS", "CLEARED"]]
        total_payments_count = len(cleared_payments)
        total_payments_amount = round(sum(float(p.get("amount", 0)) for p in cleared_payments), 2)

        cust_orders = list(orders_collection.find({"customer_id": str(cust_id)}).sort("created_at", -1))
        active_orders = [o for o in cust_orders if o.get("status") in ["PENDING_REVIEW", "UNDER_REVIEW", "ACCEPTED"]]
        pending_orders = [o for o in cust_orders if o.get("status") in ["PENDING_REVIEW", "UNDER_REVIEW"]]
        total_purchased_products = sum(len(i.get("items", [])) for i in cust_invoices)

        return {
            "role": "customer",
            "customer": serialize_document(customer),
            "stats": {
                "total_invoices_count": total_invoices_count,
                "total_invoiced_amount": total_invoiced_amount,
                "outstanding_amount": outstanding_amount,
                "paid_invoices_count": paid_invoices_count,
                "paid_invoices_amount": paid_invoices_amount,
                "unpaid_invoices_count": unpaid_invoices_count,
                "partially_paid_invoices_count": partially_paid_count,
                "overdue_invoices_count": overdue_invoices_count,
                "upcoming_due_invoices_count": len(upcoming_due_invoices),
                "total_payments_count": total_payments_count,
                "total_payments_amount": total_payments_amount,
                "active_orders_count": len(active_orders),
                "pending_orders_count": len(pending_orders),
                "total_orders_count": len(cust_orders),
                "total_purchases_count": total_purchased_products,
            },
            "upcoming_due_invoices": upcoming_due_invoices[:5],
            "overdue_invoices": overdue_invoices[:5],
            "recent_invoices": [serialize_document(i) for i in cust_invoices[:5]],
            "recent_payments": [serialize_document(p) for p in cust_payments[:5]],
            "recent_orders": [serialize_document(o) for o in cust_orders[:5]],
        }
    except HTTPException:
        raise
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not load Customer dashboard.")


@app.get("/customer/invoices")
def get_customer_invoices(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    List invoices strictly belonging to the authenticated customer.
    """
    if current_user.get("role") == "customer":
        cust_id = current_user.get("customer_id")
        if not cust_id:
            raise HTTPException(status_code=403, detail="No customer record associated with your account.")
    else:
        # Default fallback for admin preview
        cust_id = current_user.get("customer_id")
        if not cust_id:
            first_cust = customers_collection.find_one()
            cust_id = str(first_cust["_id"]) if first_cust else ""

    query: dict[str, Any] = {"customer_id": str(cust_id)}

    if status and status.upper() != "ALL":
        query["status"] = {"$regex": f"^{re.escape(status.strip())}$", "$options": "i"}

    if search:
        s = re.escape(search.strip())
        query["$or"] = [
            {"invoice_number": {"$regex": s, "$options": "i"}},
            {"notes": {"$regex": s, "$options": "i"}},
        ]

    try:
        total = invoices_collection.count_documents(query)
        skip = (page - 1) * limit
        invoices = list(invoices_collection.find(query).sort("created_at", -1).skip(skip).limit(limit))
        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        items = []
        for i in invoices:
            doc = serialize_document(i)
            amt_paid = float(doc.get("amount_paid", 0))
            if not doc.get("payment_mode"):
                if amt_paid > 0:
                    doc["payment_mode"] = "Not Recorded"
                else:
                    doc["payment_mode"] = None
            items.append(doc)

        return {
            "items": items,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve customer invoices.")


@app.get("/customer/payments")
def get_customer_payments(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    List payments and receipts strictly belonging to the authenticated customer.
    """
    if current_user.get("role") == "customer":
        cust_id = current_user.get("customer_id")
        if not cust_id:
            raise HTTPException(status_code=403, detail="No customer record associated with your account.")
    else:
        cust_id = current_user.get("customer_id")
        if not cust_id:
            first_cust = customers_collection.find_one()
            cust_id = str(first_cust["_id"]) if first_cust else ""

    query: dict[str, Any] = {"customer_id": str(cust_id)}
    try:
        total = payments_collection.count_documents(query)
        skip = (page - 1) * limit
        payments = list(payments_collection.find(query).sort("created_at", -1).skip(skip).limit(limit))
        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        return {
            "items": [serialize_document(p) for p in payments],
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve customer payments.")


@app.get("/customer/profile")
def get_customer_profile(current_user: dict = Depends(require_customer_or_staff_or_admin)):
    """
    Retrieve authenticated customer profile.
    """
    cust_id = current_user.get("customer_id")
    if not cust_id:
        raise HTTPException(status_code=404, detail="No customer profile linked to this account.")
    cust_obj_id = valid_object_id(cust_id, "customer")
    customer = customers_collection.find_one({"_id": cust_obj_id})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found.")
    return {
        "customer": serialize_document(customer),
        "user": current_user,
    }


@app.put("/customer/profile")
@app.patch("/customer/profile")
def update_customer_profile(
    profile_in: CustomerProfileUpdate,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Allow customer to update permitted personal and business profile fields.
    Guarantees historical invoices are never altered (snapshot integrity).
    """
    cust_id = current_user.get("customer_id")
    if not cust_id:
        raise HTTPException(status_code=404, detail="No customer profile linked to this account.")
    cust_obj_id = valid_object_id(cust_id, "customer")
    customer = customers_collection.find_one({"_id": cust_obj_id})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found.")

    update_fields = {}
    user_updates = {}

    if profile_in.business_name is not None:
        clean_biz = profile_in.business_name.strip()
        update_fields["business_name"] = clean_biz
        if clean_biz:
            update_fields["name"] = clean_biz

    if profile_in.full_name is not None:
        clean_name = profile_in.full_name.strip()
        if len(clean_name) >= 2:
            user_updates["full_name"] = clean_name
            if not profile_in.business_name and not customer.get("business_name") and not customer.get("name"):
                update_fields["name"] = clean_name

    if profile_in.phone is not None:
        clean_phone = clean_optional(profile_in.phone)
        update_fields["phone"] = clean_phone
        user_updates["phone"] = clean_phone

    if profile_in.business_phone is not None:
        update_fields["business_phone"] = clean_optional(profile_in.business_phone)

    if profile_in.billing_address is not None:
        b_addr = profile_in.billing_address.strip()
        update_fields["billing_address"] = b_addr
        update_fields["address"] = b_addr

    if profile_in.city is not None:
        update_fields["city"] = clean_optional(profile_in.city)

    if profile_in.state is not None:
        update_fields["state"] = clean_optional(profile_in.state)

    if profile_in.pincode is not None:
        update_fields["pincode"] = clean_optional(profile_in.pincode)

    if profile_in.profile_image is not None:
        p_img = profile_in.profile_image.strip()
        update_fields["profile_image"] = p_img
        user_updates["avatar_url"] = p_img

    if profile_in.gstin is not None:
        raw_gstin = profile_in.gstin.strip().upper()
        if raw_gstin:
            gstin, sc, st = validate_and_normalize_gstin(
                raw_gstin,
                customer.get("state_code"),
                update_fields.get("state") or customer.get("state"),
            )
            update_fields["gstin"] = gstin
            update_fields["state_code"] = sc
            if st and "state" not in update_fields:
                update_fields["state"] = st
        else:
            update_fields["gstin"] = None

    if update_fields:
        update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        customers_collection.update_one({"_id": cust_obj_id}, {"$set": update_fields})

    if user_updates:
        u_oid = current_user.get("_id") or current_user.get("id")
        if u_oid:
            try:
                users_collection.update_one({"_id": ObjectId(u_oid) if isinstance(u_oid, str) and ObjectId.is_valid(u_oid) else u_oid}, {"$set": user_updates})
            except Exception:
                pass

    updated = customers_collection.find_one({"_id": cust_obj_id})
    updated_user = users_collection.find_one({"email": current_user.get("email")})
    return {
        "message": "Customer profile updated successfully.",
        "customer": serialize_document(updated),
        "user": serialize_user(updated_user) if updated_user else current_user,
    }


# -------------------------
# Customer Invitation & Account Linking
# -------------------------

@app.post("/customers/{customer_id}/invite")
def invite_customer(
    customer_id: str,
    current_user: dict = Depends(require_staff_or_admin),
):
    """
    Generate a secure single-use time-limited invitation token for a customer.
    """
    cust_obj_id = valid_object_id(customer_id, "customer")
    customer = customers_collection.find_one({"_id": cust_obj_id})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer record not found.")

    email = (customer.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(
            status_code=400,
            detail="Customer has no registered email. Please update customer email before inviting.",
        )

    # Check if a login account already exists for this email
    existing_user = users_collection.find_one({"email": email})
    if existing_user and existing_user.get("customer_id") == str(cust_obj_id):
        raise HTTPException(
            status_code=409,
            detail=f"Customer account for {email} is already active.",
        )

    token = secrets.token_urlsafe(32)
    now_dt = datetime.now(timezone.utc)
    expires_at = (now_dt + timedelta(days=7)).isoformat()

    invitation_doc = {
        "customer_id": str(cust_obj_id),
        "customer_name": customer.get("name", "Client"),
        "email": email,
        "token": token,
        "status": "PENDING",
        "invited_by": current_user.get("email"),
        "invited_by_role": current_user.get("role"),
        "expires_at": expires_at,
        "created_at": now_dt.isoformat(),
        "updated_at": now_dt.isoformat(),
    }
    customer_invitations_collection.insert_one(invitation_doc)

    log_audit_event(
        actor=current_user,
        action="INVITE_CUSTOMER",
        resource_type="customer",
        resource_id=customer_id,
        details={"customer_name": customer.get("name"), "email": email},
    )

    create_notification(
        title="Client Invitation Sent",
        message=f"Portal invitation dispatched for {customer.get('name')} ({email}).",
        recipient_role="staff",
        notification_type="invitation",
    )

    invitation_link = f"/invite?token={token}"
    return {
        "message": f"Invitation created successfully for {customer.get('name')}.",
        "invitation_link": invitation_link,
        "token": token,
        "email": email,
        "expires_at": expires_at,
    }


@app.get("/auth/verify-invite")
def verify_invite(token: str = Query(...)):
    """
    Public validation endpoint for customer portal invitation token.
    """
    inv = customer_invitations_collection.find_one({"token": token, "status": "PENDING"})
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation token not found or already consumed.")

    expires_at_str = inv.get("expires_at", "")
    if expires_at_str:
        try:
            exp_dt = datetime.fromisoformat(expires_at_str)
            if datetime.now(timezone.utc) > exp_dt:
                raise HTTPException(status_code=410, detail="Invitation link has expired.")
        except ValueError:
            pass

    cust_id = inv.get("customer_id")
    cust_obj = customers_collection.find_one({"_id": ObjectId(cust_id)}) if cust_id and ObjectId.is_valid(cust_id) else None

    return {
        "valid": True,
        "email": inv.get("email"),
        "customer_name": inv.get("customer_name") or (cust_obj.get("name") if cust_obj else "Client"),
        "customer_id": cust_id,
    }


@app.post("/auth/accept-invite")
def accept_invite(request: AcceptInviteRequest):
    """
    Public registration endpoint: accepts invitation, sets password with Argon2id,
    and securely binds the login account to the customer record.
    """
    inv = customer_invitations_collection.find_one({"token": request.token, "status": "PENDING"})
    if not inv:
        raise HTTPException(status_code=404, detail="Invalid or expired invitation token.")

    expires_at_str = inv.get("expires_at", "")
    if expires_at_str:
        try:
            exp_dt = datetime.fromisoformat(expires_at_str)
            if datetime.now(timezone.utc) > exp_dt:
                raise HTTPException(status_code=410, detail="Invitation link has expired.")
        except ValueError:
            pass

    cust_id = inv.get("customer_id")
    email = inv.get("email").strip().lower()
    customer = customers_collection.find_one({"_id": ObjectId(cust_id)}) if cust_id and ObjectId.is_valid(cust_id) else None
    if not customer:
        raise HTTPException(status_code=404, detail="Associated customer record not found.")

    pwd_hash = password_hasher.hash(request.password)
    now_dt = datetime.now(timezone.utc)
    full_name = request.full_name or customer.get("name") or "Customer User"

    existing_user = users_collection.find_one({"email": email})
    if existing_user:
        users_collection.update_one(
            {"_id": existing_user["_id"]},
            {
                "$set": {
                    "password_hash": pwd_hash,
                    "role": "customer",
                    "customer_id": str(cust_id),
                    "full_name": full_name,
                    "is_active": True,
                    "updated_at": now_dt.isoformat(),
                }
            },
        )
        user_id = str(existing_user["_id"])
    else:
        new_user = {
            "email": email,
            "password_hash": pwd_hash,
            "full_name": full_name,
            "role": "customer",
            "customer_id": str(cust_id),
            "is_active": True,
            "created_at": now_dt.isoformat(),
            "updated_at": now_dt.isoformat(),
        }
        ins = users_collection.insert_one(new_user)
        user_id = str(ins.inserted_id)

    customer_invitations_collection.update_one(
        {"_id": inv["_id"]},
        {"$set": {"status": "ACCEPTED", "accepted_at": now_dt.isoformat()}},
    )

    log_audit_event(
        actor={"id": user_id, "email": email, "role": "customer"},
        action="ACCEPT_CUSTOMER_INVITE",
        resource_type="customer",
        resource_id=str(cust_id),
        details={"email": email, "customer_name": customer.get("name")},
    )

    create_notification(
        title="New Customer Portal Registration",
        message=f"{customer.get('name')} ({email}) has activated their customer portal account.",
        recipient_role="admin",
        notification_type="registration",
    )

    return {
        "message": "Your client portal account is active! You can now log in.",
        "email": email,
        "customer_id": str(cust_id),
        "role": "customer",
    }


# -------------------------
# Notifications System
# -------------------------

@app.get("/notifications")
def get_notifications(
    unread_only: bool = False,
    limit: int = 30,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Retrieve in-app notifications scoped to current authenticated role and user ID.
    """
    role = current_user.get("role")
    user_id = str(current_user.get("id", ""))
    cust_id = current_user.get("customer_id")

    query: dict[str, Any] = {}
    if role == "customer":
        or_clauses: list[dict[str, Any]] = [{"recipient_role": "customer"}]
        if cust_id:
            or_clauses.append({"customer_id": str(cust_id)})
        if user_id:
            or_clauses.append({"recipient_user_id": user_id})
        query["$or"] = or_clauses
    elif role == "staff":
        query["$or"] = [
            {"recipient_role": {"$in": ["staff", "all"]}},
            {"recipient_user_id": user_id},
        ]
    else:  # admin
        query["$or"] = [
            {"recipient_role": {"$in": ["admin", "staff", "all"]}},
            {"recipient_user_id": user_id},
        ]

    if unread_only:
        query["is_read"] = False

    try:
        items = list(notifications_collection.find(query).sort("created_at", -1).limit(limit))
        unread_q = dict(query)
        unread_q["is_read"] = False
        unread_count = notifications_collection.count_documents(unread_q)

        return {
            "items": [serialize_document(n) for n in items],
            "unread_count": unread_count,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve notifications.")


@app.put("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Mark a single notification as read.
    """
    notif_obj_id = valid_object_id(notification_id, "notification")
    res = notifications_collection.update_one(
        {"_id": notif_obj_id},
        {"$set": {"is_read": True, "read_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"status": "success", "message": "Notification marked as read."}


@app.put("/notifications/read-all")
def mark_all_notifications_read(
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Mark all unread notifications for the current user as read.
    """
    role = current_user.get("role")
    user_id = str(current_user.get("id", ""))
    cust_id = current_user.get("customer_id")

    query: dict[str, Any] = {"is_read": False}
    if role == "customer":
        or_clauses: list[dict[str, Any]] = [{"recipient_role": "customer"}]
        if cust_id:
            or_clauses.append({"customer_id": str(cust_id)})
        if user_id:
            or_clauses.append({"recipient_user_id": user_id})
        query["$or"] = or_clauses
    elif role == "staff":
        query["$or"] = [
            {"recipient_role": {"$in": ["staff", "all"]}},
            {"recipient_user_id": user_id},
        ]
    else:
        query["$or"] = [
            {"recipient_role": {"$in": ["admin", "staff", "all"]}},
            {"recipient_user_id": user_id},
        ]

    notifications_collection.update_many(
        query,
        {"$set": {"is_read": True, "read_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"status": "success", "message": "All notifications marked as read."}


# -------------------------
# Audit Logs System (Admin Only)
# -------------------------

@app.get("/audit-logs")
def get_audit_logs(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    action: Optional[str] = None,
    module: Optional[str] = None,
    role: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: dict = Depends(require_admin),
):
    """
    Query financial and administrative audit trail. Strictly restricted to Admin.
    Supports comprehensive filtering by module, action, role, status, date range, and keyword search.
    """
    query: dict[str, Any] = {}
    if action and action.upper() != "ALL":
        query["action"] = action.strip()
    if module and module.upper() != "ALL":
        query["module"] = {"$regex": f"^{re.escape(module.strip())}$", "$options": "i"}
    if role and role.upper() != "ALL":
        clean_role = role.strip().lower()
        query["$or"] = [{"user_role": clean_role}, {"actor_role": clean_role}]
    if status and status.upper() != "ALL":
        query["status"] = status.strip().upper()

    if from_date or to_date:
        date_q = {}
        if from_date:
            date_q["$gte"] = from_date.strip()
        if to_date:
            to_val = to_date.strip()
            if len(to_val) == 10:
                to_val = f"{to_val}T23:59:59.999999Z"
            date_q["$lte"] = to_val
        if date_q:
            query["created_at"] = date_q

    if search:
        s = re.escape(search.strip())
        search_or = [
            {"user_name": {"$regex": s, "$options": "i"}},
            {"user_email": {"$regex": s, "$options": "i"}},
            {"actor_email": {"$regex": s, "$options": "i"}},
            {"description": {"$regex": s, "$options": "i"}},
            {"action": {"$regex": s, "$options": "i"}},
            {"module": {"$regex": s, "$options": "i"}},
            {"resource_type": {"$regex": s, "$options": "i"}},
            {"entity_type": {"$regex": s, "$options": "i"}},
            {"resource_id": {"$regex": s, "$options": "i"}},
            {"entity_id": {"$regex": s, "$options": "i"}},
        ]
        if "$or" in query:
            query = {"$and": [query, {"$or": search_or}]}
        else:
            query["$or"] = search_or

    try:
        total = audit_logs_collection.count_documents(query)
        skip = (page - 1) * limit
        logs = list(audit_logs_collection.find(query).sort("created_at", -1).skip(skip).limit(limit))
        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        return {
            "items": [serialize_document(l) for l in logs],
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve audit logs.")


# ==============================================================================
# Customer Shopping Portal, Persistent Cart & Order Management Module
# ==============================================================================

def resolve_customer_id_for_user(current_user: dict, customer_id: Optional[str] = None) -> str:
    """Safely determines customer ID for current context. Customer users can never access other customer data."""
    user_role = current_user.get("role")
    if user_role == "customer":
        cust_id = current_user.get("customer_id")
        if not cust_id:
            email = current_user.get("email")
            if email:
                c = customers_collection.find_one({"email": email})
                if c:
                    cust_id = str(c["_id"])
        if not cust_id:
            raise HTTPException(status_code=403, detail="No customer profile linked to this user account.")
        return str(cust_id)
    else:
        if customer_id:
            return str(customer_id)
        first_c = customers_collection.find_one()
        if first_c:
            return str(first_c["_id"])
        raise HTTPException(status_code=404, detail="No customer record found.")


def _calculate_customer_cart_state(cust_id: str) -> dict:
    """
    Computes real-time cart state by fetching active products, verifying prices,
    and invoking the centralized GST calculation engine.
    """
    cart = carts_collection.find_one({"customer_id": str(cust_id)}) or {"customer_id": str(cust_id), "items": []}
    raw_items = cart.get("items", [])

    customer = None
    if ObjectId.is_valid(cust_id):
        customer = customers_collection.find_one({"_id": ObjectId(cust_id)})

    cust_state = (customer.get("state") or "") if customer else ""
    comp_settings = company_settings_collection.find_one() or {}
    company_state = comp_settings.get("state", "Maharashtra")

    product_ids = [it.get("product_id") for it in raw_items if it.get("product_id")]
    prod_map = {}
    if product_ids:
        valid_oids = [ObjectId(pid) for pid in product_ids if ObjectId.is_valid(pid)]
        if valid_oids:
            prods = list(products_collection.find({"_id": {"$in": valid_oids}}))
            for p in prods:
                prod_map[str(p["_id"])] = p

    items_for_tax = []
    sanitized_items = []
    for it in raw_items:
        pid = str(it.get("product_id"))
        qty = int(it.get("quantity", 1))
        if qty <= 0:
            continue
        p = prod_map.get(pid)
        if not p or p.get("is_active") is False:
            continue

        sanitized_items.append({"product_id": pid, "quantity": qty})
        items_for_tax.append({
            "product_id": pid,
            "product_name": p["name"],
            "unit": p.get("unit", "pcs"),
            "quantity": qty,
            "unit_price": float(p["price"]),
            "gst_rate": float(p.get("gst_rate", 18.0)),
            "image_url": p.get("image_url"),
            "category": p.get("category"),
            "sku": p.get("sku"),
        })

    # Auto-prune inactive or non-existent items
    if len(sanitized_items) != len(raw_items):
        carts_collection.update_one(
            {"customer_id": str(cust_id)},
            {"$set": {"items": sanitized_items, "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )

    if not items_for_tax:
        return {
            "customer_id": str(cust_id),
            "items": [],
            "total_items_count": 0,
            "subtotal": 0.0,
            "discount": 0.0,
            "taxable_amount": 0.0,
            "total_cgst": 0.0,
            "total_sgst": 0.0,
            "total_igst": 0.0,
            "total_gst": 0.0,
            "total_amount": 0.0,
            "supply_type": "Intra-State",
            "rate_breakdown": [],
            "customer": serialize_document(customer) if customer else None,
        }

    tax_calc = calculate_invoice_taxes(
        items_raw=items_for_tax,
        discount=0.0,
        place_of_supply=cust_state,
        company_state=company_state,
    )

    items_result = tax_calc.get("items", [])
    for inv_it in items_result:
        p = prod_map.get(inv_it["product_id"])
        if p:
            inv_it["image_url"] = p.get("image_url")
            inv_it["sku"] = p.get("sku")
            inv_it["category"] = p.get("category")

    tax_bd = tax_calc.get("tax_breakdown", {})

    return {
        "customer_id": str(cust_id),
        "items": items_result,
        "total_items_count": sum(it["quantity"] for it in items_result),
        "subtotal": tax_calc.get("subtotal", 0.0),
        "discount": tax_calc.get("discount", 0.0),
        "taxable_amount": tax_calc.get("taxable_amount", 0.0),
        "total_cgst": tax_calc.get("cgst_amount", 0.0),
        "total_sgst": tax_calc.get("sgst_amount", 0.0),
        "total_igst": tax_calc.get("igst_amount", 0.0),
        "total_gst": tax_calc.get("gst_amount", 0.0),
        "total_amount": tax_calc.get("total_amount", 0.0),
        "supply_type": tax_bd.get("supply_type", "Intra-State"),
        "rate_breakdown": tax_bd.get("rate_summary", []),
        "customer": serialize_document(customer) if customer else None,
    }


# -------------------------
# Customer Catalogue Endpoints
# -------------------------

@app.get("/customer/catalogue")
def get_customer_catalogue(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    search: Optional[str] = None,
    category: Optional[str] = None,
    sort_by: str = "name",
    sort_dir: str = "asc",
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Product catalogue for customer shopping. Strictly shows active products only.
    """
    try:
        query: dict[str, Any] = {"is_active": {"$ne": False}}
        if search:
            s = re.escape(search.strip())
            query["$or"] = [
                {"name": {"$regex": s, "$options": "i"}},
                {"sku": {"$regex": s, "$options": "i"}},
                {"category": {"$regex": s, "$options": "i"}},
                {"description": {"$regex": s, "$options": "i"}},
            ]
        if category and category.strip().lower() != "all":
            query["category"] = category.strip()

        valid_sorts = {"name": "name", "price": "price", "created_at": "created_at"}
        sort_field = valid_sorts.get(sort_by, "name")
        sort_order = -1 if sort_dir.lower() == "desc" else 1

        total = products_collection.count_documents(query)
        skip = (page - 1) * limit
        products = list(
            products_collection.find(query).sort(sort_field, sort_order).skip(skip).limit(limit)
        )
        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        # Fetch distinct active categories for convenient frontend filtering
        categories = products_collection.distinct("category", {"is_active": {"$ne": False}})
        clean_categories = [c for c in categories if c and str(c).strip()]

        return {
            "items": [serialize_document(p) for p in products],
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
            "categories": sorted(clean_categories),
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve catalogue products.")


@app.get("/customer/catalogue/{product_id}")
def get_catalogue_product_details(
    product_id: str,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """Retrieve detailed product specifications from active catalogue."""
    p_oid = valid_object_id(product_id, "product")
    product = products_collection.find_one({"_id": p_oid, "is_active": {"$ne": False}})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found in active catalogue.")
    return serialize_document(product)


# -------------------------
# Customer Shopping Cart Endpoints
# -------------------------

@app.get("/customer/cart")
def get_customer_cart(
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Retrieve customer's persistent shopping cart with live price and tax calculations.
    """
    cust_id = resolve_customer_id_for_user(current_user, customer_id)
    return _calculate_customer_cart_state(cust_id)


@app.post("/customer/cart/items")
def add_item_to_cart(
    item: CartItemAdd,
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """Add a product or increment its quantity in the customer's cart."""
    cust_id = resolve_customer_id_for_user(current_user, customer_id)
    p_oid = valid_object_id(item.product_id, "product")
    product = products_collection.find_one({"_id": p_oid, "is_active": {"$ne": False}})
    if not product:
        raise HTTPException(status_code=404, detail="Product is unavailable or inactive.")

    cart = carts_collection.find_one({"customer_id": str(cust_id)})
    if not cart:
        items = [{"product_id": str(item.product_id), "quantity": item.quantity}]
    else:
        items = list(cart.get("items", []))
        found = False
        for it in items:
            if it.get("product_id") == str(item.product_id):
                it["quantity"] = int(it.get("quantity", 0)) + item.quantity
                found = True
                break
        if not found:
            items.append({"product_id": str(item.product_id), "quantity": item.quantity})

    carts_collection.update_one(
        {"customer_id": str(cust_id)},
        {"$set": {"items": items, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return _calculate_customer_cart_state(cust_id)


@app.patch("/customer/cart/items/{product_id}")
def update_cart_item_quantity(
    product_id: str,
    payload: CartItemUpdate,
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """Set explicit quantity for an item in the cart. If <= 0, item is removed."""
    cust_id = resolve_customer_id_for_user(current_user, customer_id)
    cart = carts_collection.find_one({"customer_id": str(cust_id)}) or {"items": []}
    items = list(cart.get("items", []))

    new_items = []
    for it in items:
        if it.get("product_id") == str(product_id):
            if payload.quantity > 0:
                new_items.append({"product_id": str(product_id), "quantity": payload.quantity})
        else:
            new_items.append(it)

    carts_collection.update_one(
        {"customer_id": str(cust_id)},
        {"$set": {"items": new_items, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return _calculate_customer_cart_state(cust_id)


@app.delete("/customer/cart/items/{product_id}")
def remove_item_from_cart(
    product_id: str,
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """Remove a specific product line item from the shopping cart."""
    cust_id = resolve_customer_id_for_user(current_user, customer_id)
    cart = carts_collection.find_one({"customer_id": str(cust_id)}) or {"items": []}
    items = [it for it in cart.get("items", []) if it.get("product_id") != str(product_id)]

    carts_collection.update_one(
        {"customer_id": str(cust_id)},
        {"$set": {"items": items, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return _calculate_customer_cart_state(cust_id)


@app.delete("/customer/cart")
def clear_customer_cart(
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """Empty all contents from the customer's shopping cart."""
    cust_id = resolve_customer_id_for_user(current_user, customer_id)
    carts_collection.update_one(
        {"customer_id": str(cust_id)},
        {"$set": {"items": [], "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return _calculate_customer_cart_state(cust_id)


# -------------------------
# Customer Orders & Purchases
# -------------------------

@app.post("/customer/orders", status_code=201)
def place_customer_order(
    order_in: OrderCreate,
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Submits a purchase order from current cart.
    Freezes items, quantities, and GST snapshots; empties the cart; alerts business staff.
    """
    cust_id = resolve_customer_id_for_user(current_user, customer_id)
    cart_state = _calculate_customer_cart_state(cust_id)

    if not cart_state.get("items"):
        raise HTTPException(
            status_code=400,
            detail="Your shopping cart is empty. Please add products before placing an order.",
        )

    customer_doc = customers_collection.find_one({"_id": ObjectId(cust_id)})
    if not customer_doc:
        raise HTTPException(status_code=404, detail="Customer record not found.")

    now_utc = datetime.now(timezone.utc)
    order_number = generate_next_order_number(now_utc)

    order_doc = {
        "order_number": order_number,
        "customer_id": str(cust_id),
        "customer_name": customer_doc.get("name", "Valued Customer"),
        "customer_email": customer_doc.get("email"),
        "customer_phone": customer_doc.get("phone"),
        "billing_address": customer_doc.get("address", ""),
        "shipping_address": customer_doc.get("address", ""),
        "place_of_supply": customer_doc.get("state", ""),
        "delivery_notes": order_in.delivery_notes.strip() if order_in.delivery_notes else None,
        "items": cart_state["items"],
        "subtotal": cart_state["subtotal"],
        "discount": cart_state["discount"],
        "taxable_amount": cart_state["taxable_amount"],
        "total_cgst": cart_state["total_cgst"],
        "total_sgst": cart_state["total_sgst"],
        "total_igst": cart_state["total_igst"],
        "total_gst": cart_state["total_gst"],
        "total_amount": cart_state["total_amount"],
        "supply_type": cart_state["supply_type"],
        "status": "PENDING_REVIEW",
        "status_history": [
            {
                "status": "PENDING_REVIEW",
                "changed_at": now_utc.isoformat(),
                "changed_by": current_user.get("email", "customer"),
                "role": current_user.get("role", "customer"),
                "notes": "Purchase order submitted by customer.",
            }
        ],
        "invoice_id": None,
        "invoice_number": None,
        "created_at": now_utc.isoformat(),
        "updated_at": now_utc.isoformat(),
    }

    try:
        res = orders_collection.insert_one(order_doc)
        order_doc["_id"] = res.inserted_id

        # Empty cart on successful placement
        carts_collection.update_one(
            {"customer_id": str(cust_id)},
            {"$set": {"items": [], "updated_at": now_utc.isoformat()}},
            upsert=True,
        )

        # Notify business staff and customer
        notifications_collection.insert_one({
            "recipient_role": "staff",
            "recipient_user_id": None,
            "title": "New Purchase Order Received",
            "message": f"Order {order_number} for ₹{order_doc['total_amount']} submitted by {order_doc['customer_name']}.",
            "type": "ORDER_SUBMITTED",
            "resource_id": str(res.inserted_id),
            "is_read": False,
            "created_at": now_utc.isoformat(),
        })
        notifications_collection.insert_one({
            "recipient_role": "customer",
            "recipient_user_id": str(current_user.get("id", "")),
            "customer_id": str(cust_id),
            "title": "Order Placed Successfully",
            "message": f"Your order {order_number} has been submitted for review.",
            "type": "ORDER_CONFIRMATION",
            "resource_id": str(res.inserted_id),
            "is_read": False,
            "created_at": now_utc.isoformat(),
        })

        log_audit_event(
            actor=current_user,
            action="ORDER_PLACED",
            resource_type="order",
            resource_id=str(res.inserted_id),
            details={"order_number": order_number, "total_amount": order_doc["total_amount"]},
        )

        return serialize_document(order_doc)
    except PyMongoError as e:
        logger.error(f"Failed to place order: {e}")
        raise HTTPException(status_code=503, detail="Could not submit order. Please try again.")


@app.get("/customer/orders")
def get_customer_orders(
    status: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """Retrieve orders placed by current customer with status filtering."""
    cust_id = resolve_customer_id_for_user(current_user, customer_id)
    query: dict[str, Any] = {"customer_id": str(cust_id)}
    if status and status.strip().upper() != "ALL":
        query["status"] = status.strip().upper()

    try:
        total = orders_collection.count_documents(query)
        skip = (page - 1) * limit
        orders = list(orders_collection.find(query).sort("created_at", -1).skip(skip).limit(limit))
        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        return {
            "items": [serialize_document(o) for o in orders],
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve customer orders.")


@app.get("/customer/orders/{order_id}")
def get_customer_order_detail(
    order_id: str,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """Retrieve specific order details. Strictly prevents cross-customer unauthorized viewing."""
    o_oid = valid_object_id(order_id, "order")
    order = orders_collection.find_one({"_id": o_oid})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    if current_user.get("role") == "customer":
        cust_id = resolve_customer_id_for_user(current_user)
        if str(order.get("customer_id")) != str(cust_id):
            raise HTTPException(status_code=403, detail="Access denied: unauthorized order access.")

    return serialize_document(order)


@app.post("/customer/orders/{order_id}/cancel")
def cancel_customer_order(
    order_id: str,
    action: OrderCancelAction,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Cancel an order before it has been accepted or invoiced.
    """
    o_oid = valid_object_id(order_id, "order")
    order = orders_collection.find_one({"_id": o_oid})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    if current_user.get("role") == "customer":
        cust_id = resolve_customer_id_for_user(current_user)
        if str(order.get("customer_id")) != str(cust_id):
            raise HTTPException(status_code=403, detail="Access denied: cannot cancel another customer's order.")

    if order.get("status") not in ["PENDING_REVIEW", "UNDER_REVIEW"]:
        raise HTTPException(
            status_code=400,
            detail=f"Order cannot be cancelled in status '{order.get('status')}'.",
        )

    now_utc = datetime.now(timezone.utc)
    cancel_history = {
        "status": "CANCELLED",
        "changed_at": now_utc.isoformat(),
        "changed_by": current_user.get("email"),
        "role": current_user.get("role"),
        "notes": action.reason.strip() if action.reason else "Cancelled by customer.",
    }

    orders_collection.update_one(
        {"_id": o_oid},
        {
            "$set": {
                "status": "CANCELLED",
                "cancellation_reason": action.reason.strip() if action.reason else None,
                "updated_at": now_utc.isoformat(),
            },
            "$push": {"status_history": cancel_history},
        },
    )

    # Notify staff
    notifications_collection.insert_one({
        "recipient_role": "staff",
        "title": "Order Cancelled",
        "message": f"Order {order.get('order_number')} has been cancelled by customer.",
        "type": "ORDER_CANCELLED",
        "resource_id": str(order["_id"]),
        "is_read": False,
        "created_at": now_utc.isoformat(),
    })

    updated_order = orders_collection.find_one({"_id": o_oid})
    return serialize_document(updated_order)


@app.get("/customer/purchases")
def get_customer_purchases(
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Returns confirmed purchase history aggregated from invoices.
    Reflects actual billed and fulfilled items with invoice numbers and PDF download access.
    """
    cust_id = resolve_customer_id_for_user(current_user, customer_id)
    try:
        invoices = list(invoices_collection.find({"customer_id": str(cust_id)}).sort("invoice_date", -1))
        all_purchased_items = []
        total_spend = 0.0

        for inv in invoices:
            inv_id = str(inv["_id"])
            inv_num = inv.get("invoice_number", "")
            inv_date = inv.get("invoice_date") or (inv.get("created_at") or "")[:10]
            inv_status = inv.get("status", "UNPAID")
            total_spend += float(inv.get("total_amount", 0.0))

            for it in inv.get("items", []):
                all_purchased_items.append({
                    "invoice_id": inv_id,
                    "invoice_number": inv_num,
                    "invoice_date": inv_date,
                    "invoice_status": inv_status,
                    "product_id": it.get("product_id"),
                    "product_name": it.get("product_name"),
                    "unit": it.get("unit", "pcs"),
                    "quantity": it.get("quantity", 1),
                    "unit_price": it.get("unit_price", 0.0),
                    "total": it.get("total", 0.0),
                    "gst_rate": it.get("gst_rate", 0.0),
                })

        distinct_product_ids = {it["product_id"] for it in all_purchased_items if it.get("product_id")}

        return {
            "items": all_purchased_items,
            "total_purchases_count": len(all_purchased_items),
            "distinct_products_count": len(distinct_product_ids),
            "total_spend": round(total_spend, 2),
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve purchase history.")


# -------------------------
# Admin & Staff Order Management Endpoints
# -------------------------

@app.get("/orders")
def list_all_orders(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = None,
    search: Optional[str] = None,
    customer_id: Optional[str] = None,
    current_user: dict = Depends(require_staff_or_admin),
):
    """
    Admin and Staff order management table with status filtering and counts.
    """
    try:
        query: dict[str, Any] = {}
        if status and status.strip().upper() != "ALL":
            query["status"] = status.strip().upper()
        if customer_id:
            query["customer_id"] = str(customer_id)
        if search:
            s = re.escape(search.strip())
            query["$or"] = [
                {"order_number": {"$regex": s, "$options": "i"}},
                {"customer_name": {"$regex": s, "$options": "i"}},
                {"customer_email": {"$regex": s, "$options": "i"}},
            ]

        total = orders_collection.count_documents(query)
        skip = (page - 1) * limit
        orders = list(orders_collection.find(query).sort("created_at", -1).skip(skip).limit(limit))
        total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1

        # Summary counts
        pending_review_count = orders_collection.count_documents({"status": "PENDING_REVIEW"})
        under_review_count = orders_collection.count_documents({"status": "UNDER_REVIEW"})
        accepted_count = orders_collection.count_documents({"status": "ACCEPTED"})
        invoiced_count = orders_collection.count_documents({"status": "INVOICED"})
        rejected_count = orders_collection.count_documents({"status": "REJECTED"})
        cancelled_count = orders_collection.count_documents({"status": "CANCELLED"})

        return {
            "items": [serialize_document(o) for o in orders],
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
            "counts": {
                "pending_review": pending_review_count,
                "under_review": under_review_count,
                "accepted": accepted_count,
                "invoiced": invoiced_count,
                "rejected": rejected_count,
                "cancelled": cancelled_count,
                "total": orders_collection.count_documents({}),
            },
        }
    except PyMongoError:
        raise HTTPException(status_code=503, detail="Could not retrieve orders.")


@app.get("/orders/{order_id}")
def get_order_for_admin_or_staff(
    order_id: str,
    current_user: dict = Depends(require_staff_or_admin),
):
    """Retrieve complete order details for business management."""
    o_oid = valid_object_id(order_id, "order")
    order = orders_collection.find_one({"_id": o_oid})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    return serialize_document(order)


@app.get("/orders/{order_id}/pdf")
def download_order_pdf(
    order_id: str,
    token: Optional[str] = Query(None),
    current_user: dict = Depends(require_customer_or_staff_or_admin),
):
    """
    Generates and downloads an authentic Purchase Order / Summary PDF.
    If order is not yet invoiced, clearly labeled as Order / Purchase Summary.
    Enforces customer isolation.
    """
    ord_obj_id = valid_object_id(order_id, "order")
    try:
        order = orders_collection.find_one({"_id": ord_obj_id})
        if not order:
            raise HTTPException(status_code=404, detail="Order not found.")

        if current_user.get("role") == "customer":
            user_cust_id = current_user.get("customer_id")
            if not user_cust_id or str(order.get("customer_id")) != str(user_cust_id):
                raise HTTPException(
                    status_code=403,
                    detail="Access forbidden: you do not have permission to view this order document.",
                )

        customer = None
        cust_id = order.get("customer_id")
        if cust_id:
            try:
                customer = customers_collection.find_one({"_id": ObjectId(cust_id) if isinstance(cust_id, str) and ObjectId.is_valid(cust_id) else cust_id})
            except Exception:
                customer = None
        customer = customer or {}

        company = company_settings_collection.find_one() or DEFAULT_COMPANY_SETTINGS

        pdf_bytes = generate_order_pdf(order, customer, company)
        ord_num = order.get("order_number") or f"ORD-{str(ord_obj_id)[-6:]}"
        filename = f"Purchase_Summary_{ord_num}.pdf"

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate order PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate order PDF: {str(e)}")


@app.post("/orders/{order_id}/review")
def review_order(
    order_id: str,
    action: Optional[OrderReviewAction] = None,
    current_user: dict = Depends(require_staff_or_admin),
):
    """Mark an order as UNDER_REVIEW."""
    o_oid = valid_object_id(order_id, "order")
    order = orders_collection.find_one({"_id": o_oid})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    if order.get("status") not in ["PENDING_REVIEW", "UNDER_REVIEW"]:
        raise HTTPException(status_code=400, detail=f"Cannot move order in status '{order.get('status')}' to UNDER_REVIEW.")

    now_utc = datetime.now(timezone.utc)
    note = action.notes if action and action.notes else "Order is now under review by staff."

    orders_collection.update_one(
        {"_id": o_oid},
        {
            "$set": {"status": "UNDER_REVIEW", "updated_at": now_utc.isoformat()},
            "$push": {
                "status_history": {
                    "status": "UNDER_REVIEW",
                    "changed_at": now_utc.isoformat(),
                    "changed_by": current_user.get("email"),
                    "role": current_user.get("role"),
                    "notes": note,
                }
            },
        },
    )

    notifications_collection.insert_one({
        "recipient_role": "customer",
        "customer_id": str(order["customer_id"]),
        "title": "Order Under Review",
        "message": f"Your order {order.get('order_number')} is currently under review.",
        "type": "ORDER_STATUS_UPDATE",
        "resource_id": str(order["_id"]),
        "is_read": False,
        "created_at": now_utc.isoformat(),
    })

    updated = orders_collection.find_one({"_id": o_oid})
    return serialize_document(updated)


@app.post("/orders/{order_id}/accept")
def accept_order(
    order_id: str,
    action: Optional[OrderReviewAction] = None,
    current_user: dict = Depends(require_staff_or_admin),
):
    """Accept purchase order before generating invoice."""
    o_oid = valid_object_id(order_id, "order")
    order = orders_collection.find_one({"_id": o_oid})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    if order.get("status") in ["INVOICED", "REJECTED", "CANCELLED"]:
        raise HTTPException(status_code=400, detail=f"Cannot accept order in status '{order.get('status')}'.")

    now_utc = datetime.now(timezone.utc)
    note = action.notes if action and action.notes else "Order accepted by business."

    orders_collection.update_one(
        {"_id": o_oid},
        {
            "$set": {"status": "ACCEPTED", "updated_at": now_utc.isoformat()},
            "$push": {
                "status_history": {
                    "status": "ACCEPTED",
                    "changed_at": now_utc.isoformat(),
                    "changed_by": current_user.get("email"),
                    "role": current_user.get("role"),
                    "notes": note,
                }
            },
        },
    )

    notifications_collection.insert_one({
        "recipient_role": "customer",
        "customer_id": str(order["customer_id"]),
        "title": "Order Accepted",
        "message": f"Your order {order.get('order_number')} has been accepted.",
        "type": "ORDER_STATUS_UPDATE",
        "resource_id": str(order["_id"]),
        "is_read": False,
        "created_at": now_utc.isoformat(),
    })

    log_audit_event(
        actor=current_user,
        action="ORDER_ACCEPTED",
        resource_type="order",
        resource_id=str(order["_id"]),
        details={"order_number": order.get("order_number")},
    )

    updated = orders_collection.find_one({"_id": o_oid})
    return serialize_document(updated)


@app.post("/orders/{order_id}/reject")
def reject_order(
    order_id: str,
    action: OrderRejectAction,
    current_user: dict = Depends(require_staff_or_admin),
):
    """Reject purchase order with mandatory explanation reason."""
    o_oid = valid_object_id(order_id, "order")
    order = orders_collection.find_one({"_id": o_oid})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")

    if order.get("status") in ["INVOICED", "REJECTED", "CANCELLED"]:
        raise HTTPException(status_code=400, detail=f"Cannot reject order in status '{order.get('status')}'.")

    now_utc = datetime.now(timezone.utc)
    orders_collection.update_one(
        {"_id": o_oid},
        {
            "$set": {
                "status": "REJECTED",
                "rejection_reason": action.reason.strip(),
                "updated_at": now_utc.isoformat(),
            },
            "$push": {
                "status_history": {
                    "status": "REJECTED",
                    "changed_at": now_utc.isoformat(),
                    "changed_by": current_user.get("email"),
                    "role": current_user.get("role"),
                    "notes": f"Reason: {action.reason.strip()}",
                }
            },
        },
    )

    notifications_collection.insert_one({
        "recipient_role": "customer",
        "customer_id": str(order["customer_id"]),
        "title": "Order Rejected",
        "message": f"Your order {order.get('order_number')} was not approved. Reason: {action.reason.strip()}",
        "type": "ORDER_REJECTED",
        "resource_id": str(order["_id"]),
        "is_read": False,
        "created_at": now_utc.isoformat(),
    })

    log_audit_event(
        actor=current_user,
        action="ORDER_REJECTED",
        resource_type="order",
        resource_id=str(order["_id"]),
        details={"order_number": order.get("order_number"), "reason": action.reason.strip()},
    )

    updated = orders_collection.find_one({"_id": o_oid})
    return serialize_document(updated)


@app.post("/orders/{order_id}/generate-invoice")
def generate_invoice_for_order(
    order_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_staff_or_admin),
):
    """
    Atomically transforms an accepted order into an official tax invoice.
    Uses concurrency lock to prevent duplicate invoice generation.
    """
    lock = get_invoice_lock(f"order_invoice_{order_id}")
    with lock:
        o_oid = valid_object_id(order_id, "order")
        order = orders_collection.find_one({"_id": o_oid})
        if not order:
            raise HTTPException(status_code=404, detail="Order not found.")

        if order.get("status") == "INVOICED" or order.get("invoice_id"):
            raise HTTPException(status_code=400, detail="Invoice has already been generated for this order.")

        if order.get("status") in ["REJECTED", "CANCELLED"]:
            raise HTTPException(status_code=400, detail=f"Cannot generate invoice for order with status '{order.get('status')}'.")

        now_utc = datetime.now(timezone.utc)
        inv_number = generate_next_invoice_number(now_utc)
        today_str = now_utc.strftime("%Y-%m-%d")
        due_str = (now_utc + timedelta(days=15)).strftime("%Y-%m-%d")

        invoice_doc = {
            "invoice_number": inv_number,
            "customer_id": str(order["customer_id"]),
            "customer_name": order.get("customer_name", "Valued Client"),
            "billing_address": order.get("billing_address", ""),
            "shipping_address": order.get("shipping_address", ""),
            "place_of_supply": order.get("place_of_supply", ""),
            "supply_type": order.get("supply_type", "Intra-State"),
            "items": order.get("items", []),
            "subtotal": float(order.get("subtotal", 0.0)),
            "discount": float(order.get("discount", 0.0)),
            "taxable_amount": float(order.get("taxable_amount", 0.0)),
            "cgst_amount": float(order.get("total_cgst", 0.0)),
            "sgst_amount": float(order.get("total_sgst", 0.0)),
            "igst_amount": float(order.get("total_igst", 0.0)),
            "total_gst": float(order.get("total_gst", 0.0)),
            "total_amount": float(order.get("total_amount", 0.0)),
            "amount_paid": 0.0,
            "balance_due": float(order.get("total_amount", 0.0)),
            "status": "UNPAID",
            "invoice_date": today_str,
            "due_date": due_str,
            "order_id": str(order["_id"]),
            "order_number": order.get("order_number"),
            "created_by": current_user.get("email"),
            "created_at": now_utc.isoformat(),
            "updated_at": now_utc.isoformat(),
        }

        try:
            inv_res = invoices_collection.insert_one(invoice_doc)
            invoice_doc["_id"] = inv_res.inserted_id

            orders_collection.update_one(
                {"_id": o_oid},
                {
                    "$set": {
                        "status": "INVOICED",
                        "invoice_id": str(inv_res.inserted_id),
                        "invoice_number": inv_number,
                        "updated_at": now_utc.isoformat(),
                    },
                    "$push": {
                        "status_history": {
                            "status": "INVOICED",
                            "changed_at": now_utc.isoformat(),
                            "changed_by": current_user.get("email"),
                            "role": current_user.get("role"),
                            "notes": f"Invoice {inv_number} generated.",
                        }
                    },
                },
            )

            # Notifications
            notifications_collection.insert_one({
                "recipient_role": "customer",
                "customer_id": str(order["customer_id"]),
                "title": "Invoice Generated",
                "message": f"Invoice {inv_number} has been generated for your order {order.get('order_number')}.",
                "type": "INVOICE_GENERATED",
                "resource_id": str(inv_res.inserted_id),
                "is_read": False,
                "created_at": now_utc.isoformat(),
            })

            log_audit_event(
                actor=current_user,
                action="ORDER_INVOICED",
                resource_type="invoice",
                resource_id=str(inv_res.inserted_id),
                details={"order_number": order.get("order_number"), "invoice_number": inv_number},
            )

            # Automatically dispatch invoice PDF via email in background
            background_tasks.add_task(dispatch_invoice_email, str(inv_res.inserted_id))

            updated_order = orders_collection.find_one({"_id": o_oid})
            return {
                "order": serialize_document(updated_order),
                "invoice": serialize_document(invoice_doc),
            }
        except PyMongoError as e:
            logger.error(f"Failed to generate invoice for order {order_id}: {e}")
            raise HTTPException(status_code=503, detail="Could not generate invoice. Please retry.")


# ---------------------------------------------------------------------------
# Payment Scheduling Endpoints
# ---------------------------------------------------------------------------

class PaymentScheduleCreate(BaseModel):
    invoice_id: str
    scheduled_date: str = Field(..., description="Format: YYYY-MM-DD")
    planned_amount: float = Field(..., gt=0)
    payment_method: str = Field(default="UPI")
    notes: Optional[str] = Field(default=None, max_length=500)


class PaymentScheduleUpdate(BaseModel):
    scheduled_date: Optional[str] = Field(default=None, description="Format: YYYY-MM-DD")
    planned_amount: Optional[float] = Field(default=None, gt=0)
    payment_method: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=500)
    status: Optional[str] = None


@app.post("/payment-schedules", status_code=201)
def create_payment_schedule(
    req: PaymentScheduleCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Schedules a planned future payment for an invoice.
    CRITICAL RULE: Scheduled payments are planning reminders only and MUST NOT reduce
    the invoice outstanding balance or mark it paid. Actual balance deduction only happens
    when real payment is verified and cleared.
    """
    try:
        inv_oid = ObjectId(req.invoice_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid invoice ID format.")

    invoice = invoices_collection.find_one({"_id": inv_oid})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")

    # Access control
    if current_user.get("role") == "customer":
        cust_id = current_user.get("customer_id")
        if not cust_id or str(invoice.get("customer_id")) != str(cust_id):
            raise HTTPException(status_code=403, detail="You can only schedule payments for your own invoices.")

    # Check invoice status and balance
    balance_due = float(invoice.get("balance_due", 0))
    inv_status = (invoice.get("status") or "").upper()
    if inv_status == "PAID" or balance_due <= 0:
        raise HTTPException(status_code=400, detail="This invoice is already fully paid. Cannot schedule additional payments.")

    if round(req.planned_amount, 2) > round(balance_due, 2):
        raise HTTPException(
            status_code=400,
            detail=f"Planned amount ({req.planned_amount:.2f}) exceeds current outstanding balance ({balance_due:.2f}).",
        )

    # Validate date
    try:
        sched_dt = datetime.strptime(req.scheduled_date.strip(), "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="scheduled_date must be formatted as YYYY-MM-DD.")

    today_dt = datetime.now(timezone.utc).date()
    if sched_dt < today_dt:
        raise HTTPException(status_code=400, detail="Scheduled payment date cannot be in the past.")

    now_iso = datetime.now(timezone.utc).isoformat()
    customer_name = invoice.get("customer_name") or invoice.get("client_name") or "Customer"

    schedule_doc = {
        "invoice_id": str(invoice["_id"]),
        "invoice_number": invoice.get("invoice_number", ""),
        "customer_id": str(invoice.get("customer_id")),
        "customer_name": customer_name,
        "planned_amount": round(float(req.planned_amount), 2),
        "scheduled_date": req.scheduled_date.strip(),
        "payment_method": (req.payment_method or "UPI").strip(),
        "notes": (req.notes or "").strip(),
        "status": "PLANNED",
        "created_by_user_id": str(current_user.get("id") or current_user.get("_id") or ""),
        "created_by_role": current_user.get("role"),
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    try:
        res = payment_schedules_collection.insert_one(schedule_doc)
        schedule_doc["_id"] = res.inserted_id

        # Notification
        create_notification(
            title="Payment Scheduled",
            message=f"Payment of Rs. {schedule_doc['planned_amount']:.2f} scheduled for invoice {schedule_doc['invoice_number']} on {schedule_doc['scheduled_date']}.",
            recipient_role="customer" if current_user.get("role") != "customer" else "admin",
            customer_id=str(invoice.get("customer_id")),
            notification_type="PAYMENT_SCHEDULED",
        )

        log_audit_event(
            actor=current_user,
            action="PAYMENT_SCHEDULE_CREATED",
            resource_type="payment_schedule",
            resource_id=str(res.inserted_id),
            details={
                "invoice_id": str(invoice["_id"]),
                "invoice_number": invoice.get("invoice_number"),
                "planned_amount": schedule_doc["planned_amount"],
                "scheduled_date": schedule_doc["scheduled_date"],
            },
        )

        return serialize_document(schedule_doc)
    except PyMongoError as e:
        logger.error(f"Failed to record payment schedule: {e}")
        raise HTTPException(status_code=503, detail="Could not create payment schedule. Please retry.")


@app.get("/payment-schedules")
def list_payment_schedules(
    invoice_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """
    List payment schedules with role isolation and automatic overdue detection.
    """
    query: Dict[str, Any] = {}

    if current_user.get("role") == "customer":
        cust_id = current_user.get("customer_id")
        if not cust_id:
            return []
        query["customer_id"] = str(cust_id)
    elif customer_id:
        query["customer_id"] = str(customer_id)

    if invoice_id:
        query["invoice_id"] = str(invoice_id)

    # Automatic overdue status update for planned items in the past
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        payment_schedules_collection.update_many(
            {"status": "PLANNED", "scheduled_date": {"$lt": today_str}},
            {"$set": {"status": "OVERDUE", "updated_at": now_iso}},
        )
    except Exception as e:
        logger.warning(f"Failed to update overdue payment schedules: {e}")

    if status:
        query["status"] = status.strip().upper()

    try:
        schedules = list(
            payment_schedules_collection.find(query).sort([("scheduled_date", 1), ("created_at", -1)])
        )
        return [serialize_document(s) for s in schedules]
    except PyMongoError as e:
        logger.error(f"Failed to fetch payment schedules: {e}")
        raise HTTPException(status_code=503, detail="Could not fetch payment schedules.")


@app.get("/payment-schedules/{schedule_id}")
def get_payment_schedule(
    schedule_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Fetch a single payment schedule with customer access verification.
    """
    try:
        s_oid = ObjectId(schedule_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid schedule ID format.")

    sched = payment_schedules_collection.find_one({"_id": s_oid})
    if not sched:
        raise HTTPException(status_code=404, detail="Payment schedule not found.")

    if current_user.get("role") == "customer":
        cust_id = current_user.get("customer_id")
        if not cust_id or str(sched.get("customer_id")) != str(cust_id):
            raise HTTPException(status_code=403, detail="Access denied.")

    return serialize_document(sched)


@app.patch("/payment-schedules/{schedule_id}")
def update_payment_schedule(
    schedule_id: str,
    req: PaymentScheduleUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Updates an existing planned payment schedule.
    """
    try:
        s_oid = ObjectId(schedule_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid schedule ID format.")

    sched = payment_schedules_collection.find_one({"_id": s_oid})
    if not sched:
        raise HTTPException(status_code=404, detail="Payment schedule not found.")

    if current_user.get("role") == "customer":
        cust_id = current_user.get("customer_id")
        if not cust_id or str(sched.get("customer_id")) != str(cust_id):
            raise HTTPException(status_code=403, detail="Access denied.")

    if sched.get("status") in ("COMPLETED", "CANCELLED"):
        raise HTTPException(status_code=400, detail="Cannot modify a completed or cancelled payment schedule.")

    update_fields: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}

    if req.scheduled_date:
        try:
            s_date = datetime.strptime(req.scheduled_date.strip(), "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="scheduled_date must be formatted as YYYY-MM-DD.")
        today_dt = datetime.now(timezone.utc).date()
        if s_date < today_dt:
            raise HTTPException(status_code=400, detail="Scheduled payment date cannot be in the past.")
        update_fields["scheduled_date"] = req.scheduled_date.strip()
        # Reset overdue if scheduled date moved to today or future
        if sched.get("status") == "OVERDUE":
            update_fields["status"] = "PLANNED"

    if req.planned_amount is not None:
        inv = invoices_collection.find_one({"_id": ObjectId(sched["invoice_id"])})
        if inv:
            bal = float(inv.get("balance_due", 0))
            if round(req.planned_amount, 2) > round(bal, 2):
                raise HTTPException(
                    status_code=400,
                    detail=f"Planned amount ({req.planned_amount:.2f}) exceeds current outstanding balance ({bal:.2f}).",
                )
        update_fields["planned_amount"] = round(float(req.planned_amount), 2)

    if req.payment_method:
        update_fields["payment_method"] = req.payment_method.strip()

    if req.notes is not None:
        update_fields["notes"] = req.notes.strip()

    if req.status and req.status.upper() in ("PLANNED", "CANCELLED"):
        update_fields["status"] = req.status.upper()

    try:
        updated = payment_schedules_collection.find_one_and_update(
            {"_id": s_oid},
            {"$set": update_fields},
            return_document=ReturnDocument.AFTER,
        )
        return serialize_document(updated)
    except PyMongoError as e:
        logger.error(f"Failed to update payment schedule {schedule_id}: {e}")
        raise HTTPException(status_code=503, detail="Could not update payment schedule.")


@app.delete("/payment-schedules/{schedule_id}")
def cancel_payment_schedule(
    schedule_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Cancels a payment schedule. Customer can cancel their own; Admin and Staff can cancel any.
    """
    try:
        s_oid = ObjectId(schedule_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid schedule ID format.")

    sched = payment_schedules_collection.find_one({"_id": s_oid})
    if not sched:
        raise HTTPException(status_code=404, detail="Payment schedule not found.")

    if current_user.get("role") == "customer":
        cust_id = current_user.get("customer_id")
        if not cust_id or str(sched.get("customer_id")) != str(cust_id):
            raise HTTPException(status_code=403, detail="Access denied.")

    if sched.get("status") == "COMPLETED":
        raise HTTPException(status_code=400, detail="Cannot cancel a completed payment schedule.")

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        payment_schedules_collection.update_one(
            {"_id": s_oid},
            {"$set": {"status": "CANCELLED", "cancelled_at": now_iso, "cancelled_by": current_user.get("email"), "updated_at": now_iso}}
        )
        return {"message": "Payment schedule cancelled successfully.", "schedule_id": schedule_id}
    except PyMongoError as e:
        logger.error(f"Failed to cancel payment schedule {schedule_id}: {e}")
        raise HTTPException(status_code=503, detail="Could not cancel payment schedule.")


@app.patch("/payment-schedules/{schedule_id}/complete")
def complete_payment_schedule(
    schedule_id: str,
    current_user: dict = Depends(require_staff_or_admin),
):
    """
    Admin and Staff endpoint to mark a planned payment schedule as COMPLETED
    once the payment has been recorded and verified.
    """
    try:
        s_oid = ObjectId(schedule_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid schedule ID format.")

    sched = payment_schedules_collection.find_one({"_id": s_oid})
    if not sched:
        raise HTTPException(status_code=404, detail="Payment schedule not found.")

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        updated = payment_schedules_collection.find_one_and_update(
            {"_id": s_oid},
            {
                "$set": {
                    "status": "COMPLETED",
                    "completed_at": now_iso,
                    "completed_by": current_user.get("email"),
                    "updated_at": now_iso,
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        return serialize_document(updated)
    except PyMongoError as e:
        logger.error(f"Failed to complete payment schedule {schedule_id}: {e}")
        raise HTTPException(status_code=503, detail="Could not complete payment schedule.")




