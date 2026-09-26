export type Role = 'ADMIN' | 'OPERATOR' | 'APPROVER' | 'VIEWER'
export type WorkflowStatus = 'CREATED' | 'PLANNING' | 'DATA_COLLECTION' | 'ANALYSIS' | 'ACTION_PROPOSED' | 'WAITING_APPROVAL' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'WAITING_FOR_INPUT' | 'FAILED' | 'RETRYING' | 'REPLANNING' | 'RESOLVED' | 'CANCELLED'
export type TaskKind = 'GATHER' | 'ANALYZE' | 'RECOMMEND' | 'APPROVAL' | 'ACTION' | 'MONITOR'
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'WAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'FAILED'
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED'

export interface User {
  id: string
  name: string
  company: string
  email: string
  role: Role
  is_active: boolean
  created_at: string
}

export interface AuthSession {
  access_token: string
  token_type: 'bearer'
  user: User
}

export interface Workflow {
  id: string
  owner_id: string | null
  objective: string
  status: WorkflowStatus
  created_at: string
  updated_at: string
}

export interface WorkflowTask {
  id: string
  workflow_id: string
  order_index: number
  title: string
  description: string
  kind: TaskKind
  status: TaskStatus
  source: string | null
  priority: TaskPriority
  assigned_to_id: string | null
  due_at: string | null
  result_data: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  name: string
  email: string
  segment: string
  created_by_id: string | null
  created_at: string
}

export interface Invoice {
  id: string
  invoice_number: string
  customer_id: string
  amount: string
  currency: string
  due_date: string
  status: 'OPEN' | 'PAID'
  created_at: string
  updated_at: string
}

export interface Payment {
  id: string
  invoice_id: string
  amount: string
  paid_at: string
  reference: string
  created_at: string
}

export interface Contract {
  id: string
  customer_id: string
  reference: string
  requires_formal_notice: boolean
  notice_terms: string
  created_at: string
}

export interface SupportTicket {
  id: string
  ticket_number: string
  subject: string
  description: string
  requester_email: string
  customer_id: string | null
  priority: TicketPriority
  status: TicketStatus
  sla_due_at: string
  assigned_to_id: string | null
  created_by_id: string | null
  created_at: string
  updated_at: string
}

export interface AuditEvent {
  id: number
  workflow_id: string
  event_type: string
  actor: string
  details: Record<string, unknown>
  created_at: string
}

let accessToken: string | null = null
const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

