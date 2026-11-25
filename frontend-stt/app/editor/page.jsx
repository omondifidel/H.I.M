"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, getToken } from "../../lib/api";
import { clock } from "../../lib/format";
import { getAudio, saveAudio } from "../../lib/db";
import { THEMES, applyTheme, getTheme } from "../../lib/theme";
import { useVoice } from "../../lib/useVoice";
import { nextRate } from "../../lib/voice";

let keyCounter = 1000;
const newKey = () => "n" + keyCounter++;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const VERSE_RE = /\b(?:[1-3]\s+)?[A-Z][a-z]{2,11}\s+\d{1,3}:\d{1,3}(?:-\d{1,3})?\b/g;
function findVerses(text) {
  return [...new Set(text.match(VERSE_RE) || [])];
}

/** Paragraphs as the server grouped them. `segs` keeps the original timed sentences of untouched paragraphs. */
function fromServer(data) {
  return data.paragraphs.map((p, i) => ({
    key: "p" + i, start: p.start, end: p.end, text: p.text, low: p.low,
    segs: data.segments.slice(p.first, p.last + 1), edited: false,
  }));
}

function fromDraft(segments) {
  const out = [];
  let cur = null;
  segments.forEach((s, i) => {
    if (!cur || s.para) {
      cur = { key: "d" + i, start: s.start, end: s.end, text: s.text, low: !!s.low, segs: [s], edited: false };
      out.push(cur);
    } else {
      cur.end = s.end; cur.text += " " + s.text; cur.low = cur.low || !!s.low; cur.segs.push(s);
    }
  });
  return out;
}

/** What gets saved: untouched paragraphs keep their original timing, edited ones become one timed block. */
function toSegments(paras) {
  const out = [];
  for (const p of paras) {
    if (!p.edited && p.segs.length) {
      p.segs.forEach((s, j) => out.push({ start: s.start, end: s.end, text: s.text, low: !!s.low, para: j === 0 }));
    } else if (p.text.trim()) {
      out.push({ start: p.start, end: Math.max(p.end, p.start), text: p.text.trim(), low: false, para: true });
    }
  }
  return out;
}

function Area({ value, onChange, onKeyDown, onFocus, setRef, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  }, [value]);
  return (
    <textarea
      ref={(el) => { ref.current = el; setRef(el); }}
      rows={1} value={value} aria-label={label} spellCheck
      onChange={onChange} onKeyDown={onKeyDown} onFocus={onFocus}
    />
  );
}

