import { useEffect, useState } from 'react'
import { ArrowRight, Building2, Check, Clock3, LoaderCircle, RefreshCw, Users } from 'lucide-react'
import { listUsers, updateUser, type User } from './api'
import './AdminViews.css'

export type AdminPage = 'admin-dashboard' | 'pending-requests' | 'approved-tenants'

function tenantGroups(users: User[]) {
  const groups = new Map<string, User[]>()
  for (const user of users) {
    const company = user.company.trim() || 'Unnamed business'
    groups.set(company, [...(groups.get(company) ?? []), user])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function requestedAtLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export default function AdminView({ page, onNavigate }: { page: AdminPage; onNavigate: (page: AdminPage) => void }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingRequests = users.filter((user) => user.role === 'OPERATOR' && !user.is_active)
  const activeUsers = users.filter((user) => user.is_active)
  const approvedTenants = tenantGroups(activeUsers)

  async function refresh(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      setUsers(await listUsers())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load tenant records.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    listUsers().then((items) => {
      if (active) {
        setUsers(items)
        setError(null)
      }
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load tenant records.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  async function approveRequest(user: User) {
    setBusyId(user.id)
    setError(null)
    try {
      const updated = await updateUser(user.id, { is_active: true })
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not approve this request.')
    } finally {
      setBusyId(null)
    }
  }

  const titles: Record<AdminPage, string> = {
    'admin-dashboard': 'Admin Dashboard',
    'pending-requests': 'Pending Requests',
    'approved-tenants': 'Approved Tenants',
  }

  return <main className="admin-page">
    <header className="page-heading">
      <div><div className="eyebrow"><span className="eyebrow-line" />TENANT ADMINISTRATION</div><h1>{titles[page]}<span className="heading-comma">.</span></h1><p className="page-subtitle">Review business access requests and manage approved workspaces.</p></div>
      <button className="icon-button" onClick={() => void refresh(true)} type="button" aria-label="Refresh tenant data"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
    </header>
    {error && <div className="notice notice-error" role="alert"><span>{error}</span></div>}
    {page === 'admin-dashboard' && <>
      <section className="metrics admin-metrics" aria-label="Tenant administration summary">
        <article className="metric"><div className="metric-top"><span>Approved tenants</span><span className="metric-icon metric-mint"><Building2 size={15} /></span></div><div className="metric-value">{loading ? '...' : approvedTenants.length}</div><div className="metric-hint">Active business workspaces</div></article>
        <article className="metric"><div className="metric-top"><span>Pending requests</span><span className="metric-icon metric-amber"><Clock3 size={15} /></span></div><div className="metric-value">{loading ? '...' : pendingRequests.length}</div><div className="metric-hint">Waiting for activation</div></article>
        <article className="metric"><div className="metric-top"><span>Active accounts</span><span className="metric-icon metric-blue"><Users size={15} /></span></div><div className="metric-value">{loading ? '...' : activeUsers.length}</div><div className="metric-hint">Across approved tenants</div></article>
      </section>
      <section className="admin-shortcuts">
        <button className="admin-shortcut" onClick={() => onNavigate('pending-requests')} type="button"><span><Clock3 size={17} />Pending Requests</span><strong>Review account requests</strong><ArrowRight size={16} /></button>
        <button className="admin-shortcut" onClick={() => onNavigate('approved-tenants')} type="button"><span><Building2 size={17} />Approved Tenants</span><strong>Browse active businesses</strong><ArrowRight size={16} /></button>
      </section>
    </>}
    {page === 'pending-requests' && <section className="admin-table-panel">
      {loading ? <div className="admin-empty"><LoaderCircle size={18} className="spin" />Loading requests</div> : pendingRequests.length === 0 ? <div className="admin-empty"><Clock3 size={18} /><strong>No pending requests</strong><span>New business owner requests will appear here.</span></div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>BUSINESS</th><th>REQUESTER</th><th>EMAIL</th><th>REQUESTED</th><th>ACTION</th></tr></thead><tbody>{pendingRequests.map((user) => <tr key={user.id}><td><strong>{user.company}</strong></td><td>{user.name}</td><td>{user.email}</td><td>{requestedAtLabel(user.created_at)}</td><td><button className="approve-button" disabled={busyId === user.id} onClick={() => void approveRequest(user)} type="button">{busyId === user.id ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}Approve</button></td></tr>)}</tbody></table></div>}
    </section>}
    {page === 'approved-tenants' && <section className="admin-table-panel">
      {loading ? <div className="admin-empty"><LoaderCircle size={18} className="spin" />Loading tenants</div> : approvedTenants.length === 0 ? <div className="admin-empty"><Building2 size={18} /><strong>No approved tenants</strong><span>Activate a pending business request to list it here.</span></div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>BUSINESS</th><th>ADMIN CONTACT</th><th>ACTIVE ACCOUNTS</th><th>STATUS</th></tr></thead><tbody>{approvedTenants.map(([company, members]) => { const admin = members.find((member) => member.role === 'ADMIN'); const contact = admin ?? members[0]; return <tr key={company}><td><strong>{company}</strong></td><td>{contact.name}<small>{contact.email}</small></td><td>{members.length}</td><td><span className="tenant-status"><span className="status-pip" />Approved</span></td></tr>})}</tbody></table></div>}
    </section>}
  </main>
}