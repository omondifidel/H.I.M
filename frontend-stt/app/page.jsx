"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken, setUser } from "../lib/api";
import { cleanName, clock, fmtDate, fmtSize } from "../lib/format";
import { deleteAudio, saveAudio } from "../lib/db";
import { uploadRecording } from "../lib/upload";
import { THEMES, applyTheme, getTheme } from "../lib/theme";

const ACTIVE = ["uploading", "queued", "processing"];
const LABEL = { uploading: "Upload not finished", queued: "In line", processing: "Transcribing", done: "Ready", failed: "Failed", cancelled: "Cancelled" };

function NewForm({ engine, onStarted, disabled }) {
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("");
  const [mixed, setMixed] = useState(true);
  const [bible, setBible] = useState(true);
  const [vocab, setVocab] = useState("");
  const input = useRef(null);

  function pick(f) {
    if (!f) return;
    setFile(f);
    if (!title) setTitle(cleanName(f.name));
  }

  function submit(e) {
    e.preventDefault();
    if (!file) return;
    onStarted(file, { filename: file.name, size: file.size, title: title.trim() || undefined, language: mixed ? null : language || null, vocabulary: vocab, bible, mixed });
    setFile(null); setTitle(""); setVocab("");
  }

  return (
    <form className="card form" onSubmit={submit}>
      <input ref={input} type="file" accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.flac,.aac,.mp4,.mov,.mkv,.amr,.3gp" hidden onChange={(e) => pick(e.target.files && e.target.files[0])} />
      <div
        className={"drop" + (over ? " over" : "")}
        role="button" tabIndex={0}
        onClick={() => input.current.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files && e.dataTransfer.files[0]); }}
      >
        {file ? (<><b>{file.name}</b><span className="muted">{fmtSize(file.size)} · tap to choose a different file</span></>) : (<><b>Choose a sermon recording</b><span className="muted">or drop it here · MP3, M4A, WAV, MP4 and more · up to {engine ? engine.max_audio_mb : 600} MB</span></>)}
      </div>

      <label className="field">Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday service, 9 Nov" /></label>

      <label className="check">
        <input type="checkbox" checked={mixed} onChange={(e) => setMixed(e.target.checked)} />
        <span><b>English and Kiswahili mixed</b><br /><span className="muted">Sends shorter pieces so the language can change as the preacher switches. Recommended for most sermons.</span></span>
      </label>
      {!mixed && (
        <label className="field">Language
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Detect automatically</option>
            <option value="en">English only</option>
            <option value="sw">Kiswahili only</option>
          </select>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={bible} onChange={(e) => setBible(e.target.checked)} />
        <span><b>This is a sermon with Bible references</b><br /><span className="muted">Helps with book names and verses, like John 3:16.</span></span>
      </label>
      <label className="field">Names and special words (optional)
        <textarea className="input" rows={2} value={vocab} onChange={(e) => setVocab(e.target.value)} placeholder="Pastor names, church name, places, uncommon words" />
      </label>
      <button className="btn" disabled={!file || disabled}>Start transcribing</button>
    </form>
  );
}

function Job({ job, onCancel, onRetry, onDelete, onResume }) {
  const picker = useRef(null);
  const working = job.status === "processing";
  const pct = job.status === "done" ? 100 : job.progress;
  return (
    <div className="card job">
      <div className="jh">
        <div>
          <b>{job.title}</b>
          <div className="muted sm">{job.original_name} · {fmtSize(job.size)}{job.duration ? ` · ${clock(job.duration)} long` : ""} · {fmtDate(job.created_at)}</div>
        </div>
        <span className={"st " + (job.status === "done" ? "done" : job.status === "failed" ? "failed" : ACTIVE.includes(job.status) ? "work" : "")}>{LABEL[job.status] || job.status}</span>
      </div>
      {(working || job.status === "queued") && (
        <>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + "%" }} /></div>
          <div className="muted sm">{job.note || "Working"}{job.chunks_total ? ` · part ${Math.min(job.chunks_done + 1, job.chunks_total)} of ${job.chunks_total}` : ""}</div>
        </>
      )}
      {job.status === "failed" && <div className="err" role="alert" style={{ margin: 0 }}>{job.error || "Something went wrong."}</div>}
      {job.status === "uploading" && <div className="muted sm">Choose the same file again to continue sending it.</div>}
      <div className="acts">
        {job.status === "done" && <a className="btn" href={`/transcribe/editor/?id=${job.id}`}>Open and edit</a>}
        {job.status === "uploading" && (
          <>
            <input ref={picker} type="file" hidden onChange={(e) => e.target.files[0] && onResume(job, e.target.files[0])} />
            <button className="btn" onClick={() => picker.current.click()}>Resume upload</button>
          </>
        )}
        {ACTIVE.includes(job.status) && <button className="btn ghost" onClick={() => onCancel(job)}>Cancel</button>}
        {(job.status === "failed" || job.status === "cancelled") && <button className="btn" onClick={() => onRetry(job)}>Try again</button>}
        {!working && <button className="btn ghost" onClick={() => onDelete(job)}>Delete</button>}
      </div>
    </div>
  );
}

