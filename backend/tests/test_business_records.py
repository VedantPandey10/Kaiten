from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KAITEN_SEED_DEMO_DATA", "false")
    monkeypatch.setenv("KAITEN_JWT_SECRET", "test-secret-that-is-long-enough-for-tests")
    with TestClient(create_app(f"sqlite:///{tmp_path / 'records.db'}")) as test_client:
        admin = test_client.post("/api/auth/bootstrap", json={
            "name": "Admin", "email": "admin@example.com",
            "password": "Admin-password-123!",
        }).json()
        headers = {"Authorization": f"Bearer {admin['access_token']}"}
        test_client.headers.update(headers)
        viewer = test_client.post("/api/users", headers=headers, json={
            "name": "Viewer", "email": "viewer@example.com",
            "password": "Viewer-password-123!", "role": "VIEWER",
        }).json()
        viewer_login = test_client.post("/api/auth/login", json={
            "email": viewer["email"], "password": "Viewer-password-123!",
        }).json()
        test_client.viewer_headers = {"Authorization": f"Bearer {viewer_login['access_token']}"}
        yield test_client


def test_business_records_crud_and_payment_reconciliation(client):
    customer = client.post("/api/customers", json={
        "name": "Acme Manufacturing", "email": "finance@acme.example.com", "segment": "ENTERPRISE",
    })
    assert customer.status_code == 201
    customer_id = customer.json()["id"]
    assert client.get(f"/api/customers/{customer_id}").json()["segment"] == "ENTERPRISE"

    invoice = client.post("/api/invoices", json={
        "invoice_number": "INV-2001", "customer_id": customer_id,
        "amount": "150000.00", "currency": "INR", "due_date": str(date.today() - timedelta(days=45)),
    })
    assert invoice.status_code == 201
    invoice_id = invoice.json()["id"]
    assert len(client.get("/api/invoices", params={"overdue_only": "true", "minimum_amount": "100000"}).json()) == 1

    assert client.post("/api/payments", json={
        "invoice_id": invoice_id, "amount": "50000.00", "paid_at": str(date.today()), "reference": "PAY-1",
    }).json()["invoice_id"] == invoice_id
    assert client.get(f"/api/invoices/{invoice_id}").json()["status"] == "OPEN"
    payment = client.post("/api/payments", json={
        "invoice_id": invoice_id, "amount": "100000.00", "paid_at": str(date.today()), "reference": "PAY-2",
    }).json()
    assert client.get(f"/api/invoices/{invoice_id}").json()["status"] == "PAID"
    assert client.get("/api/invoices", params={"overdue_only": "true"}).json() == []

    contract = client.post("/api/contracts", json={
        "customer_id": customer_id, "reference": "MSA-2001",
        "requires_formal_notice": True, "notice_terms": "Send written notice before escalation.",
    })
    assert contract.status_code == 201
    assert client.patch(f"/api/contracts/{contract.json()['id']}", json={"requires_formal_notice": False}).json()["requires_formal_notice"] is False
    assert client.patch(f"/api/customers/{customer_id}", json={"segment": "STRATEGIC"}).json()["segment"] == "STRATEGIC"
    assert client.patch(f"/api/invoices/{invoice_id}", json={"invoice_number": "INV-2001-UPDATED"}).json()["invoice_number"] == "INV-2001-UPDATED"
    assert client.patch(f"/api/payments/{payment['id']}", json={"reference": "PAY-UPDATED"}).status_code == 200
    assert client.delete(f"/api/customers/{customer_id}").status_code == 409

    assert client.delete(f"/api/invoices/{invoice_id}").status_code == 204
    assert client.delete(f"/api/contracts/{contract.json()['id']}").status_code == 204
    assert client.delete(f"/api/customers/{customer_id}").status_code == 204


def test_viewer_can_read_but_cannot_change_business_records(client):
    response = client.post("/api/customers", headers=client.viewer_headers, json={
        "name": "No Write", "email": "no-write@example.com",
    })
    assert response.status_code == 403
    assert client.get("/api/customers", headers=client.viewer_headers).status_code == 200


