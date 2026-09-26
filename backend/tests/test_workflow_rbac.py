from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KAITEN_SEED_DEMO_DATA", "false")
    monkeypatch.setenv("KAITEN_JWT_SECRET", "test-secret-that-is-long-enough-for-tests")
    database_url = f"sqlite:///{tmp_path / 'rbac.db'}"
    with TestClient(create_app(database_url)) as test_client:
        yield test_client


def bootstrap_admin(client):
    response = client.post(
        "/api/auth/bootstrap",
        json={
            "name": "Workspace Admin",
            "email": "admin@example.com",
            "password": "Admin-password-123!",
        },
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def create_user(client, admin_token, name, email, role):
    response = client.post(
        "/api/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": name, "email": email, "password": "Strong-password-123!", "role": role},
    )
    assert response.status_code == 201
    return response.json()


def login(client, email, password):
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_routes_require_a_valid_token(client):
    assert client.get("/api/workflows").status_code == 401
    assert client.get("/api/auth/me", headers=auth("not-a-token")).status_code == 401


def test_local_bootstrap_generates_session_and_seeds_owner_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("KAITEN_SEED_DEMO_DATA", "true")
    monkeypatch.setenv("KAITEN_JWT_SECRET", "test-secret-that-is-long-enough-for-tests")
    with TestClient(create_app(f"sqlite:///{tmp_path / 'owner-seed.db'}")) as seeded_client:
        bootstrap = seeded_client.post("/api/auth/bootstrap", json={
            "name": "Vedant", "company": "Vedant Operations", "email": "vedant@example.com",
            "password": "Aloha@123",
        })
        assert bootstrap.status_code == 201
        assert bootstrap.json()["access_token"]
        headers = auth(bootstrap.json()["access_token"])
        assert seeded_client.get("/api/auth/me", headers=headers).json()["company"] == "Vedant Operations"
        assert len(seeded_client.get("/api/customers", headers=headers).json()) == 3
        assert len(seeded_client.get("/api/invoices", headers=headers).json()) == 4
        assert len(seeded_client.get("/api/contracts", headers=headers).json()) == 2
        assert len(seeded_client.get("/api/tickets", headers=headers).json()) == 2
        seeded_workflows = seeded_client.get("/api/workflows", headers=headers).json()
        assert len(seeded_workflows) == 2
        assert all(workflow["status"] == "WAITING_APPROVAL" for workflow in seeded_workflows)
        assert len(seeded_client.get("/api/communications", headers=headers).json()) == 1


def test_bootstrap_is_rejected_for_non_local_request(tmp_path, monkeypatch):
    monkeypatch.setenv("KAITEN_SEED_DEMO_DATA", "false")
    monkeypatch.setenv("KAITEN_JWT_SECRET", "test-secret-that-is-long-enough-for-tests")
    with TestClient(create_app(f"sqlite:///{tmp_path / 'remote-bootstrap.db'}"), client=("203.0.113.10", 50000)) as remote_client:
        response = remote_client.post("/api/auth/bootstrap", json={
            "name": "Remote", "company": "Remote Company", "email": "remote@example.com",
            "password": "Aloha@123",
        })
    assert response.status_code == 403


def test_public_registration_waits_for_admin_activation(client, monkeypatch):
    registration = {
        "name": "New Operator",
        "company": "Example Operations",
        "email": "new.operator@example.com",
        "password": "Strong-password-123!",
    }
    assert client.post("/api/auth/register", json=registration).status_code == 503

    admin_token = bootstrap_admin(client)
    monkeypatch.setenv("KAITEN_ENV", "production")
    response = client.post("/api/auth/register", json=registration)
    assert response.status_code == 202
    assert "activate" in response.json()["detail"].lower()
    assert client.post(
        "/api/auth/login",
        json={"email": registration["email"], "password": registration["password"]},
    ).status_code == 401

    users = client.get("/api/users", headers=auth(admin_token)).json()
    pending = next(user for user in users if user["email"] == registration["email"])
    assert pending["role"] == "OPERATOR"
    assert pending["is_active"] is False

    activated = client.patch(
        f"/api/users/{pending['id']}", headers=auth(admin_token), json={"is_active": True}
    )
    assert activated.status_code == 200
    login_response = client.post(
        "/api/auth/login",
        json={"email": registration["email"], "password": registration["password"]},
    )
    assert login_response.status_code == 200
    assert login_response.json()["user"]["role"] == "OPERATOR"


