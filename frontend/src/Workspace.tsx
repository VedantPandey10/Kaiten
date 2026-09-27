import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, ArrowRight, BarChart3, Bot, Check, CircleAlert, Clock3,
  FilePlus2, FileText, Headphones, Layers3, ListTodo, LoaderCircle, LogOut,
  KeyRound, Pencil, Play, Plus, RefreshCw, Search, ShieldCheck, ScrollText, Sparkles, Trash2,
  UserRoundCog, Users, X, Zap,
} from 'lucide-react'
import {
  approveTask, bootstrapAdmin, cancelWorkflow, completeTask, createTask,
  createUser, createWorkflow, deleteTask, deleteUser, deleteWorkflow,
  getAdminRegistrationStatus, getCurrentUser, getWorkflowAudit, listTasks, listTeam, listTickets, listUsers, listWorkflows,
  login, registerAdmin, registerUser, rejectTask, replanWorkflow, resumeWorkflow, setAccessToken, simulateWorkflow, startWorkflow, updateTask,
  updateUser, updateWorkflow,
  type AuditEvent, type AuthSession, type Role, type SimulationResponse, type TaskKind, type TaskPriority, type TaskStatus,
  type User, type Workflow, type WorkflowStatus, type WorkflowTask,
} from './api'
import './Dashboard.css'
import './Workspace.css'
import RecordCenter, { type RecordTab } from './Records'
import { OperationsView, type OperationsPage } from './OperationsViews'
import AdminView, { type AdminPage } from './AdminViews'

const workflowStatus: Record<WorkflowStatus, string> = {
  CREATED: 'Draft', PLANNING: 'Planning', DATA_COLLECTION: 'Gathering data',
  ANALYSIS: 'Analysis', ACTION_PROPOSED: 'Action proposed', WAITING_APPROVAL: 'Approval needed',
  APPROVED: 'Approved', EXECUTING: 'Executing', VERIFYING: 'Monitoring',
  WAITING_FOR_INPUT: 'Needs input', FAILED: 'Failed', RETRYING: 'Retrying',
  REPLANNING: 'Replanning', RESOLVED: 'Resolved', CANCELLED: 'Cancelled',
}
const taskStatus: Record<TaskStatus, string> = {
  TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked',
  WAITING_APPROVAL: 'Needs approval', APPROVED: 'Approved', REJECTED: 'Rejected',
  COMPLETED: 'Completed', FAILED: 'Failed',
}
const roleNames: Record<Role, string> = {
  ADMIN: 'Administrator', OPERATOR: 'Operator', APPROVER: 'Approver', VIEWER: 'Viewer',
}
const allRoles: Role[] = ['ADMIN', 'OPERATOR', 'APPROVER', 'VIEWER']
const taskKinds: TaskKind[] = ['GATHER', 'ANALYZE', 'RECOMMEND', 'APPROVAL', 'ACTION', 'MONITOR']
const draftStatus: WorkflowStatus = 'CREATED'
type WorkspaceView = 'admin-dashboard' | 'pending-requests' | 'approved-tenants' | 'command' | 'assistant' | 'workflows' | 'tasks' | 'approvals' | 'finance' | 'support' | 'documents' | 'communications' | 'analytics' | 'audit'
type WorkflowFilter = 'ALL' | 'RUNNING' | 'WAITING' | 'FAILED' | 'ESCALATED' | 'COMPLETED' | 'CANCELLED'
const rememberedToken = localStorage.getItem('kaiten.accessToken')
const sessionToken = sessionStorage.getItem('kaiten.accessToken')

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function matchesWorkflowFilter(status: WorkflowStatus, filter: WorkflowFilter) {
  if (filter === 'ALL') return true
  if (filter === 'COMPLETED') return status === 'RESOLVED'
  if (filter === 'CANCELLED') return status === 'CANCELLED'
  if (filter === 'FAILED') return status === 'FAILED'
  if (filter === 'ESCALATED') return status === 'REPLANNING'
  if (filter === 'WAITING') return ['CREATED', 'WAITING_APPROVAL', 'WAITING_FOR_INPUT'].includes(status)
  return !['CREATED', 'WAITING_APPROVAL', 'WAITING_FOR_INPUT', 'FAILED', 'RESOLVED', 'CANCELLED'].includes(status)
}

function visibleCountForFilter(workflows: Workflow[], filter: WorkflowFilter) {
  return workflows.filter((workflow) => matchesWorkflowFilter(workflow.status, filter)).length
}