function Editor() {
  const id = useSearchParams().get("id");
  const [title, setTitle] = useState("");
  const [paras, setParas] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [save, setSave] = useState("saved"); // saved | unsaved | saving | error
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioNote, setAudioNote] = useState("");
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [follow, setFollow] = useState(true);
  const [rewind, setRewind] = useState(true);
  const [showFind, setShowFind] = useState(false);
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [onlyCheck, setOnlyCheck] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [fmt, setFmt] = useState("docx");
  const [stamps, setStamps] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [theme, setTheme] = useState("light");
  useEffect(() => { const t = getTheme(); setTheme(t); applyTheme(t); }, []);
  const [notes, setNotes] = useState([]); // sermon notes [{id, time, body}]
  const [showNotes, setShowNotes] = useState(false);

  const audioRef = useRef(null);
  const parasRef = useRef([]);
  const titleRef = useRef("");
  const history = useRef([]);
  const saveTimer = useRef(null);
  const areas = useRef({});
  const pending = useRef(null);
  const focusIdx = useRef(-1);
  const rewindRef = useRef(true);
  const rateRef = useRef(1);
  const loaded = useRef(false);
  const notesRef = useRef([]);
  const notesTimer = useRef(null);
  const activeNote = useRef(null);

  // ---------- saving ----------
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (!loaded.current) return;
    const segments = toSegments(parasRef.current);
    try { localStorage.setItem("draft:" + id, JSON.stringify({ title: titleRef.current, segments })); } catch {}
    setSave("saving");
    try {
      await api(`/api/transcriptions/${id}`, { method: "PATCH", body: { title: titleRef.current, segments } });
      try { localStorage.removeItem("draft:" + id); } catch {}
      setSave("saved");
    } catch (e) {
      setSave("error");
      setError(e.message);
    }
  }, [id]);

  const markDirty = useCallback(() => {
    setSave("unsaved");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 1500);
  }, [flush]);

  function commit(next, snapshot = false) {
    if (snapshot) {
      history.current.push(parasRef.current);
      if (history.current.length > 30) history.current.shift();
      setUndoCount(history.current.length);
    }
    parasRef.current = next;
    setParas(next);
    markDirty();
  }

  function undo() {
    const prev = history.current.pop();
    setUndoCount(history.current.length);
    if (!prev) return;
    parasRef.current = prev;
    setParas(prev);
    markDirty();
  }

  useEffect(() => {
    const warn = (e) => { if (save === "unsaved" || save === "saving" || save === "error") { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  // ---------- loading ----------
  useEffect(() => {
    if (!getToken()) { window.location.href = "/"; return; }
    if (!id) { setStatus("error"); setError("No transcription selected."); return; }
    (async () => {
      try {
        const data = await api(`/api/transcriptions/${id}/transcript`);
        let list = fromServer(data);
        let name = data.title;
        let draft = null;
        try { draft = JSON.parse(localStorage.getItem("draft:" + id) || "null"); } catch {}
        if (draft && draft.segments && draft.segments.length && confirm("You have edits from last time that were not saved. Restore them?")) {
          list = fromDraft(draft.segments);
          name = draft.title || name;
        }
        setTitle(name); titleRef.current = name;
        parasRef.current = list; setParas(list);
        setDur(data.duration);
        notesRef.current = data.notes || []; setNotes(notesRef.current);
        loaded.current = true;
        setStatus("ready");
      } catch (e) {
        if (e.status === 401) { window.location.href = "/"; return; }
        setStatus("error"); setError(e.message);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let url = null;
    let dead = false;
    (async () => {
      let blob = null;
      try { blob = await getAudio(id); } catch {}
      if (!blob) {
        try { blob = await (await api(`/api/transcriptions/${id}/audio`, { raw: true })).blob(); } catch {}
      }
      if (dead) return;
      if (blob) { url = URL.createObjectURL(blob); setAudioUrl(url); }
      else setAudioNote("The recording is not stored here or on the server any more. You can still edit the text. To listen as well, attach the recording file below.");
    })();
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [id]);

  async function attach(file) {
    if (!file) return;
    saveAudio(id, file).catch(() => {});
    setAudioUrl(URL.createObjectURL(file));
    setAudioNote("");
  }

  // ---------- audio ----------
  useEffect(() => { rewindRef.current = rewind; }, [rewind]);
  useEffect(() => {
    rateRef.current = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, audioUrl]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      if (rewindRef.current && a.currentTime > 2) a.currentTime -= 2; // hear the last words again
      a.play().catch(() => {});
    } else a.pause();
  }, []);
  const skip = useCallback((d) => {
    const a = audioRef.current;
    if (a) a.currentTime = Math.max(0, Math.min(a.duration || 1e9, a.currentTime + d));
  }, []);
  const seek = (time) => {
    const a = audioRef.current;
    if (a) { a.currentTime = Math.max(0, time); a.play().catch(() => {}); }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); toggle(); }
      else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); skip(-5); }
      else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); skip(5); }
      else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); setRate((r) => Math.min(2, +(r + 0.25).toFixed(2))); }
      else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); setRate((r) => Math.max(0.5, +(r - 0.25).toFixed(2))); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setShowFind(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, skip]);

  const cur = useMemo(() => {
    let found = -1;
    for (let i = 0; i < paras.length; i++) { if (paras[i].start <= t + 0.25) found = i; else break; }
    return found;
  }, [paras, t]);

  useEffect(() => {
    if (!playing || !follow || cur < 0) return;
    const el = document.getElementById("para-" + paras[cur].key);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- editing ----------
  function setText(i, text) {
    commit(parasRef.current.map((p, j) => (j === i ? { ...p, text, edited: true, low: false } : p)));
  }

  function split(i, pos) {
    const p = parasRef.current[i];
    const a = p.text.slice(0, pos).trim(), b = p.text.slice(pos).trim();
    if (!a || !b) return;
    const mid = p.start + (p.end - p.start) * (pos / Math.max(1, p.text.length));
    const key = newKey();
    const next = [...parasRef.current];
    next.splice(i, 1, { ...p, end: mid, text: a, edited: true, low: false, segs: [] }, { key, start: mid, end: p.end, text: b, edited: true, low: false, segs: [] });
    pending.current = { key, pos: 0 };
    commit(next, true);
  }

  function mergePrev(i) {
    if (i === 0) return;
    const a = parasRef.current[i - 1], b = parasRef.current[i];
    const merged = { ...a, end: b.end, text: (a.text + " " + b.text).trim(), edited: true, low: false, segs: [] };
    const next = [...parasRef.current];
    next.splice(i - 1, 2, merged);
    pending.current = { key: a.key, pos: a.text.length };
    commit(next, true);
  }
  function remove(i) {
    commit(parasRef.current.filter((_, j) => j !== i), true);
  }

  useEffect(() => {
    if (!pending.current) return;
    const { key, pos } = pending.current;
    pending.current = null;
    const el = areas.current[key];
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }, [paras]);

  function onKey(i, e) {
    const el = e.target;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey) { e.preventDefault(); split(i, el.selectionStart); }
    else if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0 && i > 0) { e.preventDefault(); mergePrev(i); }
  }

  // ---------- find and replace, and uncertain passages ----------
  const matches = useMemo(() => {
    if (!find) return 0;
    const re = new RegExp(escapeRe(find), "gi");
    return paras.reduce((n, p) => n + (p.text.match(re) || []).length, 0);
  }, [paras, find]);

  function replaceAll() {
    if (!find || !matches) return;
    const next = parasRef.current.map((p) => {
      const text = p.text.replace(new RegExp(escapeRe(find), "gi"), () => repl);
      return text === p.text ? p : { ...p, text, edited: true, low: false };
    });
    commit(next, true);
  }

  const lows = paras.filter((p) => p.low).length;
  function nextCheck() {
    const list = paras.map((p, i) => (p.low ? i : -1)).filter((i) => i >= 0);
    if (!list.length) return;
    const target = list.find((i) => i > focusIdx.current);
    const idx = target === undefined ? list[0] : target;
    focusIdx.current = idx;
    const el = document.getElementById("para-" + paras[idx].key);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, paras[idx].start - 1);
    const area = areas.current[paras[idx].key];
    if (area) area.focus({ preventScroll: true });
  }

  // ---------- sermon notes (stamped with the time in the recording) ----------
  function commitNotes(next) {
    notesRef.current = next;
    setNotes(next);
    setSave("unsaved");
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      try {
        await api(`/api/transcriptions/${id}`, { method: "PATCH", body: { notes: notesRef.current } });
        setSave("saved");
      } catch (e) { setSave("error"); setError(e.message); }
    }, 800);
  }
  function addNote(body = "") {
    const time = Math.round((audioRef.current ? audioRef.current.currentTime : t) * 10) / 10;
    const note = { id: crypto.randomUUID(), time, body };
    commitNotes([...notesRef.current, note].sort((a, b) => a.time - b.time));
    activeNote.current = note.id;
    setShowNotes(true);
    return note;
  }
  const editNote = (nid, body) => commitNotes(notesRef.current.map((n) => (n.id === nid ? { ...n, body } : n)));
  const deleteNote = (nid) => commitNotes(notesRef.current.filter((n) => n.id !== nid));

  // ---------- voice control (mic orb / Ctrl+Space) ----------
  const voice = useVoice({
    pause: () => { const a = audioRef.current; const was = !!a && !a.paused; if (was) a.pause(); return was; },
    resume: () => { audioRef.current?.play().catch(() => {}); },
    dictate: (text) => {
      const n = notesRef.current.find((x) => x.id === activeNote.current);
      if (n) editNote(n.id, n.body + (n.body && !/\s$/.test(n.body) ? " " : "") + text);
    },
    command: async ({ cmd, arg }) => {
      const a = audioRef.current;
      if (cmd === "pause") { a?.pause(); return; }
      if (cmd === "resume") { a?.play().catch(() => {}); return; }
      if (cmd === "rate") { const r = nextRate(rateRef.current, arg, 2); setRate(r); return `Speed ${r}x`; }
      if (cmd === "minute") { if (a) a.currentTime = Math.min(arg * 60, a.duration || arg * 60); return `Minute ${arg}`; }
      if (cmd === "page") return "Sermons have no pages. Say “go to minute 5”.";
      if (cmd === "theme") { setTheme(arg); applyTheme(arg); return `${arg[0].toUpperCase() + arg.slice(1)} mode`; }
      if (cmd === "bookmark") return `Bookmarked ${clock(addNote("🔖 Bookmark").time)}`;
      if (cmd === "note") { addNote(); return; }
      if (cmd === "skip") { skip(arg); return arg < 0 ? `Back ${-arg} seconds` : `Forward ${arg} seconds`; }
      if (cmd === "turn") return "Sermons have no pages. Say “next paragraph” or “skip forward 30 seconds”.";
      if (cmd === "paragraph") {
        const list = parasRef.current, now = a ? a.currentTime : t;
        let i = -1;
        for (let j = 0; j < list.length; j++) { if (list[j].start <= now + 0.25) i = j; else break; }
        const target = list[Math.max(0, Math.min(list.length - 1, i + arg))];
        if (a && target) a.currentTime = target.start;
        return target ? `Paragraph at ${clock(target.start)}` : "";
      }
      if (cmd === "notes") { setShowNotes(arg); return arg ? "Your notes" : "Notes closed"; }
      if (cmd === "lastNote" || cmd === "deleteNote") {
        const n = notesRef.current.find((x) => x.id === activeNote.current) || notesRef.current[notesRef.current.length - 1];
        if (!n) return "There are no notes yet.";
        if (cmd === "deleteNote") { deleteNote(n.id); activeNote.current = null; return `Deleted the note at ${clock(n.time)}`; }
        if (a) a.currentTime = n.time;
        setShowNotes(true);
        return `Note at ${clock(n.time)}`;
      }
      if (cmd === "ask") {
        const r = await api("/api/assistant/ask", { method: "POST", body: { transcription_id: id, question: arg } });
        return r.answer;
      }
    },
  });

  // ---------- export ----------
  async function download() {
    await flush();
    try {
      const res = await api(`/api/transcriptions/${id}/export?format=${fmt}&timestamps=${stamps}`, { raw: true });
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match ? match[1] : `transcript.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      setShowExport(false);
    } catch (e) {
      setError(e.message);
    }
  }

  const wordCount = useMemo(() => paras.reduce((n, p) => n + (p.text.trim() ? p.text.trim().split(/\s+/).length : 0), 0), [paras]);
  const readMins = Math.max(1, Math.round(wordCount / 180));
  const shown = onlyCheck ? paras.map((p, i) => [p, i]).filter(([p]) => p.low) : paras.map((p, i) => [p, i]);
  const saveLabel = { saved: "Saved", unsaved: "Unsaved", saving: "Saving...", error: "Not saved" }[save];

  if (status === "error") return <div className="wrap"><a className="btn ghost" href="/transcribe/">Back</a><p className="err" role="alert">{error}</p></div>;
  if (status === "loading") return <div className="wrap"><p className="muted">Opening your transcript...</p></div>;

  return (
    <>
      <div className="etop">
        <a className="btn ghost" style={{ height: 40 }} href="/transcribe/" onClick={(e) => { if (save !== "saved") { e.preventDefault(); flush().then(() => { window.location.href = "/transcribe/"; }); } }}>Back</a>
        <input className="tin" value={title} aria-label="Title" onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; markDirty(); }} />
        <span className="meta-pill">{wordCount} words · ~{readMins}m read</span>
        <span className={"sv " + (save === "error" ? "error" : "")} role="status">{saveLabel}</span>
        <div className="tools">
          <button className="tbtn" onClick={undo} disabled={!undoCount}>Undo</button>
          <button className={"tbtn" + (showFind ? " on" : "")} onClick={() => setShowFind(!showFind)}>Find</button>
          <button className="tbtn" onClick={nextCheck} disabled={!lows}>Next check ({lows})</button>
          <button className={"tbtn" + (onlyCheck ? " on" : "")} onClick={() => setOnlyCheck(!onlyCheck)} disabled={!lows && !onlyCheck}>Only uncertain</button>
          <button className={"tbtn" + (showNotes ? " on" : "")} onClick={() => setShowNotes(!showNotes)}>Notes ({notes.length})</button>
          <button className={"tbtn" + (showExport ? " on" : "")} onClick={() => setShowExport(!showExport)}>Export</button>
          <select className="theme-sel" aria-label="Theme" value={theme} onChange={(e) => { setTheme(e.target.value); applyTheme(e.target.value); }}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="panel"><p className="err" role="alert">{error} {save === "error" && <button className="tbtn" onClick={flush}>Try saving again</button>}</p></div>}

      {showFind && (
        <div className="panel"><div className="card">
          <input className="input" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find" />
          <input className="input" placeholder="Replace with" value={repl} onChange={(e) => setRepl(e.target.value)} aria-label="Replace with" />
          <span className="muted sm">{find ? `${matches} found` : ""}</span>
          <button className="tbtn" onClick={replaceAll} disabled={!matches}>Replace all</button>
        </div></div>
      )}

      {showExport && (
        <div className="panel"><div className="card">
          <select className="input" value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="Format" style={{ flex: "0 1 220px" }}>
            <option value="docx">Word document (.docx)</option>
            <option value="txt">Plain text (.txt)</option>
            <option value="md">Markdown (.md)</option>
            <option value="srt">Subtitles (.srt)</option>
            <option value="vtt">Subtitles (.vtt)</option>
          </select>
          <label className="check" style={{ alignItems: "center" }}><input type="checkbox" checked={stamps} onChange={(e) => setStamps(e.target.checked)} /><span>Add time stamps</span></label>
          <button className="btn" style={{ height: 42 }} onClick={download}>Download</button>
        </div></div>
      )}

      {showNotes && (
        <div className="panel"><div className="card">
          <button className="tbtn" onClick={() => addNote()}>+ Note at {clock(t)}</button>
          <span className="muted sm">Or tap the mic and say “take a note …”</span>
          {notes.map((n) => (
            <div key={n.id} className="snote">
              <button className="ts" onClick={() => seek(n.time)} aria-label={`Play from ${clock(n.time)}`} disabled={!audioUrl}>{clock(n.time)}</button>
              <div className="pbody">
                <Area value={n.body} label={`Note at ${clock(n.time)}`} setRef={() => {}} onChange={(e) => editNote(n.id, e.target.value)} />
                {voice.live && n.id === activeNote.current && <div className="live" aria-live="polite">{voice.live}…</div>}
              </div>
              <button className="px" aria-label={`Delete note at ${clock(n.time)}`} onClick={() => deleteNote(n.id)}>×</button>
            </div>
          ))}
        </div></div>
      )}

      <div className="doc">
        {shown.length === 0 && <p className="muted">{onlyCheck ? "Nothing is marked uncertain." : "This transcript is empty."}</p>}
        {shown.map(([p, i]) => (
          <div key={p.key} id={"para-" + p.key} className={"para" + (i === cur ? " now" : "") + (p.low ? " low" : "")}>
            <button className="ts" onClick={() => seek(p.start)} aria-label={`Play from ${clock(p.start)}`} disabled={!audioUrl}>{clock(p.start)}</button>
            <div className="pbody">
              {p.low && <span className="chk">CHECK THIS PART</span>}
              {findVerses(p.text).length > 0 && (
                <div className="verse-row">
                  {findVerses(p.text).map((v) => <span key={v} className="verse-chip">{v}</span>)}
                </div>
              )}
              <Area value={p.text} label={`Paragraph at ${clock(p.start)}`} setRef={(el) => { areas.current[p.key] = el; }}
                onChange={(e) => setText(i, e.target.value)} onKeyDown={(e) => onKey(i, e)} onFocus={() => { focusIdx.current = i; }} />
            </div>
            <button className="px" aria-label={`Delete paragraph at ${clock(p.start)}`} onClick={() => remove(i)}>×</button>
          </div>
        ))}
      </div>

      <div className="eplayer">
        <div className="in">
          <button className={"orb " + voice.state} aria-label="Voice command (Ctrl+Space)" title="Voice command (Ctrl+Space)" onClick={voice.toggle}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3" /></svg>
          </button>
          {voice.caption && <div className="vcap" role="status" aria-live="polite">{voice.caption}</div>}
          {audioUrl ? (
            <>
              <audio ref={audioRef} src={audioUrl} preload="metadata"
                onTimeUpdate={(e) => setT(e.target.currentTime)}
                onLoadedMetadata={(e) => { setDur(e.target.duration || dur); e.target.playbackRate = rateRef.current; }}
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
              <div className="seek">
                <span>{clock(t)}</span>
                <input type="range" min="0" max={dur || 1} step="0.1" value={Math.min(t, dur || 1)} aria-label="Position in the recording" onChange={(e) => { if (audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value); }} />
                <span>{clock(dur)}</span>
              </div>
              <div className="pctl">
                <button className="skip" onClick={() => skip(-5)} aria-label="Back 5 seconds">-5s</button>
                <button className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing ? <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></> : <path d="M7 4l13 8-13 8z" />}</svg>
                </button>
                <button className="skip" onClick={() => skip(5)} aria-label="Forward 5 seconds">+5s</button>
                <select value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} aria-label="Playback speed">
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => <option key={r} value={r}>{r}x</option>)}
                </select>
                <label className="check" style={{ alignItems: "center" }}><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /><span>Follow along</span></label>
                <label className="check" style={{ alignItems: "center" }}><input type="checkbox" checked={rewind} onChange={(e) => setRewind(e.target.checked)} /><span>Rewind 2s on play</span></label>
                <label className="check" style={{ alignItems: "center" }} title="Say “Hey Nasoma”, then a command"><input type="checkbox" checked={voice.handsFree} onChange={(e) => voice.setHandsFree(e.target.checked)} /><span>Hands-free (“Hey Nasoma”)</span></label>
              </div>
              <div className="hint">Esc play or pause · Ctrl+Space voice command · Alt + arrows: skip and speed · Enter splits a paragraph · Backspace at the start joins it to the one above</div>
            </>
          ) : (
            <div className="pctl">
              <span className="muted sm" style={{ maxWidth: 560 }}>{audioNote || "Loading the recording..."}</span>
              <label className="btn" style={{ height: 40 }}>Attach recording<input type="file" accept="audio/*,video/*" hidden onChange={(e) => attach(e.target.files[0])} /></label>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={null}>
      <Editor />
    </Suspense>
  );
}
