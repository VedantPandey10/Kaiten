from __future__ import annotations
import os
import re
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Iterator
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, inspect, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import Base, create_database
from app.models import (
    AuditEvent,
    CommunicationLog,
    Contract,
    Customer,
    Invoice,
    InvoiceStatus,
    Payment,
    Role,
    SupportTicket,
    SupportTicketEvent,
    TaskKind,
    TaskStatus,
    TicketPriority,
    TicketStatus,
    User,
    Workflow,
    WorkflowStatus,
    WorkflowTask,
)
from app.schemas import (
    AuditEventRead,
    CommunicationRead,
    ContractCreate,
    ContractRead,
    ContractUpdate,
    CustomerCreate,
    CustomerRead,
    CustomerUpdate,
    InvoiceCreate,
    InvoiceRead,
    InvoiceUpdate,
    LoginRequest,
    PaymentCreate,
    PaymentRead,
    PaymentUpdate,
    SupportTicketCreate,
    SupportTicketEventRead,
    SupportTicketRead,
    SupportTicketUpdate,
    TaskCreate,
    TaskRead,
    TaskUpdate,
    TokenRead,
    UserBootstrap,
    UserCreate,
    UserRead,
    UserUpdate,
    WorkflowCreate,
    WorkflowRead,
    WorkflowUpdate,
)
from app.security import create_access_token, get_authenticated_user, hash_password, require_role, verify_password

auth_scheme = HTTPBearer(auto_error=False)
PREPARATION_KINDS = {TaskKind.GATHER, TaskKind.ANALYZE, TaskKind.RECOMMEND}
COMPLETE_STATUSES = {TaskStatus.COMPLETED, TaskStatus.APPROVED, TaskStatus.REJECTED}


