# Kaiten — Intelligent Business Workflow Automation

## Project Roadmap & Technical Implementation Plan

Kaiten is an AI-powered business workflow orchestration platform that transforms a natural-language business objective into a complete, executable, adaptive, and auditable workflow.

The long-term product scope spans Finance, Sales, Support, HR, Procurement, and
internal Operations. Invoice recovery is the first deep vertical slice used to
prove the shared orchestration engine; other departments remain roadmap modules
until their workflows are implemented.

Primary MVP use case: **Intelligent Invoice Recovery**

> “Find all overdue invoices above ₹1 lakh, analyze customer history, contact customers, and escalate high-value cases.”

Core model:

**Objective → Gather → Plan → Analyze → Approve → Execute → Monitor → Adapt → Resolve → Audit**

---

# 1. MVP Scope

Kaiten should:

1. Understand the business objective.
2. Discover required information sources.
3. Gather data from multiple sources.
4. Build an execution plan.
5. Analyze the collected context.
6. Prioritize invoices.
7. Recommend an action.
8. Request human approval for sensitive actions.
9. Execute the approved action.
10. Monitor the result.
11. Handle failures and missing information.
12. Dynamically re-plan when required.
13. Resolve or escalate the case.
14. Maintain a complete audit trail.

### Initial integrations

- PostgreSQL — invoices, customers, payments
- Excel/CSV — additional business data
- PDF — contracts
- Email — simulated email system
- LLM — planning and reasoning
- Notification system — approval requests

Build one strong end-to-end vertical slice before adding many integrations.

---

# 2. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| UI | Tailwind CSS / CSS |
| Backend | Python FastAPI |
| Database | PostgreSQL |
| ORM | SQLAlchemy |
| AI | Schema-validated LLM planner (planned) |
| Documents | PDF/DOCX extraction (planned) |
| Authentication | JWT + password hashing + RBAC |
| API Documentation | Swagger / OpenAPI |
| Background Jobs | Scheduler/worker (planned) |
| Realtime Updates | WebSocket/SSE (planned) |
| Deployment | Docker |

---

# 3. Project Structure

```text
Kaiten/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── types/
│   │   └── utils/
│   └── package.json
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   ├── database.py
│   │   └── security.py
│   ├── tests/
│   └── requirements.txt
│
├── database/
│   ├── migrations/
│   └── seed/
│
├── docs/
└── README.md
```

---

# 4. Phase 0 — Freeze the MVP Scope

Primary workflow:

```text
Business Objective
        ↓
Find Overdue Invoices
        ↓
Gather Customer Context
        ↓
Analyze Risk
        ↓
Prioritize
        ↓
Recommend Action
        ↓
Human Approval
        ↓
Execute
        ↓
Monitor
        ↓
Resolve / Escalate
        ↓
Audit
```

The system must demonstrate adaptive behavior when information is missing or an execution step fails.

---

# 5. Phase 1 — Project Foundation

## Backend

Use:

- ASP.NET Core Web API
- C#
- Entity Framework Core
- PostgreSQL
- Swagger/OpenAPI
- JWT authentication

## Frontend

Use:

- React
- TypeScript
- Vite
- Responsive UI
- Dashboard architecture

## Development principles

- Keep AI logic separate from API controllers.
- Keep workflow state separate from LLM responses.
- Use environment variables for secrets.
- Keep integrations behind a common tool interface.
- Use structured JSON responses from the AI layer.

---

# 6. Phase 2 — Database

Build the database before advanced AI.

## Core tables

```text
Users
Workflows
WorkflowTasks
WorkflowExecutions
Approvals
DataSources
Documents
AuditLogs
Notifications
Invoices
Customers
Payments
Contracts
CommunicationLogs
```

## Main relationships

```text
User
 │
 └── Workflow
       │
       ├── WorkflowTasks
       ├── WorkflowExecutions
       ├── Approvals
       └── AuditLogs
```

## Invoice domain