function Workspace() {
  const [token, setToken] = useState(() => rememberedToken ?? sessionToken)
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(rememberedToken || sessionToken))
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<WorkflowTask[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [team, setTeam] = useState<User[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<'workflow' | 'task' | 'users' | 'simulate' | null>(null)
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
  const [editingTask, setEditingTask] = useState<WorkflowTask | null>(null)
  const [activeView, setActiveView] = useState<WorkspaceView>('command')
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowFilter>('ALL')
  const [slaBreachedCount, setSlaBreachedCount] = useState(0)

  const canOperate = user?.role === 'ADMIN' || user?.role === 'OPERATOR'
  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? null

  useEffect(() => {
    if (!token) return
    setAccessToken(token)
    getCurrentUser().then((currentUser) => {
      setUser(currentUser)
      if (currentUser.role === 'ADMIN') setActiveView('admin-dashboard')
    }).catch(() => {
      sessionStorage.removeItem('kaiten.accessToken')
      localStorage.removeItem('kaiten.accessToken')
      setAccessToken(null)
      setToken(null)
    }).finally(() => setAuthLoading(false))
  }, [token])

  useEffect(() => {
    if (!token || !user) return
    let active = true
    Promise.all([listWorkflows(), listTickets({ sla_breached: true }), listTeam()]).then(([items, breachedTickets, teamMembers]) => {
      if (!active) return
      setWorkflows(items)
      setSlaBreachedCount(breachedTickets.length)
      setTeam(teamMembers)
      setError(null)
      setSelectedId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null)
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load workflows.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, user])

  useEffect(() => {
    if (!token || !user || !selectedId) return
    let active = true
    Promise.all([listTasks(selectedId), getWorkflowAudit(selectedId)]).then(([nextTasks, nextAudit]) => {
      if (!active) return
      setTasks(nextTasks)
      setAudit(nextAudit)
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load workflow details.')
    })
    return () => { active = false }
  }, [selectedId, token, user])

  function signOut() {
    sessionStorage.removeItem('kaiten.accessToken')
    localStorage.removeItem('kaiten.accessToken')
    setAccessToken(null)
    setToken(null)
    setUser(null)
    setWorkflows([])
    setSelectedId(null)
    setTasks([])
    setAudit([])
  }

  function establishSession(session: AuthSession, rememberMe: boolean) {
    sessionStorage.removeItem('kaiten.accessToken')
    localStorage.removeItem('kaiten.accessToken')
    if (rememberMe) localStorage.setItem('kaiten.accessToken', session.access_token)
    else sessionStorage.setItem('kaiten.accessToken', session.access_token)
    setAccessToken(session.access_token)
    setToken(session.access_token)
    setUser(session.user)
    if (session.user.role === 'ADMIN') setActiveView('admin-dashboard')
    setLoading(true)
    setError(null)
  }

  async function refreshDetails(workflowId = selectedId) {
    if (!workflowId) return
    const [nextTasks, nextAudit, nextWorkflows] = await Promise.all([
      listTasks(workflowId), getWorkflowAudit(workflowId), listWorkflows(),
    ])
    setTasks(nextTasks)
    setAudit(nextAudit)
    setWorkflows(nextWorkflows)
  }

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refreshDetails()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The requested action failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleWorkflowSave(objective: string) {
    if (editingWorkflow) {
      const updated = await updateWorkflow(editingWorkflow.id, objective)
      setWorkflows((items) => items.map((item) => item.id === updated.id ? updated : item))
    } else {
      const created = await createWorkflow(objective)
      setWorkflows((items) => [created, ...items])
      setSelectedId(created.id)
    }
    setEditingWorkflow(null)
    setModal(null)
  }

  async function handleCommandCreate(objective: string) {
    setBusy(true)
    setError(null)
    try {
      const created = await createWorkflow(objective)
      let finalWorkflow = created
      try {
        finalWorkflow = await startWorkflow(created.id)
      } catch {
        // If auto-start planner has no matching template, keep created draft
      }
      setWorkflows((items) => [finalWorkflow, ...items])
      setSelectedId(finalWorkflow.id)
      setActiveView('workflows')
      const [nextTasks, nextAudit] = await Promise.all([
        listTasks(finalWorkflow.id),
        getWorkflowAudit(finalWorkflow.id),
      ])
      setTasks(nextTasks)
      setAudit(nextAudit)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create workflow.')
    } finally { setBusy(false) }
  }

  async function handleTaskSave(payload: { title: string; description: string; kind: TaskKind; source: string | null; priority: TaskPriority; assigned_to_id: string | null; due_at: string | null }) {
    if (!selected) return
    if (editingTask) await updateTask(editingTask.id, payload)
    else await createTask(selected.id, payload)
    setEditingTask(null)
    setModal(null)
    await refreshDetails()
  }

  async function handleUsersChanged(nextUsers: User[]) {
    setUsers(nextUsers)
  }

  if (authLoading) return <div className="auth-loading"><LoaderCircle className="spin" size={22} /><span>Checking your session</span></div>
  if (!user || !token) return <AuthGate onAuthenticated={establishSession} />

  const visibleWorkflows = workflows.filter((item) => {
    const matchesQuery = item.objective.toLowerCase().includes(query.toLowerCase().trim())
    return matchesQuery && matchesWorkflowFilter(item.status, workflowFilter)
  })
  const activeCount = workflows.filter((item) => !['RESOLVED', 'CANCELLED'].includes(item.status)).length
  const approvalCount = workflows.filter((item) => item.status === 'WAITING_APPROVAL').length
  const resolvedCount = workflows.filter((item) => item.status === 'RESOLVED').length
  const recordsView = activeView === 'finance' || activeView === 'support' || activeView === 'documents' || activeView === 'communications'
  const recordTab: RecordTab = activeView === 'support' ? 'tickets' : activeView === 'documents' ? 'contracts' : activeView === 'communications' ? 'communications' : 'invoices'
  const operationsPage: OperationsPage | null = activeView === 'tasks' || activeView === 'approvals' || activeView === 'audit' || activeView === 'analytics' ? activeView : null
  const adminPage: AdminPage | null = activeView === 'admin-dashboard' || activeView === 'pending-requests' || activeView === 'approved-tenants' ? activeView : null
  const viewTitles: Record<WorkspaceView, string> = {
    'admin-dashboard': 'Admin Dashboard', 'pending-requests': 'Pending Requests', 'approved-tenants': 'Approved Tenants',
    command: 'Command Center', assistant: 'AI Command', workflows: 'Workflows',
    tasks: 'Tasks', approvals: 'Approvals', finance: 'Finance', support: 'Support',
    documents: 'Documents & Data Sources', communications: 'Communications',
    analytics: 'Analytics', audit: 'Audit & Activity',
  }
  const navigationGroups: { label: string; items: { view: WorkspaceView; label: string; icon: ReactNode; count?: number }[] }[] = [
    { label: 'OPERATIONS', items: [
      { view: 'command' as const, label: 'Command Center', icon: <Activity size={16} /> },
      { view: 'assistant' as const, label: 'AI Command', icon: <Bot size={16} /> },
      { view: 'workflows' as const, label: 'Workflows', icon: <Layers3 size={16} />, count: workflows.length },
      { view: 'tasks' as const, label: 'Tasks', icon: <ListTodo size={16} /> },
      { view: 'approvals' as const, label: 'Approvals', icon: <ShieldCheck size={16} />, count: approvalCount },
    ] },
    { label: 'BUSINESS', items: [
      { view: 'finance' as const, label: 'Finance', icon: <FilePlus2 size={16} /> },
      { view: 'support' as const, label: 'Support', icon: <Headphones size={16} />, count: slaBreachedCount },
    ] },
    { label: 'RESOURCES', items: [
      { view: 'documents' as const, label: 'Documents', icon: <FileText size={16} /> },
      { view: 'communications' as const, label: 'Communications', icon: <Activity size={16} /> },
    ] },
    { label: 'INTELLIGENCE', items: [
      { view: 'analytics' as const, label: 'Analytics', icon: <BarChart3 size={16} /> },
    ] },
    { label: 'SYSTEM', items: [
      { view: 'audit' as const, label: 'Audit & Activity', icon: <ScrollText size={16} /> },
    ] },
  ]
  const sidebarGroups: { label: string; items: { view: WorkspaceView; label: string; icon: ReactNode; count?: number }[] }[] = user.role === 'ADMIN'
    ? [{ label: 'TENANT ADMIN', items: [
      { view: 'admin-dashboard' as const, label: 'Admin Dashboard', icon: <ShieldCheck size={16} /> },
      { view: 'pending-requests' as const, label: 'Pending Requests', icon: <Clock3 size={16} /> },
      { view: 'approved-tenants' as const, label: 'Approved Tenants', icon: <Users size={16} /> },
    ] }, ...navigationGroups]
    : navigationGroups

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Kaiten overview"><span className="brand-mark"><Layers3 size={18} /></span><span>kaiten<span className="brand-period">.</span></span></a>
        <div className="workspace-label">SIGNED IN AS</div>
        <div className="workspace-switcher"><span className="workspace-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.company}</small></span></div>
        <nav className="side-nav" aria-label="Main navigation">{sidebarGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-caption">{group.label}</span>{group.items.map((item) => <button className={`nav-item nav-button ${activeView === item.view ? 'active' : ''}`} key={item.view} onClick={() => setActiveView(item.view)} type="button">{item.icon}{item.label}{item.count !== undefined && <span className="nav-count">{item.count}</span>}</button>)}</div>)}{user.role === 'ADMIN' && <div className="nav-group"><span className="nav-caption">ADMIN</span><button className="nav-item nav-button" onClick={() => { setError(null); setModal('users'); void listUsers().then(setUsers).catch((cause) => setError(cause.message)) }} type="button"><Users size={16} />People</button></div>}</nav>
        <div className="sidebar-bottom"><div className="side-status"><span className="status-pip" />Signed in · {roleNames[user.role]}</div><button className="signout-button" onClick={signOut} type="button"><LogOut size={14} />Sign out</button></div>
      </aside>

      <main className="main-area" id="overview">
        <header className="topbar"><div className="breadcrumbs"><span>{user.name}</span><span className="crumb-divider">/</span><strong>{viewTitles[activeView]}</strong></div><div className="topbar-actions"><span className="role-chip">{roleNames[user.role]}</span><span className="user-avatar" title={user.email}>{user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><button className="topbar-signout" onClick={signOut} type="button" aria-label="Sign out"><LogOut size={15} /></button></div></header>
        <div className="page-content">
          {error && <div className="notice notice-error" role="alert"><CircleAlert size={17} /><span>{error}</span><button className="icon-button" onClick={() => setError(null)} type="button" aria-label="Dismiss error"><X size={15} /></button></div>}
          {adminPage ? <AdminView key={adminPage} page={adminPage} onNavigate={setActiveView} />
            : recordsView ? <RecordCenter key={activeView} title={viewTitles[activeView]} user={user} initialTab={recordTab} onError={setError} />
            : operationsPage ? <OperationsView key={operationsPage} page={operationsPage} user={user} />
              : activeView === 'assistant' ? <BusinessCommand busy={busy} writable={canOperate} onCreate={handleCommandCreate} /> : <>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{activeView === 'command' ? 'BUSINESS OPERATIONS' : 'WORKSPACE'}</div><h1>{activeView === 'command' ? 'Command Center' : 'Workflows'}<span className="heading-comma">.</span></h1><p className="page-subtitle">{activeView === 'command' ? 'Active workflows, approvals, and support SLA risks across your workspace.' : 'Browse plans, execution state, and workflow audit history.'}</p></div>{canOperate && <div className="heading-actions-row"><button className="secondary-button sim-btn" onClick={() => setModal('simulate')} type="button"><Sparkles size={15} />Simulate Plan</button><button className="primary-button" onClick={() => { setEditingWorkflow(selected); setModal('workflow') }} type="button"><FilePlus2 size={16} />New workflow</button></div>}</section>

          {activeView === 'command' && <section className="metrics" aria-label="Command center summary"><Metric label="Active workflows" value={activeCount} hint="Not yet resolved" icon={<Activity size={16} />} tone="mint" /><Metric label="Awaiting approval" value={approvalCount} hint="Approver action" icon={<ShieldCheck size={16} />} tone="amber" /><Metric label="Resolved" value={resolvedCount} hint="Completed workflows" icon={<Check size={16} />} tone="blue" /><Metric label="SLA breached" value={slaBreachedCount} hint="Support tickets overdue" icon={<CircleAlert size={16} />} tone="rose" /></section>}

          {activeView === 'workflows' && <div className="workflow-filters" role="tablist" aria-label="Filter workflows">{([{ id: 'ALL', label: 'All' }, { id: 'RUNNING', label: 'Running' }, { id: 'WAITING', label: 'Waiting' }, { id: 'FAILED', label: 'Failed' }, { id: 'ESCALATED', label: 'Escalated' }, { id: 'COMPLETED', label: 'Completed' }, { id: 'CANCELLED', label: 'Cancelled' }] as { id: WorkflowFilter; label: string }[]).map((item) => <button aria-selected={workflowFilter === item.id} className={workflowFilter === item.id ? 'workflow-filter active' : 'workflow-filter'} key={item.id} onClick={() => setWorkflowFilter(item.id)} role="tab" type="button">{item.label}<span>{item.id === 'ALL' ? workflows.length : visibleCountForFilter(workflows, item.id)}</span></button>)}</div>}

          <section className="work-area">
            <div className="workflow-panel" id="workflow-list"><div className="panel-heading"><div><div className="section-kicker">YOUR WORK QUEUE</div><h2>Workflows <span className="heading-count">{workflows.length}</span></h2></div><div className="list-controls"><label className="search-field"><Search size={14} /><input aria-label="Search workflows" placeholder="Search objectives" onChange={(event) => setQuery(event.target.value)} value={query} /></label><button className="icon-button" onClick={() => { setLoading(true); void listWorkflows().then(setWorkflows).catch((cause) => setError(cause.message)).finally(() => setLoading(false)) }} type="button" aria-label="Refresh workflows"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></div></div>
              {loading && workflows.length === 0 ? <div className="list-state"><LoaderCircle size={20} className="spin" /><span>Loading workflows</span></div> : visibleWorkflows.length === 0 ? <div className="empty-state"><div className="empty-symbol"><Layers3 size={21} /></div><strong>{query ? 'No matching workflows' : 'No workflows yet'}</strong><p>{query ? 'Try another objective.' : 'Create a business objective to start a tracked workflow.'}</p>{!query && canOperate && <button className="text-button" onClick={() => setModal('workflow')} type="button">Create workflow <ArrowRight size={14} /></button>}</div> : <div className="table-wrap"><table><thead><tr><th>OBJECTIVE</th><th>STATUS</th><th>CREATED</th><th /></tr></thead><tbody>{visibleWorkflows.map((workflow) => <tr key={workflow.id} className={selectedId === workflow.id ? 'selected-row' : ''} onClick={() => setSelectedId(workflow.id)}><td><button className="objective-link" onClick={() => setSelectedId(workflow.id)} type="button">{workflow.objective}</button><span className="workflow-id">{workflow.id.slice(0, 8).toUpperCase()}</span></td><td><StatusBadge status={workflow.status} /></td><td className="date-cell">{dateLabel(workflow.created_at)}</td><td className="row-action-cell">{canOperate && workflow.status === 'CREATED' ? <button className="row-action start-action" disabled={busy} onClick={(event) => { event.stopPropagation(); void runAction(() => startWorkflow(workflow.id)) }} type="button">Build plan <ArrowRight size={13} /></button> : canOperate && !['RESOLVED', 'CANCELLED'].includes(workflow.status) ? <button className="row-action" disabled={busy} onClick={(event) => { event.stopPropagation(); void runAction(() => cancelWorkflow(workflow.id)) }} type="button">Cancel</button> : null}</td></tr>)}</tbody></table></div>}
              <div className="panel-footer"><span>{visibleWorkflows.length} of {workflows.length} workflows</span><span className="footer-live"><span className="status-pip" />DATABASE CONNECTED</span></div>
            </div>

            <aside className="detail-column"><section className="detail-panel"><div className="detail-heading"><div><div className="section-kicker">PERSISTED WORKFLOW PLAN</div><h2>Steps & activity</h2></div>{selected && canOperate && selected.status === draftStatus && <div className="detail-actions"><button className="icon-button" title="Edit workflow objective" onClick={() => { setEditingWorkflow(selected); setModal('workflow') }} type="button" aria-label="Edit workflow objective"><Pencil size={14} /></button><button className="icon-button danger-icon" title="Delete draft workflow" onClick={() => { if (window.confirm('Delete this draft workflow?')) void runAction(() => deleteWorkflow(selected.id)).then(() => { setWorkflows((items) => items.filter((item) => item.id !== selected.id)); setSelectedId(null) }) }} type="button" aria-label="Delete draft workflow"><Trash2 size={14} /></button></div>}</div>
              {selected ? <><div className="selected-summary"><StatusBadge status={selected.status} /><p>{selected.objective}</p><span className="detail-created">Created {dateLabel(selected.created_at)}</span>{canOperate && selected.status === 'CREATED' && <button className="text-button start-plan-button" onClick={() => void runAction(() => startWorkflow(selected.id))} type="button">Generate step plan <ArrowRight size={14} /></button>}{canOperate && selected.status === 'WAITING_FOR_INPUT' && <button className="text-button start-plan-button" onClick={() => void runAction(() => resumeWorkflow(selected.id))} type="button">Recheck business records <RefreshCw size={13} /></button>}{canOperate && !['RESOLVED', 'CANCELLED', 'CREATED'].includes(selected.status) && <button className="text-button start-plan-button replan-trigger-btn" disabled={busy} onClick={() => void runAction(() => replanWorkflow(selected.id))} type="button"><Zap size={13} />Re-evaluate State (Dynamic Replanner)</button>}</div>
                {tasks.length > 0 && <div className="plan-list"><div className="plan-list-heading"><span>EXECUTION PLAN</span><span>{tasks.filter((task) => task.status === 'COMPLETED').length}/{tasks.length} DONE</span></div>{tasks.map((task) => <TaskRow key={task.id} task={task} user={user} team={team} busy={busy} canEdit={selected.status === 'CREATED'} canComplete={!['CREATED', 'WAITING_FOR_INPUT', 'RESOLVED', 'CANCELLED'].includes(selected.status) && (!task.assigned_to_id || task.assigned_to_id === user.id || user.role === 'ADMIN')} onComplete={() => void runAction(() => completeTask(task.id))} onApprove={() => void runAction(() => approveTask(task.id))} onReject={() => void runAction(() => rejectTask(task.id))} onEdit={() => { setEditingTask(task); setModal('task') }} onDelete={() => { if (window.confirm('Delete this task?')) void runAction(() => deleteTask(task.id)) }} />)}</div>}
                {canOperate && selected.status === 'CREATED' && <button className="add-step-button" onClick={() => { setEditingTask(null); setModal('task') }} type="button"><Plus size={14} />Add workflow step</button>}
                <div className="activity-list audit-list"><div className="plan-list-heading"><span>AUDIT TRAIL</span><span>{audit.length} EVENTS</span></div>{audit.length ? audit.map((event) => <AuditItem event={event} key={event.id} />) : <div className="activity-empty"><Clock3 size={16} /><span>No events recorded.</span></div>}</div></> : <div className="activity-empty no-selection"><Layers3 size={18} /><span>Select a workflow to inspect its plan and audit history.</span></div>}
            </section><section className="guardrail-note"><span className="guardrail-icon"><ShieldCheck size={16} /></span><div><strong>Approval is enforced by the API</strong><p>Only approver and admin roles can authorize external actions.</p></div></section></aside>
          </section>
          <footer className="page-footer"><span>KAITEN WORKFLOW CONSOLE</span><span>ACCOUNT: {user.email.toUpperCase()} <span className="footer-dot">·</span> {roleNames[user.role].toUpperCase()}</span></footer>
          </>}
        </div>
      </main>

      {modal === 'workflow' && <WorkflowDialog initial={editingWorkflow?.objective ?? ''} busy={busy} onClose={() => { setModal(null); setEditingWorkflow(null) }} onSave={handleWorkflowSave} />}
      {modal === 'task' && <TaskDialog initial={editingTask} team={team} busy={busy} onClose={() => { setModal(null); setEditingTask(null) }} onSave={handleTaskSave} />}
      {modal === 'users' && user.role === 'ADMIN' && <PeopleDialog users={users} companyName={user.company} onClose={() => setModal(null)} onError={setError} onReset={setResetTarget} onUsersChange={handleUsersChanged} />}
      {modal === 'simulate' && <SimulationDialog onClose={() => setModal(null)} onCreate={handleCommandCreate} />}
      {resetTarget && <PasswordResetDialog user={resetTarget} onClose={() => setResetTarget(null)} onSave={async (password) => { await updateUser(resetTarget.id, { password }); setResetTarget(null) }} />}
    </div>
  )
}

function SimulationDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (objective: string) => Promise<void> }) {
  const [objective, setObjective] = useState('Find overdue invoices above INR 100,000, analyze customer history, contact customers, and escalate high-value cases.')
  const [result, setResult] = useState<SimulationResponse | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSimulate() {
    setLoading(true)
    try {
      const res = await simulateWorkflow(objective)
      setResult(res)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="create-dialog workspace-dialog sim-modal" role="dialog" aria-modal="true" aria-label="Workflow Dry-Run Simulator">
        <div className="dialog-top">
          <div className="dialog-icon"><Sparkles size={18} /></div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close dialog"><X size={16} /></button>
        </div>
        <div className="section-kicker">WORKFLOW SIMULATOR</div>
        <h2 style={{ fontSize: '22px', color: '#1e293b', marginTop: '4px', marginBottom: '14px' }}>Workflow Dry-Run Simulator</h2>
        <div className="workspace-dialog-content">
          <label className="form-label" htmlFor="sim-objective-input" style={{ fontWeight: 700, color: '#334155', display: 'block', marginBottom: '6px' }}>BUSINESS OBJECTIVE TO SIMULATE</label>
          <textarea id="sim-objective-input" className="dialog-textarea" onChange={(e) => setObjective(e.target.value)} value={objective} rows={3} style={{ width: '100%', minHeight: '80px', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '11px', color: '#0f172a', background: '#ffffff', boxSizing: 'border-box' }} />
          <div className="sim-actions-bar" style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="primary-button sim-run-btn" disabled={loading} onClick={handleSimulate} type="button">
              {loading ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Run Dry-Run Simulation
            </button>
          </div>

          {result && (
            <div className="sim-results-panel">
              <div className="sim-summary-row">
                <span className="sim-pill">Domain: <strong>{result.domain}</strong></span>
                <span className="sim-pill">Est. Time: <strong>{result.estimated_duration}</strong></span>
                <span className="sim-pill">Approvals: <strong>{result.approvals_required}</strong></span>
              </div>

              {result.potential_risks.length > 0 && (
                <div className="sim-risks-box">
                  <strong>POTENTIAL RISKS & AUDIT CLAUSES:</strong>
                  {result.potential_risks.map((r, i) => <div key={i}>{r}</div>)}
                </div>
              )}

              <div className="sim-steps-list">
                <strong>PLANNED EXECUTION STEPS ({result.expected_steps.length}):</strong>
                {result.expected_steps.map((s, idx) => (
                  <div className="sim-step-item" key={idx}>
                    <span className="step-num">{idx + 1}</span>
                    <div className="step-details">
                      <strong>{s.title}</strong>
                      <small>{s.description} · {s.estimated_duration}</small>
                    </div>
                    {s.requires_approval && <span className="approval-tag">APPROVAL REQUIRED</span>}
                  </div>
                ))}
              </div>

              <div className="sim-run-footer">
                <button className="primary-button" onClick={() => { void onCreate(objective); onClose(); }} type="button">
                  Create Real Workflow <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function BusinessCommand({ busy, writable, onCreate }: { busy: boolean; writable: boolean; onCreate: (objective: string) => Promise<void> }) {
  const [objective, setObjective] = useState('')
  const templates = [
    'Find overdue invoices above INR 100,000, analyze customer history, contact customers, and escalate high-value cases.',
    'Find unresolved high-priority support tickets older than 24 hours and escalate them.',
  ]
  return <main className="business-command-page">
    <header className="operations-heading"><div><div className="eyebrow"><span className="eyebrow-line" />BUSINESS COMMAND</div><h1>What needs to move?<span className="heading-comma">.</span></h1><p className="page-subtitle">Describe the outcome; Kaiten will build a workflow from supported business templates.</p></div><span className="role-chip">{writable ? 'OBJECTIVE INPUT' : 'READ ONLY'}</span></header>
    <section className="command-composer"><form onSubmit={(event) => { event.preventDefault(); if (objective.trim()) void onCreate(objective.trim()) }}><label className="objective-label" htmlFor="business-objective">BUSINESS OBJECTIVE</label><textarea id="business-objective" autoFocus maxLength={2000} onChange={(event) => setObjective(event.target.value)} placeholder="Find overdue invoices above INR 100,000, review customer history, and recommend the next action." value={objective} /><div className="command-composer-footer"><span>{objective.length}/2000</span><button className="primary-button" disabled={!writable || busy || !objective.trim()} type="submit">{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}{busy ? 'Creating...' : 'Create workflow'}</button></div></form></section>
    <section className="command-templates"><div className="section-kicker">START WITH A WORKFLOW</div><div className="command-template-list">{templates.map((template) => <button className="command-template" key={template} onClick={() => setObjective(template)} type="button"><span>{template.includes('invoice') ? 'FINANCE' : 'SUPPORT'}</span><strong>{template.includes('invoice') ? 'Invoice recovery' : 'Support SLA escalation'}</strong><ArrowRight size={14} /></button>)}</div></section>
    <div className="command-capability-note"><ShieldCheck size={16} /><span>Current planners support invoice recovery and Support SLA escalation. Other objectives are saved as workflows but remain paused until a matching planner is available.</span></div>
  </main>
}

function AuthGate({ onAuthenticated }: { onAuthenticated: (session: AuthSession, rememberMe: boolean) => void }) {
  type AuthMode = 'login' | 'admin-login' | 'bootstrap' | 'register' | 'admin-register'
  const [mode, setMode] = useState<AuthMode>(() => {
    const query = new URLSearchParams(window.location.search)
    return query.get('admin-register') === '1' ? 'admin-register' : query.get('admin-login') === '1' ? 'admin-login' : query.get('register') === '1' ? 'register' : 'login'
  })
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adminRegistrationAvailable, setAdminRegistrationAvailable] = useState(false)
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname)

  useEffect(() => {
    let active = true
    getAdminRegistrationStatus().then(({ available }) => {
      if (active) setAdminRegistrationAvailable(available)
    }).catch(() => {
      if (active) setAdminRegistrationAvailable(false)
    })
    return () => { active = false }
  }, [])

  function changeMode(nextMode: AuthMode) {
    const url = new URL(window.location.href)
    url.searchParams.delete('register')
    url.searchParams.delete('admin-register')
    url.searchParams.delete('admin-login')
    if (nextMode === 'register') url.searchParams.set('register', '1')
    if (nextMode === 'admin-register') url.searchParams.set('admin-register', '1')
    if (nextMode === 'admin-login') url.searchParams.set('admin-login', '1')
    window.history.pushState({}, '', url)
    setMode(nextMode)
    setError(null)
    setSuccess(null)
  }

  useEffect(() => {
    const syncModeFromUrl = () => {
      const query = new URLSearchParams(window.location.search)
      setMode(query.get('admin-register') === '1' ? 'admin-register' : query.get('admin-login') === '1' ? 'admin-login' : query.get('register') === '1' ? 'register' : 'login')
      setError(null)
      setSuccess(null)
    }
    window.addEventListener('popstate', syncModeFromUrl)
    return () => window.removeEventListener('popstate', syncModeFromUrl)
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      if (mode === 'register') {
        const response = await registerUser({ name, company, email, password })
        setPassword('')
        changeMode('login')
        setSuccess(response.detail)
        return
      }
      if (mode === 'admin-register') {
        const session = await registerAdmin({ name, company, email, password })
        onAuthenticated(session, rememberMe)
        return
      }
      const session = mode === 'bootstrap'
        ? await bootstrapAdmin({ name, company, email, password })
        : await login(email, password)
      if (mode === 'admin-login' && session.user.role !== 'ADMIN') {
        throw new Error('This sign-in is for workspace administrators.')
      }
      onAuthenticated(session, rememberMe)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

    return <main className="auth-page">
      <div className="auth-art">
        <div className="auth-brand"><span className="brand-mark"><Layers3 size={19} /></span>kaiten<span className="brand-period">.</span></div>
        <div className="auth-art-copy"><span className="auth-overline">BUSINESS WORKFLOW AUTOMATION</span><h1>Keep work moving.<br /><em>Keep every step visible.</em></h1><p>From an objective to an approved action, with a record of what happened and why.</p></div>
        <div className="auth-art-foot">MULTI-STEP WORKFLOWS <span>·</span> HUMAN APPROVAL <span>·</span> AUDITABLE ACTIONS</div>
      </div>
      <div className="auth-form-side">
        <button className="auth-corner-button" onClick={() => changeMode(mode === 'admin-login' ? 'login' : 'admin-login')} type="button">{mode === 'admin-login' ? 'Back to sign in' : 'Admin login'}</button>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <div className="auth-mobile-brand"><span className="brand-mark"><Layers3 size={18} /></span> kaiten</div>
          <div className="section-kicker">SECURE WORKSPACE</div>
          <h2>{mode === 'bootstrap' ? 'Set up your workspace' : mode === 'admin-register' ? 'Register administrator' : mode === 'register' ? 'Request workspace access' : mode === 'admin-login' ? 'Administrator sign in' : 'Welcome back'}</h2>
          <p className="auth-description">{mode === 'bootstrap' ? 'Create the first administrator account to initialize role-based access.' : mode === 'admin-register' ? 'Register the workspace administrator. This one-time registration is immediately active.' : mode === 'register' ? 'Create an account request. A workspace administrator must activate it before you can sign in.' : mode === 'admin-login' ? 'Sign in with your workspace administrator account to review tenant requests.' : 'Sign in to manage your workflows and approvals.'}</p>
          {error && <div className="auth-error" role="alert"><CircleAlert size={16} />{error}</div>}
          {success && <div className="auth-success" role="status">{success}</div>}
      {(mode === 'bootstrap' || mode === 'register' || mode === 'admin-register') && <label>Full name<input autoComplete="name" onChange={(event) => setName(event.target.value)} required value={name} /></label>}
      {(mode === 'bootstrap' || mode === 'register' || mode === 'admin-register') && <label>Company<input autoComplete="organization" onChange={(event) => setCompany(event.target.value)} required value={company} /></label>}
      <label>Work email<input autoComplete="username" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
      <label>Password<input autoComplete={mode === 'login' || mode === 'admin-login' ? 'current-password' : 'new-password'} minLength={mode === 'login' || mode === 'admin-login' ? undefined : 8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />{(mode === 'bootstrap' || mode === 'admin-register') && <small>At least 8 characters. This one-time admin account is active immediately.</small>}{mode === 'register' && <small>At least 8 characters. Access is pending admin approval.</small>}</label>
      {(mode === 'login' || mode === 'admin-login') && <div className="auth-options"><label className="remember-me"><input checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" />Remember me</label><span>Forgot password? Ask a workspace admin to reset it in People.</span></div>}
      {mode === 'login' && <a className="owner-register-link" href="?register=1">Request user access</a>}
      <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : mode === 'bootstrap' || mode === 'admin-register' ? <ShieldCheck size={16} /> : mode === 'register' ? <Users size={16} /> : <ArrowRight size={16} />}{mode === 'bootstrap' || mode === 'admin-register' ? 'Create administrator' : mode === 'register' ? 'Request workspace access' : mode === 'admin-login' ? 'Admin sign in' : 'Sign in'}</button>
      {(mode === 'login' || mode === 'admin-login') && adminRegistrationAvailable && <button className="auth-mode-button" onClick={() => changeMode('admin-register')} type="button">Register the first administrator</button>}
      {mode === 'login' && isLocalHost && <button className="auth-mode-button" onClick={() => changeMode('bootstrap')} type="button">First-time setup</button>}
    </form><div className="auth-security"><ShieldCheck size={14} />Roles are enforced by the API, not only by the interface.</div></div></main>
}

function WorkflowDialog({ initial, busy, onClose, onSave }: { initial: string; busy: boolean; onClose: () => void; onSave: (objective: string) => Promise<void> }) {
  const [objective, setObjective] = useState(initial)
  return <Dialog title={initial ? 'Edit workflow objective' : 'Create a workflow'} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); void onSave(objective.trim()) }}><label className="form-label" htmlFor="workflow-objective">BUSINESS OBJECTIVE</label><textarea autoFocus className="dialog-textarea" id="workflow-objective" maxLength={2000} onChange={(event) => setObjective(event.target.value)} placeholder="Find overdue invoices above INR 100,000, analyze customer history, and prepare a follow-up." required value={objective} /><div className="dialog-footer"><span>{objective.length}/2000</span><button className="primary-button" disabled={busy || !objective.trim()} type="submit">{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{initial ? 'Save changes' : 'Create workflow'}</button></div></form></Dialog>
}

function localDateTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function TaskDialog({ initial, team, busy, onClose, onSave }: { initial: WorkflowTask | null; team: User[]; busy: boolean; onClose: () => void; onSave: (task: { title: string; description: string; kind: TaskKind; source: string | null; priority: TaskPriority; assigned_to_id: string | null; due_at: string | null }) => Promise<void> }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [kind, setKind] = useState<TaskKind>(initial?.kind ?? 'GATHER')
  const [source, setSource] = useState(initial?.source ?? '')
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'MEDIUM')
  const [assignee, setAssignee] = useState(initial?.assigned_to_id ?? '')
  const [dueAt, setDueAt] = useState(localDateTime(initial?.due_at ?? null))
  return <Dialog title={initial ? 'Edit workflow step' : 'Add workflow step'} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); void onSave({ title: title.trim(), description: description.trim(), kind, source: source.trim() || null, priority, assigned_to_id: assignee || null, due_at: dueAt ? new Date(dueAt).toISOString() : null }) }}><label className="form-label" htmlFor="task-title">STEP NAME</label><input className="dialog-input" id="task-title" maxLength={240} onChange={(event) => setTitle(event.target.value)} required value={title} /><label className="form-label" htmlFor="task-description">DESCRIPTION</label><textarea className="dialog-textarea compact-textarea" id="task-description" maxLength={2000} onChange={(event) => setDescription(event.target.value)} value={description} /><div className="form-grid"><label className="form-label">STEP TYPE<select className="dialog-input" onChange={(event) => setKind(event.target.value as TaskKind)} value={kind}>{taskKinds.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="form-label">PRIORITY<select className="dialog-input" onChange={(event) => setPriority(event.target.value as TaskPriority)} value={priority}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option></select></label></div><div className="form-grid"><label className="form-label">ASSIGNED TO<select className="dialog-input" onChange={(event) => setAssignee(event.target.value)} value={assignee}><option value="">Unassigned</option>{team.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label><label className="form-label">DEADLINE<input className="dialog-input" onChange={(event) => setDueAt(event.target.value)} type="datetime-local" value={dueAt} /></label></div><label className="form-label">DATA SOURCE<input className="dialog-input" maxLength={120} onChange={(event) => setSource(event.target.value)} placeholder="Optional" value={source} /></label><div className="dialog-footer"><span>Order is set when saved</span><button className="primary-button" disabled={busy || !title.trim()} type="submit">{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{initial ? 'Save step' : 'Add step'}</button></div></form></Dialog>
}

function PeopleDialog({ users, companyName, onClose, onError, onReset, onUsersChange }: { users: User[]; companyName: string; onClose: () => void; onError: (error: string) => void; onReset: (user: User) => void; onUsersChange: (users: User[]) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('OPERATOR')
  const [busy, setBusy] = useState(false)

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      const created = await createUser({ name, company: companyName, email, password, role })
      onUsersChange([...users, created])
      setName(''); setEmail(''); setPassword(''); setRole('OPERATOR')
      onError('')
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not create user.') }
    finally { setBusy(false) }
  }

  async function changeRole(target: User, nextRole: Role) {
    try {
      const updated = await updateUser(target.id, { role: nextRole })
      onUsersChange(users.map((item) => item.id === updated.id ? updated : item))
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not update role.') }
  }

  async function toggleActive(target: User) {
    try {
      const updated = await updateUser(target.id, { is_active: !target.is_active })
      onUsersChange(users.map((item) => item.id === updated.id ? updated : item))
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not update account.') }
  }

  async function removeUser(target: User) {
    if (!window.confirm(`Remove ${target.name} from this workspace?`)) return
    try {
      await deleteUser(target.id)
      onUsersChange(users.filter((item) => item.id !== target.id))
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not delete account.') }
  }

  return <Dialog title="Workspace access" onClose={onClose} wide><div className="people-layout"><section className="people-list"><div className="people-list-heading"><span>{users.length} ACCOUNTS</span><span>ROLE ACCESS</span></div>{users.map((person) => <article className="person-row" key={person.id}><span className="person-avatar">{person.name.slice(0, 1).toUpperCase()}</span><div className="person-details"><strong>{person.name}</strong><small>{person.email}</small><span className="person-company">{person.company}</span><span className={person.is_active ? 'account-state enabled' : 'account-state'}>{person.is_active ? 'Active' : 'Disabled'}</span></div><select aria-label={`Role for ${person.name}`} className="role-select" disabled={!person.is_active} onChange={(event) => void changeRole(person, event.target.value as Role)} value={person.role}>{allRoles.map((item) => <option key={item} value={item}>{roleNames[item]}</option>)}</select><button className="icon-button" aria-label={`Reset password for ${person.name}`} onClick={() => onReset(person)} type="button"><KeyRound size={14} /></button><button className="icon-button" aria-label={`${person.is_active ? 'Disable' : 'Enable'} ${person.name}`} onClick={() => void toggleActive(person)} type="button"><UserRoundCog size={14} /></button><button className="icon-button danger-icon" aria-label={`Remove ${person.name}`} onClick={() => void removeUser(person)} type="button"><Trash2 size={14} /></button></article>)}</section><form className="add-user-form" onSubmit={(event) => void addUser(event)}><div className="section-kicker">ADD ACCOUNT</div><label className="form-label">NAME<input className="dialog-input" onChange={(event) => setName(event.target.value)} required value={name} /></label><label className="form-label">COMPANY<input className="dialog-input" readOnly value={companyName} /></label><label className="form-label">EMAIL<input className="dialog-input" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label><label className="form-label">TEMPORARY PASSWORD<input className="dialog-input" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label><label className="form-label">ROLE<select className="dialog-input" onChange={(event) => setRole(event.target.value as Role)} value={role}>{allRoles.filter((item) => item !== 'ADMIN').map((item) => <option key={item} value={item}>{roleNames[item]}</option>)}</select></label><button className="primary-button add-user-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}Create account</button><p className="form-footnote">Account changes take effect immediately. An active admin account is always required.</p></form></div></Dialog>
}

function PasswordResetDialog({ user, onClose, onSave }: { user: User; onClose: () => void; onSave: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try { await onSave(password) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reset this password.') }
    finally { setBusy(false) }
  }

  return <Dialog title={`Reset password for ${user.name}`} onClose={onClose}><form className="record-form" onSubmit={(event) => void submit(event)}>{error && <div className="auth-error" role="alert"><CircleAlert size={15} />{error}</div>}<label className="form-label">NEW PASSWORD<input autoComplete="new-password" className="dialog-input" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label><div className="dialog-footer"><span>At least 12 characters</span><button className="primary-button" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}Reset password</button></div></form></Dialog>
}

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} role="presentation"><section className={`create-dialog workspace-dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="dialog-top"><div className="dialog-icon"><FilePlus2 size={18} /></div><button className="icon-button" onClick={onClose} type="button" aria-label="Close dialog"><X size={16} /></button></div><div className="section-kicker">WORKSPACE RECORD</div><h2>{title}</h2><div className="workspace-dialog-content">{children}</div></section></div>
}

function Metric({ label, value, hint, icon, tone }: { label: string; value: number; hint: string; icon: ReactNode; tone: string }) {
  return <article className={`metric metric-${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value.toString().padStart(2, '0')}</div><div className="metric-hint"><span className="metric-marker" />{hint}</div></article>
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  const tone = status === 'FAILED' ? 'danger' : status === 'WAITING_APPROVAL' || status === 'WAITING_FOR_INPUT' ? 'warning' : status === 'RESOLVED' ? 'success' : status === 'CANCELLED' ? 'neutral' : 'active'
  return <span className={`status-badge tone-${tone}`}><span className="badge-dot" />{workflowStatus[status]}</span>
}

function TaskRow({ task, user, team, busy, canEdit, canComplete, onComplete, onApprove, onReject, onEdit, onDelete }: { task: WorkflowTask; user: User; team: User[]; busy: boolean; canEdit: boolean; canComplete: boolean; onComplete: () => void; onApprove: () => void; onReject: () => void; onEdit: () => void; onDelete: () => void }) {
  const operator = user.role === 'ADMIN' || user.role === 'OPERATOR'
  const approver = user.role === 'ADMIN' || user.role === 'APPROVER'
  const assignee = team.find((member) => member.id === task.assigned_to_id)
  return <article className={`task-row task-${task.status.toLowerCase()}`}><span className="task-order">{String(task.order_index).padStart(2, '0')}</span><div className="task-content"><div className="task-title-line"><strong>{task.title}</strong><span className={`task-status task-status-${task.status.toLowerCase()}`}>{taskStatus[task.status]}</span></div><p>{task.description}</p><div className="task-meta"><span>{task.kind}</span><i /><span>{task.priority}</span>{assignee && <><i /> <span>{assignee.name}</span></>}{task.due_at && <><i /> <span>Due {dateLabel(task.due_at)}</span></>}{task.source && <><i /> <span>{task.source}</span></>}</div>{task.result_data && <details className="task-evidence"><summary>Inspect gathered evidence</summary><pre>{JSON.stringify(task.result_data, null, 2)}</pre></details>}{task.status === 'WAITING_APPROVAL' && approver && <div className="task-actions approval-actions"><button className="approve-button" disabled={busy} onClick={onApprove} type="button"><Check size={13} />Approve</button><button className="reject-button" disabled={busy} onClick={onReject} type="button"><X size={13} />Reject & replan</button></div>}{canComplete && task.status === 'TODO' && operator && task.kind !== 'APPROVAL' && <div className="task-actions"><button className="complete-button" disabled={busy} onClick={onComplete} type="button"><Check size={13} />Complete step</button></div>}</div>{task.status === 'BLOCKED' && <span className="blocked-label">Waiting</span>}{operator && canEdit && <div className="task-edit-actions"><button className="icon-button" onClick={onEdit} type="button" aria-label={`Edit ${task.title}`}><Pencil size={13} /></button><button className="icon-button danger-icon" onClick={onDelete} type="button" aria-label={`Delete ${task.title}`}><Trash2 size={13} /></button></div>}</article>
}

function AuditItem({ event }: { event: AuditEvent }) {
  const title = event.event_type.replaceAll('_', ' ').toLowerCase()
  return <div className="activity-item"><span className="activity-mark"><span /></span><div><strong>{title.charAt(0).toUpperCase() + title.slice(1)}</strong><p>{event.actor}{typeof event.details.title === 'string' ? ` · ${event.details.title}` : ''}</p><time>{dateLabel(event.created_at)}</time></div></div>
}

export default Workspace