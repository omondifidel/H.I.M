"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, setToken } from "../lib/api";
import { idbDel, idbDelPrefix, idbKeys, idbPut } from "../lib/db";
import { clearLocalNotes } from "../lib/notes";

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
      const res = await api(`/api/auth/${mode}`, {
        method: "POST",
        body: { email, password, invite_code: invite },
      });
      setToken(res.token);
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <form className="auth" onSubmit={submit}>
      <h1>Read-Aloud PDF</h1>
      <p className="muted">{mode === "login" ? "Sign in to your library." : "Create an account with your invite code."}</p>
      <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Email" />
      <input className="input" type="password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required aria-label="Password" />
      {mode === "register" && (
        <input className="input" placeholder="Invite code" value={invite} onChange={(e) => setInvite(e.target.value)} aria-label="Invite code" />
      )}
      {error && <div className="err" role="alert">{error}</div>}
      <button className="btn" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"}</button>
      <button type="button" className="btn ghost" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "I have an invite code" : "Back to sign in"}
      </button>
    </form>
  );
}

function fmtSize(b) {
  return b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
}

function Library({ onLogout }) {
  const [docs, setDocs] = useState([]);
  const [offline, setOffline] = useState(new Set());
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

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
  }, []);

  useEffect(() => {
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

  const shown = docs.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="wrap">
      <div className="row between">
        <h1>My Library</h1>
        <button className="btn ghost small" onClick={onLogout}>Sign out</button>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <input className="input" placeholder="Search your PDFs" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your PDFs" />
        <label className="btn" style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
          {busy ? "Uploading..." : "+ Add PDF"}
          <input type="file" accept="application/pdf" onChange={upload} hidden disabled={busy} />
        </label>
      </div>
      {msg && <div className="err" role="alert">{msg}</div>}
      <div className="list">
        {shown.length === 0 && <p className="muted">No PDFs yet. Tap "+ Add PDF" to upload one.</p>}
        {shown.map((d) => (
          <div className="card row" key={d.id} style={{ alignItems: "flex-start" }}>
            <div className="cover" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link href={`/reader/?id=${d.id}`} style={{ fontWeight: 600, fontSize: 16, wordBreak: "break-word" }}>{d.title}</Link>
              <div className="muted" style={{ marginTop: 4 }}>
                {fmtSize(d.size)} · {d.last_page > 1 || d.last_paragraph > 0 ? `Page ${d.last_page}` : "Not started"}
              </div>
              <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                {offline.has(d.id) ? <span className="badge">Offline</span> : <button className="btn ghost small" onClick={() => saveOffline(d)}>Save offline</button>}
                <Link className="btn small" href={`/reader/?id=${d.id}`} style={{ display: "flex", alignItems: "center" }}>Listen</Link>
                <button className="btn ghost small" onClick={() => remove(d)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
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
