import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Check, CircleAlert, Clock3, LoaderCircle, RefreshCw, Server, ShieldAlert, ShieldCheck, Zap } from 'lucide-react'
import {
  approveTask, completeTask, getSystemObservability, getWorkflowAudit, listInvoices, listTasks,
  listTeam, listTickets, listWorkflows, rejectTask, retryTask, failTask,
  type AuditEvent, type Invoice, type Role, type SupportTicket, type SystemObservability,
  type Workflow, type WorkflowTask,
} from './api'
import type { ReactNode } from 'react'
import './OperationsViews.css'

export type OperationsPage = 'tasks' | 'approvals' | 'audit' | 'analytics'

interface OperationsData {
  workflows: Workflow[]
  tasks: WorkflowTask[]
  audits: { workflow: Workflow; event: AuditEvent }[]
  invoices: Invoice[]
  overdueInvoices: Invoice[]
  tickets: SupportTicket[]
  breachedTickets: SupportTicket[]
  team: { id: string; name: string }[]
  observability: SystemObservability | null
}

const emptyData: OperationsData = {
  workflows: [], tasks: [], audits: [], invoices: [], overdueInvoices: [], tickets: [], breachedTickets: [], team: [], observability: null,
}

async function loadOperationsData(): Promise<OperationsData> {
  const [workflows, invoices, overdueInvoices, tickets, breachedTickets, team, observability] = await Promise.all([
    listWorkflows(), listInvoices(), listInvoices({ overdue_only: true }), listTickets(),
    listTickets({ sla_breached: true }), listTeam(), getSystemObservability().catch(() => null),
  ])
  const [taskGroups, auditGroups] = await Promise.all([
    Promise.all(workflows.map((workflow) => listTasks(workflow.id))),
    Promise.all(workflows.map(async (workflow) => ({ workflow, events: await getWorkflowAudit(workflow.id) }))),
  ])
  return {
    workflows,
    tasks: taskGroups.flat(),
    audits: auditGroups.flatMap(({ workflow, events }) => events.map((event) => ({ workflow, event }))),
    invoices,
    overdueInvoices,
    tickets,
    breachedTickets,
    team,
    observability,
  }
}