```text
Customer
   │
   ├── Invoices
   │      └── Payments
   ├── Contracts
   └── CommunicationLogs
```

---

# 7. Phase 3 — Backend Foundation

## Authentication APIs

```http
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
```

## Workflow APIs

```http
POST   /api/workflows
GET    /api/workflows
GET    /api/workflows/{id}
POST   /api/workflows/{id}/start
POST   /api/workflows/{id}/cancel
```

## Task APIs

```http
GET  /api/workflows/{id}/tasks
GET  /api/tasks/{id}
POST /api/tasks/{id}/retry
```

## Approval APIs

```http
GET  /api/approvals
POST /api/approvals/{id}/approve
POST /api/approvals/{id}/reject
```

## Audit APIs

```http
GET /api/workflows/{id}/audit
```

The backend should work even without AI at this stage.

---

# 8. Phase 4 — Workflow Engine

The workflow engine is the heart of Kaiten.

The LLM should not directly control the entire application. The backend maintains deterministic workflow state.

## Workflow states

```text
CREATED
   ↓
PLANNING
   ↓
DATA_COLLECTION
   ↓
ANALYSIS
   ↓
ACTION_PROPOSED
   ↓
WAITING_APPROVAL
   ↓
APPROVED
   ↓
EXECUTING
   ↓
VERIFYING
   ↓
RESOLVED
```

## Failure path

```text
EXECUTING
    ↓
  FAILED
    ↓
 RETRYING
    ↓
REPLANNING
    ↓
 EXECUTING
```

## Missing-information path

```text
DATA_COLLECTION
      ↓
MISSING_INFORMATION
      ↓
SEARCH_OTHER_SOURCE
      ↓
FOUND
      ↓
CONTINUE
```

Resume from the blocked task instead of restarting the workflow.

---

# 9. Phase 5 — AI Planning Engine

The AI converts the natural-language objective into a structured execution plan.

Example:

```text
Find all overdue invoices above ₹1 lakh,
analyze customer history,
contact customers,
and escalate high-value cases.
```

Possible structured plan:

```json
{
  "objective": "Recover overdue invoices",
  "tasks": [
    {"id": "T1", "action": "find_invoices", "source": "invoice_database"},
    {"id": "T2", "action": "filter", "condition": "amount > 100000 AND overdue = true"},
    {"id": "T3", "action": "get_customer_history"},
    {"id": "T4", "action": "analyze_risk"},
    {"id": "T5", "action": "recommend_action"},
    {"id": "T6", "action": "request_approval"},
    {"id": "T7", "action": "send_communication"},
    {"id": "T8", "action": "monitor_response"}
  ]
}
```

Use structured outputs / JSON schema wherever supported.

The AI generates plans; the workflow engine validates and executes them.

---

# 10. Phase 6 — Tool / Integration Layer

Create a standard integration interface.

```text
ToolRegistry
     │
     ├── DatabaseTool
     ├── ExcelTool
     ├── PDFTool
     ├── EmailTool
     ├── NotificationTool
     └── API Tool
```

Example:

```text
DatabaseTool
 ├── queryInvoices()
 ├── getCustomer()
 ├── getPayments()
 └── getCommunicationHistory()
```

Execution architecture:

```text
LLM
 ↓
Tool Selection
 ↓
Tool Registry
 ↓
Actual Tool
 ↓
Result
 ↓
Workflow State
```

The AI selects tools, but the backend performs the actual execution.

---

# 11. Phase 7 — Multi-Source Data Gathering

Kaiten should combine information from multiple sources.

```text
                Invoice DB
                    │
                    ↓
Excel ─────────→ Kaiten ←──────── CRM
                    │
                    ├──────── PDF Contracts
                    ├──────── Email History
                    └──────── External APIs
```

Example for `INV-1042`:

```text
Invoice
₹4,80,000
47 days overdue

Customer
Enterprise / High-value

Payment History
2 previous late payments

Contract
Formal notice required

Email History
Previous reminder ignored
```

