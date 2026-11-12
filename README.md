# Viora Bills v1

A modern, full-stack GST billing, customer ordering, and invoice management system built with **FastAPI**, **MongoDB**, and **React (Vite)**.

---

## 🌟 Key Features

- **GST Compliant Invoicing**: Automated calculation of CGST, SGST, and IGST with atomic sequence numbering (`INV-YYYY-XXXXX`).
- **Role-Based Access Control (RBAC)**:
  - **Admin**: Revenue analytics, audit trail logs, staff management, and business profile configuration.
  - **Staff**: Daily billing, invoice dispatch, order approvals, and multi-channel payment reconciliation (Cash, Cheque, UPI, Card).
  - **Customer Portal**: Self-service product catalogue, cart management, checkout with sequential PO tracking, dynamic UPI QR payment, and PDF invoice downloads.
- **Automated Communication**: OTP-based user verification, password recovery, and email dispatch for invoices and receipts.
- **One-Click Desktop Launcher**: Standalone launcher script and executable (`VioraBills_v1.exe`) to orchestrate backend, frontend, and database services seamlessly.

---

## 🛠️ Tech Stack

- **Backend**: Python 3.11+ / 3.13, FastAPI, Uvicorn, Motor/PyMongo, Pydantic, Argon2id, PyJWT, ReportLab.
- **Frontend**: React 18, Vite, React Router v6, Tailwind CSS / Modern CSS, Lucide Icons.
- **Database**: MongoDB (Local or Atlas).

---

## 🚀 Quick Start Guide

### Option 1: One-Click Desktop Launcher (Windows)
Double-click `VioraBills_v1.exe` in the root folder, or run:
```bash
python launcher.py
```
This automatically verifies the MongoDB background service, spins up FastAPI on `http://127.0.0.1:8000`, starts Vite on `http://localhost:5173`, and opens your default browser.

---

### Option 2: Manual Development Setup

#### 1. Prerequisites
- [Python 3.11+](https://www.python.org/downloads/)
- [Node.js 18+](https://nodejs.org/)
- [MongoDB Community Server](https://www.mongodb.com/try/download/community) running locally on port `27017`

#### 2. Backend Setup
```bash
cd backend

# Create environment configuration
cp .env.example .env

# Install Python dependencies
pip install -r requirements.txt

# Start backend API server
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
API Documentation will be live at `http://127.0.0.1:8000/docs`.

#### 3. Frontend Setup
In a new terminal:
```bash
cd frontend

# Install dependencies
npm install

# Start Vite development server
npm run dev
```
The application will be accessible at `http://localhost:5173`.

---

## 🧪 Running Automated Tests

The test suite covers full end-to-end flows, RBAC authorization, customer shopping cart, and GST calculations:
```bash
pytest tests/
```

---

## 📁 Project Structure

```text
Viora Bills v1/
├── backend/                  # FastAPI backend
│   ├── main.py               # Main application and API endpoints
│   ├── requirements.txt      # Python dependencies
│   ├── .env.example          # Environment variables template
│   └── uploads/              # Static file uploads (product images, logos)
├── frontend/                 # React + Vite application
│   ├── src/                  # React components, pages, hooks, routes
│   ├── public/               # Public assets & icons
│   ├── package.json          # Node dependencies & scripts
│   └── vite.config.js        # Vite configuration
├── tests/                    # Automated pytest test suites
├── launcher.py               # Desktop launcher source
├── VioraBills_v1.exe         # One-click Windows executable
└── README.md                 # Project documentation
```

---

## 📄 License
This project is proprietary and confidential. Developed for Viora Bills.