def create_app(database_url: str | None = None) -> FastAPI:
    engine, session_factory = create_database(database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        Base.metadata.create_all(bind=engine)
        _upgrade_legacy_workflows(engine)
        yield
        engine.dispose()

    app = FastAPI(title="Kaiten API", version="0.2.0", lifespan=lifespan)
    allowed_origins = [
        origin.strip()
        for origin in os.getenv(
            "KAITEN_CORS_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173",
        ).split(",")
        if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.state.session_factory = session_factory

    def get_db() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    def get_current_user(
        credentials: HTTPAuthorizationCredentials | None = Depends(auth_scheme),
        db: Session = Depends(get_db),
    ) -> User:
        return get_authenticated_user(credentials, db)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/auth/bootstrap", response_model=TokenRead, status_code=status.HTTP_201_CREATED)
    def bootstrap_admin(
        payload: UserBootstrap,
        request: Request,
        db: Session = Depends(get_db),
    ) -> TokenRead:
        client_host = request.client.host if request.client else ""
        is_local_request = client_host in {"127.0.0.1", "::1", "localhost", "testclient"}
        if os.getenv("KAITEN_ENV", "development").lower() == "production" or not is_local_request:
            raise HTTPException(status_code=403, detail="Initial admin setup is only available locally before deployment.")
        if db.scalar(select(func.count()).select_from(User)):
            raise HTTPException(status_code=409, detail="Admin bootstrap can only be used once.")
        user = User(
            name=payload.name.strip(), company=payload.company.strip(), email=str(payload.email).lower(),
            password_hash=hash_password(payload.password), role=Role.ADMIN,
        )
        db.add(user)
        db.flush()
        if os.getenv("KAITEN_SEED_DEMO_DATA", "true").lower() not in {"0", "false", "no"}:
            _seed_demo_workspace(db, user)
        _commit_or_conflict(db, "An account with this email already exists.")
        db.refresh(user)
        return TokenRead(access_token=create_access_token(user), user=user)

    @app.post("/api/auth/login", response_model=TokenRead)
    def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenRead:
        user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
        if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        return TokenRead(access_token=create_access_token(user), user=user)

    @app.get("/api/auth/me", response_model=UserRead)
    def get_me(user: User = Depends(get_current_user)) -> User:
        return user

    @app.get("/api/team", response_model=list[UserRead])
    def list_team(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[User]:
        return list(db.scalars(select(User).where(User.is_active.is_(True)).order_by(User.name)))

    @app.get("/api/users", response_model=list[UserRead])
    def list_users(
        user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> list[User]:
        require_role(user, Role.ADMIN)
        return list(db.scalars(select(User).order_by(User.created_at, User.name)))

    @app.post("/api/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
    def create_user(
        payload: UserCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> User:
        require_role(user, Role.ADMIN)
        created = User(
            name=payload.name.strip(), company=payload.company.strip(), email=str(payload.email).lower(),
            password_hash=hash_password(payload.password), role=payload.role,
        )
        db.add(created)
        _commit_or_conflict(db, "An account with this email already exists.")
        db.refresh(created)
        return created

    @app.patch("/api/users/{user_id}", response_model=UserRead)
    def update_user(
        user_id: UUID, payload: UserUpdate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> User:
        require_role(user, Role.ADMIN)
        target = db.get(User, user_id)
        if target is None:
            raise HTTPException(status_code=404, detail="User not found.")
        changes = payload.model_dump(exclude_unset=True)
        if target.id == user.id and (changes.get("is_active") is False or changes.get("role") not in (None, Role.ADMIN)):
            raise HTTPException(status_code=409, detail="You cannot deactivate or demote your own admin account.")
        if changes.get("role") is not None and changes["role"] is not Role.ADMIN and target.role is Role.ADMIN:
            _ensure_another_active_admin(db, target.id)
        if changes.get("is_active") is False and target.role is Role.ADMIN:
            _ensure_another_active_admin(db, target.id)
        if "password" in changes:
            target.password_hash = hash_password(changes.pop("password"))
        if "email" in changes and changes["email"] is not None:
            changes["email"] = str(changes["email"]).lower()
        for field, value in changes.items():
            setattr(target, field, value.strip() if field in {"name", "company"} and value else value)
        _commit_or_conflict(db, "An account with this email already exists.")
        db.refresh(target)
        return target

    @app.delete("/api/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_user(
        user_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Response:
        require_role(user, Role.ADMIN)
        target = db.get(User, user_id)
        if target is None:
            raise HTTPException(status_code=404, detail="User not found.")
        if target.id == user.id:
            raise HTTPException(status_code=409, detail="You cannot delete your own account.")
        if target.role is Role.ADMIN and target.is_active:
            _ensure_another_active_admin(db, target.id)
        db.delete(target)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/customers", response_model=list[CustomerRead])
    def list_customers(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[Customer]:
        return list(db.scalars(select(Customer).order_by(Customer.name)))

    @app.get("/api/customers/{customer_id}", response_model=CustomerRead)
    def get_customer(
        customer_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Customer:
        customer = db.get(Customer, customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="Customer not found.")
        return customer

    @app.post("/api/customers", response_model=CustomerRead, status_code=status.HTTP_201_CREATED)
    def create_customer(
        payload: CustomerCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Customer:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        customer = Customer(
            name=payload.name.strip(), email=str(payload.email).lower(),
            segment=payload.segment.strip(), created_by_id=user.id,
        )
        db.add(customer)
        db.commit()
        db.refresh(customer)
        return customer

    @app.patch("/api/customers/{customer_id}", response_model=CustomerRead)
    def update_customer(
        customer_id: UUID, payload: CustomerUpdate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> Customer:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        customer = db.get(Customer, customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="Customer not found.")
        for field, value in payload.model_dump(exclude_unset=True).items():
            if field == "email" and value is not None:
                value = str(value).lower()
            setattr(customer, field, value.strip() if isinstance(value, str) else value)
        _commit_or_conflict(db, "Could not save customer changes.")
        db.refresh(customer)
        return customer

    @app.delete("/api/customers/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_customer(
        customer_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Response:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        customer = db.get(Customer, customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="Customer not found.")
        if db.scalar(select(func.count()).select_from(Invoice).where(Invoice.customer_id == customer.id)):
            raise HTTPException(status_code=409, detail="Move or delete this customer's invoices before deleting them.")
        for contract in db.scalars(select(Contract).where(Contract.customer_id == customer.id)):
            db.delete(contract)
        db.delete(customer)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/invoices", response_model=list[InvoiceRead])
    def list_invoices(
        overdue_only: bool = False, minimum_amount: Decimal | None = None,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> list[Invoice]:
        statement = select(Invoice).order_by(Invoice.due_date, Invoice.invoice_number)
        if overdue_only:
            statement = statement.where(Invoice.status == InvoiceStatus.OPEN, Invoice.due_date < date.today())
        if minimum_amount is not None:
            statement = statement.where(Invoice.amount >= minimum_amount)
        return list(db.scalars(statement))

    @app.get("/api/invoices/{invoice_id}", response_model=InvoiceRead)
    def get_invoice(
        invoice_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Invoice:
        invoice = db.get(Invoice, invoice_id)
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")
        return invoice

    @app.post("/api/invoices", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
    def create_invoice(
        payload: InvoiceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Invoice:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        if db.get(Customer, payload.customer_id) is None:
            raise HTTPException(status_code=404, detail="Customer not found.")
        invoice = Invoice(**payload.model_dump())
        invoice.invoice_number = invoice.invoice_number.strip()
        db.add(invoice)
        _commit_or_conflict(db, "An invoice with this number already exists.")
        db.refresh(invoice)
        return invoice

    @app.patch("/api/invoices/{invoice_id}", response_model=InvoiceRead)
    def update_invoice(
        invoice_id: UUID, payload: InvoiceUpdate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> Invoice:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        invoice = db.get(Invoice, invoice_id)
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")
        changes = payload.model_dump(exclude_unset=True)
        if changes.get("customer_id") is not None and db.get(Customer, changes["customer_id"]) is None:
            raise HTTPException(status_code=404, detail="Customer not found.")
        for field, value in changes.items():
            setattr(invoice, field, value.strip() if field == "invoice_number" and value else value)
        invoice.updated_at = datetime.now(UTC)
        _commit_or_conflict(db, "Could not save invoice changes.")
        db.refresh(invoice)
        return invoice

    @app.delete("/api/invoices/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_invoice(
        invoice_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Response:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        invoice = db.get(Invoice, invoice_id)
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")
        for payment in db.scalars(select(Payment).where(Payment.invoice_id == invoice.id)):
            db.delete(payment)
        for communication in db.scalars(select(CommunicationLog).where(CommunicationLog.invoice_id == invoice.id)):
            db.delete(communication)
        db.delete(invoice)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/invoices/{invoice_id}/payments", response_model=list[PaymentRead])
    def list_payments(
        invoice_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> list[Payment]:
        if db.get(Invoice, invoice_id) is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")
        return list(db.scalars(select(Payment).where(Payment.invoice_id == invoice_id).order_by(Payment.paid_at)))

    @app.post("/api/payments", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
    def create_payment(
        payload: PaymentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Payment:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        invoice = db.get(Invoice, payload.invoice_id)
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found.")
        payment = Payment(**payload.model_dump())
        db.add(payment)
        db.flush()
        _sync_invoice_status(db, invoice)
        db.commit()
        db.refresh(payment)
        return payment

    @app.patch("/api/payments/{payment_id}", response_model=PaymentRead)
    def update_payment(
        payment_id: UUID, payload: PaymentUpdate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> Payment:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        payment = db.get(Payment, payment_id)
        if payment is None:
            raise HTTPException(status_code=404, detail="Payment not found.")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(payment, field, value)
        invoice = db.get(Invoice, payment.invoice_id)
        _sync_invoice_status(db, invoice)
        db.commit()
        db.refresh(payment)
        return payment

    @app.delete("/api/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_payment(
        payment_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Response:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        payment = db.get(Payment, payment_id)
        if payment is None:
            raise HTTPException(status_code=404, detail="Payment not found.")
        invoice = db.get(Invoice, payment.invoice_id)
        db.delete(payment)
        _sync_invoice_status(db, invoice)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/contracts", response_model=list[ContractRead])
    def list_contracts(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[Contract]:
        return list(db.scalars(select(Contract).order_by(Contract.reference)))

    @app.get("/api/contracts/{contract_id}", response_model=ContractRead)
    def get_contract(
        contract_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Contract:
        contract = db.get(Contract, contract_id)
        if contract is None:
            raise HTTPException(status_code=404, detail="Contract not found.")
        return contract

    @app.post("/api/contracts", response_model=ContractRead, status_code=status.HTTP_201_CREATED)
    def create_contract(
        payload: ContractCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Contract:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        if db.get(Customer, payload.customer_id) is None:
            raise HTTPException(status_code=404, detail="Customer not found.")
        contract = Contract(**payload.model_dump())
        db.add(contract)
        db.commit()
        db.refresh(contract)
        return contract

    @app.patch("/api/contracts/{contract_id}", response_model=ContractRead)
    def update_contract(
        contract_id: UUID, payload: ContractUpdate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> Contract:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        contract = db.get(Contract, contract_id)
        if contract is None:
            raise HTTPException(status_code=404, detail="Contract not found.")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(contract, field, value.strip() if isinstance(value, str) else value)
        db.commit()
        db.refresh(contract)
        return contract

    @app.delete("/api/contracts/{contract_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_contract(
        contract_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Response:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        contract = db.get(Contract, contract_id)
        if contract is None:
            raise HTTPException(status_code=404, detail="Contract not found.")
        db.delete(contract)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/communications", response_model=list[CommunicationRead])
    def list_communications(
        user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> list[CommunicationLog]:
        return list(db.scalars(select(CommunicationLog).order_by(CommunicationLog.created_at.desc())))

    @app.get("/api/tickets", response_model=list[SupportTicketRead])
    def list_tickets(
        ticket_status: TicketStatus | None = None,
        priority: TicketPriority | None = None,
        sla_breached: bool = False,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> list[SupportTicket]:
        statement = select(SupportTicket).order_by(SupportTicket.sla_due_at, SupportTicket.ticket_number)
        if ticket_status is not None:
            statement = statement.where(SupportTicket.status == ticket_status.value)
        if priority is not None:
            statement = statement.where(SupportTicket.priority == priority.value)
        tickets = list(db.scalars(statement))
        return [ticket for ticket in tickets if not sla_breached or _is_sla_breached(ticket)]

    @app.post("/api/tickets", response_model=SupportTicketRead, status_code=status.HTTP_201_CREATED)
    def create_ticket(
        payload: SupportTicketCreate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> SupportTicket:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        _validate_ticket_references(db, payload.customer_id, payload.assigned_to_id)
        ticket_fields = payload.model_dump()
        ticket_fields["ticket_number"] = payload.ticket_number.strip()
        ticket_fields["subject"] = payload.subject.strip()
        ticket_fields["requester_email"] = str(payload.requester_email).lower()
        ticket_fields["sla_due_at"] = _as_utc(ticket_fields["sla_due_at"])
        ticket = SupportTicket(**ticket_fields, created_by_id=user.id)
        db.add(ticket)
        db.flush()
        _ticket_record(db, ticket, "TICKET_CREATED", user, {"status": ticket.status.value, "priority": ticket.priority.value})
        _commit_or_conflict(db, "A support ticket with this number already exists.")
        db.refresh(ticket)
        return ticket

    @app.get("/api/tickets/{ticket_id}", response_model=SupportTicketRead)
    def get_ticket(
        ticket_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> SupportTicket:
        ticket = db.get(SupportTicket, ticket_id)
        if ticket is None:
            raise HTTPException(status_code=404, detail="Support ticket not found.")
        return ticket

    @app.patch("/api/tickets/{ticket_id}", response_model=SupportTicketRead)
    def update_ticket(
        ticket_id: UUID, payload: SupportTicketUpdate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> SupportTicket:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        ticket = db.get(SupportTicket, ticket_id)
        if ticket is None:
            raise HTTPException(status_code=404, detail="Support ticket not found.")
        changes = payload.model_dump(exclude_unset=True)
        _validate_ticket_references(db, changes.get("customer_id"), changes.get("assigned_to_id"))
        previous_status = ticket.status
        for field, value in changes.items():
            if value is not None:
                if field == "requester_email":
                    value = str(value).lower()
                if field in {"subject", "description"}:
                    value = value.strip()
                if field == "sla_due_at":
                    value = _as_utc(value)
                setattr(ticket, field, value)
        ticket.updated_at = datetime.now(UTC)
        db.flush()
        event_type = "TICKET_STATUS_CHANGED" if ticket.status is not previous_status else "TICKET_UPDATED"
        _ticket_record(db, ticket, event_type, user, {"status": ticket.status.value, "priority": ticket.priority.value})
        _commit_or_conflict(db, "Could not save support ticket changes.")
        db.refresh(ticket)
        return ticket

    @app.delete("/api/tickets/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_ticket(
        ticket_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Response:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        ticket = db.get(SupportTicket, ticket_id)
        if ticket is None:
            raise HTTPException(status_code=404, detail="Support ticket not found.")
        for event in db.scalars(select(SupportTicketEvent).where(SupportTicketEvent.ticket_id == ticket.id)):
            db.delete(event)
        db.delete(ticket)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/tickets/{ticket_id}/events", response_model=list[SupportTicketEventRead])
    def list_ticket_events(
        ticket_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> list[SupportTicketEvent]:
        if db.get(SupportTicket, ticket_id) is None:
            raise HTTPException(status_code=404, detail="Support ticket not found.")
        return list(db.scalars(
            select(SupportTicketEvent).where(SupportTicketEvent.ticket_id == ticket_id).order_by(SupportTicketEvent.created_at, SupportTicketEvent.id)
        ))

    @app.post("/api/workflows", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
    def create_workflow(
        payload: WorkflowCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Workflow:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        workflow = Workflow(objective=payload.objective, owner_id=user.id)
        db.add(workflow)
        db.flush()
        _record(db, workflow, "WORKFLOW_CREATED", user, {"objective": workflow.objective})
        db.commit()
        db.refresh(workflow)
        return workflow

    @app.get("/api/workflows", response_model=list[WorkflowRead])
    def list_workflows(
        user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> list[Workflow]:
        statement = select(Workflow).order_by(Workflow.created_at.desc())
        if user.role not in {Role.ADMIN, Role.APPROVER}:
            assigned_workflows = select(WorkflowTask.workflow_id).where(WorkflowTask.assigned_to_id == user.id)
            statement = statement.where(or_(Workflow.owner_id == user.id, Workflow.id.in_(assigned_workflows)))
        return list(db.scalars(statement))

    @app.get("/api/workflows/{workflow_id}", response_model=WorkflowRead)
    def get_workflow(
        workflow_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Workflow:
        return _get_workflow(db, workflow_id, user)

    @app.patch("/api/workflows/{workflow_id}", response_model=WorkflowRead)
    def update_workflow(
        workflow_id: UUID, payload: WorkflowUpdate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> Workflow:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        workflow = _get_workflow(db, workflow_id, user)
        _require_workflow_manager(workflow, user)
        if workflow.status is not WorkflowStatus.CREATED:
            raise HTTPException(status_code=409, detail="Only a draft workflow can be edited.")
        workflow.objective = payload.objective
        workflow.updated_at = datetime.now(UTC)
        _record(db, workflow, "WORKFLOW_UPDATED", user, {"objective": workflow.objective})
        db.commit()
        db.refresh(workflow)
        return workflow

    @app.delete("/api/workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_workflow(
        workflow_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Response:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        workflow = _get_workflow(db, workflow_id, user)
        _require_workflow_manager(workflow, user)
        if workflow.status is not WorkflowStatus.CREATED:
            raise HTTPException(status_code=409, detail="Only a draft workflow can be deleted.")
        db.delete(workflow)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post("/api/workflows/{workflow_id}/start", response_model=WorkflowRead)
    def start_workflow(
        workflow_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Workflow:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        workflow = _get_workflow(db, workflow_id, user)
        _require_workflow_manager(workflow, user)
        if workflow.status is not WorkflowStatus.CREATED:
            raise HTTPException(status_code=409, detail="Only a draft workflow can be started.")
        if not workflow.tasks:
            support_request = _is_support_objective(workflow.objective)
            invoice_request = _is_invoice_objective(workflow.objective)
            planner = _support_sla_plan if support_request else _invoice_recovery_plan if invoice_request else _unsupported_objective_plan
            tasks, recommendations, has_matches = planner(db, workflow.objective)
            workflow.tasks.extend(tasks)
            workflow.status = WorkflowStatus.WAITING_APPROVAL if has_matches else WorkflowStatus.WAITING_FOR_INPUT
            approval_task = next(task for task in tasks if task.kind is TaskKind.APPROVAL)
            if has_matches:
                approval_task.status = TaskStatus.WAITING_APPROVAL
            _record(db, workflow, "PLAN_GENERATED", user, {"task_count": len(tasks)})
            source_event = "SUPPORT_TICKETS_GATHERED" if support_request else "INVOICE_DATA_GATHERED" if invoice_request else "OBJECTIVE_CLASSIFIED"
            _record(db, workflow, source_event, user, {"matched_case_count": len(recommendations)})
            _record(db, workflow, "RELATED_CONTEXT_GATHERED", user, {"case_count": len(recommendations)})
            if has_matches:
                _record(db, workflow, "RISK_ANALYZED", user, {"case_count": len(recommendations)})
                _record(db, workflow, "RECOMMENDATIONS_CREATED", user, {"recommendation_count": len(recommendations)})
                _record(db, workflow, "APPROVAL_REQUESTED", user, {"task_id": str(approval_task.id)})
            else:
                missing_detail = (
                    "Add a breached support ticket matching the objective, then resume this workflow."
                    if support_request else
                    "Add an overdue invoice matching the objective, then resume this workflow."
                    if invoice_request else
                    "No installed workflow template matches this objective yet. Choose invoice recovery or Support SLA escalation."
                )
                _record(db, workflow, "MISSING_INFORMATION", user, {"required": missing_detail})
        else:
            workflow.status = WorkflowStatus.DATA_COLLECTION
            _record(db, workflow, "PLAN_STARTED", user, {"task_count": len(workflow.tasks)})
            _advance_plan(db, workflow, user)
        workflow.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(workflow)
        return workflow

    @app.post("/api/workflows/{workflow_id}/resume", response_model=WorkflowRead)
    def resume_workflow(
        workflow_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Workflow:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        workflow = _get_workflow(db, workflow_id, user)
        _require_workflow_manager(workflow, user)
        if workflow.status is not WorkflowStatus.WAITING_FOR_INPUT:
            raise HTTPException(status_code=409, detail="This workflow is not waiting for input.")
        support_request = _is_support_objective(workflow.objective)
        invoice_request = _is_invoice_objective(workflow.objective)
        planner = _support_sla_plan if support_request else _invoice_recovery_plan if invoice_request else _unsupported_objective_plan
        refreshed, recommendations, has_matches = planner(db, workflow.objective)
        existing = sorted(workflow.tasks, key=lambda task: task.order_index)
        for current, replacement in zip(existing, refreshed):
            current.title = replacement.title
            current.description = replacement.description
            current.kind = replacement.kind
            current.status = replacement.status
            current.source = replacement.source
            current.result_data = replacement.result_data
            current.updated_at = datetime.now(UTC)
        workflow.status = WorkflowStatus.WAITING_APPROVAL if has_matches else WorkflowStatus.WAITING_FOR_INPUT
        if has_matches:
            approval_task = next(task for task in existing if task.kind is TaskKind.APPROVAL)
            approval_task.status = TaskStatus.WAITING_APPROVAL
            _record(db, workflow, "DATA_RECONCILED", user, {"matched_invoice_count": len(recommendations)})
            _record(db, workflow, "RISK_ANALYZED", user, {"case_count": len(recommendations)})
            _record(db, workflow, "RECOMMENDATIONS_CREATED", user, {"recommendation_count": len(recommendations)})
            _record(db, workflow, "APPROVAL_REQUESTED", user, {"task_id": str(approval_task.id)})
        else:
            _record(db, workflow, "MISSING_INFORMATION", user, {"matched_invoice_count": 0})
        workflow.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(workflow)
        return workflow

    @app.post("/api/workflows/{workflow_id}/cancel", response_model=WorkflowRead)
    def cancel_workflow(
        workflow_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Workflow:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        workflow = _get_workflow(db, workflow_id, user)
        _require_workflow_manager(workflow, user)
        if workflow.status in {WorkflowStatus.RESOLVED, WorkflowStatus.CANCELLED}:
            raise HTTPException(status_code=409, detail="This workflow is already finished.")
        _set_workflow_status(db, workflow, WorkflowStatus.CANCELLED, "WORKFLOW_CANCELLED", user)
        return workflow

    @app.get("/api/workflows/{workflow_id}/tasks", response_model=list[TaskRead])
    def list_tasks(
        workflow_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> list[WorkflowTask]:
        workflow = _get_workflow(db, workflow_id, user)
        return list(db.scalars(select(WorkflowTask).where(WorkflowTask.workflow_id == workflow.id).order_by(WorkflowTask.order_index)))

    @app.post("/api/workflows/{workflow_id}/tasks", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
    def create_task(
        workflow_id: UUID, payload: TaskCreate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> WorkflowTask:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        workflow = _get_workflow(db, workflow_id, user)
        _require_workflow_manager(workflow, user)
        _ensure_draft(workflow)
        last_order = db.scalar(select(func.max(WorkflowTask.order_index)).where(WorkflowTask.workflow_id == workflow.id))
        _validate_task_assignee(db, payload.assigned_to_id)
        task = WorkflowTask(
            workflow_id=workflow.id, order_index=(last_order or 0) + 1,
            title=payload.title.strip(), description=payload.description.strip(),
            kind=payload.kind, status=TaskStatus.TODO, source=payload.source,
            priority=payload.priority, assigned_to_id=payload.assigned_to_id,
            due_at=_as_utc(payload.due_at) if payload.due_at else None,
        )
        db.add(task)
        _record(db, workflow, "TASK_CREATED", user, {"task_title": task.title})
        db.commit()
        db.refresh(task)
        return task

    @app.patch("/api/tasks/{task_id}", response_model=TaskRead)
    def update_task(
        task_id: UUID, payload: TaskUpdate,
        user: User = Depends(get_current_user), db: Session = Depends(get_db),
    ) -> WorkflowTask:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        task = _get_task(db, task_id)
        workflow = _get_workflow(db, task.workflow_id, user)
        _require_workflow_manager(workflow, user)
        _ensure_draft(workflow)
        for field, value in payload.model_dump(exclude_unset=True).items():
            if field == "priority" and value is None:
                continue
            setattr(task, field, value.strip() if isinstance(value, str) and field != "source" else value)
        _validate_task_assignee(db, task.assigned_to_id)
        if task.due_at is not None:
            task.due_at = _as_utc(task.due_at)
        task.updated_at = datetime.now(UTC)
        _record(db, workflow, "TASK_UPDATED", user, {"task_id": str(task.id), "title": task.title})
        db.commit()
        db.refresh(task)
        return task

    @app.delete("/api/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_task(
        task_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> Response:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        task = _get_task(db, task_id)
        workflow = _get_workflow(db, task.workflow_id, user)
        _require_workflow_manager(workflow, user)
        _ensure_draft(workflow)
        _record(db, workflow, "TASK_DELETED", user, {"task_id": str(task.id), "title": task.title})
        db.delete(task)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post("/api/tasks/{task_id}/complete", response_model=TaskRead)
    def complete_task(
        task_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> WorkflowTask:
        require_role(user, Role.ADMIN, Role.OPERATOR)
        task = _get_task(db, task_id)
        workflow = _get_workflow(db, task.workflow_id, user)
        if task.assigned_to_id is not None and task.assigned_to_id != user.id and user.role is not Role.ADMIN:
            raise HTTPException(status_code=403, detail="This task is assigned to another team member.")
        if workflow.status is WorkflowStatus.CREATED:
            raise HTTPException(status_code=409, detail="Start the workflow before completing a step.")
        if task.kind is TaskKind.APPROVAL:
            raise HTTPException(status_code=409, detail="Approval tasks must be decided by an approver.")
        if task.status is not TaskStatus.TODO:
            raise HTTPException(status_code=409, detail="This task is not ready to complete.")
        preceding = db.scalars(
            select(WorkflowTask).where(
                WorkflowTask.workflow_id == workflow.id,
                WorkflowTask.order_index < task.order_index,
            )
        )
        if any(previous.status not in COMPLETE_STATUSES for previous in preceding):
            raise HTTPException(status_code=409, detail="Complete earlier workflow steps first.")
        task.status = TaskStatus.COMPLETED
        task.updated_at = datetime.now(UTC)
        _record(db, workflow, "TASK_COMPLETED", user, {"task_id": str(task.id), "title": task.title})
        if task.kind is TaskKind.ACTION:
            task_data = task.result_data or {}
            ticket_recommendations = task_data.get("tickets")
            if ticket_recommendations is not None:
                escalated_count = 0
                for recommendation in ticket_recommendations:
                    ticket = db.get(SupportTicket, UUID(recommendation["ticket_id"]))
                    if ticket is None:
                        continue
                    if ticket.status is TicketStatus.OPEN:
                        ticket.status = TicketStatus.IN_PROGRESS
                        ticket.updated_at = datetime.now(UTC)
                    _ticket_record(db, ticket, "ESCALATION_SIMULATED", user, {
                        "workflow_id": str(workflow.id),
                        "reason": recommendation["reason"],
                    })
                    escalated_count += 1
                task.result_data = {"simulated": True, "escalated_ticket_count": escalated_count}
                _record(db, workflow, "SIMULATED_SUPPORT_ESCALATION", user, {
                    "result": "SUCCESS", "ticket_count": escalated_count,
                })
            else:
                recommendations = task_data.get("recommendations", [])
                sent_count = 0
                for recommendation in recommendations:
                    invoice = db.get(Invoice, UUID(recommendation["invoice_id"]))
                    customer = db.get(Customer, invoice.customer_id) if invoice else None
                    if invoice is None or customer is None:
                        continue
                    notice = recommendation["recommended_action"]
                    db.add(CommunicationLog(
                        invoice_id=invoice.id, actor_id=user.id, channel="SIMULATED_EMAIL",
                        subject=f"{notice}: invoice {invoice.invoice_number}",
                        body=(f"This simulated {notice.lower()} concerns invoice {invoice.invoice_number} "
                              f"for {invoice.currency} {invoice.amount:.2f}, due {invoice.due_date.isoformat()}. "
                              f"Recipient: {customer.email}. No message was sent externally."),
                        status="SIMULATED_SENT",
                    ))
                    sent_count += 1
                task.result_data = {"simulated": True, "sent_count": sent_count}
                _record(db, workflow, "SIMULATED_ACTION_EXECUTED", user, {"action": task.title, "result": "SUCCESS", "message_count": sent_count})
        _advance_plan(db, workflow, user)
        db.commit()
        db.refresh(task)
        return task

    @app.post("/api/tasks/{task_id}/approve", response_model=TaskRead)
    def approve_task(
        task_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> WorkflowTask:
        require_role(user, Role.ADMIN, Role.APPROVER)
        task = _get_task(db, task_id)
        workflow = _get_workflow(db, task.workflow_id, user)
        if task.kind is not TaskKind.APPROVAL or task.status is not TaskStatus.WAITING_APPROVAL:
            raise HTTPException(status_code=409, detail="This action is not awaiting approval.")
        task.status = TaskStatus.APPROVED
        task.updated_at = datetime.now(UTC)
        _record(db, workflow, "TASK_APPROVED", user, {"task_id": str(task.id), "decision": "APPROVED"})
        _advance_plan(db, workflow, user)
        db.commit()
        db.refresh(task)
        return task

    @app.post("/api/tasks/{task_id}/reject", response_model=TaskRead)
    def reject_task(
        task_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> WorkflowTask:
        require_role(user, Role.ADMIN, Role.APPROVER)
        task = _get_task(db, task_id)
        workflow = _get_workflow(db, task.workflow_id, user)
        if task.kind is not TaskKind.APPROVAL or task.status is not TaskStatus.WAITING_APPROVAL:
            raise HTTPException(status_code=409, detail="This action is not awaiting approval.")
        insert_at = task.order_index
        task.status = TaskStatus.BLOCKED
        task.updated_at = datetime.now(UTC)
        _record(db, workflow, "TASK_REJECTED", user, {"task_id": str(task.id), "decision": "REJECTED"})
        action_task = next(item for item in workflow.tasks if item.kind is TaskKind.ACTION)
        monitor_task = next(item for item in workflow.tasks if item.kind is TaskKind.MONITOR)
        action_task.status = TaskStatus.BLOCKED
        monitor_task.status = TaskStatus.BLOCKED
        for item in workflow.tasks:
            if item.order_index >= insert_at:
                item.order_index += 1
        workflow.tasks.append(
            WorkflowTask(
                workflow_id=workflow.id, order_index=insert_at,
                title="Revise the recommendation based on approver feedback",
                description="Update the proposed follow-up before requesting approval again.",
                kind=TaskKind.RECOMMEND, status=TaskStatus.TODO,
                source="Workflow context",
            )
        )
        workflow.status = WorkflowStatus.REPLANNING
        workflow.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(task)
        return task

    @app.get("/api/workflows/{workflow_id}/audit", response_model=list[AuditEventRead])
    def get_workflow_audit(
        workflow_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ) -> list[AuditEvent]:
        workflow = _get_workflow(db, workflow_id, user)
        return list(db.scalars(
            select(AuditEvent).where(AuditEvent.workflow_id == workflow.id).order_by(AuditEvent.created_at, AuditEvent.id)
        ))

    return app


def _upgrade_legacy_workflows(engine) -> None:
    if engine.dialect.name not in {"sqlite", "postgresql"}:
        return
    owner_type = "CHAR(32)" if engine.dialect.name == "sqlite" else "UUID"
    tables = set(inspect(engine).get_table_names())
    with engine.begin() as connection:
        if "users" in tables:
            user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
            if "company" not in user_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN company VARCHAR(180) NOT NULL DEFAULT 'Kaiten'"
                )
        if "workflows" in tables:
            workflow_columns = {column["name"] for column in inspect(engine).get_columns("workflows")}
            if "owner_id" not in workflow_columns:
                connection.exec_driver_sql(f"ALTER TABLE workflows ADD COLUMN owner_id {owner_type}")
        if "workflow_tasks" in tables:
            task_columns = {column["name"] for column in inspect(engine).get_columns("workflow_tasks")}
            task_column_types = {
                "result_data": "JSON",
                "assigned_to_id": "CHAR(32)" if engine.dialect.name == "sqlite" else "UUID",
                "priority": "VARCHAR(12) NOT NULL DEFAULT 'MEDIUM'",
                "due_at": "DATETIME" if engine.dialect.name == "sqlite" else "TIMESTAMP WITH TIME ZONE",
            }
            for column, column_type in task_column_types.items():
                if column not in task_columns:
                    connection.exec_driver_sql(f"ALTER TABLE workflow_tasks ADD COLUMN {column} {column_type}")


def _commit_or_conflict(db: Session, detail: str) -> None:
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail=detail) from error


def _ensure_another_active_admin(db: Session, excluded_id: UUID) -> None:
    other_admins = db.scalar(
        select(func.count()).select_from(User).where(
            User.role == Role.ADMIN, User.is_active.is_(True), User.id != excluded_id
        )
    )
    if not other_admins:
        raise HTTPException(status_code=409, detail="The workspace must retain an active admin.")


def _record(db: Session, workflow: Workflow, event_type: str, user: User, details: dict) -> None:
    db.add(AuditEvent(workflow_id=workflow.id, event_type=event_type, actor=user.email, details=details))


def _sync_invoice_status(db: Session, invoice: Invoice) -> None:
    db.flush()
    total_paid = db.scalar(select(func.sum(Payment.amount)).where(Payment.invoice_id == invoice.id)) or Decimal("0")
    invoice.status = InvoiceStatus.PAID if total_paid >= invoice.amount else InvoiceStatus.OPEN
    invoice.updated_at = datetime.now(UTC)


def _ticket_record(
    db: Session, ticket: SupportTicket, event_type: str, user: User, details: dict
) -> None:
    db.add(SupportTicketEvent(ticket_id=ticket.id, event_type=event_type, actor=user.email, details=details))


def _validate_ticket_references(
    db: Session, customer_id: UUID | None, assigned_to_id: UUID | None
) -> None:
    if customer_id is not None and db.get(Customer, customer_id) is None:
        raise HTTPException(status_code=404, detail="Customer not found.")
    if assigned_to_id is not None:
        assignee = db.get(User, assigned_to_id)
        if assignee is None or not assignee.is_active:
            raise HTTPException(status_code=404, detail="Active assignee not found.")


def _is_sla_breached(ticket: SupportTicket, now: datetime | None = None) -> bool:
    if ticket.status in {TicketStatus.RESOLVED, TicketStatus.CLOSED}:
        return False
    due_at = ticket.sla_due_at
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=UTC)
    return due_at <= (now or datetime.now(UTC))


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _seed_demo_workspace(db: Session, owner: User) -> None:
    today = date.today()
    now = datetime.now(UTC)
    customers = [
        Customer(name="Acme Manufacturing", email="finance@acme.example.com", segment="ENTERPRISE", created_by_id=owner.id),
        Customer(name="Northstar Systems", email="ap@northstar.example.com", segment="STRATEGIC", created_by_id=owner.id),
        Customer(name="Harbor Components", email="billing@harbor.example.com", segment="STANDARD", created_by_id=owner.id),
    ]
    db.add_all(customers)
    db.flush()

    invoices = [
        Invoice(invoice_number="INV-1042", customer_id=customers[0].id, amount=Decimal("480000.00"), currency="INR", due_date=today - timedelta(days=47), status=InvoiceStatus.OPEN),
        Invoice(invoice_number="INV-1088", customer_id=customers[1].id, amount=Decimal("1250000.00"), currency="INR", due_date=today - timedelta(days=18), status=InvoiceStatus.OPEN),
        Invoice(invoice_number="INV-0991", customer_id=customers[0].id, amount=Decimal("75000.00"), currency="INR", due_date=today - timedelta(days=100), status=InvoiceStatus.PAID),
        Invoice(invoice_number="INV-1110", customer_id=customers[2].id, amount=Decimal("89000.00"), currency="INR", due_date=today + timedelta(days=7), status=InvoiceStatus.OPEN),
    ]
    db.add_all(invoices)
    db.flush()
    db.add_all([
        Payment(invoice_id=invoices[2].id, amount=Decimal("75000.00"), paid_at=today - timedelta(days=50), reference="PAY-0991"),
        Payment(invoice_id=invoices[0].id, amount=Decimal("50000.00"), paid_at=today - timedelta(days=12), reference="PARTIAL-1042"),
    ])
    db.add_all([
        Contract(customer_id=customers[0].id, reference="MSA-ACME-2026", requires_formal_notice=True, notice_terms="Written payment notice required before escalation."),
        Contract(customer_id=customers[1].id, reference="MSA-NORTHSTAR-2026", requires_formal_notice=False, notice_terms="Standard collections terms."),
    ])
    db.add(CommunicationLog(
        invoice_id=invoices[0].id, actor_id=owner.id, channel="SIMULATED_EMAIL",
        subject="Payment reminder: invoice INV-1042", body="A previous payment reminder was logged for this invoice.",
        status="SIMULATED_SENT", created_at=now - timedelta(days=5),
    ))

    tickets = [
        SupportTicket(ticket_number="SUP-2048", subject="Orders are not syncing", description="New orders are missing from the operations dashboard.", requester_email="ops@northstar.example.com", customer_id=customers[1].id, priority=TicketPriority.HIGH, status=TicketStatus.OPEN, sla_due_at=now - timedelta(hours=27), assigned_to_id=owner.id, created_by_id=owner.id),
        SupportTicket(ticket_number="SUP-2091", subject="Checkout is slow", description="Checkout response time is above target.", requester_email="buyer@acme.example.com", customer_id=customers[0].id, priority=TicketPriority.MEDIUM, status=TicketStatus.IN_PROGRESS, sla_due_at=now + timedelta(hours=5), assigned_to_id=owner.id, created_by_id=owner.id),
    ]
    db.add_all(tickets)
    db.flush()
    db.add(SupportTicketEvent(ticket_id=tickets[0].id, event_type="TICKET_CREATED", actor=owner.email, details={"priority": "HIGH"}, created_at=now - timedelta(hours=31)))
    db.add(SupportTicketEvent(ticket_id=tickets[1].id, event_type="TICKET_CREATED", actor=owner.email, details={"priority": "MEDIUM"}, created_at=now - timedelta(hours=2)))
    db.flush()

    demo_workflows = [
        ("Find overdue invoices above INR 100,000, analyze customer history, contact customers, and escalate high-value cases", _invoice_recovery_plan),
        ("Find unresolved high-priority support tickets older than 24 hours and escalate them", _support_sla_plan),
    ]
    for objective, planner in demo_workflows:
        tasks, cases, has_matches = planner(db, objective)
        workflow = Workflow(
            owner_id=owner.id, objective=objective,
            status=WorkflowStatus.WAITING_APPROVAL if has_matches else WorkflowStatus.WAITING_FOR_INPUT,
        )
        if has_matches:
            approval = next(task for task in tasks if task.kind is TaskKind.APPROVAL)
            approval.status = TaskStatus.WAITING_APPROVAL
        workflow.tasks.extend(tasks)
        db.add(workflow)
        db.flush()
        _record(db, workflow, "WORKFLOW_CREATED", owner, {"objective": objective, "demo_seed": True})
        _record(db, workflow, "PLAN_GENERATED", owner, {"task_count": len(tasks), "demo_seed": True})
        _record(db, workflow, "DEMO_CONTEXT_GATHERED", owner, {"case_count": len(cases)})
        if has_matches:
            _record(db, workflow, "APPROVAL_REQUESTED", owner, {"task_id": str(approval.id)})


def _get_workflow(db: Session, workflow_id: UUID, user: User) -> Workflow:
    workflow = db.get(Workflow, workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    if user.role not in {Role.ADMIN, Role.APPROVER} and workflow.owner_id != user.id:
        assigned_task = db.scalar(select(WorkflowTask.id).where(
            WorkflowTask.workflow_id == workflow.id,
            WorkflowTask.assigned_to_id == user.id,
        ))
        if assigned_task is None:
            raise HTTPException(status_code=404, detail="Workflow not found.")
    return workflow


def _require_workflow_manager(workflow: Workflow, user: User) -> None:
    if user.role is not Role.ADMIN and workflow.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Only the workflow owner or an admin can change this workflow.")


def _validate_task_assignee(db: Session, assigned_to_id: UUID | None) -> None:
    if assigned_to_id is not None:
        assignee = db.get(User, assigned_to_id)
        if assignee is None or not assignee.is_active:
            raise HTTPException(status_code=404, detail="Active assignee not found.")


def _get_task(db: Session, task_id: UUID) -> WorkflowTask:
    task = db.get(WorkflowTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")
    return task


def _ensure_draft(workflow: Workflow) -> None:
    if workflow.status is not WorkflowStatus.CREATED:
        raise HTTPException(status_code=409, detail="Tasks can only be changed before the workflow starts.")


def _set_workflow_status(
    db: Session, workflow: Workflow, new_status: WorkflowStatus, event_type: str, user: User
) -> None:
    workflow.status = new_status
    workflow.updated_at = datetime.now(UTC)
    _record(db, workflow, event_type, user, {"status": new_status.value})
    db.commit()
    db.refresh(workflow)


def _is_support_objective(objective: str) -> bool:
    return re.search(r"\b(ticket|tickets|support|complaint|complaints|sla)\b", objective, re.IGNORECASE) is not None


def _is_invoice_objective(objective: str) -> bool:
    return re.search(r"\b(invoice|invoices|receivable|receivables|payable|payables|expense|expenses)\b", objective, re.IGNORECASE) is not None


def _unsupported_objective_plan(db: Session, objective: str) -> tuple[list[WorkflowTask], list[dict], bool]:
    del db
    return [WorkflowTask(
        order_index=1,
        title="Choose or configure a workflow template",
        description="No domain planner is configured for this objective yet.",
        kind=TaskKind.GATHER,
        status=TaskStatus.BLOCKED,
        source="Available templates",
        result_data={"objective": objective, "available_templates": ["Invoice recovery", "Support SLA escalation"]},
    )], [], False


def _support_sla_plan(db: Session, objective: str) -> tuple[list[WorkflowTask], list[dict], bool]:
    normalized_objective = objective.lower().replace("-", " ")
    age_match = re.search(r"(?:older than|over|more than)\s+(\d+)\s+hours?", normalized_objective)
    minimum_age_hours = int(age_match.group(1)) if age_match else 0
    high_priority_only = "high priority" in normalized_objective or "urgent" in normalized_objective
    candidates = list(db.scalars(
        select(SupportTicket)
        .where(SupportTicket.status.in_([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CUSTOMER]))
        .order_by(SupportTicket.sla_due_at, SupportTicket.ticket_number)
    ))
    now = datetime.now(UTC)
    matches: list[SupportTicket] = []
    evidence: list[dict] = []
    recommendations: list[dict] = []
    for ticket in candidates:
        if not _is_sla_breached(ticket, now):
            continue
        if high_priority_only and ticket.priority not in {TicketPriority.HIGH, TicketPriority.URGENT}:
            continue
        due_at = ticket.sla_due_at
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=UTC)
        hours_past_sla = round((now - due_at).total_seconds() / 3600, 1)
        if hours_past_sla < minimum_age_hours:
            continue
        customer = db.get(Customer, ticket.customer_id) if ticket.customer_id else None
        related_count = 0
        if ticket.customer_id:
            related_count = db.scalar(select(func.count()).select_from(SupportTicket).where(
                SupportTicket.customer_id == ticket.customer_id,
                SupportTicket.id != ticket.id,
            )) or 0
        record = {
            "ticket_id": str(ticket.id),
            "ticket_number": ticket.ticket_number,
            "subject": ticket.subject,
            "description": ticket.description,
            "requester_email": ticket.requester_email,
            "customer_name": customer.name if customer else None,
            "priority": ticket.priority.value,
            "status": ticket.status.value,
            "sla_due_at": due_at.isoformat(),
            "hours_past_sla": hours_past_sla,
            "related_ticket_count": related_count,
        }
        matches.append(ticket)
        evidence.append(record)
        recommendations.append({
            "ticket_id": str(ticket.id),
            "ticket_number": ticket.ticket_number,
            "subject": ticket.subject,
            "requester_email": ticket.requester_email,
            "priority": ticket.priority.value,
            "hours_past_sla": hours_past_sla,
            "recommended_action": "Escalate to the support lead",
            "reason": f"{ticket.priority.value.lower()} priority ticket is {hours_past_sla:g} hours past its SLA.",
        })

    has_matches = bool(matches)
    prep_status = TaskStatus.COMPLETED if has_matches else TaskStatus.BLOCKED
    tasks = [
        WorkflowTask(order_index=1, title="Find unresolved support tickets past SLA", description=f"Found {len(matches)} matching ticket(s).", kind=TaskKind.GATHER, status=TaskStatus.COMPLETED, source="Support ticket database", result_data={"minimum_age_hours": minimum_age_hours, "high_priority_only": high_priority_only, "ticket_count": len(evidence), "tickets": evidence}),
        WorkflowTask(order_index=2, title="Gather requester and customer history", description="Collect requester and related-ticket context.", kind=TaskKind.GATHER, status=prep_status, source="Customer and support ticket records", result_data={"tickets": evidence}),
        WorkflowTask(order_index=3, title="Identify priority and SLA breaches", description="Rank cases by ticket priority and time past SLA.", kind=TaskKind.ANALYZE, status=prep_status, source="SLA policy rules", result_data={"tickets": [{"ticket_number": item["ticket_number"], "priority": item["priority"], "hours_past_sla": item["hours_past_sla"]} for item in evidence]}),
        WorkflowTask(order_index=4, title="Recommend support escalation", description=f"Prepared {len(recommendations)} manager-escalation recommendation(s).", kind=TaskKind.RECOMMEND, status=prep_status, source="Ticket and SLA evidence", result_data={"tickets": recommendations}),
        WorkflowTask(order_index=5, title="Approve support escalation", description="An approver reviews the affected tickets and SLA evidence.", kind=TaskKind.APPROVAL, status=TaskStatus.BLOCKED, source=None, result_data={"tickets": recommendations}),
        WorkflowTask(order_index=6, title="Record simulated escalation to support lead", description="Write an escalation event to each ticket; no external notification is sent.", kind=TaskKind.ACTION, status=TaskStatus.BLOCKED, source="Simulated support notification", result_data={"tickets": recommendations}),
        WorkflowTask(order_index=7, title="Review ticket response and resolution", description="Track the ticket outcome after escalation.", kind=TaskKind.MONITOR, status=TaskStatus.BLOCKED, source="Support ticket events", result_data=None),
    ]
    return tasks, recommendations, has_matches


def _minimum_amount(objective: str) -> Decimal:
    numeric = re.search(r"(?:inr|rs\.?)[\s:]*([\d,]+(?:\.\d+)?)", objective, re.IGNORECASE)
    if numeric:
        return Decimal(numeric.group(1).replace(",", ""))
    scaled = re.search(r"([\d,.]+)\s*(lakh|lakhs|lac|lacs|crore|crores)", objective, re.IGNORECASE)
    if not scaled:
        return Decimal("0")
    amount = Decimal(scaled.group(1).replace(",", ""))
    return amount * (Decimal("10000000") if scaled.group(2).lower().startswith("cro") else Decimal("100000"))


def _invoice_recovery_plan(db: Session, objective: str) -> tuple[list[WorkflowTask], list[dict], bool]:
    minimum_amount = _minimum_amount(objective)
    matches = list(db.execute(
        select(Invoice, Customer)
        .join(Customer, Customer.id == Invoice.customer_id)
        .where(
            Invoice.status == InvoiceStatus.OPEN,
            Invoice.due_date < date.today(),
            Invoice.amount >= minimum_amount,
        )
        .order_by(Invoice.due_date, Invoice.invoice_number)
    ).all())
    customer_ids = {customer.id for _, customer in matches}
    matching_invoice_ids = {invoice.id for invoice, _ in matches}

    history: dict[UUID, dict[str, int]] = {customer_id: {"payment_count": 0, "late_payment_count": 0} for customer_id in customer_ids}
    if customer_ids:
        payment_rows = db.execute(
            select(Payment, Invoice)
            .join(Invoice, Invoice.id == Payment.invoice_id)
            .where(Invoice.customer_id.in_(customer_ids))
        ).all()
        for payment, historical_invoice in payment_rows:
            customer_history = history[historical_invoice.customer_id]
            customer_history["payment_count"] += 1
            if payment.paid_at > historical_invoice.due_date:
                customer_history["late_payment_count"] += 1

    contracts_by_customer: dict[UUID, list[Contract]] = {customer_id: [] for customer_id in customer_ids}
    if customer_ids:
        for contract in db.scalars(select(Contract).where(Contract.customer_id.in_(customer_ids))):
            contracts_by_customer[contract.customer_id].append(contract)

    communications_by_invoice: dict[UUID, int] = {invoice_id: 0 for invoice_id in matching_invoice_ids}
    if matching_invoice_ids:
        for invoice_id, count in db.execute(
            select(CommunicationLog.invoice_id, func.count())
            .where(CommunicationLog.invoice_id.in_(matching_invoice_ids))
            .group_by(CommunicationLog.invoice_id)
        ):
            communications_by_invoice[invoice_id] = count

    records: list[dict] = []
    recommendations: list[dict] = []
    for invoice, customer in matches:
        overdue_days = (date.today() - invoice.due_date).days
        customer_history = history[customer.id]
        customer_contracts = contracts_by_customer[customer.id]
        formal_notice = any(contract.requires_formal_notice for contract in customer_contracts)
        priority = "HIGH" if invoice.amount >= Decimal("500000") or overdue_days >= 30 else "STANDARD"
        if formal_notice:
            recommendation = "Formal payment notice"
        elif priority == "HIGH":
            recommendation = "Escalation review"
        else:
            recommendation = "Payment reminder"
        record = {
            "invoice_id": str(invoice.id),
            "invoice_number": invoice.invoice_number,
            "customer_id": str(customer.id),
            "customer_name": customer.name,
            "customer_email": customer.email,
            "customer_segment": customer.segment,
            "amount": f"{invoice.amount:.2f}",
            "currency": invoice.currency,
            "due_date": invoice.due_date.isoformat(),
            "days_overdue": overdue_days,
            "payment_count": customer_history["payment_count"],
            "late_payment_count": customer_history["late_payment_count"],
            "contracts": [contract.reference for contract in customer_contracts],
            "requires_formal_notice": formal_notice,
            "prior_communication_count": communications_by_invoice[invoice.id],
            "priority": priority,
            "recommended_action": recommendation,
        }
        records.append(record)
        recommendations.append({
            "invoice_id": record["invoice_id"],
            "invoice_number": invoice.invoice_number,
            "customer_email": customer.email,
            "amount": record["amount"],
            "currency": invoice.currency,
            "due_date": record["due_date"],
            "recommended_action": recommendation,
            "priority": priority,
            "reason": f"{overdue_days} days overdue; {customer_history['late_payment_count']} prior late payment(s); formal notice {'required' if formal_notice else 'not required'}.",
        })

    has_matches = bool(records)
    preparation_status = TaskStatus.COMPLETED if has_matches else TaskStatus.BLOCKED
    tasks = [
        WorkflowTask(order_index=1, title="Find overdue invoices matching the objective", description=f"Found {len(records)} open overdue invoice(s) at or above {minimum_amount} {matches[0][0].currency if matches else 'INR'}.", kind=TaskKind.GATHER, status=TaskStatus.COMPLETED, source="Invoice database", result_data={"minimum_amount": str(minimum_amount), "invoice_count": len(records), "invoices": records}),
        WorkflowTask(order_index=2, title="Gather customer and payment history", description=f"Retrieved payment history for {len(customer_ids)} customer(s).", kind=TaskKind.GATHER, status=preparation_status, source="Customer and payments tables", result_data={"customers": [{"customer_id": str(customer_id), **values} for customer_id, values in history.items()]}),
        WorkflowTask(order_index=3, title="Review contract terms and prior communications", description="Checked notice clauses and prior simulated contact records.", kind=TaskKind.GATHER, status=preparation_status, source="Contracts and communication log", result_data={"cases": [{"invoice_id": record["invoice_id"], "contracts": record["contracts"], "requires_formal_notice": record["requires_formal_notice"], "prior_communication_count": record["prior_communication_count"]} for record in records]}),
        WorkflowTask(order_index=4, title="Prioritize cases using amount, age, and payment history", description="Applied deterministic amount and overdue-age rules.", kind=TaskKind.ANALYZE, status=preparation_status, source="Deterministic business rules", result_data={"cases": [{"invoice_number": record["invoice_number"], "priority": record["priority"], "days_overdue": record["days_overdue"], "late_payment_count": record["late_payment_count"]} for record in records]}),
        WorkflowTask(order_index=5, title="Prepare evidence-backed follow-up recommendations", description=f"Prepared {len(recommendations)} recommendation(s) from the retrieved records.", kind=TaskKind.RECOMMEND, status=preparation_status, source="Invoice, customer, payment, and contract records", result_data={"recommendations": recommendations}),
        WorkflowTask(order_index=6, title="Approve customer communication", description="An approver reviews the recommendation evidence before any external action.", kind=TaskKind.APPROVAL, status=TaskStatus.BLOCKED, source=None, result_data={"recommendations": recommendations}),
        WorkflowTask(order_index=7, title="Send approved communications using the simulator", description="Create simulated email communication records; nothing is sent externally.", kind=TaskKind.ACTION, status=TaskStatus.BLOCKED, source="Simulated email", result_data={"recommendations": recommendations}),
        WorkflowTask(order_index=8, title="Review response status and resolve or escalate", description="Record the follow-up outcome after the simulated action.", kind=TaskKind.MONITOR, status=TaskStatus.BLOCKED, source="Communication log", result_data=None),
    ]
    return tasks, recommendations, has_matches


def _advance_plan(db: Session, workflow: Workflow, user: User) -> None:
    tasks = sorted(workflow.tasks, key=lambda item: item.order_index)
    if not tasks:
        return
    active = next((task for task in tasks if task.status not in COMPLETE_STATUSES), None)
    if active is None:
        workflow.status = WorkflowStatus.RESOLVED
        _record(db, workflow, "WORKFLOW_RESOLVED", user, {"status": workflow.status.value})
    elif active.kind is TaskKind.APPROVAL:
        active.status = TaskStatus.WAITING_APPROVAL
        workflow.status = WorkflowStatus.WAITING_APPROVAL
        _record(db, workflow, "APPROVAL_REQUESTED", user, {"task_id": str(active.id), "title": active.title})
    elif active.status is TaskStatus.BLOCKED:
        active.status = TaskStatus.TODO
        if active.kind is TaskKind.ACTION:
            workflow.status = WorkflowStatus.EXECUTING
        elif active.kind is TaskKind.MONITOR:
            workflow.status = WorkflowStatus.VERIFYING
        elif active.kind in {TaskKind.ANALYZE, TaskKind.RECOMMEND}:
            workflow.status = WorkflowStatus.ANALYSIS
        else:
            workflow.status = WorkflowStatus.DATA_COLLECTION
    workflow.updated_at = datetime.now(UTC)


app = create_app()