def test_rbac_and_workflow_crud(client):
    admin_token = bootstrap_admin(client)
    create_user(client, admin_token, "Invoice Operator", "operator@example.com", "OPERATOR")
    create_user(client, admin_token, "Finance Approver", "approver@example.com", "APPROVER")
    operator_token = login(client, "operator@example.com", "Strong-password-123!")
    approver_token = login(client, "approver@example.com", "Strong-password-123!")

    created = client.post(
        "/api/workflows", headers=auth(operator_token),
        json={"objective": "Recover overdue invoices"},
    )
    assert created.status_code == 201
    workflow_id = created.json()["id"]

    updated = client.patch(
        f"/api/workflows/{workflow_id}", headers=auth(operator_token),
        json={"objective": "Recover high-value overdue invoices"},
    )
    assert updated.status_code == 200
    assert updated.json()["objective"] == "Recover high-value overdue invoices"
    assert client.post(f"/api/workflows/{workflow_id}/start", headers=auth(approver_token)).status_code == 403

    started = client.post(f"/api/workflows/{workflow_id}/start", headers=auth(operator_token))
    assert started.status_code == 200
    assert started.json()["status"] == "WAITING_FOR_INPUT"
    tasks = client.get(f"/api/workflows/{workflow_id}/tasks", headers=auth(operator_token))
    assert tasks.status_code == 200
    assert len(tasks.json()) >= 6
    assert client.get("/api/users", headers=auth(operator_token)).status_code == 403

    deletable = client.post(
        "/api/workflows", headers=auth(operator_token), json={"objective": "Delete me"}
    ).json()
    assert client.delete(f"/api/workflows/{deletable['id']}", headers=auth(operator_token)).status_code == 204
    assert client.get(f"/api/workflows/{deletable['id']}", headers=auth(operator_token)).status_code == 404


def test_plan_requires_approval_and_completes_with_audit(client):
    admin_token = bootstrap_admin(client)
    create_user(client, admin_token, "Invoice Operator", "operator@example.com", "OPERATOR")
    create_user(client, admin_token, "Finance Approver", "approver@example.com", "APPROVER")
    operator_token = login(client, "operator@example.com", "Strong-password-123!")
    approver_token = login(client, "approver@example.com", "Strong-password-123!")
    operator_headers = auth(operator_token)

    customer = client.post("/api/customers", headers=operator_headers, json={
        "name": "Acme", "email": "finance@acme.example.com", "segment": "ENTERPRISE",
    }).json()
    client.post("/api/invoices", headers=operator_headers, json={
        "invoice_number": "INV-RBAC-1", "customer_id": customer["id"], "amount": "180000.00",
        "due_date": "2020-01-01", "currency": "INR",
    })

    created = client.post(
        "/api/workflows", headers=operator_headers,
        json={"objective": "Find overdue invoices above INR 100,000 and contact customers"},
    ).json()
    workflow_id = created["id"]
    started = client.post(f"/api/workflows/{workflow_id}/start", headers=operator_headers)
    assert started.json()["status"] == "WAITING_APPROVAL"
    tasks = client.get(f"/api/workflows/{workflow_id}/tasks", headers=operator_headers).json()
    assert all(task["status"] == "COMPLETED" for task in tasks[:5])

    workflow = client.get(f"/api/workflows/{workflow_id}", headers=operator_headers).json()
    assert workflow["status"] == "WAITING_APPROVAL"
    approval_task = next(task for task in tasks if task["kind"] == "APPROVAL")
    assert client.post(f"/api/tasks/{approval_task['id']}/approve", headers=operator_headers).status_code == 403

    approved = client.post(f"/api/tasks/{approval_task['id']}/approve", headers=auth(approver_token))
    assert approved.status_code == 200
    assert approved.json()["status"] == "APPROVED"

    refreshed = client.get(f"/api/workflows/{workflow_id}/tasks", headers=operator_headers).json()
    action = next(task for task in refreshed if task["kind"] == "ACTION")
    monitor = next(task for task in refreshed if task["kind"] == "MONITOR")
    assert action["status"] == "TODO"
    assert monitor["status"] == "BLOCKED"
    client.post(f"/api/tasks/{action['id']}/complete", headers=operator_headers)
    refreshed = client.get(f"/api/workflows/{workflow_id}/tasks", headers=operator_headers).json()
    monitor = next(task for task in refreshed if task["kind"] == "MONITOR")
    assert monitor["status"] == "TODO"
    client.post(f"/api/tasks/{monitor['id']}/complete", headers=operator_headers)

    final_workflow = client.get(f"/api/workflows/{workflow_id}", headers=operator_headers).json()
    assert final_workflow["status"] == "RESOLVED"
    audit = client.get(f"/api/workflows/{workflow_id}/audit", headers=operator_headers).json()
    assert any(event["event_type"] == "TASK_APPROVED" for event in audit)
    assert any(event["event_type"] == "WORKFLOW_RESOLVED" for event in audit)


