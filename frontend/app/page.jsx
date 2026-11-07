"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, setToken } from "../lib/api";
import { idbAll, idbDel, idbDelPrefix, idbKeys, idbPut } from "../lib/db";
import { clearLocalNotes, syncNotes } from "../lib/notes";
import { applyTheme, getTheme } from "../lib/theme";

const Icon = ({ d, size = 24, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const P = {
  book: <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13" />,
  pencil: <path d="M4 20l4-1 11-11-3-3L5 16z" />,
  download: <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4" />,
  play: <path d="M7 4l13 8-13 8z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
};

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function Cover({ id, children, ...rest }) {
  const h = hash(id);
  return (
    <>
      <i className={"s" + (h % 3)} />
      {children}
    </>
  );
}
const coverClass = (id) => "cv c" + (hash(id) % 4);
const cleanTitle = (t) => t.replace(/\.pdf$/i, "");
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

function AuthForm({ onDone }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api(`/api/auth/${mode}`, { method: "POST", body: { email, password, invite_code: invite } });
      setToken(res.token);
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <form className="auth" onSubmit={submit}>
      <h1 className="title" style={{ fontSize: 30 }}>Read-Aloud PDF</h1>
      <p className="muted" style={{ margin: 0 }}>{mode === "login" ? "Sign in to your library." : "Create an account with your invite code."}</p>
      <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Email" />
      <input className="input" type="password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required aria-label="Password" />
      {mode === "register" && <input className="input" placeholder="Invite code" value={invite} onChange={(e) => setInvite(e.target.value)} aria-label="Invite code" />}
      {error && <div className="err" role="alert">{error}</div>}
      <button className="btn" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"}</button>
      <button type="button" className="btn ghost" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "I have an invite code" : "Back to sign in"}
      </button>
    </form>
  );
}

