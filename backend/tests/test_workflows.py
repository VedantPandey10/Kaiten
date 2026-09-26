from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KAITEN_SEED_DEMO_DATA", "false")
    monkeypatch.setenv("KAITEN_JWT_SECRET", "test-secret-that-is-long-enough-for-tests")
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    with TestClient(create_app(database_url)) as test_client:
        bootstrap = test_client.post(
            "/api/auth/bootstrap",
            json={
                "name": "Admin",
                "email": "admin@example.com",
                "password": "Admin-password-123!",
            },
        )
        admin_headers = {"Authorization": f"Bearer {bootstrap.json()['access_token']}"}
        operator = test_client.post(
            "/api/users",
            headers=admin_headers,
            json={
                "name": "Operator",
                "email": "operator@example.com",
                "password": "Operator-password-123!",
                "role": "OPERATOR",
            },
        )
        operator_login = test_client.post(
            "/api/auth/login",
            json={"email": "operator@example.com", "password": "Operator-password-123!"},
        )
        test_client.headers.update({"Authorization": f"Bearer {operator_login.json()['access_token']}"})
        yield test_client


def test_create_workflow_persists_creation_audit_event(client):
    response = client.post(
        "/api/workflows", json={"objective": "Find overdue invoices above INR 100,000"}
    )

    assert response.status_code == 201
    workflow = response.json()
    assert workflow["status"] == "CREATED"
    assert workflow["objective"] == "Find overdue invoices above INR 100,000"

    audit_response = client.get(f"/api/workflows/{workflow['id']}/audit")
    assert audit_response.status_code == 200
    assert [event["event_type"] for event in audit_response.json()] == ["WORKFLOW_CREATED"]


def test_start_workflow_updates_status_and_audit(client):
    created = client.post("/api/workflows", json={"objective": "Recover overdue invoices"})

    response = client.post(f"/api/workflows/{created.json()['id']}/start")

    assert response.status_code == 200
    assert response.json()["status"] == "WAITING_FOR_INPUT"
    audit = client.get(f"/api/workflows/{created.json()['id']}/audit").json()
    event_types = [event["event_type"] for event in audit]
    assert event_types[:2] == ["WORKFLOW_CREATED", "PLAN_GENERATED"]
    assert "MISSING_INFORMATION" in event_types


def test_starting_workflow_twice_returns_conflict(client):
    created = client.post("/api/workflows", json={"objective": "Recover overdue invoices"})
    workflow_id = created.json()["id"]
    client.post(f"/api/workflows/{workflow_id}/start")

    response = client.post(f"/api/workflows/{workflow_id}/start")

    assert response.status_code == 409


def test_cancel_workflow_and_unknown_workflow(client):
    created = client.post("/api/workflows", json={"objective": "Recover overdue invoices"})

    cancelled = client.post(f"/api/workflows/{created.json()['id']}/cancel")
    missing = client.get(f"/api/workflows/{uuid4()}")

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    assert missing.status_code == 404


def test_blank_objective_is_rejected(client):
    response = client.post("/api/workflows", json={"objective": "   "})

    assert response.status_code == 422