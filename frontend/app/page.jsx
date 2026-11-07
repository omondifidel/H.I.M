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
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.6 6.6C3.7 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 004.1-.9" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  mic: <path d="M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3" />,
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

const WAVE = [30, 56, 78, 44, 64, 90, 52, 36, 70, 48, 84, 40, 60, 28, 74, 46, 58, 34];
const MINI = [12, 24, 32, 18, 28, 14, 22, 10];

function strength(pw) {
  if (!pw) return { score: 0, label: "" };
  if (pw.length < 8) return { score: 1, label: "Too short" };
  let s = 1;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  s = Math.min(4, s);
  return { score: s, label: ["", "Weak", "Okay", "Good", "Strong"][s] };
}

function AuthForm({ onDone }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [show, setShow] = useState(false);
  const [errs, setErrs] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const reg = mode === "register";
  const st = strength(password);

  function wiggle() {
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }
  function switchMode(m) {
    setMode(m);
    setErrs({});
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    const v = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) v.email = "Enter a valid email address.";
    if (!password) v.password = "Enter your password.";
    else if (reg && password.length < 8) v.password = "Use at least 8 characters.";
    if (reg && !invite.trim()) v.invite = "Enter your invite code.";
    setErrs(v);
    if (Object.keys(v).length) { wiggle(); return; }
    setBusy(true);
    try {
      const res = await api(`/api/auth/${mode}`, { method: "POST", body: { email, password, invite_code: invite } });
      setToken(res.token);
      onDone();
    } catch (err) {
      if (err.status === 403) setErrs({ invite: err.message });
      else if (err.status === 409) setErrs({ email: err.message });
      else setError(err.message);
      wiggle();
    }
    setBusy(false);
  }

  return (
    <div className="authx">
      <section className="brand">
        <div className="row between">
          <div className="logo"><i><Icon size={18} fill d={P.play} /></i>Read-Aloud</div>
          {reg && <span className="badge only-m">Invite only</span>}
        </div>

        {reg ? (
          <div className="strip only-m" aria-hidden="true">
            <i className="c1" /><i className="c2" /><i className="c3" />
            <span className="pbig"><Icon size={30} fill d={P.play} /></span>
          </div>
        ) : (
          <div className="art" aria-hidden="true">
            <div className="pc a" />
            <div className="pc b" />
            <div className="pc f">
              <div className="ln t" />
              <div className="ln" style={{ width: "90%" }} />
              <div className="ln" style={{ width: "60%", background: "var(--accent)" }} />
              <div className="ln" style={{ width: "80%" }} />
              <div className="mini">
                {MINI.map((h, i) => <i key={i} style={{ height: h, animationDelay: `${-i * 0.15}s`, opacity: i < 4 ? 1 : 0.45 }} />)}
              </div>
              <div className="pb"><Icon size={22} fill d={P.play} /></div>
            </div>
          </div>
        )}

        <div>
          <h1 className="ah only-m">{reg ? "Join with your invite code" : "Your PDFs, read to you."}</h1>
          <h1 className="ah only-d">Listen to everything you read.</h1>
          <p className="as only-m" style={{ marginTop: 12 }}>
            {reg ? "Create your account and start listening in under a minute." : "Sign in to pick up right where you stopped listening."}
          </p>
          <p className="as only-d" style={{ marginTop: 16 }}>Upload a PDF, press play, and let it read to you while you write notes beside it.</p>
        </div>

        <div className="feats">
          <div className="ft"><span className="ic"><Icon size={22} d={P.mic} /></span><div><b>Natural voices, your speed</b><div className="muted sm">Change voice and pace any time.</div></div></div>
          <div className="ft"><span className="ic"><Icon size={22} d={P.pencil} /></span><div><b>Notes that work offline</b><div className="muted sm">Pinned to the paragraph you are on.</div></div></div>
          <div className="ft"><span className="ic"><Icon size={22} d={P.download} /></span><div><b>Pick up where you stopped</b><div className="muted sm">On your phone, tablet or computer.</div></div></div>
        </div>

        <div className="bars" aria-hidden="true">
          {WAVE.map((h, i) => <i key={i} className={i < 7 ? "on" : ""} style={{ height: h, animationDelay: `${-(i % 9) * 0.17}s` }} />)}
        </div>
      </section>

      <section className="formside">
        <form className={"formbox" + (shake ? " shake" : "")} onSubmit={submit} noValidate>
          <h2 className="fh only-d">{reg ? "Create your account" : "Welcome back"}</h2>
          <p className="muted only-d" style={{ margin: "-6px 0 6px" }}>{reg ? "Use the invite code you were given." : "Sign in to your library."}</p>
          <div className="seg only-d" role="group" aria-label="Sign in or create account">
            <button type="button" className={!reg ? "on" : ""} aria-pressed={!reg} onClick={() => switchMode("login")}>Sign in</button>
            <button type="button" className={reg ? "on" : ""} aria-pressed={reg} onClick={() => switchMode("register")}>Create account</button>
          </div>

          <div>
            <label className={"fld" + (errs.email ? " bad" : "")}>
              <Icon size={20} d={P.mail} />
              <input type="email" autoComplete="email" placeholder="Email" aria-label="Email" aria-invalid={!!errs.email} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {errs.email && <div className="ferr" role="alert">{errs.email}</div>}
          </div>

          <div>
            <label className={"fld" + (errs.password ? " bad" : "")}>
              <Icon size={20} d={P.lock} />
              <input type={show ? "text" : "password"} autoComplete={reg ? "new-password" : "current-password"} placeholder={reg ? "Password (8+ characters)" : "Password"} aria-label="Password" aria-invalid={!!errs.password} value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="eye" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} onClick={() => setShow(!show)}>
                <Icon size={20} d={show ? P.eyeOff : P.eye} />
              </button>
            </label>
            {errs.password && <div className="ferr" role="alert">{errs.password}</div>}
            <div className={"col" + (reg && password ? " open" : "")}>
              <div>
                <div className="meter" aria-live="polite">
                  {[1, 2, 3, 4].map((n) => <i key={n} className={n <= st.score ? "on s" + st.score : ""} />)}
                  <span className={"s" + st.score}>{st.label}</span>
                </div>
              </div>
            </div>
          </div>

          <div className={"col" + (reg ? " open" : "")}>
            <div>
              <label className={"fld" + (errs.invite ? " bad" : "")}>
                <Icon size={20} d={P.key} />
                <input type="text" autoComplete="off" placeholder="Invite code" aria-label="Invite code" aria-invalid={!!errs.invite} tabIndex={reg ? 0 : -1} value={invite} onChange={(e) => setInvite(e.target.value)} />
              </label>
              {errs.invite && <div className="ferr" role="alert">{errs.invite}</div>}
            </div>
          </div>

          <button className="cta" disabled={busy}>
            {busy ? <><span className="spin" />{reg ? "Creating account..." : "Signing in..."}</> : <>{reg ? "Create account" : "Sign in"}<Icon size={20} d={P.arrow} /></>}
          </button>
          {error && <div className="err" role="alert" style={{ margin: 0 }}>{error}</div>}

          <button type="button" className="alt only-m" onClick={() => switchMode(reg ? "login" : "register")}>
            {reg ? "Back to sign in" : "I have an invite code"}
          </button>
          <p className="muted sm only-d" style={{ margin: "6px 0 0", textAlign: "center" }}>Invite only. Ask the person who shared this app for a code.</p>

          <div className="chips3 only-m">
            <span><Icon size={16} d={P.download} />Works offline</span>
            <span><Icon size={16} d={P.pencil} />Notes that sync</span>
            <span><Icon size={16} d={P.mic} />Choose your voice</span>
          </div>
        </form>
      </section>
    </div>
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