export function setAccessToken(token: string | null) {
  accessToken = token
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, apiBaseUrl), {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? `Request failed (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const bootstrapAdmin = (payload: { name: string; company: string; email: string; password: string }) => request<AuthSession>('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify(payload) })
export const getAdminRegistrationStatus = () => request<{ available: boolean }>('/api/auth/admin-registration-status')
export const registerAdmin = (payload: { name: string; company: string; email: string; password: string }) => request<AuthSession>('/api/auth/register-admin', { method: 'POST', body: JSON.stringify(payload) })
export const registerUser = (payload: { name: string; company: string; email: string; password: string }) => request<{ detail: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) })
export const login = (email: string, password: string) => request<AuthSession>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
export const getCurrentUser = () => request<User>('/api/auth/me')
export const listTeam = () => request<User[]>('/api/team')

export const listUsers = () => request<User[]>('/api/users')
export const createUser = (payload: { name: string; company: string; email: string; password: string; role: Role }) => request<User>('/api/users', { method: 'POST', body: JSON.stringify(payload) })
export const updateUser = (id: string, payload: Partial<Pick<User, 'name' | 'email' | 'role' | 'is_active'>> & { password?: string }) => request<User>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const deleteUser = (id: string) => request<void>(`/api/users/${id}`, { method: 'DELETE' })

export const listWorkflows = () => request<Workflow[]>('/api/workflows')
export const createWorkflow = (objective: string) => request<Workflow>('/api/workflows', {
  method: 'POST',
  body: JSON.stringify({ objective }),
})
export const updateWorkflow = (id: string, objective: string) => request<Workflow>(`/api/workflows/${id}`, { method: 'PATCH', body: JSON.stringify({ objective }) })
export const deleteWorkflow = (id: string) => request<void>(`/api/workflows/${id}`, { method: 'DELETE' })
export const startWorkflow = (id: string) => request<Workflow>(`/api/workflows/${id}/start`, { method: 'POST' })
export const cancelWorkflow = (id: string) => request<Workflow>(`/api/workflows/${id}/cancel`, { method: 'POST' })
export const resumeWorkflow = (id: string) => request<Workflow>(`/api/workflows/${id}/resume`, { method: 'POST' })
export const listTasks = (workflowId: string) => request<WorkflowTask[]>(`/api/workflows/${workflowId}/tasks`)
export const createTask = (workflowId: string, task: Pick<WorkflowTask, 'title' | 'description' | 'kind' | 'source' | 'priority' | 'assigned_to_id' | 'due_at'>) => request<WorkflowTask>(`/api/workflows/${workflowId}/tasks`, { method: 'POST', body: JSON.stringify(task) })
export const updateTask = (id: string, task: Partial<Pick<WorkflowTask, 'title' | 'description' | 'source' | 'priority' | 'assigned_to_id' | 'due_at'>>) => request<WorkflowTask>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(task) })
export const deleteTask = (id: string) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' })
export const completeTask = (id: string) => request<WorkflowTask>(`/api/tasks/${id}/complete`, { method: 'POST' })
export const approveTask = (id: string) => request<WorkflowTask>(`/api/tasks/${id}/approve`, { method: 'POST' })
export const rejectTask = (id: string) => request<WorkflowTask>(`/api/tasks/${id}/reject`, { method: 'POST' })
export const getWorkflowAudit = (id: string) => request<AuditEvent[]>(`/api/workflows/${id}/audit`)

export const listCustomers = () => request<Customer[]>('/api/customers')
export const createCustomer = (customer: Pick<Customer, 'name' | 'email' | 'segment'>) => request<Customer>('/api/customers', { method: 'POST', body: JSON.stringify(customer) })
export const updateCustomer = (id: string, customer: Partial<Pick<Customer, 'name' | 'email' | 'segment'>>) => request<Customer>(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify(customer) })
export const deleteCustomer = (id: string) => request<void>(`/api/customers/${id}`, { method: 'DELETE' })

export const listInvoices = (filters?: { overdue_only?: boolean; minimum_amount?: string }) => {
  const params = new URLSearchParams()
  if (filters?.overdue_only) params.set('overdue_only', 'true')
  if (filters?.minimum_amount) params.set('minimum_amount', filters.minimum_amount)
  const suffix = params.size ? `?${params.toString()}` : ''
  return request<Invoice[]>(`/api/invoices${suffix}`)
}
export const createInvoice = (invoice: Pick<Invoice, 'invoice_number' | 'customer_id' | 'amount' | 'currency' | 'due_date' | 'status'>) => request<Invoice>('/api/invoices', { method: 'POST', body: JSON.stringify(invoice) })
export const updateInvoice = (id: string, invoice: Partial<Pick<Invoice, 'invoice_number' | 'customer_id' | 'amount' | 'currency' | 'due_date' | 'status'>>) => request<Invoice>(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(invoice) })
export const deleteInvoice = (id: string) => request<void>(`/api/invoices/${id}`, { method: 'DELETE' })

export const listPayments = (invoiceId: string) => request<Payment[]>(`/api/invoices/${invoiceId}/payments`)
export const createPayment = (payment: Pick<Payment, 'invoice_id' | 'amount' | 'paid_at' | 'reference'>) => request<Payment>('/api/payments', { method: 'POST', body: JSON.stringify(payment) })
export const updatePayment = (id: string, payment: Partial<Pick<Payment, 'amount' | 'paid_at' | 'reference'>>) => request<Payment>(`/api/payments/${id}`, { method: 'PATCH', body: JSON.stringify(payment) })
export const deletePayment = (id: string) => request<void>(`/api/payments/${id}`, { method: 'DELETE' })

export const listContracts = () => request<Contract[]>('/api/contracts')
export const createContract = (contract: Pick<Contract, 'customer_id' | 'reference' | 'requires_formal_notice' | 'notice_terms'>) => request<Contract>('/api/contracts', { method: 'POST', body: JSON.stringify(contract) })
export const updateContract = (id: string, contract: Partial<Pick<Contract, 'reference' | 'requires_formal_notice' | 'notice_terms'>>) => request<Contract>(`/api/contracts/${id}`, { method: 'PATCH', body: JSON.stringify(contract) })
export const deleteContract = (id: string) => request<void>(`/api/contracts/${id}`, { method: 'DELETE' })

export const listCommunications = () => request<{ id: string; invoice_id: string; channel: string; subject: string; body: string; status: string; created_at: string }[]>('/api/communications')

export const listTickets = (filters?: { sla_breached?: boolean; priority?: TicketPriority }) => {
  const params = new URLSearchParams()
  if (filters?.sla_breached) params.set('sla_breached', 'true')
  if (filters?.priority) params.set('priority', filters.priority)
  const suffix = params.size ? `?${params.toString()}` : ''
  return request<SupportTicket[]>(`/api/tickets${suffix}`)
}
export const createTicket = (ticket: Pick<SupportTicket, 'ticket_number' | 'subject' | 'description' | 'requester_email' | 'customer_id' | 'priority' | 'status' | 'sla_due_at' | 'assigned_to_id'>) => request<SupportTicket>('/api/tickets', { method: 'POST', body: JSON.stringify(ticket) })
export const updateTicket = (id: string, ticket: Partial<Pick<SupportTicket, 'subject' | 'description' | 'requester_email' | 'customer_id' | 'priority' | 'status' | 'sla_due_at' | 'assigned_to_id'>>) => request<SupportTicket>(`/api/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(ticket) })
export const deleteTicket = (id: string) => request<void>(`/api/tickets/${id}`, { method: 'DELETE' })
export const listTicketEvents = (id: string) => request<{ id: number; ticket_id: string; event_type: string; actor: string; details: Record<string, unknown>; created_at: string }[]>(`/api/tickets/${id}/events`)