Kaiten combines this information into a contextual representation for analysis.

---

# 12. Phase 8 — Context & Decision Engine

Example inputs:

```text
Invoice Amount       → ₹4.8L
Days Overdue         → 47
Customer Value       → High
Previous Defaults    → 2
Contract Requirement → Formal Notice
```

Result:

```text
Priority = HIGH
Risk = HIGH
Recommended Action = Formal Payment Notice
Approval Required = YES
```

## Deterministic business rules

```text
IF invoice_amount > ₹5,00,000
    → approval required

IF invoice_amount > ₹1,00,000
    → high priority

IF contract.requires_formal_notice
    → use formal notice template
```

Use the LLM for contextual reasoning, not as the sole authority for hard business rules.

---

# 13. Phase 9 — Human-in-the-Loop

Create an Approval Center.

Example:

```text
┌──────────────────────────────────────┐
│ Approval Required                    │
├──────────────────────────────────────┤
│ Invoice: INV-1042                    │
│ Customer: ABC Enterprises            │
│ Amount: ₹4,80,000                    │
│ Overdue: 47 days                     │
│                                      │
│ Recommended Action:                  │
│ Formal Payment Reminder              │
│                                      │
│ Reason: High-value invoice +         │
│ contract requires formal notice      │
│                                      │
│ [ Reject ]       [ Approve ]         │
└──────────────────────────────────────┘
```

Approval should be required for high-impact operations such as:

- High-value financial actions
- Legal notices
- Refunds
- Contract modifications
- Data deletion
- External escalations

---

# 14. Phase 10 — Action Execution

After approval:

```text
Approval
   ↓
Action Executor
   ↓
Email Tool
   ↓
Send Reminder
   ↓
Communication Log
   ↓
Workflow Continues
```

Store:

```text
who
what
when
why
result
```

Example:

```text
Actor: Kaiten
Action: Payment reminder sent
Invoice: INV-1042
Timestamp: 14:32
Status: SUCCESS
Approval: APPROVAL-1042
```

---

# 15. Phase 11 — Failure Handling

Example:

```text
Send Email
    ↓
API Failure
    ↓
Retry #1
    ↓
API Failure
    ↓
Retry #2
    ↓
Failure
    ↓
AI Replanning
    ↓
Alternative communication available?
    ↓
YES
    ↓
Request Approval
    ↓
SMS
```

Record every attempt:

```text
Attempt 1 → Failed
Attempt 2 → Failed
Alternative → SMS
Approval → Granted
SMS → Successful
```

---

# 16. Phase 12 — Missing Information Handling

Example:

```text
AI needs customer's contract
          ↓
Contract DB
          ↓
Not found
          ↓
Document Storage
          ↓
Not found
          ↓
Email History
          ↓
Found
          ↓
Continue Workflow
```

If information cannot be found:

```text
Ask User
   ↓
WAITING_FOR_INPUT
   ↓
User provides information
   ↓
Resume Task
```

Never restart the entire workflow for a single missing input.

---

# 17. Phase 13 — Dynamic Replanning

Create a dedicated Replanner.

## Input

```text
Current workflow state
+
Failure
+
Available tools
+
New information
```

## Output

```text
Next best executable step
```

Example:

```text
Original plan:
Email customer

Problem:
Email service unavailable

Replanner:
SMS available
→ Approval required
→ Send SMS
→ Monitor response
```

This demonstrates dynamic re-planning.

---

# 18. Phase 14 — Audit Trail

Every significant event should create an audit record.

Example:

```text
14:00 Objective created
14:01 Plan generated
14:02 Invoice DB queried
14:03 Customer history retrieved
14:04 Contract analyzed
14:05 Invoice prioritized
14:06 Approval requested
14:08 Approval granted
14:09 Email sent
14:10 Response monitoring started
```

Audit Explorer filters:

```text
Workflow
User
Agent
Action
Status
Date
```

Every important operation must be traceable.

