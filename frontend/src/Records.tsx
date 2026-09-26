import { useEffect, useState, type FormEvent } from 'react'
import { FilePlus2, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import {
  createContract, createCustomer, createInvoice, createPayment, deleteContract,
  createTicket, deleteCustomer, deleteInvoice, deletePayment, deleteTicket,
  listCommunications, listContracts, listCustomers, listInvoices, listPayments,
  listTeam, listTickets, updateContract, updateCustomer, updateInvoice,
  updatePayment, updateTicket,
  type Contract, type Customer, type Invoice, type Payment, type SupportTicket,
  type TicketPriority, type TicketStatus, type User,
} from './api'
import './Records.css'

export type RecordTab = 'invoices' | 'customers' | 'payments' | 'contracts' | 'communications' | 'tickets'
type Editor =
  | { kind: 'customer'; record: Customer | null }
  | { kind: 'invoice'; record: Invoice | null }
  | { kind: 'payment'; record: Payment | null }
  | { kind: 'contract'; record: Contract | null }
  | { kind: 'ticket'; record: SupportTicket | null }
  | null
type Communication = { id: string; invoice_id: string; channel: string; subject: string; body: string; status: string; created_at: string }

const tabs: { id: RecordTab; label: string }[] = [
  { id: 'invoices', label: 'Invoices' }, { id: 'customers', label: 'Customers' },
  { id: 'payments', label: 'Payments' }, { id: 'contracts', label: 'Contracts' },
  { id: 'communications', label: 'Communications' }, { id: 'tickets', label: 'Support tickets' },
]

async function loadBusinessRecords() {
  const [customers, invoices, contracts, communications, tickets, team, breachedTickets] = await Promise.all([
    listCustomers(), listInvoices(), listContracts(), listCommunications(), listTickets(), listTeam(), listTickets({ sla_breached: true }),
  ])
  const payments = await Promise.all(invoices.map((invoice) => listPayments(invoice.id)))
  return { customers, invoices, contracts, communications, tickets, team, breachedTicketIds: breachedTickets.map((ticket) => ticket.id), payments: payments.flat() }
}

function amount(value: string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value))
}

