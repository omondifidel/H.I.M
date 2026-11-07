"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../lib/api";
import { idbGet, idbPut } from "../../lib/db";
import { listNotes, newNoteId, putNote, removeNote, syncNotes } from "../../lib/notes";
import { extractParagraphs, loadPdfjs } from "../../lib/pdfText";

/** Split a paragraph into short chunks so browsers never cut long speech off. */
function splitChunks(text, max = 220) {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + s).length > max) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
    while (cur.length > max * 1.5) {
      const cut = cur.lastIndexOf(" ", max);
      const at = cut > 40 ? cut : max;
      out.push(cur.slice(0, at).trim());
      cur = cur.slice(at);
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [text];
}

const Icon = ({ d, size = 24, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const P = {
  down: <path d="M6 9l6 6 6-6" />,
  up: <path d="M18 15l-6-6-6 6" />,
  prev: <path d="M6 5v14M20 5L9 12l11 7z" />,
  next: <path d="M18 5v14M4 5l11 7-11 7z" />,
  pencil: <path d="M4 20l4-1 11-11-3-3L5 16z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  speed: <path d="M12 13l4-4M4 18a9 9 0 1116 0" />,
  mic: <path d="M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3" />,
  moon: <path d="M20 14A8 8 0 019 3a8 8 0 1011 11z" />,
  check: <path d="M5 12l5 5 9-10" />,
  pin: <path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3z" />,
  play: <path d="M7 4l13 8-13 8z" />,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
};
const BARS = [5, 9, 14, 8, 16, 11, 6, 13, 18, 10, 7, 15, 12, 20, 9, 6, 14, 17, 8, 12, 19, 10, 5, 13, 16, 7, 11, 15, 9, 6, 12, 18, 8, 14, 10, 7, 13, 16, 9, 5, 11, 14, 8];
const PAL = ["#FFB547", "#5B8DEF", "#4FD1A5", "#FF7A59", "#C08CF5"];

function Reader() {
  const sp = useSearchParams();
  const id = sp.get("id");
  const pageParam = sp.get("page");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [idx, setIdx] = useState(0);
  const [chunk, setChunk] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [paras, setParas] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [hl, setHl] = useState(true);
  const [panel, setPanel] = useState(null); // null | "notes" | "voice"
  const [sleepMin, setSleepMin] = useState(0);

  const pdfRef = useRef(null);
  const cache = useRef(new Map());
  const run = useRef(0);
  const pos = useRef({ page: 1, idx: 0, chunk: 0 });
  const rateRef = useRef(1);
  const voiceRef = useRef("");
  const numRef = useRef(0);
  const playingRef = useRef(false);
  const saveTimer = useRef(null);
  const sleepTimer = useRef(null);
  const latest = useRef({});

  // ---- notes state ----
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState({ id: null, body: "", paragraph: null, page: 1 });
  const [syncState, setSyncState] = useState("saved");
  const [showAll, setShowAll] = useState(false);
  const draftRef = useRef({ id: null, body: "", paragraph: null, page: 1 });
  const noteTimer = useRef(null);
  const syncTimer = useRef(null);

  const setPlay = (v) => {
    playingRef.current = v;
    setPlaying(v);
  };

  // ---- paragraphs (memory -> IndexedDB -> extract from PDF) ----
  async function getParas(p) {
    const key = `${id}:${p}`;
    if (cache.current.has(key)) return cache.current.get(key);
    let v = null;
    try { v = await idbGet("paras", key); } catch {}
    if (!v) {
      v = await extractParagraphs(pdfRef.current, p);
      try { await idbPut("paras", key, v); } catch {}
    }
    cache.current.set(key, v);
    return v;
  }

  /** Looks forward (dir 1) or backward (dir -1) for the nearest page that has readable text. */
  async function findTextPage(from, dir, limit = 40) {
    for (let k = 0; k < limit; k++) {
      const q = from + dir * k;
      if (q < 1 || q > numRef.current) return null;
      const ps = await getParas(q);
      if (ps.length) return { page: q, paras: ps };
    }
    return null;
  }

  function show(p, i, ps) {
    pos.current = { ...pos.current, page: p, idx: i };
    setPage(p);
    setIdx(i);
    if (ps) setParas(ps);
  }

  // ---- speech ----
  async function play(p, i, chunkNo = 0) {
    const synth = window.speechSynthesis;
    const myRun = ++run.current;
    synth.cancel();
    setPlay(true);
    setError("");
    let ps = await getParas(p);
    if (myRun !== run.current) return;
    let empties = 0;
    while (i >= ps.length) {
      if (p >= numRef.current) { setPlay(false); return; }
      if (++empties > 40) {
        setPlay(false);
        setError("No readable text in the next 40 pages. They may be scanned images (OCR is needed). Use the page box to jump ahead.");
        return;
      }
      p += 1; i = 0; chunkNo = 0;
      ps = await getParas(p);
      if (myRun !== run.current) return;
    }
    show(p, i, ps);
    pos.current.chunk = chunkNo;
    setChunk(chunkNo);
    if (p < numRef.current) getParas(p + 1).catch(() => {}); // prefetch next page

    const chunks = splitChunks(ps[i]);
    const text = chunks[chunkNo];
    if (text == null) return play(p, i + 1, 0);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rateRef.current;
    const v = synth.getVoices().find((x) => x.voiceURI === voiceRef.current);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.onend = () => {
      if (myRun !== run.current) return;
      if (chunkNo + 1 < chunks.length) play(p, i, chunkNo + 1);
      else play(p, i + 1, 0);
    };
    u.onerror = (e) => {
      if (myRun !== run.current) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      setPlay(false);
      setError("Speech stopped: " + (e.error || "unknown error"));
    };
    setTimeout(() => { if (myRun === run.current) synth.speak(u); }, 40);
  }

  function pause() {
    run.current++;
    window.speechSynthesis.cancel();
    setPlay(false);
  }

  async function step(p, i, delta) {
    if (delta > 0) {
      const ps = await getParas(p);
      if (i + 1 < ps.length) return { page: p, idx: i + 1 };
      for (let q = p + 1; q <= numRef.current; q++) {
        if ((await getParas(q)).length) return { page: q, idx: 0 };
      }
      return { page: p, idx: i };
    }
    if (i > 0) return { page: p, idx: i - 1 };
    for (let q = p - 1; q >= 1; q--) {
      const ps = await getParas(q);
      if (ps.length) return { page: q, idx: ps.length - 1 };
    }
    return { page: p, idx: i };
  }

  async function jump(p, i) {
    if (playingRef.current) return play(p, i, 0);
    show(p, i, await getParas(p));
    pos.current.chunk = 0;
    setChunk(0);
  }
  async function move(delta) {
    const t = await step(pos.current.page, pos.current.idx, delta);
    return jump(t.page, t.idx);
  }
  async function goPage(p, dir = 0) {
    p = Math.max(1, Math.min(numRef.current, Number(p) || 1));
    setError("");
    if (dir !== 0) {
      const found = await findTextPage(p, dir, 60);
      if (!found) {
        setError("No readable text found in that direction. Those pages may be scanned images.");
        return;
      }
      p = found.page;
    }
    return jump(p, 0);
  }
  function toggle() {
    if (playingRef.current) pause();
    else play(pos.current.page, pos.current.idx, pos.current.chunk);
  }
  function changeRate(r) {
    rateRef.current = r;
    setRate(r);
    localStorage.setItem("tts:rate", String(r));
    if (playingRef.current) play(pos.current.page, pos.current.idx, pos.current.chunk);
  }
  function changeVoice(uri) {
    voiceRef.current = uri;
    setVoiceURI(uri);
    localStorage.setItem("tts:voice", uri);
    if (playingRef.current) play(pos.current.page, pos.current.idx, pos.current.chunk);
  }
  function previewVoice(v) {
    pause();
    const u = new SpeechSynthesisUtterance("This is how I will read your document.");
    u.voice = v;
    u.lang = v.lang;
    u.rate = rateRef.current;
    setTimeout(() => window.speechSynthesis.speak(u), 60);
  }
  function changeHl(v) {
    setHl(v);
    localStorage.setItem("ui:hl", v ? "1" : "0");
  }
  function setSleep(min) {
    clearTimeout(sleepTimer.current);
    setSleepMin(min);
    if (min > 0) {
      sleepTimer.current = setTimeout(() => { pause(); setSleepMin(0); }, min * 60000);
    }
  }
  latest.current = { toggle, move };

  // ---- notes (written to this device first, synced when online) ----
  async function refreshNotes() {
    try { setNotes(await listNotes(id)); } catch {}
  }
  async function runSync() {
    if (!navigator.onLine) { setSyncState("offline"); return; }
    setSyncState("syncing");
    const r = await syncNotes();
    setSyncState(r.ok ? "synced" : "saved");
    await refreshNotes();
  }
  async function persistDraft() {
    const d = draftRef.current;
    if (!d.id && !d.body.trim()) return;
    if (!d.id) {
      d.id = newNoteId();
      setDraft({ ...d });
    }
    await putNote({ id: d.id, document_id: id, page: d.page, paragraph: d.paragraph, body: d.body, updated_at: new Date().toISOString(), deleted: false });
    await refreshNotes();
    setSyncState(navigator.onLine ? "saved" : "offline");
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(runSync, 1500);
  }
  function editDraft(patch) {
    const cur = draftRef.current;
    const base = cur.id ? {} : { page: pos.current.page };
    draftRef.current = { ...cur, ...base, ...patch };
    setDraft(draftRef.current);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(persistDraft, 600);
  }
  function blankDraft() {
    draftRef.current = { id: null, body: "", paragraph: null, page: pos.current.page };
    setDraft(draftRef.current);
  }
  async function startNewNote() {
    clearTimeout(noteTimer.current);
    await persistDraft();
    blankDraft();
  }
  async function openNote(n) {
    clearTimeout(noteTimer.current);
    await persistDraft();
    draftRef.current = { id: n.id, body: n.body, paragraph: n.paragraph, page: n.page };
    setDraft(draftRef.current);
  }
  async function deleteDraft() {
    const d = draftRef.current;
    clearTimeout(noteTimer.current);
    if (d.id) await removeNote(d.id);
    blankDraft();
    await refreshNotes();
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(runSync, 800);
  }
  function addBullet() {
    const b = draftRef.current.body;
    editDraft({ body: b + (b && !b.endsWith("\n") ? "\n" : "") + "• " });
  }
  function openNotes() {
    if (!draftRef.current.id && !draftRef.current.body) blankDraft();
    setPanel("notes");
  }
  async function closeNotes() {
    clearTimeout(noteTimer.current);
    await persistDraft();
    setPanel(null);
  }
  function closePanel() {
    if (panel === "notes") closeNotes();
    else setPanel(null);
  }

  useEffect(() => {
    if (!id) return;
    refreshNotes();
    runSync();
    const online = () => runSync();
    const offline = () => setSyncState("offline");
    const hidden = () => { if (document.visibilityState === "hidden") { clearTimeout(noteTimer.current); persistDraft(); } };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", hidden);
      clearTimeout(noteTimer.current);
      persistDraft();
    };
  }, [id]);

  // ---- load settings and voices ----
  useEffect(() => {
    const r = parseFloat(localStorage.getItem("tts:rate") || "1") || 1;
    rateRef.current = r;
    setRate(r);
    setHl(localStorage.getItem("ui:hl") !== "0");
    voiceRef.current = localStorage.getItem("tts:voice") || "";
    setVoiceURI(voiceRef.current);
    const synth = window.speechSynthesis;
    if (!synth) { setError("This browser does not support reading aloud."); return; }
    const load = () => {
      const list = synth.getVoices();
      if (!list.length) return;
      setVoices(list);
      if (!list.find((v) => v.voiceURI === voiceRef.current)) {
        const lang = (navigator.language || "en").toLowerCase();
        const pick = list.find((v) => v.lang.toLowerCase() === lang) || list.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) || list[0];
        voiceRef.current = pick.voiceURI;
        setVoiceURI(pick.voiceURI);
      }
    };
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, []);

  // ---- load the PDF ----
  useEffect(() => {
    if (!id) { setStatus("error"); setError("No PDF selected."); return; }
    let dead = false;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        let blob = null;
        try { blob = await idbGet("pdfs", id); } catch {}
        if (!blob) {
          const res = await api(`/api/documents/${id}/file`, { raw: true });
          blob = await res.blob();
          try { await idbPut("pdfs", id, blob); } catch {}
        }
        const data = new Uint8Array(await blob.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (dead) return;
        pdfRef.current = pdf;
        numRef.current = pdf.numPages;
        setNumPages(pdf.numPages);
        localStorage.setItem("last", id);
        localStorage.setItem("pages:" + id, String(pdf.numPages));

        let meta = null;
        try {
          meta = (await api("/api/documents")).find((d) => d.id === id);
        } catch {
          meta = JSON.parse(localStorage.getItem("docs") || "[]").find((d) => d.id === id);
        }
        const local = JSON.parse(localStorage.getItem("progress:" + id) || "null");
        const forced = pageParam ? { page: Number(pageParam) || 1, idx: 0 } : null;
        const start = forced || local || (meta ? { page: meta.last_page, idx: meta.last_paragraph } : { page: 1, idx: 0 });
        setTitle(meta ? meta.title.replace(/\.pdf$/i, "") : "PDF");

        let p = Math.min(Math.max(1, start.page), pdf.numPages);
        let ps = await getParas(p);
        let startIdx = Math.min(start.idx, Math.max(0, ps.length - 1));
        if (ps.length === 0) {
          const found = await findTextPage(p, 1, 60);
          if (found) { p = found.page; ps = found.paras; startIdx = 0; }
        }
        show(p, startIdx, ps);
        if (ps.length === 0) setError("No readable text found in the first pages. This may be a scanned PDF (it needs OCR, coming later).");
        setStatus("ready");
      } catch (e) {
        if (!dead) { setStatus("error"); setError(e.message || "Could not open this PDF."); }
      }
    })();
    return () => {
      dead = true;
      run.current++;
      clearTimeout(sleepTimer.current);
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, [id]);

  // ---- save progress (device now, server a moment later) ----
  useEffect(() => {
    if (status !== "ready") return;
    localStorage.setItem("progress:" + id, JSON.stringify({ page, idx }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api(`/api/documents/${id}/progress`, { method: "PUT", body: { page, paragraph: idx } }).catch(() => {});
    }, 1500);
  }, [page, idx, status]);

  useEffect(() => { setPageInput(String(page)); }, [page]);

  // ---- keep the current paragraph in view ----
  useEffect(() => {
    const el = document.querySelector(".rd.on .spk") || document.getElementById("p" + idx);
    if (!el) return;
    const target = window.innerHeight * (panel === "notes" ? 0.2 : 0.3);
    window.scrollBy({ top: el.getBoundingClientRect().top - target, behavior: "smooth" });
  }, [idx, chunk, page, paras, panel, hl]);

  // ---- lock-screen / headset controls ----
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: title || "PDF", artist: "Read-Aloud PDF" });
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
    set("play", () => latest.current.toggle());
    set("pause", () => latest.current.toggle());
    set("nexttrack", () => latest.current.move(1));
    set("previoustrack", () => latest.current.move(-1));
  }, [title]);

  // ---- derived values ----
  const voiceList = useMemo(() => {
    const lang = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
    return [...voices].sort((a, b) => Number(b.lang.toLowerCase().startsWith(lang)) - Number(a.lang.toLowerCase().startsWith(lang)));
  }, [voices]);
  const voiceName = (v) => v.name.replace(/^Microsoft\s+/, "").replace(/\s+-\s+.*$/, "").replace(/\s*\(.*\)\s*$/, "");
  const currentVoice = voices.find((v) => v.voiceURI === voiceURI);
  const pageNotes = notes.filter((n) => n.page === page);
  const syncLabel = { saved: "Saved on device", syncing: "Syncing...", synced: "Saved and synced", offline: "Offline: saved on device" }[syncState];
  const pct = paras.length ? Math.round(((idx + 1) / paras.length) * 100) : 0;
  const pinnedText = draft.paragraph != null && draft.page === page ? paras[draft.paragraph] : null;

  return (
    <>
      <div className="top">
        <Link href="/" className="ib" aria-label="Back to library"><Icon d={P.down} /></Link>
        <div className="t">
          <b>{title || "Loading..."}</b>
          <span className="muted sm">Page {page} of {numPages || "..."}</span>
        </div>
        <button className="ib" style={{ width: 36 }} aria-label="Previous page with text" onClick={() => goPage(page - 1, -1)}><Icon size={20} d={P.up} /></button>
        <input
          className="pg" type="number" min="1" max={numPages || 1} value={pageInput} aria-label="Go to page"
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") goPage(pageInput); }}
        />
        <button className="ib" style={{ width: 36 }} aria-label="Next page with text" onClick={() => goPage(page + 1, 1)}><Icon size={20} d={P.down} /></button>
      </div>

      <div className={"rtext" + (panel === "notes" ? " pad" : "")}>
        {status === "loading" && <p className="muted">Opening your PDF...</p>}
        {error && <p className="err" role="alert">{error}</p>}
        {paras.length === 0 && status === "ready" && !error && (
          <p className="muted">This page has no readable text (a cover, a picture or a scanned page). Use the page arrows to jump to the next page with text.</p>
        )}
        {paras.map((t, i) => (
          <button key={i} id={"p" + i} type="button" className={"rd" + (i === idx ? " on" : "") + (i === idx && !hl ? " whole" : "")} onClick={() => jump(page, i)}>
            {i === idx && hl
              ? splitChunks(t).map((c, j) => <span key={j} className={j === chunk ? "spk" : ""}>{c}{" "}</span>)
              : t}
          </button>
        ))}
      </div>

      {!panel && status === "ready" && (
        <button className="fab2" aria-label="Open notes" onClick={openNotes}><Icon d={P.pencil} /></button>
      )}

      <div className="player">
        <div className="in">
          <div className="row between muted sm"><span>Paragraph {paras.length ? idx + 1 : 0} of {paras.length}</span><span>Page {page}</span></div>
          <div className="wave" role="img" aria-label={`Progress on this page, ${pct} percent`}>
            {BARS.map((h, i) => <i key={i} className={(i / BARS.length) * 100 < pct ? "on" : ""} style={{ height: h * 2 }} />)}
          </div>
          <div className="ctrl">
            <button className="ib" style={{ width: 52, height: 52 }} aria-label="Previous paragraph" onClick={() => move(-1)}><Icon size={28} d={P.prev} /></button>
            <button className="play" aria-label={playing ? "Pause" : "Play"} onClick={toggle} disabled={status !== "ready"}>
              <Icon size={30} fill d={playing ? P.pause : P.play} />
            </button>
            <button className="ib" style={{ width: 52, height: 52 }} aria-label="Next paragraph" onClick={() => move(1)}><Icon size={28} d={P.next} /></button>
          </div>
          <div className="pills">
            <button className="pill" onClick={() => setPanel("voice")}><Icon size={16} d={P.speed} />{rate}x</button>
            <button className="pill" onClick={() => setPanel("voice")}><Icon size={16} d={P.mic} />{currentVoice ? voiceName(currentVoice) : "Voice"}</button>
            <button className="pill" onClick={() => setPanel("voice")}><Icon size={16} d={P.moon} />{sleepMin ? `${sleepMin} min` : "Sleep"}</button>
          </div>
        </div>
      </div>

      {panel && <button className="scrim" aria-label="Close" onClick={closePanel} />}

      {panel === "notes" && (
        <div className="sheet" role="dialog" aria-label="Notes">
          <div className="grab" style={{ margin: "0 auto" }} />
          <div className="row between">
            <h2 className="sh">Notes</h2>
            <div className="row" style={{ gap: 4 }}>
              <span className="badge"><Icon size={14} d={P.check} />{syncLabel}</span>
              <button className="ib" aria-label="Close notes" onClick={closeNotes}><Icon d={P.close} /></button>
            </div>
          </div>
          <div className="seg">
            <button className={!showAll ? "on" : ""} onClick={() => setShowAll(false)}>This page</button>
            <button className={showAll ? "on" : ""} onClick={() => setShowAll(true)}>All notes ({notes.length})</button>
          </div>
          {draft.paragraph != null && (
            <div className="nc pinned">
              <span style={{ color: "var(--accent-text)", flex: "none", marginTop: 2 }}><Icon size={18} d={P.pin} /></span>
              <div>
                <b style={{ color: "var(--accent-text)" }}>Pinned to paragraph {draft.paragraph + 1}</b>
                {pinnedText && <div className="muted">{pinnedText.slice(0, 90)}…</div>}
              </div>
            </div>
          )}
          <textarea className="noteArea" value={draft.body} onChange={(e) => editDraft({ body: e.target.value })} placeholder="Write a note. It saves on this device as you type, even offline." aria-label="Note text" />
          <div className="tools">
            {(!draft.id || draft.page === page) && (
              <button className={"tool" + (draft.paragraph != null ? " on" : "")} onClick={() => editDraft({ paragraph: draft.paragraph != null ? null : idx })}>Pin</button>
            )}
            <button className="tool" onClick={addBullet}>• List</button>
            <button className="tool" onClick={startNewNote}>New note</button>
            {draft.id && <button className="tool del" onClick={deleteDraft}>Delete</button>}
          </div>
          <div className="lbl">{showAll ? "ALL NOTES IN THIS PDF" : "ON THIS PAGE"}</div>
          <div className="grow">
            {(showAll ? notes : pageNotes).length === 0 && <div className="muted sm">No notes here yet.</div>}
            {(showAll ? notes : pageNotes).map((n) => (
              <div key={n.id} className="nc nitem" style={{ marginBottom: 8, borderColor: n.id === draft.id ? "var(--accent)" : undefined }}>
                <button className="nbtn" onClick={() => openNote(n)}>
                  <span className="muted sm">Page {n.page}{n.paragraph != null ? ` · Paragraph ${n.paragraph + 1}` : ""}</span>
                  <span>{n.body.slice(0, 90) || "(empty)"}</span>
                </button>
                {n.page !== page && <button className="tool" onClick={() => goPage(n.page)}>Go to page</button>}
              </div>
            ))}
          </div>
          <div className="mini">
            <button className="ib" aria-label="Previous paragraph" onClick={() => move(-1)}><Icon size={22} d={P.prev} /></button>
            <button className="pp" aria-label={playing ? "Pause" : "Play"} onClick={toggle}><Icon size={20} fill d={playing ? P.pause : P.play} /></button>
            <button className="ib" aria-label="Next paragraph" onClick={() => move(1)}><Icon size={22} d={P.next} /></button>
            <div style={{ flex: 1, fontSize: 13 }}><b>{playing ? "Still reading" : "Paused"}</b><div className="muted sm">Paragraph {idx + 1} · {rate}x</div></div>
          </div>
        </div>
      )}

      {panel === "voice" && (
        <div className="sheet" role="dialog" aria-label="Voice and speed">
          <div className="grab" style={{ margin: "0 auto" }} />
          <div className="row between">
            <h2 className="sh">Voice and speed</h2>
            <button className="ib" aria-label="Close" onClick={() => setPanel(null)}><Icon d={P.close} /></button>
          </div>
          <div>
            <div className="bigrate">{rate}<span>x</span></div>
            <div className="muted sm" style={{ textAlign: "center", marginTop: 4 }}>About {Math.round(rate * 150)} words per minute</div>
          </div>
          <input type="range" min="0.5" max="3" step="0.25" value={rate} onChange={(e) => changeRate(parseFloat(e.target.value))} aria-label="Reading speed" />
          <div className="presets">
            {[0.75, 1, 1.25, 1.5, 2].map((r) => (
              <button key={r} className={"pre" + (r === rate ? " on" : "")} onClick={() => changeRate(r)}>{r}x</button>
            ))}
          </div>
          <div className="lbl">VOICE</div>
          <div className="grow vlist">
            {voiceList.length === 0 && <div className="muted sm">No voices found on this device.</div>}
            {voiceList.map((v, n) => {
              const sel = v.voiceURI === voiceURI;
              const name = voiceName(v);
              return (
                <div key={v.voiceURI} className={"vc" + (sel ? " sel" : "")}>
                  <button className="vsel" aria-pressed={sel} onClick={() => changeVoice(v.voiceURI)}>
                    <span className="av" style={{ background: PAL[n % PAL.length] }}>{(name[0] || "?").toUpperCase()}</span>
                    <span className="vt"><b>{name}</b><span className="muted sm">{v.lang}{v.localService ? " · On device" : " · Needs internet"}</span></span>
                  </button>
                  <button className="pv" aria-label={`Preview ${name}`} onClick={() => previewVoice(v)}><Icon size={16} fill d={P.play} /></button>
                </div>
              );
            })}
          </div>
          <div className="row between">
            <span style={{ fontSize: 15, fontWeight: 500 }}>Highlight the spoken sentence</span>
            <button className={"sw" + (hl ? " on" : "")} role="switch" aria-checked={hl} aria-label="Highlight the spoken sentence" onClick={() => changeHl(!hl)}><i /></button>
          </div>
          <div className="row between">
            <span style={{ fontSize: 15, fontWeight: 500 }}>Sleep timer</span>
            <div className="row" style={{ gap: 6 }}>
              {[0, 15, 30, 60].map((m) => (
                <button key={m} className={"chip sm" + (sleepMin === m ? " on" : "")} onClick={() => setSleep(m)}>{m === 0 ? "Off" : `${m}m`}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ReaderPage() {
  return (
    <Suspense fallback={null}>
      <Reader />
    </Suspense>
  );
}