def test_workflow_gathers_records_and_simulates_recommended_communication(client):
    customer = client.post("/api/customers", json={
        "name": "Northwind Systems", "email": "ap@northwind.example.com", "segment": "ENTERPRISE",
    }).json()
    overdue = client.post("/api/invoices", json={
        "invoice_number": "INV-4800", "customer_id": customer["id"], "amount": "480000.00",
        "due_date": str(date.today() - timedelta(days=47)), "currency": "INR",
    }).json()
    historical = client.post("/api/invoices", json={
        "invoice_number": "INV-HISTORY", "customer_id": customer["id"], "amount": "1000.00",
        "due_date": str(date.today() - timedelta(days=100)), "currency": "INR",
    }).json()
    client.post("/api/payments", json={
        "invoice_id": historical["id"], "amount": "1000.00",
        "paid_at": str(date.today() - timedelta(days=50)), "reference": "LATE-PAYMENT",
    })
    client.post("/api/contracts", json={
        "customer_id": customer["id"], "reference": "MSA-NW-1",
        "requires_formal_notice": True, "notice_terms": "Written notice is required.",
    })

    workflow = client.post("/api/workflows", json={
        "objective": "Find overdue invoices above INR 100,000 and contact customers",
    }).json()
    started = client.post(f"/api/workflows/{workflow['id']}/start")
    assert started.json()["status"] == "WAITING_APPROVAL"
    tasks = client.get(f"/api/workflows/{workflow['id']}/tasks").json()
    gather = next(task for task in tasks if task["order_index"] == 1)
    recommendation_step = next(task for task in tasks if task["kind"] == "RECOMMEND")
    invoice_evidence = gather["result_data"]["invoices"][0]
    recommendation = recommendation_step["result_data"]["recommendations"][0]
    assert invoice_evidence["invoice_number"] == "INV-4800"
    assert invoice_evidence["days_overdue"] == 47
    assert invoice_evidence["late_payment_count"] == 1
    assert recommendation["recommended_action"] == "Formal payment notice"

    approval = next(task for task in tasks if task["kind"] == "APPROVAL")
    assert client.post(f"/api/tasks/{approval['id']}/approve").status_code == 200
    tasks = client.get(f"/api/workflows/{workflow['id']}/tasks").json()
    action = next(task for task in tasks if task["kind"] == "ACTION")
    assert client.post(f"/api/tasks/{action['id']}/complete").status_code == 200
    communications = client.get("/api/communications").json()
    assert len(communications) == 1
    assert communications[0]["invoice_id"] == overdue["id"]
    assert communications[0]["status"] == "SIMULATED_SENT"
    assert "No message was sent externally" in communications[0]["body"]

    tasks = client.get(f"/api/workflows/{workflow['id']}/tasks").json()
    monitor = next(task for task in tasks if task["kind"] == "MONITOR")
    assert client.post(f"/api/tasks/{monitor['id']}/complete").status_code == 200
    assert client.get(f"/api/workflows/{workflow['id']}").json()["status"] == "RESOLVED"


def test_missing_invoice_input_resumes_at_the_approval_gate(client):
    customer = client.post("/api/customers", json={
        "name": "Harbor Labs", "email": "finance@harbor.example.com",
    }).json()
    workflow = client.post("/api/workflows", json={
        "objective": "Find overdue invoices above INR 100,000",
    }).json()
    assert client.post(f"/api/workflows/{workflow['id']}/start").json()["status"] == "WAITING_FOR_INPUT"

    client.post("/api/invoices", json={
        "invoice_number": "INV-HARBOR-1", "customer_id": customer["id"], "amount": "120000.00",
        "due_date": str(date.today() - timedelta(days=20)), "currency": "INR",
    })
    resumed = client.post(f"/api/workflows/{workflow['id']}/resume")
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "WAITING_APPROVAL"
    tasks = client.get(f"/api/workflows/{workflow['id']}/tasks").json()
    assert next(task for task in tasks if task["kind"] == "APPROVAL")["status"] == "WAITING_APPROVAL"
    assert any(event["event_type"] == "DATA_RECONCILED" for event in client.get(f"/api/workflows/{workflow['id']}/audit").json())