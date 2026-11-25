"use client";
import { useCallback, useEffect, useState } from "react";
import { api, getToken, setUser } from "../lib/api";

const APPS = [["library", "Library"], ["transcribe", "Transcribe"]];
const when = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never");

function Switch({ on, label, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={"sw" + (on ? " on" : "")} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

function Overview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/api/admin/overview").then(setData).catch((e) => setError(e.message));
  }, []);
  if (error) return <p className="err" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading...</p>;
  const items = [["People", data.users], ["Active", data.active_users], ["Admins", data.admins], ["Waiting to join", data.pending_invites], ["PDFs uploaded", data.documents], ["Notes written", data.notes], ["Recordings transcribed", data.transcriptions || 0], ["Minutes transcribed", data.minutes_transcribed || 0]];
  return (
    <div className="stats">
      {items.map(([label, value]) => (
        <div className="stat" key={label}><b>{value}</b><span className="muted sm">{label}</span></div>
      ))}
    </div>
  );
}

function People({ me }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
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
    } catch (e) {
      setError(e.message);
    }
  }

  const shown = users.filter((u) => u.email.includes(query.trim().toLowerCase()));
  return (
    <>
      <input className="input" placeholder="Search people by email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people by email" />
      {error && <p className="err" role="alert">{error}</p>}
      {loading && <p className="muted">Loading...</p>}
      {shown.map((u) => {
        const isAdmin = u.role === "admin";
        return (
          <div className="card urow" key={u.id}>
            <div className="uhead">
              <b>{u.email}</b>
              {isAdmin && <span className="badge">Admin</span>}
              {u.id === me.id && <span className="muted sm">(you)</span>}
              {!u.is_active && <span className="badge off">Disabled</span>}
            </div>
            <div className="muted sm">Joined {when(u.created_at)} · Last sign-in {when(u.last_login_at)} · {u.documents} PDFs</div>
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
      {!loading && shown.length === 0 && <p className="muted">No one matches.</p>}
    </>
  );
}

function Invites() {
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
      setNote(`Saved. ${email.trim().toLowerCase()} can now create an account with this email, without an invite code.`);
      setEmail("");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    try {
      await api(`/api/admin/invites/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const toggle = (key) => setApps((a) => (a.includes(key) ? a.filter((x) => x !== key) : [...a, key]));

  return (
    <>
      <form className="card form" onSubmit={submit}>
        <b>Add a person</b>
        <input className="input" type="email" placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Their email" />
        <div className="opts" role="group" aria-label="Apps">
          {APPS.map(([key, label]) => (
            <label className="ctl" key={key} style={{ paddingTop: 0 }}>
              <input type="checkbox" checked={apps.includes(key)} onChange={() => toggle(key)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="user">Regular person</option>
          <option value="admin">Admin</option>
        </select>
        {error && <div className="err" role="alert" style={{ margin: 0 }}>{error}</div>}
        {note && <div className="muted sm" role="status">{note}</div>}
        <button className="btn">Save</button>
      </form>

      <div className="lbl" style={{ marginTop: 24 }}>WAITING TO JOIN</div>
      {invites.length === 0 && <p className="muted">No one is waiting.</p>}
      {invites.map((i) => (
        <div className="card irow" key={i.id}>
          <div>
            <b>{i.email}</b>
            <div className="muted sm">{i.role === "admin" ? "Admin · " : ""}{i.apps.join(", ") || "no apps"} · added {when(i.created_at)}</div>
          </div>
          <button className="btn ghost" style={{ height: 38 }} onClick={() => remove(i.id)}>Remove</button>
        </div>
      ))}
    </>
  );
}

function Picker({ items, selected, onChange, label, search = true }) {
  const [q, setQ] = useState("");
  const shown = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="gap" style={{ gap: 8 }}>
      {search && items.length > 6 && <input className="input" placeholder={`Search ${label}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${label}`} />}
      <div className="pick" role="group" aria-label={label}>
        {shown.length === 0 && <span className="muted sm" style={{ padding: 8 }}>Nothing to show.</span>}
        {shown.map((i) => (
          <label key={i.id}><input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} /><span>{i.label}</span></label>
        ))}
      </div>
    </div>
  );
}

const size = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

function Groups() {
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

  const run = async (fn) => { setError(""); try { await fn(); await load(); } catch (e) { setError(e.message); } };
  const create = (e) => { e.preventDefault(); run(async () => { await api("/api/admin/groups", { method: "POST", body: { name } }); setName(""); }); };
  const saveMembers = (g) => run(async () => { await api(`/api/admin/groups/${g.id}`, { method: "PATCH", body: { members } }); setEditing(null); });
  const rename = (g, value) => { if (value.trim() && value !== g.name) run(() => api(`/api/admin/groups/${g.id}`, { method: "PATCH", body: { name: value } })); };
  const remove = (g) => { if (confirm(`Delete the group "${g.name}"? Books shared with it will stop being shared with its members.`)) run(() => api(`/api/admin/groups/${g.id}`, { method: "DELETE" })); };

  return (
    <>
      <form className="card form" onSubmit={create}>
        <b>New group</b>
        <p className="muted sm" style={{ margin: 0 }}>A group is a set of people, such as "Youth team". Share a book with the group once instead of with each person.</p>
        <input className="input" placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Group name" />
        <button className="btn">Create group</button>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="lbl" style={{ marginTop: 24 }}>YOUR GROUPS</div>
      {groups.length === 0 && <p className="muted">No groups yet.</p>}
      {groups.map((g) => (
        <div className="card urow" key={g.id}>
          <div className="irow" style={{ marginTop: 0 }}>
            <input className="input" defaultValue={g.name} aria-label="Group name" style={{ maxWidth: 320, fontWeight: 700 }} onBlur={(e) => rename(g, e.target.value)} />
            <div className="row">
              <button className="btn ghost" style={{ height: 38 }} onClick={() => { setEditing(editing === g.id ? null : g.id); setMembers(g.members.map((m) => m.id)); }}>{editing === g.id ? "Close" : "Edit people"}</button>
              <button className="btn ghost" style={{ height: 38 }} onClick={() => remove(g)}>Delete</button>
            </div>
          </div>
          <div className="muted sm">{g.members.length} {g.members.length === 1 ? "person" : "people"}{g.members.length ? ": " + g.members.map((m) => m.email).join(", ") : ""}</div>
          {editing === g.id && (
            <div className="gap">
              <Picker items={users.map((u) => ({ id: u.id, label: u.email }))} selected={members} onChange={setMembers} label="people" />
              <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => saveMembers(g)}>Save people</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function Books() {
  const [books, setBooks] = useState([]);
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
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
    try { await api(`/api/admin/books/${b.id}`, { method: "DELETE" }); await load(); } catch (err) { setError(err.message); }
  }

  return (
    <>
      <div className="card form">
        <b>Add a book</b>
        <p className="muted sm" style={{ margin: 0 }}>Upload a PDF, then choose who can read it. Books people upload themselves also appear below.</p>
        <label className="btn" style={{ alignSelf: "flex-start" }}>{busy ? "Uploading..." : "Choose a PDF"}<input type="file" accept="application/pdf" hidden onChange={upload} disabled={busy} /></label>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="lbl" style={{ marginTop: 24 }}>ALL BOOKS ({books.length})</div>
      {books.length === 0 && <p className="muted">No books yet.</p>}
      {books.map((b) => (
        <div className="card urow" key={b.id}>
          <div className="irow" style={{ marginTop: 0, alignItems: "flex-start" }}>
            <div>
              <b style={{ wordBreak: "break-word" }}>{b.title.replace(/\.pdf$/i, "")}</b>
              <div className="muted sm">{size(b.size)} · added by {b.owner_email} · {when(b.created_at)} · opened {b.opens} {b.opens === 1 ? "time" : "times"} by {b.readers} {b.readers === 1 ? "person" : "people"}</div>
            </div>
            <div className="row">
              <button className="btn ghost" style={{ height: 38 }} onClick={() => (open === b.id ? setOpen(null) : startShare(b))}>{open === b.id ? "Close" : "Who can read"}</button>
              <button className="btn ghost" style={{ height: 38 }} onClick={() => remove(b)}>Delete</button>
            </div>
          </div>
          <div className="tags">
            {b.shared_with.length === 0 && <span className="tag">Only {b.owner_email}</span>}
            {b.shared_with.map((s) => <span key={s.kind + s.label} className={"tag" + (s.kind === "all" ? " all" : "")}>{s.label}</span>)}
          </div>
          {open === b.id && (
            <div className="gap">
              <label className="ctl" style={{ paddingTop: 0 }}><input type="checkbox" checked={draft.everyone} onChange={(e) => setDraft({ ...draft, everyone: e.target.checked })} /><span><b>Everyone</b> with Library access</span></label>
              {!draft.everyone && (
                <>
                  <div className="lbl">GROUPS</div>
                  <Picker items={groups.map((g) => ({ id: g.id, label: `${g.name} (${g.members.length})` }))} selected={draft.groups} onChange={(v) => setDraft({ ...draft, groups: v })} label="groups" />
                  <div className="lbl">INDIVIDUAL PEOPLE</div>
                  <Picker items={users.map((u) => ({ id: u.id, label: u.email }))} selected={draft.users} onChange={(v) => setDraft({ ...draft, users: v })} label="people" />
                </>
              )}
              <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => saveShare(b)}>Save</button>
            </div>
          )}
        </div>
      ))}
    </>
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
    <>
      <select className="input" style={{ maxWidth: 220 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
        <option value={90}>Last 90 days</option>
      </select>
      {error && <p className="err" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading...</p>}
      {data && (
        <div className="gap" style={{ marginTop: 14, gap: 16 }}>
          <div className="stats">
            {[["Books opened", data.opens], ["Active people", data.active_people], ["Recordings transcribed", data.recordings], ["Minutes transcribed", data.minutes]].map(([l, v]) => (
              <div className="stat" key={l}><b>{v}</b><span className="muted sm">{l}</span></div>
            ))}
          </div>
          <div className="card">
            <b>Books opened each day</b>
            <div className="chart" role="img" aria-label={`Books opened each day over the last ${data.days} days`}>
              {data.daily.map((d) => <i key={d.date} title={`${d.date}: ${d.opens}`} style={{ height: Math.max(2, (d.opens / max) * 112) }} />)}
            </div>
            <div className="axis"><span>{data.daily[0].date}</span><span>busiest day: {max === 1 && data.opens === 0 ? 0 : max}</span><span>{data.daily[data.daily.length - 1].date}</span></div>
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
            <b>Most active people</b>
            <table className="tbl"><thead><tr><th>Person</th><th className="n">Books opened</th><th className="n">Recordings</th><th className="n">Minutes</th><th>Last active</th></tr></thead>
              <tbody>
                {data.people.length === 0 && <tr><td colSpan={5} className="muted">No activity in this period.</td></tr>}
                {data.people.map((p) => <tr key={p.user_id}><td>{p.email}</td><td className="n">{p.events}</td><td className="n">{p.recordings}</td><td className="n">{p.minutes}</td><td>{when(p.last_active)}</td></tr>)}
              </tbody></table>
          </div>
        </div>
      )}
    </>
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
    <div style={{ display: "grid", gap: 18 }}>
      <form className="card" onSubmit={send} style={{ display: "grid", gap: 12 }}>
        <b>Send a notification</b>
        {error && <p className="err" role="alert">{error}</p>}
        {msg && <p className="muted sm" style={{ color: "var(--accent-text)", fontWeight: 600 }}>{msg}</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          <label style={{ display: "grid", gap: 5, fontSize: 13 }}>
            <span>Category</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="announcement">Announcement</option>
              <option value="new_book">New Book</option>
              <option value="system">System Alert</option>
              <option value="reminder">Reminder</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 13 }}>
            <span>Recipient</span>
            <select className="input" value={targetUser} onChange={(e) => setTargetUser(e.target.value)}>
              <option value="">All members (Broadcast)</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
          </label>
        </div>
        <input className="input" placeholder="Notification title (e.g. New Study Guide Added)" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea className="input" rows={3} placeholder="Message details..." value={body} onChange={(e) => setBody(e.target.value)} style={{ height: "auto", padding: 12 }} />
        <input className="input" placeholder="Optional link (e.g. / or /transcribe/)" value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn" disabled={busy || !title.trim()}>{busy ? "Sending..." : "Send Notification"}</button>
      </form>
      <div style={{ display: "grid", gap: 10 }}>
        <b className="muted sm">RECENTLY SENT ({items.length})</b>
        {items.length === 0 && <p className="muted sm">No notifications sent yet.</p>}
        {items.map((n) => (
          <div className="card row between" key={n.id} style={{ gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="pill" style={{ fontSize: 11 }}>{LABELS[n.kind] || n.kind}</span>
                <b>{n.title}</b>
                <span className="muted sm">{n.user_id ? "Direct" : "All members"} · {when(n.created_at)}</span>
              </div>
              {n.body && <p className="muted sm" style={{ marginTop: 4 }}>{n.body}</p>}
            </div>
            <button type="button" className="btn ghost" style={{ height: 36 }} onClick={() => remove(n.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [me, setMe] = useState(null);
  const [fatal, setFatal] = useState("");
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    (async () => {
      if (!getToken()) { window.location.href = "/"; return; }
      try {
        const r = await api("/api/auth/me");
        setUser(r.user);
        if (r.user.role !== "admin") { window.location.href = r.home; return; }
        setMe(r.user);
      } catch (e) {
        if (e.status === 401) window.location.href = "/";
        else setFatal(e.message);
      }
    })();
  }, []);

  if (fatal) return <div className="wrap"><p className="err" role="alert">{fatal}</p></div>;
  if (!me) return null;

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand"><i>A</i>Admin</div>
        <div className="row">
          <a className="btn ghost" style={{ height: 40 }} href="/">Library</a>
        </div>
      </div>
      <h1 className="title">{{ overview: "Overview", people: "People and access", groups: "Groups", books: "Books and sharing", usage: "Usage", invites: "Add people", notifications: "Notifications" }[tab]}</h1>
      <div className="tabs" role="tablist">
        {[["overview", "Overview"], ["people", "People"], ["groups", "Groups"], ["books", "Books"], ["usage", "Usage"], ["invites", "Add people"], ["notifications", "Notifications"]].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "people" && <People me={me} />}
      {tab === "groups" && <Groups />}
      {tab === "books" && <Books />}
      {tab === "usage" && <Usage />}
      {tab === "invites" && <Invites />}
      {tab === "notifications" && <NotificationsAdmin />}
    </div>
  );
}