---

# 19. Phase 15 — Frontend

Build the UI around the working workflow engine.

## Dashboard

Display:

```text
Active Workflows
Completed
Pending Approval
Failed
Escalated
Automation Rate
```

## Create Workflow

```text
What would you like Kaiten to accomplish?

┌──────────────────────────────────────────┐
│ Find overdue invoices above ₹1 lakh,    │
│ analyze customer history and contact    │
│ customers...                            │
└──────────────────────────────────────────┘

              [ Create Workflow ]
```

## AI Plan

```text
Objective
   ↓
Data Sources
   ↓
Tasks
   ↓
Decision Points
   ↓
Approval Points
   ↓
Expected Outcome
```

## Workflow Monitor

```text
✓ Objective understood
✓ Invoice data retrieved
✓ Customer history retrieved
✓ Contracts analyzed
✓ Priority calculated
⏳ Approval required
○ Communication
○ Monitoring
○ Resolution
```

Use SignalR for live updates.

## Approval Center

Display pending high-impact actions.

## Audit Explorer

Display every action and supporting evidence.

---

# 20. Phase 16 — Explainability

For important decisions, show evidence.

### Why did Kaiten choose this action?

```text
Invoice:
₹4,80,000

Overdue:
47 days

Customer:
Enterprise

Payment History:
2 previous delays

Contract:
Formal notice required

Previous Communication:
Reminder ignored

Conclusion:
Formal payment notice recommended.
```

Sources:

```text
✓ Invoice Database
✓ Customer Database
✓ Contract.pdf
✓ Email History
```

---

# 21. Phase 17 — Testing

## Scenario 1 — Normal

```text
Invoice found
→ Customer found
→ Contract found
→ Approval
→ Email
→ Resolved
```

## Scenario 2 — Missing data

```text
Customer missing
→ Search alternate source
→ Found
→ Continue
```

## Scenario 3 — Email failure

```text
Email
→ Failure
→ Retry
→ Failure
→ Replan
→ SMS
```

## Scenario 4 — User rejection

```text
Action proposed
→ Approval rejected
→ Replan
→ Alternative action
```

## Scenario 5 — No response

```text
Email sent
→ No response
→ Wait
→ Reminder
→ Escalation
```

---

# 22. Phase 18 — Security

Implement:

```text
JWT authentication
RBAC
Input validation
API authorization
Encrypted secrets
Environment variables
Database access control
Audit logging
Rate limiting
```

Never expose API keys in React.

```text
❌ React → LLM API directly

✅ React
      ↓
.NET API
      ↓
AI Service
      ↓
LLM
```

---

# 23. Phase 19 — Deployment

Containerize the application.

```text
                    Internet
                       │
                       ↓
                React Frontend
                       │
                       ↓
                 .NET Web API
                  /     |                      /      |                      ↓       ↓       ↓
           PostgreSQL  AI     Redis
                      Service
                         │
                         ↓
                       LLM
```

Recommended:

```text
Docker
Docker Compose
PostgreSQL
Redis
.NET
React
```

For the hackathon, a single cloud VM/container deployment is sufficient.

---

# 24. Phase 20 — Final Demo Scenario

### Step 1 — Business objective

> “Find all overdue invoices above ₹1 lakh, analyze customer history, contact customers, and escalate high-value cases.”

### Step 2 — AI planning

```text
8 tasks
5 data sources
2 decision points
1 approval required
```

### Step 3 — Data gathering

```text
Invoice DB
Customer DB
Payment History
Contract PDF
Email History
```

### Step 4 — Analysis

```text
INV-1042
₹4,80,000
47 days overdue
HIGH PRIORITY
```

### Step 5 — Recommendation

```text
Formal payment notice recommended.
```

### Step 6 — Human approval

```text
APPROVE
```

### Step 7 — Execute

Email is sent.

### Step 8 — Simulate failure

```text
Email API Failure
```

### Step 9 — Adaptive recovery

