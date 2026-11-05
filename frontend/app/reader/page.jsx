"use client";
import { Suspense, useEffect, useRef, useState } from "react";
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

const Icon = ({ d, fill }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

function Reader() {
  const id = useSearchParams().get("id");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [idx, setIdx] = useState(0);
  const [paras, setParas] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState("");

  const pdfRef = useRef(null);
  const cache = useRef(new Map());
  const run = useRef(0);
  const pos = useRef({ page: 1, idx: 0, chunk: 0 });
  const rateRef = useRef(1);
  const voiceRef = useRef("");
  const numRef = useRef(0);
  const playingRef = useRef(false);
  const saveTimer = useRef(null);
  const latest = useRef({});

  // ---- notes state ----
  const [sheet, setSheet] = useState(false);
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
      // Clean dot strings and layout artifacts (e.g. ".....")
      v = (v || [])
        .map((text) => text.trim())
        .filter((text) => text.length > 0 && !/^[\.\-_]{2,}$/.test(text))
        .map((text) => text.replace(/\s+/g, " "));
      try { await idbPut("paras", key, v); } catch {}
    }
    cache.current.set(key, v);
    return v;
  }

  function show(p, i, ps) {
    pos.current = { ...pos.current, page: p, idx: i };
    setPage(p);
    setIdx(i);
    if (ps) setParas(ps);
  }

  // ---- speech ----
  async function play(p, i, chunk = 0) {
    const synth = window.speechSynthesis;
    const myRun = ++run.current;
    synth.cancel();
    setPlay(true);
    let ps = await getParas(p);
    if (myRun !== run.current) return;
    while (i >= ps.length) {
      if (p >= numRef.current) { setPlay(false); return; }
      p += 1; i = 0; chunk = 0;
      ps = await getParas(p);
      if (myRun !== run.current) return;
    }
    show(p, i, ps);
    pos.current.chunk = chunk;
    if (p < numRef.current) getParas(p + 1).catch(() => {}); // prefetch next page

    const chunks = splitChunks(ps[i]);
    const text = chunks[chunk];
    if (text == null) return play(p, i + 1, 0);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rateRef.current;
    const v = synth.getVoices().find((x) => x.voiceURI === voiceRef.current);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.onend = () => {
      if (myRun !== run.current) return;
      if (chunk + 1 < chunks.length) play(p, i, chunk + 1);
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
  }
  async function move(delta) {
    const t = await step(pos.current.page, pos.current.idx, delta);
    return jump(t.page, t.idx);
  }
  async function goPage(p) {
    p = Math.max(1, Math.min(numRef.current, Number(p) || 1));
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
  async function startNewNote() {
    clearTimeout(noteTimer.current);
    await persistDraft();
    draftRef.current = { id: null, body: "", paragraph: null, page: pos.current.page };
    setDraft(draftRef.current);
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
    draftRef.current = { id: null, body: "", paragraph: null, page: pos.current.page };
    setDraft(draftRef.current);
    await refreshNotes();
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(runSync, 800);
  }
  function openSheet() {
    if (!draftRef.current.id && !draftRef.current.body) {
      draftRef.current = { id: null, body: "", paragraph: null, page: pos.current.page };
      setDraft(draftRef.current);
    }
    setSheet(true);
  }
  async function closeSheet() {
    clearTimeout(noteTimer.current);
    await persistDraft();
    setSheet(false);
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
        // Fallback PDF.js worker path for static builds to prevent chunk failure
        if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version || '3.11.174'}/build/pdf.worker.min.js`;
        }
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

        let meta = null;
        try {
          meta = (await api("/api/documents")).find((d) => d.id === id);
        } catch {
          meta = JSON.parse(localStorage.getItem("docs") || "[]").find((d) => d.id === id);
        }
        const local = JSON.parse(localStorage.getItem("progress:" + id) || "null");
        const start = local || (meta ? { page: meta.last_page, idx: meta.last_paragraph } : { page: 1, idx: 0 });
        setTitle(meta ? meta.title : "PDF");

        const p = Math.min(Math.max(1, start.page), pdf.numPages);
        const ps = await getParas(p);
        show(p, Math.min(start.idx, Math.max(0, ps.length - 1)), ps);

        let any = ps.length > 0;
        for (let q = 1; !any && q <= Math.min(3, pdf.numPages); q++) any = (await getParas(q)).length > 0;
        if (!any) setError("No readable text found. This may be a scanned PDF (it needs OCR, coming later).");
        setStatus("ready");
      } catch (e) {
        if (!dead) { setStatus("error"); setError(e.message || "Could not open this PDF."); }
      }
    })();
    return () => {
      dead = true;
      run.current++;
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

  // ---- keep the current paragraph in view ----
  useEffect(() => {
    const el = document.getElementById("p" + idx);
    if (!el) return;
    const target = window.innerHeight * (sheet ? 0.2 : 0.4);
    window.scrollBy({ top: el.getBoundingClientRect().top - target, behavior: "smooth" });
  }, [idx, page, paras, sheet]);

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

  const pageNotes = notes.filter((n) => n.page === page);
  const syncLabel = { saved: "Saved on device", syncing: "Syncing...", synced: "Saved and synced", offline: "Offline: saved on device" }[syncState];
  const pct = paras.length ? Math.round(((idx + 1) / paras.length) * 100) : 0;

  return (
    <>
      <div className="top">
        <Link href="/" className="icon" aria-label="Back to library">
          <Icon d={<path d="M15 5l-7 7 7 7" />} />
        </Link>
        <div className="t">
          <b>{title || "Loading..."}</b>
          <span className="muted">Page {page} of {numPages || "..."}</span>
        </div>
        <button className="icon" aria-label="Previous page" onClick={() => goPage(page - 1)}>
          <Icon d={<path d="M18 15l-6-6-6 6" />} />
        </button>
        <button className="icon" aria-label="Next page" onClick={() => goPage(page + 1)}>
          <Icon d={<path d="M6 9l6 6 6-6" />} />
        </button>
      </div>

      <div className={"text" + (sheet ? " pad" : "")}>
        {status === "loading" && <p className="muted">Opening your PDF...</p>}
        {error && <p className="err" role="alert">{error}</p>}
        {paras.length === 0 && status === "ready" && !error && <p className="muted">This page has no readable text. Use the page arrows to move on.</p>}
        {paras.map((t, i) => (
          <p key={i} id={"p" + i} className={i === idx ? "on" : ""} onClick={() => jump(page, i)}>{t}</p>
        ))}
      </div>

      {!sheet && status === "ready" && (
        <button className="fab" aria-label="Open notes" onClick={openSheet}>
          <Icon d={<path d="M4 20l4-1 11-11-3-3L5 16z" />} />
        </button>
      )}

      {sheet && (
        <div className="sheet" role="dialog" aria-label="Notes">
          <div className="grab" />
          <div className="row between">
            <b style={{ fontSize: 18 }}>Notes · Page {draft.id ? draft.page : page}</b>
            <div className="row">
              <span className="badge">{syncLabel}</span>
              <button className="icon" aria-label="Close notes" onClick={closeSheet}>
                <Icon d={<path d="M6 6l12 12M18 6L6 18" />} />
              </button>
            </div>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {(!draft.id || draft.page === page) && (
              <button className={"chip" + (draft.paragraph != null ? " on" : "")} onClick={() => editDraft({ paragraph: draft.paragraph != null ? null : idx })}>
                {draft.paragraph != null ? `Pinned to paragraph ${draft.paragraph + 1}` : "Pin to current paragraph"}
              </button>
            )}
            <button className="chip" onClick={startNewNote}>New note</button>
            {draft.id && <button className="chip" onClick={deleteDraft}>Delete</button>}
          </div>
          <textarea className="noteArea" value={draft.body} onChange={(e) => editDraft({ body: e.target.value })} placeholder="Write a note. It saves on this device as you type, even offline." aria-label="Note text" />
          <div className="row between muted">
            <span>{pageNotes.length} on this page · {notes.length} in this PDF</span>
            <button className="chip" onClick={() => setShowAll(!showAll)}>{showAll ? "Show this page" : "Show all notes"}</button>
          </div>
          <div className="nlist">
            {(showAll ? notes : pageNotes).map((n) => (
              <div key={n.id} className={"nitem" + (n.id === draft.id ? " on" : "")}>
                <button className="nbtn" onClick={() => openNote(n)}>
                  <span className="muted">Page {n.page}{n.paragraph != null ? ` · paragraph ${n.paragraph + 1}` : ""}</span>
                  <span>{n.body.slice(0, 90) || "(empty)"}</span>
                </button>
                {n.page !== page && <button className="chip" onClick={() => goPage(n.page)}>Go to page</button>}
              </div>
            ))}
          </div>
          <div className="mini">
            <button className="icon" aria-label="Previous paragraph" onClick={() => move(-1)}><Icon d={<path d="M6 5v14M20 5L9 12l11 7z" />} /></button>
            <button className="pp" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
              {playing ? <Icon fill d={<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>} /> : <Icon fill d={<path d="M7 4l13 8-13 8z" />} />}
            </button>
            <button className="icon" aria-label="Next paragraph" onClick={() => move(1)}><Icon d={<path d="M18 5v14M4 5l11 7-11 7z" />} /></button>
            <span style={{ flex: 1 }}>{playing ? "Playing" : "Paused"} · Paragraph {idx + 1} · {rate}x</span>
          </div>
        </div>
      )}

      <div className="player">
        <div className="inner">
          <div className="row between muted">
            <span>Paragraph {paras.length ? idx + 1 : 0} of {paras.length}</span>
            <span>Page {page}</span>
          </div>
          <div className="bar"><i style={{ width: pct + "%" }} /></div>
          <div className="ctrl">
            <button className="icon" aria-label="Previous paragraph" onClick={() => move(-1)}>
              <Icon d={<path d="M6 5v14M20 5L9 12l11 7z" />} />
            </button>
            <button className="play" aria-label={playing ? "Pause" : "Play"} onClick={toggle} disabled={status !== "ready"}>
              {playing ? <Icon fill d={<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>} /> : <Icon fill d={<path d="M7 4l13 8-13 8z" />} />}
            </button>
            <button className="icon" aria-label="Next paragraph" onClick={() => move(1)}>
              <Icon d={<path d="M18 5v14M4 5l11 7-11 7z" />} />
            </button>
          </div>
          <div className="opts">
            <div className="rate">
              <span style={{ minWidth: 44 }}>{rate.toFixed(2).replace(/0$/, "")}x</span>
              <input type="range" min="0.5" max="3" step="0.25" value={rate} onChange={(e) => changeRate(parseFloat(e.target.value))} aria-label="Speed" />
            </div>
            <select value={voiceURI} onChange={(e) => changeVoice(e.target.value)} aria-label="Voice">
              {voices.length === 0 && <option value="">Default voice</option>}
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
          </div>
        </div>
      </div>
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