"use client";
import { useCallback, useEffect, useState } from "react";
import { api, getToken, setUser } from "../lib/api";
import { THEMES, applyTheme, getTheme } from "../lib/theme";

const APPS = [["library", "Library"], ["transcribe", "Transcribe"]];
const when = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never");
const size = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

function Icon({ name }) {
  const p = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "overview": return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>;
    case "people": return <svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case "groups": return <svg {...p}><circle cx="12" cy="12" r="3" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><path d="M10.4 13.6 6.5 17.5" /><path d="M17.5 6.5 13.6 10.4" /></svg>;
    case "books": return <svg {...p}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>;
    case "usage": return <svg {...p}><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>;
    case "invites": return <svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>;
    case "notifications": return <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;
    case "mic": return <svg {...p}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>;
    case "note": return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;
    default: return null;
  }
}

function Switch({ on, label, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={"sw" + (on ? " on" : "")} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

function Overview({ data, error, onNavigate }) {
  if (error) return <p className="err" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading overview...</p>;

  const stats = [
    { label: "Total members", value: data.users, icon: "people", go: "people" },
    { label: "Active accounts", value: data.active_users, icon: "people", go: "people" },
    { label: "Admins", value: data.admins, icon: "people", go: "people" },
    { label: "Waiting to join", value: data.pending_invites, icon: "invites", go: "invites" },
    { label: "Library PDFs", value: data.documents, icon: "books", go: "books" },
    { label: "Study notes", value: data.notes, icon: "note", go: "usage" },
    { label: "Recordings transcribed", value: data.transcriptions || 0, icon: "mic", go: "usage" },
    { label: "Minutes transcribed", value: data.minutes_transcribed || 0, icon: "mic", go: "usage" },
  ];

  return (
    <div className="gap">
      {data.pending_invites > 0 && (
        <div className="warn-banner">
          <span>{data.pending_invites} {data.pending_invites === 1 ? "person is" : "people are"} invited and waiting to create an account.</span>
          <button type="button" className="btn sm" onClick={() => onNavigate("invites")}>Review invites</button>
        </div>
      )}

      <div className="stats">
        {stats.map((s) => (
          <div className="stat" key={s.label} style={{ cursor: "pointer" }} onClick={() => onNavigate(s.go)}>
            <div className="stat-top">
              <span className="sm">{s.label}</span>
              <span className="stat-icon"><Icon name={s.icon} /></span>
            </div>
            <b>{s.value}</b>
          </div>
        ))}
      </div>

      <div className="lbl" style={{ marginTop: 8 }}>QUICK ACTIONS</div>
      <div className="qgrid">
        <button type="button" className="qcard" onClick={() => onNavigate("invites")}>
          <b>+ Invite a member</b>
          <span className="muted sm">Pre-approve an email for Library or Transcribe access.</span>
        </button>
        <button type="button" className="qcard" onClick={() => onNavigate("books")}>
          <b>+ Upload a PDF book</b>
          <span className="muted sm">Publish new study material to everyone or specific groups.</span>
        </button>
        <button type="button" className="qcard" onClick={() => onNavigate("notifications")}>
          <b>Send an announcement</b>
          <span className="muted sm">Broadcast a notice or study alert to all HIM members.</span>
        </button>
        <button type="button" className="qcard" onClick={() => onNavigate("usage")}>
          <b>Inspect reading activity</b>
          <span className="muted sm">See daily opens, most read books, and active members.</span>
        </button>
      </div>
    </div>
  );
}

function People({ me, onRefreshCounts }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/api/admin/users").then(setUsers).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  async function change(u, patch) {
    setError("");
    try {
      const updated = await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: patch });
      setUsers((list) => list.map((x) => (x.id === u.id ? updated : x)));
      onRefreshCounts?.();
    } catch (e) {
      setError(e.message);
    }
  }

  const shown = users.filter((u) => {
    if (query.trim() && !u.email.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "admins") return u.role === "admin";
    if (filter === "active") return u.is_active;
    if (filter === "disabled") return !u.is_active;
    return true;
  });

  return (
    <div className="gap">
      <div className="toolbar">
        <input className="input" placeholder="Search members by email..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people by email" />
        <div className="chips" role="group" aria-label="Filter members">
          {[["all", `All (${users.length})`], ["admins", "Admins"], ["active", "Active"], ["disabled", "Disabled"]].map(([k, lbl]) => (
            <button key={k} type="button" className={"chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{lbl}</button>
          ))}
        </div>
      </div>

      {error && <p className="err" role="alert">{error}</p>}
      {loading && <p className="muted">Loading members...</p>}

      <div className="list">
        {shown.map((u) => {
          const isAdmin = u.role === "admin";
          return (
            <div className="card urow" key={u.id}>
              <div className="uhead">
                <div className="uid">
                  <span className="avatar">{u.email.slice(0, 2)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="badges">
                      <b style={{ wordBreak: "break-all" }}>{u.email}</b>
                      {u.id === me.id && <span className="muted sm">(you)</span>}
                      {isAdmin && <span className="badge">Admin</span>}
                      {u.is_active ? <span className="badge ok">Active</span> : <span className="badge off">Disabled</span>}
                    </div>
                    <div className="muted sm" style={{ marginTop: 3 }}>
                      Joined {when(u.created_at)} · Last sign-in {when(u.last_login_at)} · {u.documents} PDFs
                    </div>
                  </div>
                </div>
              </div>
              <div className="ctrls">
                {APPS.map(([key, label]) => (
                  <label className="ctl" key={key}>
                    <span>{label}</span>
                    <Switch on={u.apps.includes(key)} disabled={isAdmin} label={`${label} access for ${u.email}`} onChange={(v) => change(u, { apps: v ? [...u.apps, key] : u.apps.filter((a) => a !== key) })} />
                  </label>
                ))}
                <label className="ctl">
                  <span>Admin</span>
                  <Switch on={isAdmin} label={`Admin role for ${u.email}`} onChange={(v) => change(u, { role: v ? "admin" : "user" })} />
                </label>
                <label className="ctl">
                  <span>Active</span>
                  <Switch on={u.is_active} label={`Account active for ${u.email}`} onChange={(v) => change(u, { is_active: v })} />
                </label>
              </div>
            </div>
          );
        })}
      </div>
      {!loading && shown.length === 0 && <div className="card muted sm">No members match your filter.</div>}
    </div>
  );
}

function Invites({ onRefreshCounts }) {
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [apps, setApps] = useState(["library"]);
  const [role, setRole] = useState("user");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => api("/api/admin/invites").then(setInvites).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setNote("");
    try {
      await api("/api/admin/invites", { method: "POST", body: { email, apps, role } });
      setNote(`Saved. ${email.trim().toLowerCase()} can now sign up directly without an invite code.`);
      setEmail("");
      await load();
      onRefreshCounts?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    try {
      await api(`/api/admin/invites/${id}`, { method: "DELETE" });
      await load();
      onRefreshCounts?.();
    } catch (err) {
      setError(err.message);
    }
  }

  const toggle = (key) => setApps((a) => (a.includes(key) ? a.filter((x) => x !== key) : [...a, key]));

  return (
    <div className="gap">
      <form className="card form" onSubmit={submit}>
        <b>Pre-approve a new member</b>
        <p className="muted sm" style={{ margin: 0 }}>Enter their email and choose which HIM Ministries tools they can open as soon as they register.</p>
        <input className="input" type="email" placeholder="member@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Their email" />
        <div className="opts" role="group" aria-label="Apps">
          {APPS.map(([key, label]) => (
            <label className="ctl" key={key}>
              <input type="checkbox" checked={apps.includes(key)} onChange={() => toggle(key)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="user">Regular member</option>
          <option value="admin">Admin</option>
        </select>
        {error && <div className="err" role="alert">{error}</div>}
        {note && <div className="ok-banner" role="status">{note}</div>}
        <button className="btn" style={{ alignSelf: "flex-start" }}>Save invitation</button>
      </form>

      <div className="lbl" style={{ marginTop: 8 }}>WAITING TO JOIN ({invites.length})</div>
      {invites.length === 0 && <div className="card muted sm">No pending invitations right now.</div>}
      <div className="list">
        {invites.map((i) => (
          <div className="card irow" key={i.id}>
            <div>
              <b>{i.email}</b>
              <div className="muted sm" style={{ marginTop: 2 }}>{i.role === "admin" ? "Admin · " : ""}{i.apps.join(", ") || "no apps"} · added {when(i.created_at)}</div>
            </div>
            <button className="btn ghost sm" onClick={() => remove(i.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Picker({ items, selected, onChange, label, search = true }) {
  const [q, setQ] = useState("");
  const shown = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="gap" style={{ gap: 8 }}>
      {search && items.length > 6 && <input className="input" placeholder={`Search ${label}...`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${label}`} />}
      <div className="pick" role="group" aria-label={label}>
        {shown.length === 0 && <span className="muted sm" style={{ padding: 8 }}>Nothing to show.</span>}
        {shown.map((i) => (
          <label key={i.id}><input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} /><span>{i.label}</span></label>
        ))}
      </div>
    </div>
  );
}

function Groups({ onRefreshCounts }) {
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [g, u] = await Promise.all([api("/api/admin/groups"), api("/api/admin/users")]);
      setGroups(g); setUsers(u);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => { setError(""); try { await fn(); await load(); onRefreshCounts?.(); } catch (e) { setError(e.message); } };
  const create = (e) => { e.preventDefault(); run(async () => { await api("/api/admin/groups", { method: "POST", body: { name } }); setName(""); }); };
  const saveMembers = (g) => run(async () => { await api(`/api/admin/groups/${g.id}`, { method: "PATCH", body: { members } }); setEditing(null); });
  const rename = (g, value) => { if (value.trim() && value !== g.name) run(() => api(`/api/admin/groups/${g.id}`, { method: "PATCH", body: { name: value } })); };
  const remove = (g) => { if (confirm(`Delete the group "${g.name}"? Books shared with it will stop being shared with its members.`)) run(() => api(`/api/admin/groups/${g.id}`, { method: "DELETE" })); };

  return (
    <div className="gap">
      <form className="card form" onSubmit={create}>
        <b>Create a ministry group</b>
        <p className="muted sm" style={{ margin: 0 }}>Organize members into teams (e.g. "Youth Leaders", "Bible Study") to share study guides in one click.</p>
        <div className="row">
          <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Group name" />
          <button className="btn">Create group</button>
        </div>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="lbl" style={{ marginTop: 8 }}>YOUR GROUPS ({groups.length})</div>
      {groups.length === 0 && <div className="card muted sm">No groups created yet.</div>}
      <div className="list">
        {groups.map((g) => (
          <div className="card urow" key={g.id}>
            <div className="irow">
              <input className="input" defaultValue={g.name} aria-label="Group name" style={{ maxWidth: 320, fontWeight: 700 }} onBlur={(e) => rename(g, e.target.value)} />
              <div className="row">
                <button className="btn ghost sm" onClick={() => { setEditing(editing === g.id ? null : g.id); setMembers(g.members.map((m) => m.id)); }}>{editing === g.id ? "Close" : "Manage members"}</button>
                <button className="btn danger sm" onClick={() => remove(g)}>Delete</button>
              </div>
            </div>
            <div className="muted sm">{g.members.length} {g.members.length === 1 ? "member" : "members"}{g.members.length ? ": " + g.members.map((m) => m.email).join(", ") : ""}</div>
            {editing === g.id && (
              <div className="gap" style={{ paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                <Picker items={users.map((u) => ({ id: u.id, label: u.email }))} selected={members} onChange={setMembers} label="people" />
                <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => saveMembers(g)}>Save members</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Books({ onRefreshCounts }) {
  const [books, setBooks] = useState([]);
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [visFilter, setVisFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const [draft, setDraft] = useState({ everyone: false, groups: [], users: [] });

  const load = useCallback(async () => {
    try {
      const [b, g, u] = await Promise.all([api("/api/admin/books"), api("/api/admin/groups"), api("/api/admin/users")]);
      setBooks(b); setGroups(g); setUsers(u);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function upload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const book = await api("/api/admin/books", { method: "POST", form });
      await load();
      onRefreshCounts?.();
      startShare(book);
    } catch (err) { setError(err.message); }
    setBusy(false);
    e.target.value = "";
  }

  function startShare(b) {
    setOpen(b.id);
    setDraft({ everyone: b.everyone, groups: b.group_ids, users: b.user_ids });
  }
  async function saveShare(b) {
    setError("");
    try {
      await api(`/api/admin/books/${b.id}/shares`, { method: "PUT", body: draft });
      setOpen(null);
      await load();
    } catch (err) { setError(err.message); }
  }
  async function remove(b) {
    if (!confirm(`Delete "${b.title}" for everyone? Notes people wrote on it are deleted too.`)) return;
    try { await api(`/api/admin/books/${b.id}`, { method: "DELETE" }); await load(); onRefreshCounts?.(); } catch (err) { setError(err.message); }
  }

  const shown = books.filter((b) => {
    if (query.trim() && !`${b.title} ${b.owner_email}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (visFilter === "everyone") return b.everyone;
    if (visFilter === "restricted") return !b.everyone;
    return true;
  });

  return (
    <div className="gap">
      <div className="card form">
        <b>Publish a PDF to the library</b>
        <p className="muted sm" style={{ margin: 0 }}>Upload a PDF document and configure who can read it. Member-uploaded books also appear below.</p>
        <label className="btn" style={{ alignSelf: "flex-start" }}>{busy ? "Uploading PDF..." : "+ Choose a PDF"}<input type="file" accept="application/pdf" hidden onChange={upload} disabled={busy} /></label>
      </div>

      <div className="toolbar">
        <input className="input" placeholder="Search books by title or uploader..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search books" />
        <div className="chips" role="group" aria-label="Filter books">
          {[["all", `All (${books.length})`], ["everyone", "Public to Library"], ["restricted", "Restricted"]].map(([k, lbl]) => (
            <button key={k} type="button" className={"chip" + (visFilter === k ? " on" : "")} onClick={() => setVisFilter(k)}>{lbl}</button>
          ))}
        </div>
      </div>

      {error && <p className="err" role="alert">{error}</p>}
      {shown.length === 0 && <div className="card muted sm">No books match your filter.</div>}

      <div className="list">
        {shown.map((b) => (
          <div className="card urow" key={b.id}>
            <div className="irow" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ wordBreak: "break-word", fontSize: 15 }}>{b.title.replace(/\.pdf$/i, "")}</b>
                <div className="muted sm" style={{ marginTop: 3 }}>
                  {size(b.size)} · uploaded by {b.owner_email} · {when(b.created_at)} · opened {b.opens} {b.opens === 1 ? "time" : "times"} ({b.readers} {b.readers === 1 ? "reader" : "readers"})
                </div>
              </div>
              <div className="row">
                <button className="btn ghost sm" onClick={() => (open === b.id ? setOpen(null) : startShare(b))}>{open === b.id ? "Close" : "Access & sharing"}</button>
                <button className="btn danger sm" onClick={() => remove(b)}>Delete</button>
              </div>
            </div>
            <div className="tags">
              {b.shared_with.length === 0 && <span className="tag">Only {b.owner_email}</span>}
              {b.shared_with.map((s) => <span key={s.kind + s.label} className={"tag" + (s.kind === "all" ? " all" : "")}>{s.label}</span>)}
            </div>
            {open === b.id && (
              <div className="gap" style={{ paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                <label className="ctl">
                  <input type="checkbox" checked={draft.everyone} onChange={(e) => setDraft({ ...draft, everyone: e.target.checked })} />
                  <span><b>Everyone</b> with Library access</span>
                </label>
                {!draft.everyone && (
                  <>
                    <div className="lbl">GROUPS</div>
                    <Picker items={groups.map((g) => ({ id: g.id, label: `${g.name} (${g.members.length})` }))} selected={draft.groups} onChange={(v) => setDraft({ ...draft, groups: v })} label="groups" />
                    <div className="lbl">INDIVIDUAL PEOPLE</div>
                    <Picker items={users.map((u) => ({ id: u.id, label: u.email }))} selected={draft.users} onChange={(v) => setDraft({ ...draft, users: v })} label="people" />
                  </>
                )}
                <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => saveShare(b)}>Save permissions</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Usage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    api(`/api/admin/usage?days=${days}`).then(setData).catch((e) => setError(e.message));
  }, [days]);
  const max = data ? Math.max(1, ...data.daily.map((d) => d.opens)) : 1;

  return (
    <div className="gap">
      <div className="chips" role="group" aria-label="Period">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" className={"chip" + (days === d ? " on" : "")} onClick={() => setDays(d)}>Last {d} days</button>
        ))}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading analytics...</p>}
      {data && (
        <div className="gap" style={{ gap: 16 }}>
          <div className="stats">
            {[["Books opened", data.opens], ["Active readers", data.active_people], ["Recordings transcribed", data.recordings], ["Minutes transcribed", data.minutes]].map(([l, v]) => (
              <div className="stat" key={l}><span className="muted sm">{l}</span><b>{v}</b></div>
            ))}
          </div>
          <div className="card">
            <b>Daily book opens</b>
            <div className="chart" role="img" aria-label={`Books opened each day over the last ${data.days} days`}>
              {data.daily.map((d) => <i key={d.date} title={`${d.date}: ${d.opens}`} style={{ height: Math.max(3, (d.opens / max) * 112) }} />)}
            </div>
            <div className="axis"><span>{data.daily[0].date}</span><span>Peak: {max === 1 && data.opens === 0 ? 0 : max} opens/day</span><span>{data.daily[data.daily.length - 1].date}</span></div>
          </div>
          <div className="card wide">
            <b>Most read books</b>
            <table className="tbl"><thead><tr><th>Book</th><th className="n">Opened</th><th className="n">Readers</th></tr></thead>
              <tbody>
                {data.top_books.length === 0 && <tr><td colSpan={3} className="muted">Nothing opened in this period.</td></tr>}
                {data.top_books.map((b) => <tr key={b.id}><td>{b.title.replace(/\.pdf$/i, "")}</td><td className="n">{b.opens}</td><td className="n">{b.readers}</td></tr>)}
              </tbody></table>
          </div>
          <div className="card wide">
            <b>Most active members</b>
            <table className="tbl"><thead><tr><th>Member</th><th className="n">Books opened</th><th className="n">Recordings</th><th className="n">Minutes</th><th>Last active</th></tr></thead>
              <tbody>
                {data.people.length === 0 && <tr><td colSpan={5} className="muted">No activity in this period.</td></tr>}
                {data.people.map((p) => <tr key={p.user_id}><td>{p.email}</td><td className="n">{p.events}</td><td className="n">{p.recordings}</td><td className="n">{p.minutes}</td><td>{when(p.last_active)}</td></tr>)}
              </tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsAdmin() {
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [kind, setKind] = useState("announcement");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api("/api/admin/notifications").then(setItems).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    api("/api/admin/users").then(setUsers).catch(() => {});
  }, [load]);

  async function send(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setError(""); setMsg("");
    try {
      await api("/api/admin/notifications", {
        method: "POST",
        body: { kind, title: title.trim(), body: body.trim(), link: link.trim(), user_id: targetUser || null },
      });
      setTitle(""); setBody(""); setLink(""); setTargetUser("");
      setMsg("Notification sent.");
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function remove(id) {
    try {
      await api(`/api/admin/notifications/${id}`, { method: "DELETE" });
      setItems((list) => list.filter((x) => x.id !== id));
    } catch (e) { setError(e.message); }
  }

  const LABELS = { announcement: "Announcement", new_book: "New Book", system: "System Alert", reminder: "Reminder" };

  return (
    <div className="gap">
      <form className="card form" onSubmit={send}>
        <b>Send a notification</b>
        {error && <p className="err" role="alert">{error}</p>}
        {msg && <div className="ok-banner">{msg}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
          <label className="gap" style={{ gap: 5, fontSize: 13 }}>
            <span className="muted">Category</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="announcement">Announcement</option>
              <option value="new_book">New Book</option>
              <option value="system">System Alert</option>
              <option value="reminder">Reminder</option>
            </select>
          </label>
          <label className="gap" style={{ gap: 5, fontSize: 13 }}>
            <span className="muted">Recipient</span>
            <select className="input" value={targetUser} onChange={(e) => setTargetUser(e.target.value)}>
              <option value="">All members (Broadcast)</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
          </label>
        </div>
        <input className="input" placeholder="Notification title (e.g. New Study Guide Added)" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea className="input" rows={3} placeholder="Message details..." value={body} onChange={(e) => setBody(e.target.value)} />
        <input className="input" placeholder="Optional link (e.g. / or /transcribe/)" value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn" style={{ alignSelf: "flex-start" }} disabled={busy || !title.trim()}>{busy ? "Sending..." : "Send Notification"}</button>
      </form>

      <div className="lbl" style={{ marginTop: 8 }}>RECENTLY SENT ({items.length})</div>
      {items.length === 0 && <div className="card muted sm">No notifications sent yet.</div>}
      <div className="list">
        {items.map((n) => (
          <div className="card irow" key={n.id}>
            <div style={{ minWidth: 0 }}>
              <div className="badges">
                <span className="badge">{LABELS[n.kind] || n.kind}</span>
                <b>{n.title}</b>
                <span className="muted sm">{n.user_id ? "Direct" : "All members"} · {when(n.created_at)}</span>
              </div>
              {n.body && <p className="muted sm" style={{ margin: "5px 0 0" }}>{n.body}</p>}
            </div>
            <button type="button" className="btn danger sm" onClick={() => remove(n.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const NAV = [
  ["overview", "Overview", null],
  ["people", "People", "users"],
  ["groups", "Groups", null],
  ["books", "Books", "documents"],
  ["usage", "Usage", null],
  ["invites", "Add people", "pending_invites"],
  ["notifications", "Notifications", null],
];

const TITLES = {
  overview: ["Overview", "Live snapshot of HIM Ministries members, library documents, and sermon transcriptions."],
  people: ["People & Access", "Manage member accounts, admin privileges, and app permissions."],
  groups: ["Ministry Groups", "Organize members into teams for instant document sharing."],
  books: ["Library Books", "Upload PDFs and control who can read each resource."],
  usage: ["Usage Analytics", "Track daily reading activity, top books, and active members."],
  invites: ["Add People", "Pre-approve member emails for instant registration."],
  notifications: ["Notifications", "Send announcements and study alerts across HIM Ministries."],
};

export default function AdminPage() {
  const [me, setMe] = useState(null);
  const [fatal, setFatal] = useState("");
  const [tab, setTab] = useState("overview");
  const [theme, setTheme] = useState("sky");
  const [overview, setOverview] = useState(null);
  const [ovError, setOvError] = useState("");

  useEffect(() => {
    const t = getTheme();
    setTheme(t);
    applyTheme(t);
  }, []);

  const refreshOverview = useCallback(() => {
    api("/api/admin/overview").then(setOverview).catch((e) => setOvError(e.message));
  }, []);

  useEffect(() => {
    (async () => {
      if (!getToken()) { window.location.href = "/"; return; }
      try {
        const r = await api("/api/auth/me");
        setUser(r.user);
        if (r.user.role !== "admin") { window.location.href = r.home; return; }
        setMe(r.user);
        refreshOverview();
      } catch (e) {
        if (e.status === 401) window.location.href = "/";
        else setFatal(e.message);
      }
    })();
  }, [refreshOverview]);

  if (fatal) return <div className="wrap"><p className="err" role="alert">{fatal}</p></div>;
  if (!me) return null;

  const [heading, desc] = TITLES[tab];

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <img src="/admin/favicon.svg" alt="" width={38} height={38} style={{ borderRadius: 11 }} />
          <div className="brand-text">
            <span className="brand-title">HIM Ministries <span className="brand-pill">Admin</span></span>
            <span className="brand-sub">Workspace & Content Console</span>
          </div>
        </div>
        <div className="top-acts">
          <select
            className="theme-sel"
            aria-label="Theme"
            value={theme}
            onChange={(e) => { setTheme(e.target.value); applyTheme(e.target.value); }}
          >
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <a className="btn ghost" href="/">Library</a>
          <a className="btn ghost" href="/transcribe/">Transcribe</a>
        </div>
      </header>

      <div className="shell">
        <aside className="rail" role="tablist" aria-label="Admin sections">
          <div className="rail-lbl">Management</div>
          {NAV.map(([k, label, countKey]) => {
            const count = overview && countKey ? overview[countKey] : null;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={"nav-item" + (tab === k ? " on" : "")}
                onClick={() => setTab(k)}
              >
                <span className="nav-left"><Icon name={k} /><span>{label}</span></span>
                {count !== null && count !== undefined && (
                  <span className={"nav-badge" + (countKey === "pending_invites" && count > 0 ? " warn" : "")}>{count}</span>
                )}
              </button>
            );
          })}
          <div className="rail-foot">
            <span className="lbl" style={{ padding: 0 }}>Signed in as</span>
            <span className="me-chip" title={me.email}>{me.email}</span>
          </div>
        </aside>

        <main className="main">
          <div className="page-head">
            <div>
              <h1 className="title">{heading}</h1>
              <p className="subtitle">{desc}</p>
            </div>
          </div>

          {tab === "overview" && <Overview data={overview} error={ovError} onNavigate={setTab} />}
          {tab === "people" && <People me={me} onRefreshCounts={refreshOverview} />}
          {tab === "groups" && <Groups onRefreshCounts={refreshOverview} />}
          {tab === "books" && <Books onRefreshCounts={refreshOverview} />}
          {tab === "usage" && <Usage />}
          {tab === "invites" && <Invites onRefreshCounts={refreshOverview} />}
          {tab === "notifications" && <NotificationsAdmin />}
        </main>
      </div>
    </div>
  );
}