def test_bootstrap_is_one_time_and_admin_manages_roles(client):
    admin_token = bootstrap_admin(client)
    assert client.post(
        "/api/auth/bootstrap",
        json={
            "name": "Second Admin", "email": "second@example.com",
            "password": "Admin-password-123!",
        },
    ).status_code == 409

    user = create_user(client, admin_token, "Viewer", "viewer@example.com", "VIEWER")
    changed = client.patch(
        f"/api/users/{user['id']}", headers=auth(admin_token), json={"role": "APPROVER"}
    )
    assert changed.status_code == 200
    assert changed.json()["role"] == "APPROVER"
    assert client.delete(f"/api/users/{user['id']}", headers=auth(admin_token)).status_code == 204


def test_task_crud_and_workflow_ownership(client):
    admin_token = bootstrap_admin(client)
    create_user(client, admin_token, "Owner", "owner@example.com", "OPERATOR")
    create_user(client, admin_token, "Other", "other@example.com", "OPERATOR")
    owner_token = login(client, "owner@example.com", "Strong-password-123!")
    other_token = login(client, "other@example.com", "Strong-password-123!")

    workflow = client.post(
        "/api/workflows", headers=auth(owner_token), json={"objective": "Recover invoices"}
    ).json()
    assert client.get(f"/api/workflows/{workflow['id']}", headers=auth(other_token)).status_code == 404

    created_task = client.post(
        f"/api/workflows/{workflow['id']}/tasks", headers=auth(owner_token),
        json={"title": "Inspect source file", "description": "Review the uploaded CSV", "kind": "GATHER", "source": "CSV import"},
    )
    assert created_task.status_code == 201
    task_id = created_task.json()["id"]
    updated_task = client.patch(
        f"/api/tasks/{task_id}", headers=auth(owner_token), json={"title": "Inspect updated source"}
    )
    assert updated_task.status_code == 200
    assert updated_task.json()["title"] == "Inspect updated source"
    assert client.post(f"/api/tasks/{task_id}/complete", headers=auth(owner_token)).status_code == 409
    assert client.delete(f"/api/tasks/{task_id}", headers=auth(owner_token)).status_code == 204


