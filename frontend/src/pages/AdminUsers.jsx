import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errMsg } from '../lib/api';
import { clsx, fmtDateTime } from '../lib/format';
import { Button, Card, Chip, EmptyState, Modal, PageHeader, SkeletonRows } from '../components/ui.jsx';
import { ROLE_LABEL } from '../store/useAuth';
import { useToast } from '../store/useToast';

const CREATABLE_ROLES = [
  'investigator',
  'monitor',
  'accountant',
  'cashier',
  'manager',
  'approver',
  'general-manager',
];

function CreateUserModal({ open, onClose, onCreated }) {
  const toast = useToast((s) => s.add);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'investigator' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/users', form);
      toast.success(`User “${data.user.name}” created`);
      onCreated();
      onClose();
      setForm({ name: '', email: '', password: '', role: 'investigator' });
    } catch (err) {
      setError(errMsg(err, 'Could not create user'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create user">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Jane Operator" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@onerecon.io" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Password</label>
            <input className="input" required minLength={6} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="••••••" />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              {CREATABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Create user</Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, open, onClose, onReset }) {
  const toast = useToast((s) => s.add);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => setPassword(''), [open, user]);

  const submit = async (e) => {
    e.preventDefault();
    if (!password || password.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/users/${user._id}`, { password });
      toast.success(`Password reset for ${user.email}`);
      onReset();
      onClose();
    } catch (err) {
      setError(errMsg(err, 'Reset failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Reset password — ${user?.email || ''}`}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">New password</label>
          <input className="input" type="text" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
        </div>
        {error && <p className="rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Set password</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminUsers() {
  const navigate = useNavigate();
  const toast = useToast((s) => s.add);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState(null);

  const load = useCallback(async (silent = false) => {
    try {
      const { data } = await api.get('/users');
      setUsers(data.users);
      setError(null);
    } catch (err) {
      if (!silent) setError(errMsg(err, 'Could not load users'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = async (userId, patch, successMsg) => {
    setBusyId(userId);
    try {
      await api.put(`/users/${userId}`, patch);
      toast.success(successMsg);
      await load(true);
    } catch (err) {
      toast.error(errMsg(err, 'Update failed'));
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = (u) => mutate(u._id, { active: !u.active }, `User ${u.active ? 'deactivated' : 'activated'}`);
  const changeRole = (u, role) => mutate(u._id, { role }, `Role changed to ${role}`);
  const rename = (u, name) => name && name !== u.name && mutate(u._id, { name }, `Renamed to ${name}`);

  return (
    <div>
      <PageHeader
        title="Admin · Users"
        subtitle="Create users, change roles, toggle access and reset passwords"
        actions={<Button onClick={() => setCreateOpen(true)}>＋ Create user</Button>}
      />

      {error && (
        <p className="mb-4 rounded-lg border border-ledger-brk bg-[#FEF2F2] px-3 py-2 text-small text-ledger-brk">{error}</p>
      )}

      {users === null ? (
        <Card className="p-5"><SkeletonRows rows={6} cols={5} /></Card>
      ) : users.length === 0 ? (
        <EmptyState title="No users yet" message="Create the first user to get started." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-table">
              <thead>
                <tr className="border-b border-ledger-line bg-ledger-panel text-left text-small text-ledger-meta">
                  {['Name', 'Email', 'Role', 'Active', 'Created', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id} className="border-b border-ledger-line last:border-0 hover:bg-ledger-panel">
                    <td className="px-4 py-2.5">
                      <EditableName name={u.name} onSave={(n) => rename(u, n)} busy={busyId === u._id} />
                    </td>
                    <td className="field-id px-4 py-2.5">{u.email}</td>
                    <td className="px-4 py-2.5">
<select
                        className="input !w-auto !py-1 text-small"
                        value={u.role}
                        disabled={busyId === u._id}
                        onChange={(e) => changeRole(u, e.target.value)}
                      >
                        {[...new Set([u.role, ...CREATABLE_ROLES])].map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <Chip tone={u.active ? 'match' : 'neutral'} dot>{u.active ? 'active' : 'disabled'}</Chip>
                    </td>
                    <td className="px-4 py-2.5 text-ledger-meta">{fmtDateTime(u.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="outline" loading={busyId === u._id} onClick={() => setResetUser(u)}>Reset pwd</Button>
                        <Button size="sm" variant={u.active ? 'ghost' : 'outline'} loading={busyId === u._id} onClick={() => toggleActive(u)}>
                          {u.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-6">
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>← Back to dashboard</Button>
      </div>

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
      <ResetPasswordModal user={resetUser} open={!!resetUser} onClose={() => setResetUser(null)} onReset={load} />
    </div>
  );
}

function EditableName({ name, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const save = () => {
    setEditing(false);
    onSave(value);
  };
  if (editing) {
    return (
      <span className="flex items-center gap-1.5">
        <input className="input !w-44 !py-1 text-small" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} onBlur={save} />
        {busy && <span className="text-small text-ledger-meta">…</span>}
      </span>
    );
  }
  return (
    <button className="font-medium text-ledger-ink hover:text-ledger-accent" onClick={() => setEditing(true)} title="Click to rename">
      {name} ✎
    </button>
  );
}