function Library({ onLogout }) {
  const [docs, setDocs] = useState([]);
  const [offline, setOffline] = useState(new Set());
  const [notes, setNotes] = useState([]);
  const [tab, setTab] = useState("library");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState("system");

  const loadNotes = useCallback(async () => {
    try {
      const all = await idbAll("notes");
      setNotes(all.filter((n) => !n.deleted).sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    } catch {}
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api("/api/documents");
      setDocs(d);
      localStorage.setItem("docs", JSON.stringify(d));
    } catch (e) {
      if (e.status !== 401) {
        setDocs(JSON.parse(localStorage.getItem("docs") || "[]"));
        setMsg("Could not reach the server. Showing your saved library.");
      }
    }
    try {
      setOffline(new Set(await idbKeys("pdfs")));
    } catch {}
    await loadNotes();
    if (navigator.onLine) syncNotes().then(loadNotes);
  }, [loadNotes]);

  useEffect(() => {
    setTheme(getTheme());
    load();
  }, [load]);

  async function upload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      await api("/api/documents", { method: "POST", form });
      await load();
    } catch (err) {
      setMsg(err.message);
    }
    setBusy(false);
    e.target.value = "";
  }

  async function remove(d) {
    if (!confirm(`Delete "${d.title}"?`)) return;
    try {
      await api(`/api/documents/${d.id}`, { method: "DELETE" });
      await idbDel("pdfs", d.id);
      await idbDelPrefix("paras", d.id + ":");
      await load();
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function saveOffline(d) {
    setMsg("Downloading...");
    try {
      const res = await api(`/api/documents/${d.id}/file`, { raw: true });
      await idbPut("pdfs", d.id, await res.blob());
      setMsg("");
      await load();
    } catch (err) {
      setMsg(err.message);
    }
  }

  function chooseTheme(t) {
    setTheme(t);
    applyTheme(t);
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const lastId = typeof window !== "undefined" ? localStorage.getItem("last") : null;
  const last = docs.find((d) => d.id === lastId);
  const lastPages = last ? Number(localStorage.getItem("pages:" + last.id)) || 0 : 0;
  const started = (d) => d.last_page > 1 || d.last_paragraph > 0;

  let shown = docs.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()));
  if (tab === "offline") shown = shown.filter((d) => offline.has(d.id));
  if (filter === "progress") shown = shown.filter(started);
  const titleOf = (id) => (docs.find((d) => d.id === id) || {}).title || "PDF";

  return (
    <div className="wrap">
      {msg && <div className="err" role="alert">{msg}</div>}

      {tab === "library" || tab === "offline" ? (
        <>
          <div className="row between">
            <div>
              <div className="greet">{tab === "offline" ? "Available without internet" : greeting}</div>
              <h1 className="title">{tab === "offline" ? "Offline PDFs" : "What will you listen to?"}</h1>
            </div>
          </div>

          {tab === "library" && last && (
            <div className="hero">
              <Link href={`/reader/?id=${last.id}`} className={coverClass(last.id)} aria-label={`Open ${last.title}`}>
                <Cover id={last.id} />
              </Link>
              <div className="info">
                <div>
                  <div className="eyebrow">CONTINUE LISTENING</div>
                  <div className="htitle">{cleanTitle(last.title)}</div>
                  <div className="muted sm" style={{ marginTop: 4 }}>
                    Page {last.last_page}{lastPages ? ` of ${lastPages}` : ""}
                  </div>
                </div>
                <div className="row" style={{ gap: 12 }}>
                  <Link href={`/reader/?id=${last.id}`} className="go" aria-label="Resume listening"><Icon size={22} fill d={P.play} /></Link>
                  <div className="bar"><i style={{ width: (lastPages ? Math.min(100, (last.last_page / lastPages) * 100) : 0) + "%" }} /></div>
                </div>
              </div>
            </div>
          )}

          <div className="row" style={{ marginTop: 20 }}>
            <input className="input" placeholder="Search your PDFs" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your PDFs" />
          </div>
          <div className="chips">
            <button className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>All</button>
            <button className={"chip" + (filter === "progress" ? " on" : "")} onClick={() => setFilter("progress")}>In progress</button>
          </div>

          <div className="row between" style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{tab === "offline" ? "Saved on this device" : "Your library"}</h2>
            <span className="muted sm">{shown.length} PDFs</span>
          </div>
          {shown.length === 0 && (
            <p className="muted">{tab === "offline" ? "Nothing saved yet. Use \"Save offline\" on a PDF in your library." : "No PDFs yet. Tap the + button to upload one."}</p>
          )}
          <div className="grid">
            {shown.map((d) => (
              <div key={d.id}>
                <Link href={`/reader/?id=${d.id}`} className={coverClass(d.id)} aria-label={`Open ${d.title}`}>
                  <Cover id={d.id} />
                  {offline.has(d.id) && <span className="badge">Offline</span>}
                </Link>
                <div className="dt">{cleanTitle(d.title)}</div>
                <div className="muted sm" style={{ marginTop: 2 }}>{fmtSize(d.size)} · {started(d) ? `Page ${d.last_page}` : "Not started"}</div>
                <div className="row" style={{ marginTop: 8, gap: 6 }}>
                  {!offline.has(d.id) && <button className="chip sm" onClick={() => saveOffline(d)}>Save offline</button>}
                  <button className="ib" style={{ width: 36, height: 36 }} aria-label={`Delete ${d.title}`} onClick={() => remove(d)}><Icon size={18} d={P.trash} /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {tab === "notes" && (
        <>
          <div className="greet">Everything you wrote</div>
          <h1 className="title">All notes</h1>
          {notes.length === 0 && <p className="muted">No notes yet. Open a PDF and tap the pencil button.</p>}
          {notes.map((n) => (
            <Link key={n.id} className="nrow" href={`/reader/?id=${n.document_id}&page=${n.page}`}>
              <div className="muted sm">{cleanTitle(titleOf(n.document_id))} · Page {n.page}{n.paragraph != null ? ` · Paragraph ${n.paragraph + 1}` : ""}</div>
              <div style={{ fontSize: 14, marginTop: 4, whiteSpace: "pre-wrap" }}>{n.body.slice(0, 160) || "(empty)"}</div>
            </Link>
          ))}
        </>
      )}

      {tab === "settings" && (
        <>
          <div className="greet">Make it yours</div>
          <h1 className="title">Settings</h1>
          <div className="lbl" style={{ marginTop: 24 }}>APPEARANCE</div>
          <div className="seg" style={{ marginTop: 8 }} role="group" aria-label="Theme">
            {["system", "light", "dark"].map((t) => (
              <button key={t} className={theme === t ? "on" : ""} aria-pressed={theme === t} onClick={() => chooseTheme(t)}>
                {t === "system" ? "Match device" : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="lbl" style={{ marginTop: 28 }}>ACCOUNT</div>
          <button className="btn ghost" style={{ marginTop: 8, width: "100%" }} onClick={onLogout}>Sign out</button>
        </>
      )}

      {(tab === "library" || tab === "offline") && (
        <label className="upload" aria-label="Add PDF">
          {busy ? "…" : <Icon size={26} d={P.plus} />}
          <input type="file" accept="application/pdf" onChange={upload} hidden disabled={busy} />
        </label>
      )}

      <nav className="tabbar" aria-label="Main">
        {[["library", "Library", P.book], ["notes", "Notes", P.pencil], ["offline", "Offline", P.download], ["settings", "Settings", P.sliders]].map(([k, label, d]) => (
          <button key={k} className={"tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => { setTab(k); if (k === "notes") loadNotes(); }}>
            <Icon d={d} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(!!getToken());
    setReady(true);
    const lost = () => setAuthed(false);
    window.addEventListener("auth-lost", lost);
    return () => window.removeEventListener("auth-lost", lost);
  }, []);
  if (!ready) return null;
  return authed ? (
    <Library onLogout={() => { clearLocalNotes().catch(() => {}); setToken(null); setAuthed(false); }} />
  ) : (
    <AuthForm onDone={() => setAuthed(true)} />
  );
}