```text
Retry → Failed
       ↓
AI Replanning
       ↓
SMS available
       ↓
Approval
       ↓
SMS sent
```

### Step 10 — Resolution

```text
✓ Communication completed
✓ Case resolved
✓ Audit trail generated
```

This single scenario demonstrates most of the R2-P1 requirements.

---

# 25. Recommended Build Order

Follow this sequence:

```text
1. Project Setup
        ↓
2. PostgreSQL
        ↓
3. FastAPI APIs + authentication/RBAC
        ↓
4. Workflow State Machine
        ↓
5. AI Planner
        ↓
6. Tool Registry
        ↓
7. Data Sources
        ↓
8. Decision Engine
        ↓
9. Human Approval
        ↓
10. Action Execution
        ↓
11. Failure + Replanning
        ↓
12. Audit Trail
        ↓
13. React UI
        ↓
14. Testing
        ↓
15. Deployment
```

---

# 26. Core Architecture Principle

Kaiten should **not** be built as an AI chatbot.

It should be:

```text
Workflow Engine
       +
AI Planner
       +
Tool Registry
       +
Context Engine
       +
Decision Engine
       +
Human Approval
       +
Replanner
       +
Audit System
```

The LLM is the **reasoning and planning layer**.

The deterministic backend remains responsible for:

- Workflow state
- Permissions
- Tool execution
- Validation
- Business rules
- Retries
- Approvals
- Security
- Auditability

---

# 27. Final Product Flow

```text
                  USER OBJECTIVE
                        │
                        ▼
                OBJECTIVE ANALYZER
                        │
                        ▼
                   AI PLANNER
                        │
                        ▼
                WORKFLOW ENGINE
                        │
                        ▼
                DATA COLLECTION
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
       Database       Excel          PDF
          │             │             │
          └─────────────┼─────────────┘
                        ▼
                 CONTEXT ENGINE
                        │
                        ▼
                 DECISION ENGINE
                        │
                        ▼
                APPROVAL CHECK
                  /                          YES           NO
                 │             │
                 ▼             ▼
           HUMAN APPROVAL   EXECUTE
                 │             │
                 └──────┬──────┘
                        ▼
                  ACTION ENGINE
                        │
                        ▼
                   VERIFICATION
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
           SUCCESS              FAILURE
              │                   │
              ▼                   ▼
          RESOLUTION          RETRY/REPLAN
              │                   │
              └─────────┬─────────┘
                        ▼
                  AUDIT TRAIL
```

---

# 28. Definition of Done

The MVP is complete when Kaiten can:

- [ ] Accept a natural-language business objective.
- [ ] Convert the objective into a structured workflow.
- [ ] Discover and query multiple data sources.
- [ ] Combine information into context.
- [ ] Apply deterministic business rules.
- [ ] Use AI for contextual reasoning.
- [ ] Recommend an action.
- [ ] Request human approval when required.
- [ ] Execute an external action.
- [ ] Monitor execution.
- [ ] Retry failed operations.
- [ ] Handle missing information.
- [ ] Dynamically re-plan.
- [ ] Escalate unresolved cases.
- [ ] Verify the final result.
- [ ] Maintain a complete audit trail.
- [ ] Explain why important actions were taken.
- [ ] Display workflow progress in real time.
- [ ] Run the complete invoice-recovery demo end-to-end.

---

# 29. Final Objective

The final Kaiten prototype should demonstrate:

> A business user provides an objective, and Kaiten autonomously coordinates the data, reasoning, planning, execution, approvals, recovery, and monitoring required to move that objective toward resolution — while keeping humans in control of high-impact decisions and maintaining complete traceability.

**Core tagline:**

**UNDERSTAND → GATHER → PLAN → DECIDE → EXECUTE → ADAPT → RESOLVE → AUDIT**

---

# 30. Overall Product Requirements

Invoice recovery is the first working workflow, not the product boundary.
Kaiten's long-term product is a shared business-operations orchestrator for:

