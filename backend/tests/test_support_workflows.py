from datetime import datetime, timedelta, timezone
UTC = getattr(datetime, 'UTC', timezone.utc)

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KAITEN_SEED_DEMO_DATA", "false")
    monkeypatch.setenv("KAITEN_JWT_SECRET", "support-test-secret-that-is-long-enough")
    with TestClient(create_app(f"sqlite:///{tmp_path / 'support.db'}")) as test_client:
        admin = test_client.post("/api/auth/bootstrap", json={
            "name": "Admin", "email": "admin@example.com",
            "password": "Admin-password-123!",
        }).json()
        admin_headers = {"Authorization": f"Bearer {admin['access_token']}"}
        for name, email, role in [
            ("Operator", "operator@example.com", "OPERATOR"),
            ("Approver", "approver@example.com", "APPROVER"),
            ("Viewer", "viewer@example.com", "VIEWER"),
        ]:
            test_client.post("/api/users", headers=admin_headers, json={
                "name": name, "email": email, "password": "Strong-password-123!", "role": role,
            })
        yield test_client


def login(client, email):
    response = client.post("/api/auth/login", json={
        "email": email, "password": "Strong-password-123!",
    })
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_support_ticket_crud_and_sla_filter_respect_roles(client):
    operator = login(client, "operator@example.com")
    viewer = login(client, "viewer@example.com")
    created = client.post("/api/tickets", headers=operator, json={
        "ticket_number": "SUP-1042", "subject": "Checkout is failing",
        "description": "Customer cannot complete payment.",
        "requester_email": "buyer@example.com", "priority": "URGENT",
        "status": "OPEN", "sla_due_at": (datetime.now(UTC) - timedelta(hours=2)).isoformat(),
    })
    assert created.status_code == 201
    ticket_id = created.json()["id"]
    assert client.get("/api/tickets", headers=operator, params={"sla_breached": "true"}).json()[0]["ticket_number"] == "SUP-1042"
    assert client.get(f"/api/tickets/{ticket_id}", headers=viewer).status_code == 200
    assert client.patch(f"/api/tickets/{ticket_id}", headers=viewer, json={"priority": "LOW"}).status_code == 403

    updated = client.patch(f"/api/tickets/{ticket_id}", headers=operator, json={"subject": "Checkout unavailable"})
    assert updated.status_code == 200
    assert updated.json()["subject"] == "Checkout unavailable"
    assert client.delete(f"/api/tickets/{ticket_id}", headers=operator).status_code == 204


def test_sla_workflow_gathers_evidence_and_requires_approval(client):
    operator = login(client, "operator@example.com")
    approver = login(client, "approver@example.com")
    created = client.post("/api/tickets", headers=operator, json={
        "ticket_number": "SUP-2048", "subject": "Orders are not syncing",
        "description": "New orders are missing from the dashboard.",
        "requester_email": "ops@example.com", "priority": "HIGH", "status": "OPEN",
        "sla_due_at": (datetime.now(UTC) - timedelta(hours=27)).isoformat(),
    }).json()
    workflow = client.post("/api/workflows", headers=operator, json={
        "objective": "Find unresolved high-priority support tickets older than 24 hours and escalate them",
    }).json()

    started = client.post(f"/api/workflows/{workflow['id']}/start", headers=operator)
    assert started.json()["status"] == "WAITING_APPROVAL"
    tasks = client.get(f"/api/workflows/{workflow['id']}/tasks", headers=operator).json()
    assert all(task["status"] == "COMPLETED" for task in tasks[:4])
    evidence = tasks[0]["result_data"]["tickets"][0]
    assert evidence["ticket_number"] == "SUP-2048"
    assert evidence["hours_past_sla"] >= 26

    approval = next(task for task in tasks if task["kind"] == "APPROVAL")
    assert client.post(f"/api/tasks/{approval['id']}/approve", headers=operator).status_code == 403
    assert client.post(f"/api/tasks/{approval['id']}/approve", headers=approver).status_code == 200
    tasks = client.get(f"/api/workflows/{workflow['id']}/tasks", headers=operator).json()
    action = next(task for task in tasks if task["kind"] == "ACTION")
    assert client.post(f"/api/tasks/{action['id']}/complete", headers=operator).status_code == 200
    ticket = client.get(f"/api/tickets/{created['id']}", headers=operator).json()
    assert ticket["status"] == "IN_PROGRESS"
    events = client.get(f"/api/tickets/{created['id']}/events", headers=operator).json()
    assert any(event["event_type"] == "ESCALATION_SIMULATED" for event in events)


def test_support_workflow_resumes_when_sla_data_becomes_eligible(client):
    operator = login(client, "operator@example.com")
    created = client.post("/api/tickets", headers=operator, json={
        "ticket_number": "SUP-3049", "subject": "Account locked",
        "description": "Waiting on first response.", "requester_email": "user@example.com",
        "priority": "HIGH", "status": "OPEN",
        "sla_due_at": (datetime.now(UTC) + timedelta(hours=4)).isoformat(),
    }).json()
    workflow = client.post("/api/workflows", headers=operator, json={
        "objective": "Escalate high-priority support tickets with breached SLA",
    }).json()
    assert client.post(f"/api/workflows/{workflow['id']}/start", headers=operator).json()["status"] == "WAITING_FOR_INPUT"

    updated = client.patch(f"/api/tickets/{created['id']}", headers=operator, json={
        "sla_due_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
    })
    assert updated.status_code == 200
    resumed = client.post(f"/api/workflows/{workflow['id']}/resume", headers=operator)
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "WAITING_APPROVAL"