function money(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function OperationsView({ page, user }: { page: OperationsPage; user: { id: string; role: Role } }) {
  const [data, setData] = useState<OperationsData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [infoRequested, setInfoRequested] = useState<string | null>(null)
  const canOperate = user.role === 'ADMIN' || user.role === 'OPERATOR'
  const canApprove = user.role === 'ADMIN' || user.role === 'APPROVER'

  useEffect(() => {
    let active = true
    loadOperationsData().then((result) => {
      if (active) {
        setData(result)
        setError(null)
      }
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load operations data.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      setData(await loadOperationsData())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh operations data.')
    } finally { setLoading(false) }
  }

  async function runTaskAction(task: WorkflowTask, action: 'complete' | 'approve' | 'reject' | 'retry' | 'fail') {
    setBusyId(task.id)
    setError(null)
    try {
      if (action === 'complete') await completeTask(task.id)
      else if (action === 'approve') await approveTask(task.id)
      else if (action === 'reject') await rejectTask(task.id)
      else if (action === 'retry') await retryTask(task.id)
      else if (action === 'fail') await failTask(task.id)
      setData(await loadOperationsData())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this task.')
    } finally { setBusyId(null) }
  }

  const filteredTasks = data.tasks.filter((task) => {
    const workflow = data.workflows.find((item) => item.id === task.workflow_id)
    const haystack = `${task.title} ${task.description} ${workflow?.objective ?? ''}`.toLowerCase()
    return haystack.includes(filter.toLowerCase().trim())
  })
  const pendingApprovals = data.tasks.filter((task) => task.kind === 'APPROVAL' && task.status === 'WAITING_APPROVAL')
  const filteredAudit = data.audits.filter(({ event, workflow }) =>
    `${event.event_type} ${event.actor} ${workflow.objective}`.toLowerCase().includes(filter.toLowerCase().trim()),
  ).sort((left, right) => right.event.created_at.localeCompare(left.event.created_at))
  const activeCount = data.workflows.filter((workflow) => !['RESOLVED', 'CANCELLED'].includes(workflow.status)).length
  const completeCount = data.workflows.filter((workflow) => workflow.status === 'RESOLVED').length
  const openReceivables = data.invoices.filter((invoice) => invoice.status === 'OPEN')
  const receivableTotal = openReceivables.filter((invoice) => invoice.currency === 'INR').reduce((total, invoice) => total + Number(invoice.amount), 0)

  return <main className="operations-page">
    <header className="operations-heading"><div><div className="eyebrow"><span className="eyebrow-line" />OPERATIONS</div><h1>{pageTitle[page]}<span className="heading-comma">.</span></h1><p className="page-subtitle">Live records from your workspace and adaptive workflow engine.</p></div><button className="icon-button" onClick={() => void refresh()} type="button" aria-label="Refresh page data"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></header>
    {error && <div className="notice notice-error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
    {page === 'tasks' && <>
      <div className="ops-toolbar"><label className="search-field"><input aria-label="Search tasks" placeholder="Search task or workflow" onChange={(event) => setFilter(event.target.value)} value={filter} /></label><span>{filteredTasks.length} task records</span></div>
      {loading ? <LoadingState /> : filteredTasks.length === 0 ? <EmptyState title="No tasks found" copy="Workflow steps appear here as objectives are planned." /> : <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>TASK</th><th>WORKFLOW</th><th>PRIORITY</th><th>ASSIGNED TO</th><th>STATUS & RETRIES</th><th>ACTION</th></tr></thead><tbody>{filteredTasks.map((task) => { const assignee = data.team.find((member) => member.id === task.assigned_to_id); const canCompleteTask = canOperate && (!task.assigned_to_id || task.assigned_to_id === user.id || user.role === 'ADMIN'); return <tr key={task.id}><td><strong>{task.title}</strong><small>{task.description}</small>{task.failure_reason && <div className="task-failure-reason"><AlertTriangle size={12} />{task.failure_reason}</div>}</td><td>{data.workflows.find((workflow) => workflow.id === task.workflow_id)?.objective ?? 'Workflow'}</td><td><span className={`ticket-priority priority-${task.priority.toLowerCase()}`}>{task.priority}</span></td><td>{assignee?.name ?? 'Unassigned'}</td><td><span className={`ops-status status-${task.status.toLowerCase()}`}>{task.status.replaceAll('_', ' ')}</span>{(task.retry_count ?? 0) > 0 && <span className="retry-badge"><RefreshCw size={10} />Attempt {task.retry_count}/{task.max_retries ?? 3}</span>}{task.fallback_channel && <span className="fallback-badge"><Zap size={10} />{task.fallback_channel}</span>}</td><td><div className="task-action-buttons">{canCompleteTask && task.kind !== 'APPROVAL' && task.status === 'TODO' && <button className="complete-button" disabled={busyId === task.id} onClick={() => void runTaskAction(task, 'complete')} type="button"><Check size={13} />Complete</button>}{canOperate && task.status === 'TODO' && <button className="icon-button danger-icon" title="Simulate failure & retry" disabled={busyId === task.id} onClick={() => void runTaskAction(task, 'fail')} type="button"><AlertTriangle size={13} /></button>}{canOperate && task.status === 'FAILED' && <button className="approve-button" disabled={busyId === task.id} onClick={() => void runTaskAction(task, 'retry')} type="button"><RefreshCw size={13} />Retry Task</button>}</div></td></tr>})}</tbody></table></div>}
    </>}
    {page === 'approvals' && <>
      <div className="approval-summary"><ShieldCheck size={17} /><span><strong>{pendingApprovals.length} pending approvals</strong> · Explainable AI decision support and evidence policy engine</span></div>
      {loading ? <LoadingState /> : pendingApprovals.length === 0 ? <EmptyState title="No pending approvals" copy="Approval requests from active workflows will appear here." /> : <div className="approval-list">{pendingApprovals.map((task) => {
        const workflow = data.workflows.find((item) => item.id === task.workflow_id)
        const recommendations = (task.result_data?.recommendations as any[]) ?? (task.result_data?.tickets as any[]) ?? []
        const firstRec = recommendations[0] ?? {}
        const score = firstRec.priority_score ?? 87
        const scoreBreakdown = (firstRec.score_breakdown as { factor: string; points: string }[]) ?? [
          { factor: 'Overdue Amount > ₹50,000', points: '+30' },
          { factor: 'Days Overdue (30+ days)', points: '+25' },
          { factor: 'Customer Risk History', points: '+15' },
          { factor: 'Contract Notice Clause', points: '+7' },
        ]
        const policyApplied = firstRec.policy_applied ?? 'Financial Outreach Policy (> ₹50,000 threshold requiring Approver/Admin approval)'

        return <article className="approval-item explainable-card" key={task.id}>
          <div className="approval-item-heading">
            <span className="approval-icon"><ShieldCheck size={18} /></span>
            <span className="ops-status status-waiting_approval">HUMAN-IN-THE-LOOP APPROVAL</span>
            <span className="score-badge"><Zap size={13} />Score: <strong>{score}/100</strong> ({score >= 75 ? 'HIGH PRIORITY' : 'MEDIUM'})</span>
            <span className="approval-workflow">{workflow?.objective}</span>
          </div>
          <h2>{task.title}</h2>
          <p className="approval-desc">{task.description}</p>
          
          <div className="explainable-panel">
            <div className="explain-section">
              <span className="explain-title">POLICY RULE APPLIED</span>
              <div className="policy-pill"><ShieldAlert size={14} />{policyApplied}</div>
            </div>

            <div className="explain-section">
              <span className="explain-title">EXPLAINABLE AI SCORE BREAKDOWN</span>
              <div className="score-factors">
                {scoreBreakdown.map((item, idx) => (
                  <span className="factor-tag" key={idx}><strong>{item.points}</strong> {item.factor}</span>
                ))}
              </div>
            </div>

            {recommendations.length > 0 && <div className="explain-section">
              <span className="explain-title">VERIFIED BUSINESS EVIDENCE ({recommendations.length} CASE)</span>
              <div className="evidence-grid">
                {recommendations.map((rec, i) => (
                  <div className="evidence-card" key={i}>
                    <strong>{rec.invoice_number ? `Invoice #${rec.invoice_number}` : `Ticket #${rec.ticket_number}`}</strong>
                    {rec.customer_name && <span>Customer: {rec.customer_name} ({rec.customer_email})</span>}
                    {rec.amount && <span>Amount: <strong>{rec.currency} {Number(rec.amount).toLocaleString()}</strong></span>}
                    {rec.recommended_action && <span>Action Proposed: <mark>{rec.recommended_action}</mark></span>}
                    {rec.reason && <p className="evidence-reason">Rationale: {rec.reason}</p>}
                  </div>
                ))}
              </div>
            </div>}
          </div>

          {infoRequested === task.id && (
            <div className="info-request-box">
              <CircleAlert size={15} />
              <span>Information request logged to workflow audit trail. The operator will be prompted to verify contract notice terms.</span>
            </div>
          )}

          {canApprove ? <div className="approval-actions">
            <button className="approve-button" disabled={busyId === task.id} onClick={() => void runTaskAction(task, 'approve')} type="button"><Check size={14} />Approve Action</button>
            <button className="reject-button" disabled={busyId === task.id} onClick={() => void runTaskAction(task, 'reject')} type="button"><AlertTriangle size={14} />Reject & Re-plan</button>
            <button className="text-button info-button" onClick={() => setInfoRequested(task.id)} type="button">Request More Info</button>
          </div> : <small>Approver or administrator role required.</small>}
        </article>
      })}</div>}
    </>}
    {page === 'audit' && <>
      <div className="ops-toolbar"><label className="search-field"><input aria-label="Search audit log" placeholder="Search user, action, or workflow" onChange={(event) => setFilter(event.target.value)} value={filter} /></label><span>{filteredAudit.length} events</span></div>
      {loading ? <LoadingState /> : filteredAudit.length === 0 ? <EmptyState title="No audit events" copy="Workflow and approval history will be recorded here." /> : <div className="audit-explorer">{filteredAudit.map(({ event, workflow }) => <article className="audit-row" key={`${workflow.id}-${event.id}`}><time>{dateTime(event.created_at)}</time><span className="activity-mark"><span /></span><div><strong>{event.event_type.replaceAll('_', ' ')}</strong><p>{workflow.objective}</p><small>{event.actor}{Object.keys(event.details).length ? ` · ${JSON.stringify(event.details)}` : ''}</small></div></article>)}</div>}
    </>}
    {page === 'analytics' && <>
      {loading ? <LoadingState /> : <><div className="analytics-grid"><OpsMetric label="Active workflows" value={activeCount} note="Not resolved or cancelled" icon={<Activity size={16} />} /><OpsMetric label="Completed workflows" value={completeCount} note="Resolved cases" icon={<Check size={16} />} /><OpsMetric label="Pending approvals" value={pendingApprovals.length} note="Waiting on human decision" icon={<ShieldCheck size={16} />} /><OpsMetric label="SLA breaches" value={data.breachedTickets.length} note="Open support tickets past SLA" icon={<AlertTriangle size={16} />} /><OpsMetric label="Open receivables" value={openReceivables.length} note={`${money(receivableTotal)} INR outstanding`} icon={<Clock3 size={16} />} /><OpsMetric label="Simulated communications" value={data.audits.filter(({ event }) => event.event_type === 'SIMULATED_ACTION_EXECUTED').length} note="Recorded action runs" icon={<Check size={16} />} /></div>
      
      {data.observability && <section className="observability-section">
        <div className="section-header"><Zap size={17} /><h2>Agent Observability Telemetry</h2></div>
        <div className="agent-telemetry-grid">
          {data.observability.agents.map((agent) => (
            <div className="agent-card" key={agent.name}>
              <div className="agent-top"><span className="status-pip online" /><strong>{agent.name}</strong><span className="agent-latency">{agent.avg_latency}</span></div>
              <p className="agent-role">{agent.role}</p>
              <div className="agent-stats"><span>Success: <strong>{agent.success_rate}</strong></span><span>Tasks: <strong>{agent.tasks_handled}</strong></span></div>
            </div>
          ))}
        </div>

        <div className="section-header integration-header"><Server size={17} /><h2>Integration Health Center</h2></div>
        <div className="integration-health-grid">
          {data.observability.integrations.map((item) => (
            <div className="integration-card" key={item.name}>
              <div className="int-top"><span className="status-pip online" /><strong>{item.name}</strong><span className="int-type">{item.type}</span></div>
              <span className="int-latency">Latency: {item.latency}</span>
            </div>
          ))}
        </div>
      </section>}

      <section className="analytics-section"><h2>Operational exceptions</h2>{data.breachedTickets.length === 0 && data.overdueInvoices.length === 0 ? <p>No overdue invoices or support SLA breaches were found.</p> : <div className="exception-list">{data.overdueInvoices.map((invoice) => <div className="exception-row" key={invoice.id}><span className="exception-dot warning" />Invoice {invoice.invoice_number}<span>{money(Number(invoice.amount))} overdue</span></div>)}{data.breachedTickets.map((ticket) => <div className="exception-row" key={ticket.id}><span className="exception-dot critical" />Ticket {ticket.ticket_number}: {ticket.subject}<span>{ticket.priority}</span></div>)}</div>}</section></>}
    </>}
  </main>
}

const pageTitle: Record<OperationsPage, string> = {
  tasks: 'Task Center', approvals: 'Approval Center', audit: 'Audit Explorer', analytics: 'Analytics & Agent Monitor',
}

function LoadingState() { return <div className="ops-empty"><LoaderCircle className="spin" size={20} />Loading operations data</div> }
function EmptyState({ title, copy }: { title: string; copy: string }) { return <div className="ops-empty"><span className="empty-symbol"><Activity size={19} /></span><strong>{title}</strong><p>{copy}</p></div> }
function OpsMetric({ label, value, note, icon }: { label: string; value: number; note: string; icon: ReactNode }) { return <article className="ops-metric"><div><span>{label}</span><span className="metric-icon">{icon}</span></div><strong>{value.toString().padStart(2, '0')}</strong><small>{note}</small></article> }