| Domain | Representative workflows |
|---|---|
| Finance | Receivables, payables, expenses, payment approvals, financial reports |
| Sales | Lead qualification, assignment, pipeline follow-up, customer health |
| Customer Support | Ticket intake, classification, routing, SLA monitoring, escalation |
| Human Resources | Recruitment coordination, onboarding, leave, training, employee exit |
| Procurement | Purchase approvals, supplier onboarding, order tracking, contract renewal |
| Operations | Internal requests, task assignment, deadlines, recurring processes |
| Documents | Extraction, classification, search, obligations, expiry tracking |
| Communications | Email intake, drafting, reminders, response tracking, escalation |
| Analytics | Operational reports, risk signals, trends, evidence-backed explanations |

Calendar scheduling, alerts, a business inbox, task dependencies, and
cross-department handoffs are shared capabilities across these domains.

## Shared Platform Contract

Every department workflow should use the same controlled execution pipeline:

```text
Objective
  -> Plan and validate
  -> Gather source-linked evidence
  -> Create and assign dependent tasks
  -> Apply policy and explain the recommendation
  -> Request approval when required
  -> Execute through registered integrations
  -> Monitor deadlines and outcomes
  -> Retry or re-plan on missing information/failure
  -> Resolve and audit
```

The planner may propose work; only the deterministic workflow engine can
change state, enforce permissions, approve actions, and invoke registered
tools. Important decisions must link to the underlying records that support
them.

## Target Navigation

```text
Command Center · AI Assistant · Workflows · Tasks · Approvals
Finance · Sales · HR · Procurement · Support
Documents · Communications · Analytics · Alerts · Integrations · Audit/Admin
```

Expose navigation only when the destination has a usable workflow. Do not add
empty placeholder departments to imply functionality that is not implemented.

# 31. Product Delivery Sequence

Build reusable capabilities and a few complete workflows before expanding the
department count:

1. **Finance receivables:** complete invoice recovery with real source records,
   payment history, contract evidence, deterministic policy, approval, simulated
   action, monitoring, missing-input resume, and audit.
2. **Shared work management:** extend task assignment, priority, and deadlines
   with dependencies, recurring work, reminders, alerts, and a business inbox.
3. **Source integrations:** CSV/XLSX, PDF/DOCX, email, and API adapters. Track
        provenance and access permissions for every gathered item.
4. **Adjacent templates:** add vendor-contract renewal and another finance or
        sales workflow using the shared engine and approval model.
5. **AI planning and analysis:** add schema-validated LLM plans and evidence-
        grounded answers after tool permissions, business rules, and execution limits
        are enforced server-side.
6. **Broader departments:** expand Finance, Sales, HR, Procurement, and Operations
        based on working templates, not disconnected CRUD screens alone.
7. **Monitoring and intelligence:** durable scheduling, bounded retries,
        re-planning, reports, trend analysis, cross-department coordination, and live
        updates.

# 32. Current Implementation Boundary

The current codebase provides PostgreSQL-backed CRUD and RBAC for users,
workflows, draft workflow steps (including assignee, priority, and deadline),
customers, invoices, payments, contracts, and support tickets. It includes
Command Center, AI Command, workflow detail, task, approval, Finance, Support,
Documents/Contracts, Communications, Analytics, and Audit views. Invoice
recovery gathers matching records and evidence,
calculates deterministic priority/recommendations, gates simulated communication
on human approval, resumes after missing input, re-plans after rejection, and
records an audit trail. Support SLA escalation gathers overdue tickets, related
customer context and priority, gates escalation on approval, records ticket
events, and appears in the Command Center's breached-SLA count.

The following remain roadmap work, not current capabilities: LLM planning,
document or spreadsheet ingestion, real outbound email/API integrations,
password reset emails, durable scheduled monitoring/retries, task dependencies
and recurring schedules, and the Sales, HR, and Procurement workflow templates.
Keep the interface and demo language explicit about these boundaries as the
product expands.