def test_rejection_replans_before_requesting_approval_again(client):
    admin_token = bootstrap_admin(client)
    create_user(client, admin_token, "Operator", "operator@example.com", "OPERATOR")
    create_user(client, admin_token, "Approver", "approver@example.com", "APPROVER")
    operator_token = login(client, "operator@example.com", "Strong-password-123!")
    approver_token = login(client, "approver@example.com", "Strong-password-123!")
    operator_headers = auth(operator_token)

    customer = client.post("/api/customers", headers=operator_headers, json={
        "name": "Acme", "email": "finance@acme.example.com",
    }).json()
    client.post("/api/invoices", headers=operator_headers, json={
        "invoice_number": "INV-REPLAN-1", "customer_id": customer["id"], "amount": "180000.00",
        "due_date": "2020-01-01", "currency": "INR",
    })

    workflow = client.post(
        "/api/workflows", headers=operator_headers, json={"objective": "Recover overdue invoices"}
    ).json()
    workflow_id = workflow["id"]
    client.post(f"/api/workflows/{workflow_id}/start", headers=operator_headers)
    tasks = client.get(f"/api/workflows/{workflow_id}/tasks", headers=operator_headers).json()
    assert all(task["status"] == "COMPLETED" for task in tasks[:5])

    approval = next(task for task in client.get(f"/api/workflows/{workflow_id}/tasks", headers=operator_headers).json() if task["kind"] == "APPROVAL")
    rejected = client.post(f"/api/tasks/{approval['id']}/reject", headers=auth(approver_token))
    assert rejected.status_code == 200
    assert client.get(f"/api/workflows/{workflow_id}", headers=operator_headers).json()["status"] == "REPLANNING"

    replanned = client.get(f"/api/workflows/{workflow_id}/tasks", headers=operator_headers).json()
    revised_recommendation = next(task for task in replanned if task["title"].startswith("Revise the recommendation"))
    approval = next(task for task in replanned if task["kind"] == "APPROVAL")
    action = next(task for task in replanned if task["kind"] == "ACTION")
    assert revised_recommendation["order_index"] < approval["order_index"]
    assert action["status"] == "BLOCKED"

    assert client.post(f"/api/tasks/{revised_recommendation['id']}/complete", headers=operator_headers).status_code == 200
    replanned = client.get(f"/api/workflows/{workflow_id}/tasks", headers=operator_headers).json()
    approval = next(task for task in replanned if task["kind"] == "APPROVAL")
    action = next(task for task in replanned if task["kind"] == "ACTION")
    assert approval["status"] == "WAITING_APPROVAL"
    assert action["status"] == "BLOCKED"


def test_assigned_task_is_visible_to_assignee_and_only_assignee_can_complete(client):
    admin_token = bootstrap_admin(client)
    create_user(client, admin_token, "Workflow Owner", "owner@example.com", "OPERATOR")
    assignee = create_user(client, admin_token, "Support Teammate", "teammate@example.com", "OPERATOR")
    owner_token = login(client, "owner@example.com", "Strong-password-123!")
    teammate_token = login(client, "teammate@example.com", "Strong-password-123!")
    workflow = client.post(
        "/api/workflows", headers=auth(owner_token), json={"objective": "Coordinate assigned work"}
    ).json()
    task = client.post(f"/api/workflows/{workflow['id']}/tasks", headers=auth(owner_token), json={
        "title": "Review customer escalation", "kind": "GATHER", "description": "Inspect ticket history.",
        "assigned_to_id": assignee["id"], "priority": "HIGH", "due_at": "2026-09-25T09:00:00Z",
    })
    assert task.status_code == 201
    assert task.json()["assigned_to_id"] == assignee["id"]
    assert task.json()["priority"] == "HIGH"
    assert task.json()["due_at"] is not None

    assert client.post(f"/api/workflows/{workflow['id']}/start", headers=auth(owner_token)).status_code == 200
    visible_workflows = client.get("/api/workflows", headers=auth(teammate_token))
    assert workflow["id"] in {item["id"] for item in visible_workflows.json()}
    visible_tasks = client.get(f"/api/workflows/{workflow['id']}/tasks", headers=auth(teammate_token))
    assert any(item["id"] == task.json()["id"] for item in visible_tasks.json())
    assert client.post(f"/api/tasks/{task.json()['id']}/complete", headers=auth(owner_token)).status_code == 403
    assert client.post(f"/api/tasks/{task.json()['id']}/complete", headers=auth(teammate_token)).status_code == 200