function RecordCenter({ user, onError, initialTab = 'invoices', title = 'Business records' }: { user: User; onError: (error: string) => void; initialTab?: RecordTab; title?: string }) {
  const [tab, setTab] = useState<RecordTab>(initialTab)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [communications, setCommunications] = useState<Communication[]>([])
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [team, setTeam] = useState<User[]>([])
  const [breachedTicketIds, setBreachedTicketIds] = useState<string[]>([])
  const [editor, setEditor] = useState<Editor>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const writable = user.role === 'ADMIN' || user.role === 'OPERATOR'
  const customerById = new Map(customers.map((customer) => [customer.id, customer]))
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]))
  const teamById = new Map(team.map((member) => [member.id, member]))

  async function refresh() {
    setLoading(true)
    try {
      const records = await loadBusinessRecords()
      setCustomers(records.customers)
      setInvoices(records.invoices)
      setContracts(records.contracts)
      setCommunications(records.communications)
      setTickets(records.tickets)
      setTeam(records.team)
      setBreachedTicketIds(records.breachedTicketIds)
      setPayments(records.payments)
      onError('')
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not load business records.')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    let active = true
    loadBusinessRecords().then((records) => {
      if (!active) return
      setCustomers(records.customers)
      setInvoices(records.invoices)
      setContracts(records.contracts)
      setCommunications(records.communications)
      setTickets(records.tickets)
      setTeam(records.team)
      setBreachedTicketIds(records.breachedTicketIds)
      setPayments(records.payments)
      onError('')
    }).catch((cause) => {
      if (active) onError(cause instanceof Error ? cause.message : 'Could not load business records.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onError])

  async function save(formData: Record<string, string | boolean>) {
    if (!editor) return
    setBusy(true)
    try {
      if (editor.kind === 'customer') {
        const body = formData as { name: string; email: string; segment: string }
        if (editor.record) await updateCustomer(editor.record.id, body)
        else await createCustomer(body)
      } else if (editor.kind === 'invoice') {
        const body = formData as { invoice_number: string; customer_id: string; amount: string; currency: string; due_date: string; status: 'OPEN' | 'PAID' }
        if (editor.record) await updateInvoice(editor.record.id, body)
        else await createInvoice(body)
      } else if (editor.kind === 'payment') {
        const body = formData as { invoice_id: string; amount: string; paid_at: string; reference: string }
        if (editor.record) await updatePayment(editor.record.id, body)
        else await createPayment(body)
      } else if (editor.kind === 'contract') {
        const body = formData as { customer_id: string; reference: string; requires_formal_notice: boolean; notice_terms: string }
        if (editor.record) await updateContract(editor.record.id, body)
        else await createContract(body)
      } else {
        const body = formData as { ticket_number: string; subject: string; description: string; requester_email: string; customer_id: string; priority: TicketPriority; status: TicketStatus; sla_due_at: string; assigned_to_id: string }
        const payload = { ...body, customer_id: body.customer_id || null, assigned_to_id: body.assigned_to_id || null }
        if (editor.record) await updateTicket(editor.record.id, payload)
        else await createTicket(payload)
      }
      setEditor(null)
      await refresh()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not save this record.')
    } finally { setBusy(false) }
  }

  async function remove(kind: Exclude<Editor, null>['kind'], id: string, label: string) {
    if (!window.confirm(`Delete ${label}?`)) return
    setBusy(true)
    try {
      if (kind === 'customer') await deleteCustomer(id)
      else if (kind === 'invoice') await deleteInvoice(id)
      else if (kind === 'payment') await deletePayment(id)
      else if (kind === 'contract') await deleteContract(id)
      else await deleteTicket(id)
      await refresh()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not delete this record.')
    } finally { setBusy(false) }
  }

  const currentCount = tab === 'invoices' ? invoices.length : tab === 'customers' ? customers.length : tab === 'payments' ? payments.length : tab === 'contracts' ? contracts.length : tab === 'tickets' ? tickets.length : communications.length
  const editorKind = tab === 'tickets' ? 'ticket' : tab === 'invoices' ? 'invoice' : tab === 'customers' ? 'customer' : tab === 'payments' ? 'payment' : 'contract'

  return <section className="records-page">
    <header className="records-heading"><div><div className="eyebrow"><span className="eyebrow-line" />WORKSPACE DATA</div><h1>{title}<span className="heading-comma">.</span></h1><p className="page-subtitle">Live records connected to workflows, decisions, and audit evidence.</p></div><button className="icon-button records-refresh" onClick={() => void refresh()} type="button" aria-label="Refresh business records"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></header>
    <div className="records-panel"><div className="records-toolbar"><div className="record-tabs" role="tablist" aria-label="Business data type">{tabs.map((item) => <button aria-selected={tab === item.id} className={`record-tab ${tab === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button">{item.label}<span>{item.id === 'invoices' ? invoices.length : item.id === 'customers' ? customers.length : item.id === 'payments' ? payments.length : item.id === 'contracts' ? contracts.length : item.id === 'tickets' ? tickets.length : communications.length}</span></button>)}</div>{writable && tab !== 'communications' && <button className="primary-button record-add" onClick={() => setEditor({ kind: editorKind, record: null } as Exclude<Editor, null>)} type="button"><Plus size={15} />Add {tab === 'tickets' ? 'support ticket' : tab === 'invoices' ? 'invoice' : tab === 'customers' ? 'customer' : tab === 'payments' ? 'payment' : 'contract'}</button>}</div>
      {loading ? <div className="records-empty"><LoaderCircle size={19} className="spin" />Loading records</div> : currentCount === 0 ? <div className="records-empty"><span className="empty-symbol"><FilePlus2 size={19} /></span><strong>No {tab === 'tickets' ? 'support tickets' : tab} yet</strong><p>{tab === 'communications' ? 'Approved simulated communications will appear here.' : 'Add workspace records here; workflows use this data as their source of truth.'}</p>{writable && tab !== 'communications' && <button className="text-button" onClick={() => setEditor({ kind: editorKind, record: null } as Exclude<Editor, null>)} type="button">Add the first record <Plus size={14} /></button>}</div> : <div className="records-table-wrap"><table className="records-table"><thead>{tab === 'customers' ? <tr><th>CUSTOMER</th><th>EMAIL</th><th>SEGMENT</th><th>ADDED</th><th /></tr> : tab === 'invoices' ? <tr><th>INVOICE</th><th>CUSTOMER</th><th>AMOUNT</th><th>DUE DATE</th><th>STATUS</th><th /></tr> : tab === 'payments' ? <tr><th>INVOICE</th><th>AMOUNT</th><th>PAID DATE</th><th>REFERENCE</th><th /></tr> : tab === 'contracts' ? <tr><th>CONTRACT</th><th>CUSTOMER</th><th>NOTICE REQUIRED</th><th>TERMS</th><th /></tr> : tab === 'tickets' ? <tr><th>TICKET</th><th>REQUESTER</th><th>PRIORITY</th><th>STATUS</th><th>SLA DUE</th><th>ASSIGNEE</th><th /></tr> : <tr><th>SIMULATED COMMUNICATION</th><th>INVOICE</th><th>CHANNEL</th><th>STATUS</th><th>DATE</th></tr>}</thead><tbody>
        {tab === 'customers' && customers.map((item) => <tr key={item.id}><td className="record-primary">{item.name}</td><td>{item.email}</td><td><span className="record-tag">{item.segment}</span></td><td>{new Date(item.created_at).toLocaleDateString()}</td><RecordActions canWrite={writable} onEdit={() => setEditor({ kind: 'customer', record: item })} onDelete={() => void remove('customer', item.id, item.name)} /></tr>)}
        {tab === 'invoices' && invoices.map((item) => <tr key={item.id}><td className="record-primary">{item.invoice_number}</td><td>{customerById.get(item.customer_id)?.name ?? 'Unknown customer'}</td><td className="record-amount">{amount(item.amount, item.currency)}</td><td>{new Date(`${item.due_date}T00:00:00`).toLocaleDateString()}</td><td><span className={`invoice-state invoice-${item.status.toLowerCase()}`}>{item.status === 'PAID' ? 'Paid' : new Date(`${item.due_date}T00:00:00`) < new Date(new Date().toDateString()) ? 'Overdue' : 'Open'}</span></td><RecordActions canWrite={writable} onEdit={() => setEditor({ kind: 'invoice', record: item })} onDelete={() => void remove('invoice', item.id, item.invoice_number)} /></tr>)}
        {tab === 'payments' && payments.map((item) => <tr key={item.id}><td className="record-primary">{invoiceById.get(item.invoice_id)?.invoice_number ?? 'Unknown invoice'}</td><td className="record-amount">{amount(item.amount, invoiceById.get(item.invoice_id)?.currency ?? 'INR')}</td><td>{new Date(`${item.paid_at}T00:00:00`).toLocaleDateString()}</td><td>{item.reference || '—'}</td><RecordActions canWrite={writable} onEdit={() => setEditor({ kind: 'payment', record: item })} onDelete={() => void remove('payment', item.id, item.reference || 'payment')} /></tr>)}
        {tab === 'contracts' && contracts.map((item) => <tr key={item.id}><td className="record-primary">{item.reference}</td><td>{customerById.get(item.customer_id)?.name ?? 'Unknown customer'}</td><td><span className={`record-tag ${item.requires_formal_notice ? 'notice-required' : ''}`}>{item.requires_formal_notice ? 'Required' : 'No'}</span></td><td className="terms-cell">{item.notice_terms || '—'}</td><RecordActions canWrite={writable} onEdit={() => setEditor({ kind: 'contract', record: item })} onDelete={() => void remove('contract', item.id, item.reference)} /></tr>)}
        {tab === 'tickets' && tickets.map((item) => <tr key={item.id}><td><span className="record-primary">{item.ticket_number}</span><small className="ticket-subject">{item.subject}</small></td><td>{item.requester_email}</td><td><span className={`ticket-priority priority-${item.priority.toLowerCase()}`}>{item.priority}</span></td><td><span className="record-tag">{item.status.replaceAll('_', ' ')}</span></td><td><span className={`sla-label ${breachedTicketIds.includes(item.id) ? 'sla-breached' : ''}`}>{new Date(item.sla_due_at).toLocaleString()}</span></td><td>{teamById.get(item.assigned_to_id ?? '')?.name ?? 'Unassigned'}</td><RecordActions canWrite={writable} onEdit={() => setEditor({ kind: 'ticket', record: item })} onDelete={() => void remove('ticket', item.id, item.ticket_number)} /></tr>)}
        {tab === 'communications' && communications.map((item) => <tr key={item.id}><td className="record-primary">{item.subject}</td><td>{invoiceById.get(item.invoice_id)?.invoice_number ?? item.invoice_id.slice(0, 8)}</td><td>{item.channel.replaceAll('_', ' ')}</td><td><span className="invoice-state invoice-paid">{item.status.replaceAll('_', ' ')}</span></td><td>{new Date(item.created_at).toLocaleString()}</td></tr>)}
      </tbody></table></div>}
      <footer className="records-foot"><span>{currentCount} records</span><span>{writable ? 'READ / WRITE ACCESS' : 'READ ONLY ACCESS'}</span></footer>
    </div>
    {editor && <RecordDialog editor={editor} customers={customers} invoices={invoices} team={team} busy={busy} onClose={() => setEditor(null)} onSave={save} />}
  </section>
}

function RecordActions({ canWrite, onEdit, onDelete }: { canWrite: boolean; onEdit: () => void; onDelete: () => void }) {
  return <td className="record-actions">{canWrite && <><button className="icon-button" onClick={onEdit} type="button" aria-label="Edit record"><Pencil size={13} /></button><button className="icon-button danger-icon" onClick={onDelete} type="button" aria-label="Delete record"><Trash2 size={13} /></button></>}</td>
}

function RecordDialog({ editor, customers, invoices, team, busy, onClose, onSave }: { editor: Exclude<Editor, null>; customers: Customer[]; invoices: Invoice[]; team: User[]; busy: boolean; onClose: () => void; onSave: (payload: Record<string, string | boolean>) => Promise<void> }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} role="presentation"><section className="create-dialog workspace-dialog" role="dialog" aria-modal="true" aria-label={`${editor.record ? 'Edit' : 'Add'} ${editor.kind}`}><div className="dialog-top"><div className="dialog-icon"><FilePlus2 size={17} /></div><button className="icon-button" onClick={onClose} type="button" aria-label="Close dialog"><X size={15} /></button></div><div className="section-kicker">BUSINESS RECORD</div><h2>{editor.record ? 'Edit' : 'Add'} {editor.kind}</h2>
    {editor.kind === 'customer' && <CustomerForm initial={editor.record} busy={busy} onSave={onSave} />}
    {editor.kind === 'invoice' && <InvoiceForm initial={editor.record} customers={customers} busy={busy} onSave={onSave} />}
    {editor.kind === 'payment' && <PaymentForm initial={editor.record} invoices={invoices} busy={busy} onSave={onSave} />}
    {editor.kind === 'contract' && <ContractForm initial={editor.record} customers={customers} busy={busy} onSave={onSave} />}
    {editor.kind === 'ticket' && <TicketForm initial={editor.record} customers={customers} team={team} busy={busy} onSave={onSave} />}
  </section></div>
}

function CustomerForm({ initial, busy, onSave }: { initial: Customer | null; busy: boolean; onSave: (payload: Record<string, string | boolean>) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [segment, setSegment] = useState(initial?.segment ?? 'STANDARD')
  return <form className="record-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void onSave({ name, email, segment }) }}><Field label="CUSTOMER NAME"><input className="dialog-input" onChange={(event) => setName(event.target.value)} required value={name} /></Field><Field label="EMAIL"><input className="dialog-input" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></Field><Field label="SEGMENT"><select className="dialog-input" onChange={(event) => setSegment(event.target.value)} value={segment}><option>STANDARD</option><option>ENTERPRISE</option><option>STRATEGIC</option></select></Field><Submit busy={busy} label={initial ? 'Save customer' : 'Add customer'} /></form>
}

function InvoiceForm({ initial, customers, busy, onSave }: { initial: Invoice | null; customers: Customer[]; busy: boolean; onSave: (payload: Record<string, string | boolean>) => Promise<void> }) {
  const [number, setNumber] = useState(initial?.invoice_number ?? '')
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? customers[0]?.id ?? '')
  const [value, setValue] = useState(initial?.amount ?? '')
  const [currency, setCurrency] = useState(initial?.currency ?? 'INR')
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [status, setStatus] = useState<'OPEN' | 'PAID'>(initial?.status ?? 'OPEN')
  return <form className="record-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void onSave({ invoice_number: number, customer_id: customerId, amount: value, currency, due_date: dueDate, status }) }}><Field label="INVOICE NUMBER"><input className="dialog-input" onChange={(event) => setNumber(event.target.value)} required value={number} /></Field><Field label="CUSTOMER"><select className="dialog-input" onChange={(event) => setCustomerId(event.target.value)} required value={customerId}><option value="">Choose a customer</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</select></Field><div className="form-grid"><Field label="AMOUNT"><input className="dialog-input" min="0.01" onChange={(event) => setValue(event.target.value)} required step="0.01" type="number" value={value} /></Field><Field label="CURRENCY"><select className="dialog-input" onChange={(event) => setCurrency(event.target.value)} value={currency}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></Field></div><div className="form-grid"><Field label="DUE DATE"><input className="dialog-input" onChange={(event) => setDueDate(event.target.value)} required type="date" value={dueDate} /></Field><Field label="STATUS"><select className="dialog-input" onChange={(event) => setStatus(event.target.value as 'OPEN' | 'PAID')} value={status}><option value="OPEN">Open</option><option value="PAID">Paid</option></select></Field></div><Submit busy={busy} label={initial ? 'Save invoice' : 'Add invoice'} /></form>
}

function PaymentForm({ initial, invoices, busy, onSave }: { initial: Payment | null; invoices: Invoice[]; busy: boolean; onSave: (payload: Record<string, string | boolean>) => Promise<void> }) {
  const [invoiceId, setInvoiceId] = useState(initial?.invoice_id ?? invoices[0]?.id ?? '')
  const [value, setValue] = useState(initial?.amount ?? '')
  const [paidAt, setPaidAt] = useState(initial?.paid_at ?? new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState(initial?.reference ?? '')
  return <form className="record-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void onSave({ invoice_id: invoiceId, amount: value, paid_at: paidAt, reference }) }}><Field label="INVOICE"><select className="dialog-input" disabled={Boolean(initial)} onChange={(event) => setInvoiceId(event.target.value)} required value={invoiceId}><option value="">Choose an invoice</option>{invoices.map((item) => <option key={item.id} value={item.id}>{item.invoice_number} · {item.amount} {item.currency}</option>)}</select></Field><div className="form-grid"><Field label="AMOUNT"><input className="dialog-input" min="0.01" onChange={(event) => setValue(event.target.value)} required step="0.01" type="number" value={value} /></Field><Field label="PAID DATE"><input className="dialog-input" onChange={(event) => setPaidAt(event.target.value)} required type="date" value={paidAt} /></Field></div><Field label="PAYMENT REFERENCE"><input className="dialog-input" onChange={(event) => setReference(event.target.value)} value={reference} /></Field><Submit busy={busy} label={initial ? 'Save payment' : 'Add payment'} /></form>
}

function ContractForm({ initial, customers, busy, onSave }: { initial: Contract | null; customers: Customer[]; busy: boolean; onSave: (payload: Record<string, string | boolean>) => Promise<void> }) {
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? customers[0]?.id ?? '')
  const [reference, setReference] = useState(initial?.reference ?? '')
  const [notice, setNotice] = useState(initial?.requires_formal_notice ?? false)
  const [terms, setTerms] = useState(initial?.notice_terms ?? '')
  return <form className="record-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void onSave({ customer_id: customerId, reference, requires_formal_notice: notice, notice_terms: terms }) }}><Field label="CUSTOMER"><select className="dialog-input" disabled={Boolean(initial)} onChange={(event) => setCustomerId(event.target.value)} required value={customerId}><option value="">Choose a customer</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="CONTRACT REFERENCE"><input className="dialog-input" onChange={(event) => setReference(event.target.value)} required value={reference} /></Field><label className="notice-toggle"><input checked={notice} onChange={(event) => setNotice(event.target.checked)} type="checkbox" /><span>Formal notice required before escalation</span></label><Field label="NOTICE TERMS"><textarea className="dialog-textarea compact-textarea" onChange={(event) => setTerms(event.target.value)} value={terms} /></Field><Submit busy={busy} label={initial ? 'Save contract' : 'Add contract'} /></form>
}

function asLocalDateTime(value?: string) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function TicketForm({ initial, customers, team, busy, onSave }: { initial: SupportTicket | null; customers: Customer[]; team: User[]; busy: boolean; onSave: (payload: Record<string, string | boolean>) => Promise<void> }) {
  const [number, setNumber] = useState(initial?.ticket_number ?? '')
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [requester, setRequester] = useState(initial?.requester_email ?? '')
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? '')
  const [priority, setPriority] = useState<TicketPriority>(initial?.priority ?? 'MEDIUM')
  const [status, setStatus] = useState<TicketStatus>(initial?.status ?? 'OPEN')
  const [slaDueAt, setSlaDueAt] = useState(asLocalDateTime(initial?.sla_due_at))
  const [assigneeId, setAssigneeId] = useState(initial?.assigned_to_id ?? '')
  return <form className="record-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void onSave({ ticket_number: number, subject, description, requester_email: requester, customer_id: customerId, priority, status, sla_due_at: new Date(slaDueAt).toISOString(), assigned_to_id: assigneeId }) }}>
    <div className="form-grid"><Field label="TICKET NUMBER"><input className="dialog-input" onChange={(event) => setNumber(event.target.value)} required value={number} /></Field><Field label="PRIORITY"><select className="dialog-input" onChange={(event) => setPriority(event.target.value as TicketPriority)} value={priority}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option></select></Field></div>
    <Field label="SUBJECT"><input className="dialog-input" onChange={(event) => setSubject(event.target.value)} required value={subject} /></Field>
    <Field label="DESCRIPTION"><textarea className="dialog-textarea compact-textarea" onChange={(event) => setDescription(event.target.value)} value={description} /></Field>
    <div className="form-grid"><Field label="REQUESTER EMAIL"><input className="dialog-input" onChange={(event) => setRequester(event.target.value)} required type="email" value={requester} /></Field><Field label="CUSTOMER"><select className="dialog-input" onChange={(event) => setCustomerId(event.target.value)} value={customerId}><option value="">No linked customer</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
    <div className="form-grid"><Field label="STATUS"><select className="dialog-input" onChange={(event) => setStatus(event.target.value as TicketStatus)} value={status}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="WAITING_CUSTOMER">Waiting for customer</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></select></Field><Field label="SLA DEADLINE"><input className="dialog-input" onChange={(event) => setSlaDueAt(event.target.value)} required type="datetime-local" value={slaDueAt} /></Field></div>
    <Field label="ASSIGNEE"><select className="dialog-input" onChange={(event) => setAssigneeId(event.target.value)} value={assigneeId}><option value="">Unassigned</option>{team.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></Field>
    <Submit busy={busy} label={initial ? 'Save ticket' : 'Create ticket'} />
  </form>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-label">{label}{children}</label> }
function Submit({ busy, label }: { busy: boolean; label: string }) { return <div className="dialog-footer"><span>Changes are saved to the workspace database.</span><button className="primary-button" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={15} /> : <FilePlus2 size={15} />}{label}</button></div> }

export default RecordCenter