from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import (
    InvoiceStatus,
    Role,
    TaskKind,
    TaskPriority,
    TaskStatus,
    TicketPriority,
    TicketStatus,
    WorkflowStatus,
)


class UserBootstrap(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    company: str = Field(default="Kaiten", min_length=1, max_length=180)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    company: str = Field(default="Kaiten", min_length=1, max_length=180)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    role: Role = Role.OPERATOR


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    company: str | None = Field(default=None, min_length=1, max_length=180)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=200)
    role: Role | None = None
    is_active: bool | None = None


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    company: str
    email: EmailStr
    role: Role
    is_active: bool
    created_at: datetime


class TokenRead(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class WorkflowCreate(BaseModel):
    objective: str = Field(min_length=1, max_length=2000)

    @field_validator("objective")
    @classmethod
    def objective_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Objective must not be blank.")
        return value.strip()


class WorkflowUpdate(BaseModel):
    objective: str = Field(min_length=1, max_length=2000)

    @field_validator("objective")
    @classmethod
    def objective_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Objective must not be blank.")
        return value.strip()


class WorkflowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    owner_id: UUID | None
    objective: str
    status: WorkflowStatus
    created_at: datetime
    updated_at: datetime


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=2000)
    kind: TaskKind = TaskKind.GATHER
    source: str | None = Field(default=None, max_length=120)
    priority: TaskPriority = TaskPriority.MEDIUM
    assigned_to_id: UUID | None = None
    due_at: datetime | None = None


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    email: EmailStr
    segment: str = Field(default="STANDARD", min_length=1, max_length=80)


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    email: EmailStr | None = None
    segment: str | None = Field(default=None, min_length=1, max_length=80)


class CustomerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    email: EmailStr
    segment: str
    created_by_id: UUID | None
    created_at: datetime


class InvoiceCreate(BaseModel):
    invoice_number: str = Field(min_length=1, max_length=80)
    customer_id: UUID
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    currency: str = Field(default="INR", pattern="^[A-Z]{3}$")
    due_date: date
    status: InvoiceStatus = InvoiceStatus.OPEN


class InvoiceUpdate(BaseModel):
    invoice_number: str | None = Field(default=None, min_length=1, max_length=80)
    customer_id: UUID | None = None
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    currency: str | None = Field(default=None, pattern="^[A-Z]{3}$")
    due_date: date | None = None
    status: InvoiceStatus | None = None


class InvoiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    invoice_number: str
    customer_id: UUID
    amount: Decimal
    currency: str
    due_date: date
    status: InvoiceStatus
    created_at: datetime
    updated_at: datetime


class PaymentCreate(BaseModel):
    invoice_id: UUID
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    paid_at: date
    reference: str = Field(default="", max_length=120)


class PaymentUpdate(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    paid_at: date | None = None
    reference: str | None = Field(default=None, max_length=120)


class PaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    invoice_id: UUID
    amount: Decimal
    paid_at: date
    reference: str
    created_at: datetime


class ContractCreate(BaseModel):
    customer_id: UUID
    reference: str = Field(min_length=1, max_length=100)
    requires_formal_notice: bool = False
    notice_terms: str = Field(default="", max_length=2000)


class ContractUpdate(BaseModel):
    reference: str | None = Field(default=None, min_length=1, max_length=100)
    requires_formal_notice: bool | None = None
    notice_terms: str | None = Field(default=None, max_length=2000)


class ContractRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    customer_id: UUID
    reference: str
    requires_formal_notice: bool
    notice_terms: str
    created_at: datetime


class CommunicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    invoice_id: UUID
    actor_id: UUID | None
    channel: str
    subject: str
    body: str
    status: str
    created_at: datetime


class SupportTicketCreate(BaseModel):
    ticket_number: str = Field(min_length=1, max_length=80)
    subject: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=4000)
    requester_email: EmailStr
    customer_id: UUID | None = None
    priority: TicketPriority = TicketPriority.MEDIUM
    status: TicketStatus = TicketStatus.OPEN
    sla_due_at: datetime
    assigned_to_id: UUID | None = None


class SupportTicketUpdate(BaseModel):
    subject: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=4000)
    requester_email: EmailStr | None = None
    customer_id: UUID | None = None
    priority: TicketPriority | None = None
    status: TicketStatus | None = None
    sla_due_at: datetime | None = None
    assigned_to_id: UUID | None = None


class SupportTicketRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ticket_number: str
    subject: str
    description: str
    requester_email: EmailStr
    customer_id: UUID | None
    priority: TicketPriority
    status: TicketStatus
    sla_due_at: datetime
    assigned_to_id: UUID | None
    created_by_id: UUID | None
    created_at: datetime
    updated_at: datetime


class SupportTicketEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_id: UUID
    event_type: str
    actor: str
    details: dict[str, Any]
    created_at: datetime


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=2000)
    source: str | None = Field(default=None, max_length=120)
    priority: TaskPriority | None = None
    assigned_to_id: UUID | None = None
    due_at: datetime | None = None


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workflow_id: UUID
    order_index: int
    title: str
    description: str
    kind: TaskKind
    status: TaskStatus
    source: str | None
    priority: TaskPriority
    assigned_to_id: UUID | None
    due_at: datetime | None
    result_data: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workflow_id: UUID
    event_type: str
    actor: str
    details: dict[str, Any]
    created_at: datetime