export default function Home() {
  const [me, setMe] = useState(null);
  const [fatal, setFatal] = useState("");
  const [engine, setEngine] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [msg, setMsg] = useState("");
  const [up, setUp] = useState(null); // { id, name, pct }
  const [q, setQ] = useState("");
  const [theme, setTheme] = useState("light");
  useEffect(() => { const t = getTheme(); setTheme(t); applyTheme(t); }, []);

  const load = useCallback(async () => {
    try {
      setJobs(await api("/api/transcriptions"));
    } catch (e) {
      if (e.status !== 401) setMsg(e.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!getToken()) { window.location.href = "/"; return; }
      try {
        const r = await api("/api/auth/me");
        setUser(r.user);
        if (!r.user.apps.includes("transcribe")) { window.location.href = r.home; return; }
        setMe(r.user);
        setEngine(await api("/api/transcriptions/engine"));
        await load();
      } catch (e) {
        if (e.status === 401) window.location.href = "/";
        else setFatal(e.message);
      }
    })();
  }, [load]);

  // keep progress fresh while anything is running (this also keeps a free server awake)
  useEffect(() => {
    if (!jobs.some((j) => ACTIVE.includes(j.status))) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [jobs, load]);

  async function send(file, jobId) {
    setUp({ id: jobId, name: file.name, pct: 0 });
    try {
      await uploadRecording(file, jobId, engine ? engine.part_size : 8 * 1024 * 1024, (p) => setUp({ id: jobId, name: file.name, pct: Math.round(p * 100) }));
    } catch (err) {
      setMsg(err.message);
    }
    setUp(null);
    await load();
  }

  async function start(file, body) {
    setMsg("");
    try {
      const created = await api("/api/transcriptions", { method: "POST", body });
      saveAudio(created.id, file).catch(() => {}); // keep a copy on this device for the editor
      await load();
      await send(file, created.id);
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function resume(job, file) {
    setMsg("");
    if (file.size !== job.size) { setMsg("That is a different file. Choose the same recording you started with."); return; }
    saveAudio(job.id, file).catch(() => {});
    await send(file, job.id);
  }

  const run = async (fn) => { setMsg(""); try { await fn(); } catch (e) { setMsg(e.message); } await load(); };
  const cancel = (j) => run(() => api(`/api/transcriptions/${j.id}/cancel`, { method: "POST" }));
  const retry = (j) => run(() => api(`/api/transcriptions/${j.id}/retry`, { method: "POST" }));
  const remove = (j) => { if (confirm(`Delete "${j.title}" and its transcript?`)) run(async () => { await api(`/api/transcriptions/${j.id}`, { method: "DELETE" }); deleteAudio(j.id).catch(() => {}); }); };

  if (fatal) return <div className="wrap"><p className="err" role="alert">{fatal}</p></div>;
  if (!me) return null;

  const sortedJobs = [...jobs]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .filter((j) => !q.trim() || `${j.title} ${j.original_name}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="wrap wide">
      <div className="top">
        <div className="brand">
          <img src="/transcribe/favicon.svg" alt="" width={36} height={36} style={{ borderRadius: 10 }} />
          <span>HIM Transcribe</span>
        </div>
        <div className="acts">
          <select
            className="theme-sel"
            aria-label="Theme"
            value={theme}
            onChange={(e) => { setTheme(e.target.value); applyTheme(e.target.value); }}
          >
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {me.apps.includes("library") && <a className="btn ghost" href="/">Library</a>}
          {me.role === "admin" && <a className="btn ghost" href="/admin/">Admin</a>}
        </div>
      </div>

      <div className="stt-split">
        <aside className="stt-side" aria-label="Your transcriptions">
          <div className="stt-side-head">
            <span className="lbl">YOUR TRANSCRIPTIONS</span>
            <span className="stt-count">{jobs.length}</span>
          </div>
          {jobs.length > 0 && (
            <input
              className="stt-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter past sermons..."
              aria-label="Filter past transcriptions"
            />
          )}
          <div className="jobs">
            {sortedJobs.length === 0 && (
              <div className="empty muted sm">
                {jobs.length === 0 ? "Nothing here yet. Your first sermon will appear after you start it." : "No matching transcriptions."}
              </div>
            )}
            {sortedJobs.map((j) => <Job key={j.id} job={j} onCancel={cancel} onRetry={retry} onDelete={remove} onResume={resume} />)}
          </div>
        </aside>

        <main className="stt-main">
          <h1 className="title">Turn recordings into text</h1>
          <p className="muted" style={{ margin: "6px 0 18px" }}>Upload a sermon, leave this page open, and review the draft when it is ready.</p>

          {engine && !engine.configured && (
            <div className="banner" role="alert">Transcription is not switched on yet. The server needs its speech service key (GROQ_API_KEY). Ask the admin.</div>
          )}
          {msg && <p className="err" role="alert">{msg}</p>}

          {up && (
            <div className="card job" style={{ marginBottom: 12 }}>
              <b>Uploading {up.name}</b>
              <div className="bar" role="progressbar" aria-valuenow={up.pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: up.pct + "%" }} /></div>
              <div className="muted sm">{up.pct}% · keep this page open until it reaches 100%</div>
            </div>
          )}

          <NewForm engine={engine} onStarted={start} disabled={!!up || (engine && !engine.configured)} />
        </main>
      </div>
    </div>
  );
}
