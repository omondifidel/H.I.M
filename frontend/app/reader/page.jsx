"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../lib/api";
import { idbGet, idbPut } from "../../lib/db";
import { listNotes, newNoteId, putNote, removeNote, syncNotes } from "../../lib/notes";
import { extractParagraphs, loadPdfjs } from "../../lib/pdfText";
import { applyTheme, getTheme, THEMES } from "../../lib/theme";
import NotificationBell from "../../components/NotificationBell";
import { useVoice } from "../../lib/useVoice";
import { nextRate } from "../../lib/voice";

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
// Human-sounding voices (Edge "Natural", Google, neural). Old offline voices like "Microsoft David" sound robotic.
const isNatural = (v) => /natural|neural|online|google/i.test(v.name);
const PAL = ["#FFB547", "#5B8DEF", "#4FD1A5", "#FF7A59", "#C08CF5"];
const localDayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function PdfPageView({ pdf, pageNumber, paras, activeIdx, activeChunk, hlEnabled, onSelectPara }) {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [pageData, setPageData] = useState({ lines: [], paraRanges: [] });

  useEffect(() => {
    let active = true;
    let renderTask;
    async function renderPage() {
      try {
        const page = await pdf.getPage(pageNumber);
        if (!active) return;
        const base = page.getViewport({ scale: 1 });
        const width = Math.max(280, Math.min(900, canvasRef.current?.parentElement?.clientWidth || 720));
        const viewport = page.getViewport({ scale: Math.min(1.8, width / base.width) });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = "100%";
        renderTask = page.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
        await renderTask.promise;
        const tc = await page.getTextContent();
        if (!active) return;
        const rawLines = [];
        for (const it of tc.items || []) {
          const str = (it.str || "").trim();
          if (!str) continue;
          const tx = it.transform || [1, 0, 0, 1, 0, 0];
          const [vx, vy] = viewport.convertToViewportPoint(tx[4], tx[5]);
          const h = Math.max(10, Math.abs(tx[3]) * viewport.scale);
          const w = Math.max(8, (it.width || 0) * viewport.scale);
          const top = Math.max(0, Math.min(98, ((vy - h * 0.92) / viewport.height) * 100));
          const height = Math.max(1.2, Math.min(100 - top, ((h * 1.18) / viewport.height) * 100));
          const left = Math.max(0, Math.min(95, (vx / viewport.width) * 100));
          const right = Math.max(left + 1.5, Math.min(98, ((vx + w) / viewport.width) * 100));
          const prev = rawLines[rawLines.length - 1];
          if (prev && Math.abs(prev.vy - vy) < h * 0.5) {
            prev.left = Math.min(prev.left, left);
            prev.right = Math.max(prev.right, right);
            prev.text += " " + str;
          } else {
            rawLines.push({ vy, top, height, left, right, text: str });
          }
        }
        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        let stream = "";
        const lineSpans = rawLines.map((l, idx) => {
          const t = norm(l.text);
          const start = stream.length;
          stream += (stream ? " " : "") + t;
          return { idx, start: start ? start + 1 : 0, end: stream.length, ...l };
        });
        const paraRanges = [];
        let searchFrom = 0;
        for (let i = 0; i < (paras || []).length; i++) {
          const pNorm = norm(paras[i]);
          if (!pNorm) { paraRanges.push(null); continue; }
          const probe = pNorm.slice(0, 48);
          let pos = stream.indexOf(probe, searchFrom);
          if (pos === -1 && probe.length > 20) pos = stream.indexOf(probe.slice(0, 20), searchFrom);
          if (pos === -1) pos = searchFrom;
          const endPos = Math.min(stream.length, pos + pNorm.length);
          searchFrom = Math.max(searchFrom, endPos - 12);
          paraRanges.push({ idx: i, start: pos, end: endPos });
        }
        setPageData({ lines: lineSpans, paraRanges });
        setFailed(false);
      } catch { if (active) setFailed(true); }
    }
    setFailed(false); renderPage();
    return () => { active = false; renderTask?.cancel(); };
  }, [pdf, pageNumber, paras]);
  const activeLines = [];
  const activeRange = pageData.paraRanges[activeIdx];
  if (activeRange && pageData.lines.length) {
    let hlStart = activeRange.start, hlEnd = activeRange.end;
    if (hlEnabled && paras?.[activeIdx]) {
      const chunks = splitChunks(paras[activeIdx]);
      const cNorm = (chunks[activeChunk] || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (cNorm) {
        const prefixLen = chunks.slice(0, activeChunk).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().length;
        hlStart = activeRange.start + prefixLen;
        hlEnd = Math.min(activeRange.end, hlStart + cNorm.length + 4);
      }
    }
    for (const l of pageData.lines) if (l.end >= hlStart && l.start <= hlEnd) activeLines.push(l);
  }
  function handleLineClick(line) {
    const mid = (line.start + line.end) / 2;
    let hit = pageData.paraRanges.find((r) => r && mid >= r.start && mid <= r.end);
    if (!hit) {
      let best = null, bestDist = Infinity;
      for (const r of pageData.paraRanges) {
        if (!r) continue;
        const dist = mid < r.start ? r.start - mid : mid - r.end;
        if (dist < bestDist) { bestDist = dist; best = r; }
      }
      hit = best;
    }
    if (hit) onSelectPara?.(hit.idx);
  }
  if (failed) return null;
  return (
    <figure className="pdf-page" style={{ position: "relative" }}>
      <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />
      <div className="pdf-hl-layer">
        {pageData.lines.map((l) => (
          <button key={"hit-" + l.idx} type="button" aria-label="Read from this line" className="pdf-line-hit"
            style={{ top: `${l.top}%`, height: `${l.height}%`, left: `${l.left}%`, width: `${Math.max(4, l.right - l.left)}%` }}
            onClick={() => handleLineClick(l)} />
        ))}
        {activeLines.map((l, k) => (
          <span key={"hl-" + l.idx} id={k === 0 ? "p" + activeIdx : undefined} className="pdf-line-hl"
            style={{ top: `${l.top}%`, height: `${l.height}%`, left: `${Math.max(1.5, l.left - 0.5)}%`, width: `${Math.min(97, l.right - l.left + 1)}%` }} />
        ))}
      </div>
    </figure>
  );
}


function PageThumb({ pdf, pageNumber, active, onSelect }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !pdf || rendered) return;
    let cancelled = false;
    const obs = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      obs.disconnect();
      (async () => {
        try {
          const p = await pdf.getPage(pageNumber);
          if (cancelled || !canvasRef.current) return;
          const base = p.getViewport({ scale: 1 });
          const viewport = p.getViewport({ scale: 112 / base.width });
          const canvas = canvasRef.current;
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await p.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
          if (!cancelled) setRendered(true);
          if (pageNumber === 1) {
            try {
              const existing = await idbGet("covers", id);
              if (!existing) {
                canvas.toBlob((b) => { if (b) idbPut("covers", id, b).catch(() => {}); }, "image/jpeg", 0.85);
              }
            } catch {}
          }
        } catch {}
      })();
    }, { rootMargin: "240px 0px" });
    obs.observe(el);
    return () => { cancelled = true; obs.disconnect(); };
  }, [pdf, pageNumber, rendered]);

  return (
    <button
      ref={boxRef}
      type="button"
      className={"thumb-card" + (active ? " on" : "")}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(pageNumber)}
    >
      <div className="thumb-frame">
        <canvas ref={canvasRef} aria-hidden="true" />
        {!rendered && <span className="thumb-skel">{pageNumber}</span>}
      </div>
      <span className="thumb-num">Page {pageNumber}</span>
    </button>
  );
}

function PageRail({ pdf, numPages, currentPage, onSelect }) {
  if (!numPages) return null;
  return (
    <aside className="reader-rail" aria-label="Book pages">
      <div className="rail-head">PAGES ({numPages})</div>
      <div className="rail-scroll">
        {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
          <PageThumb key={n} pdf={pdf} pageNumber={n} active={n === currentPage} onSelect={onSelect} />
        ))}
      </div>
    </aside>
  );
}

const HUMAN_VOICES = [
  { id: "ann", name: "Ann", accent: "US · Warm & natural", color: "#2563EB" },
  { id: "mary", name: "Mary", accent: "UK · Calm & clear", color: "#7C3AED" },
  { id: "brian", name: "Brian", accent: "US · Deep & steady", color: "#D97706" },
  { id: "andrew", name: "Andrew", accent: "US · Storyteller", color: "#0D9488" },
];

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
  const [seekPage, setSeekPage] = useState(1);
  const [trayWidth, setTrayWidth] = useState(340);
  const [trayCompact, setTrayCompact] = useState(false);
  const dragRef = useRef(null);

  function startTrayResize(e) {
    e.preventDefault();
    const startX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const startW = trayWidth;
    const onMove = (ev) => {
      const cx = ev.clientX ?? ev.touches?.[0]?.clientX ?? startX;
      const next = Math.max(280, Math.min(560, startW + (startX - cx)));
      setTrayWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  const [paras, setParas] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [voiceURI, setVoiceURI] = useState("ann");
  const [hl, setHl] = useState(true);
  const [panel, setPanel] = useState(null); // null | "notes" | "voice"
  const [sleepMin, setSleepMin] = useState(0);
  const [theme, setTheme] = useState("light");

  const pdfRef = useRef(null);
  const cache = useRef(new Map());
  const run = useRef(0);
  const pos = useRef({ page: 1, idx: 0, chunk: 0 });
  const rateRef = useRef(1);
  const voiceRef = useRef("ann");
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
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
    const key = `${id}:v3:${p}`;
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

  // ---- speech (4 Human Neural Voices — gapless silence-trimmed Web Audio + instant prefetch) ----
  const neuralCacheRef = useRef(new Map());
  const decodedCacheRef = useRef(new Map());
  const neuralPendingRef = useRef(new Map());
  const audioCtxRef = useRef(null);
  const bufferSourceRef = useRef(null);

  function getAudioCtx() {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }

  function trimSilence(ctx, buf) {
    try {
      const sr = buf.sampleRate;
      const ch = buf.getChannelData(0);
      const thresh = 0.004;
      let start = 0;
      let end = ch.length - 1;
      while (start < end && Math.abs(ch[start]) < thresh) start++;
      while (end > start && Math.abs(ch[end]) < thresh) end--;
      // Leave tiny 18ms natural breath at edges so words never clip
      start = Math.max(0, start - Math.floor(sr * 0.018));
      end = Math.min(ch.length - 1, end + Math.floor(sr * 0.025));
      const len = end - start + 1;
      if (len <= Math.floor(sr * 0.08) || len >= ch.length - Math.floor(sr * 0.04)) return buf;
      const trimmed = ctx.createBuffer(buf.numberOfChannels, len, sr);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        trimmed.copyToChannel(buf.getChannelData(c).subarray(start, end + 1), c);
      }
      return trimmed;
    } catch {
      return buf;
    }
  }

  function stopAudio() {
    if (bufferSourceRef.current) {
      try {
        bufferSourceRef.current.onended = null;
        bufferSourceRef.current.stop(0);
        bufferSourceRef.current.disconnect();
      } catch {}
      bufferSourceRef.current = null;
    }
    if (audioRef.current) {
      try {
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
        audioRef.current.src = "";
      } catch {}
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      try { URL.revokeObjectURL(audioUrlRef.current); } catch {}
      audioUrlRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
  }

  function fetchNeuralBlob(text, voiceKey) {
    const vKey = voiceKey || "ann";
    const key = `${vKey}:${text}`;
    const cached = neuralCacheRef.current.get(key);
    if (cached) return Promise.resolve(cached);
    const inflight = neuralPendingRef.current.get(key);
    if (inflight) return inflight;

    const req = fetch("/api/tts/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: vKey }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Neural TTS failed");
        const blob = await res.blob();
        if (neuralCacheRef.current.size > 50) {
          const oldest = neuralCacheRef.current.keys().next().value;
          neuralCacheRef.current.delete(oldest);
          decodedCacheRef.current.delete(oldest);
        }
        neuralCacheRef.current.set(key, blob);
        // Pre-decode & trim silence immediately in background for 0ms paragraph switch
        const ctx = getAudioCtx();
        if (ctx && !decodedCacheRef.current.has(key)) {
          blob.arrayBuffer()
            .then((ab) => ctx.decodeAudioData(ab))
            .then((raw) => decodedCacheRef.current.set(key, trimSilence(ctx, raw)))
            .catch(() => {});
        }
        return blob;
      })
      .finally(() => {
        neuralPendingRef.current.delete(key);
      });

    neuralPendingRef.current.set(key, req);
    return req;
  }

  async function getDecodedBuffer(text, voiceKey) {
    const vKey = voiceKey || "ann";
    const key = `${vKey}:${text}`;
    if (decodedCacheRef.current.has(key)) return decodedCacheRef.current.get(key);
    const blob = await fetchNeuralBlob(text, vKey);
    const ctx = getAudioCtx();
    if (!ctx) return null;
    if (decodedCacheRef.current.has(key)) return decodedCacheRef.current.get(key);
    const ab = await blob.arrayBuffer();
    const raw = await ctx.decodeAudioData(ab);
    const trimmed = trimSilence(ctx, raw);
    decodedCacheRef.current.set(key, trimmed);
    return trimmed;
  }

  async function prefetchAhead(p, i, chunkNo, ps, vKey) {
    try {
      const curChunks = splitChunks(ps[i] || "");
      if (chunkNo + 1 < curChunks.length) {
        fetchNeuralBlob(curChunks[chunkNo + 1], vKey).catch(() => {});
        return;
      }
      if (i + 1 < ps.length) {
        const nextChunks = splitChunks(ps[i + 1] || "");
        if (nextChunks[0]) fetchNeuralBlob(nextChunks[0], vKey).catch(() => {});
        if (i + 2 < ps.length) {
          const thirdChunks = splitChunks(ps[i + 2] || "");
          if (thirdChunks[0]) fetchNeuralBlob(thirdChunks[0], vKey).catch(() => {});
        }
      } else if (p < numRef.current) {
        const nextPs = await getParas(p + 1);
        if (nextPs[0]) {
          const firstNext = splitChunks(nextPs[0])[0];
          if (firstNext) fetchNeuralBlob(firstNext, vKey).catch(() => {});
        }
      }
    } catch {}
  }

  async function play(p, i, chunkNo = 0) {
    const myRun = ++run.current;
    stopAudio();
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

    const chunks = splitChunks(ps[i]);
    const text = chunks[chunkNo];
    if (text == null) return play(p, i + 1, 0);

    const vKey = voiceRef.current;
    prefetchAhead(p, i, chunkNo, ps, vKey);

    const advance = () => {
      if (myRun !== run.current) return;
      if (chunkNo + 1 < chunks.length) play(p, i, chunkNo + 1);
      else play(p, i + 1, 0);
    };

    try {
      const ctx = getAudioCtx();
      if (ctx) {
        const buf = await getDecodedBuffer(text, vKey);
        if (myRun !== run.current) return;
        if (buf) {
          if (ctx.state === "suspended") await ctx.resume();
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.playbackRate.value = rateRef.current;
          src.connect(ctx.destination);
          src.onended = advance;
          bufferSourceRef.current = src;
          src.start(0);
          return;
        }
      }
      const blob = await fetchNeuralBlob(text, vKey);
      if (myRun !== run.current) return;
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audio.playbackRate = rateRef.current;
      audioRef.current = audio;
      audio.onended = advance;
      audio.onerror = () => {
        if (myRun !== run.current) return;
        setPlay(false);
        setError("Unable to play audio for this paragraph.");
      };
      await audio.play();
    } catch (err) {
      if (myRun !== run.current) return;
      if (err && err.name === "AbortError") return;
      setPlay(false);
      setError("Neural voice temporarily unavailable. Check your connection and tap Play.");
    }
  }

  function pause() {
    run.current++;
    stopAudio();
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
    if (bufferSourceRef.current) {
      bufferSourceRef.current.playbackRate.value = r;
    } else if (audioRef.current) {
      audioRef.current.playbackRate = r;
    } else if (playingRef.current) {
      play(pos.current.page, pos.current.idx, pos.current.chunk);
    }
  }
  function changeVoice(id) {
    voiceRef.current = id;
    setVoiceURI(id);
    localStorage.setItem("tts:voice", id);
    if (playingRef.current) {
      play(pos.current.page, pos.current.idx, pos.current.chunk);
    } else {
      getParas(pos.current.page).then((ps) => prefetchAhead(pos.current.page, pos.current.idx - 1, 0, ps, id)).catch(() => {});
    }
  }
  async function previewVoice(v) {
    pause();
    const myRun = ++run.current;
    try {
      const blob = await fetchNeuralBlob(`Hello, I'm ${v.name}. This is how I will read your document.`, v.id);
      if (myRun !== run.current) return;
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audio.playbackRate = rateRef.current;
      audioRef.current = audio;
      await audio.play();
    } catch (err) {
      if (myRun !== run.current || (err && err.name === "AbortError")) return;
      setError("Preview unavailable right now.");
    }
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

  // ---- voice control (mic orb / Ctrl+Space) ----
  const voice = useVoice({
    pause: () => { const was = playingRef.current; if (was) pause(); return was; },
    resume: () => play(pos.current.page, pos.current.idx, pos.current.chunk),
    voice: { rate: rateRef.current, voiceURI: voiceRef.current },
    dictate: (t) => { const b = draftRef.current.body; editDraft({ body: b + (b && !/\s$/.test(b) ? " " : "") + t }); },
    command: async ({ cmd, arg }) => {
      const { page: p, idx: i } = pos.current;
      if (cmd === "pause") return pause();
      if (cmd === "resume") return play(p, i, pos.current.chunk);
      if (cmd === "rate") { const r = nextRate(rateRef.current, arg); changeRate(r); return `Speed ${r}x`; }
      if (cmd === "page") { await goPage(arg); return `Page ${pos.current.page}`; }
      if (cmd === "minute") return "Minutes work in sermons. Here, say “go to page 12”.";
      if (cmd === "theme") { chooseTheme(arg); return `${arg[0].toUpperCase() + arg.slice(1)} mode`; }
      if (cmd === "bookmark") {
        await putNote({ id: newNoteId(), document_id: id, page: p, paragraph: i, body: "🔖 Bookmark", updated_at: new Date().toISOString(), deleted: false });
        await refreshNotes();
        clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(runSync, 1500);
        return `Bookmarked page ${p}, paragraph ${i + 1}`;
      }
      if (cmd === "paragraph") { await move(arg); return `Paragraph ${pos.current.idx + 1}`; }
      if (cmd === "skip") { await move(Math.sign(arg)); return arg < 0 ? "Back one paragraph" : "Forward one paragraph"; }
      if (cmd === "turn") { await goPage(p + arg, arg); return `Page ${pos.current.page}`; }
      if (cmd === "notes") {
        if (!arg) { await closeNotes(); return "Notes closed"; }
        openNotes();
        setShowAll(true);
        return "Your notes";
      }
      if (cmd === "lastNote") {
        const last = [...notes].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
        if (!last) return "There are no notes in this book yet.";
        await openNote(last); // so "delete that note" acts on it
        await jump(last.page, last.paragraph ?? 0);
        return `Note on page ${last.page}`;
      }
      if (cmd === "deleteNote") {
        if (!draftRef.current.id) return "Open a note first, then say “delete that note”.";
        await deleteDraft();
        return "Note deleted";
      }
      if (cmd === "note") {
        await startNewNote();
        setPanel("notes");
        return editDraft({ paragraph: i });
      }
      if (cmd === "ask") {
        const context = [];
        for (let q = Math.max(1, p - 2); q <= Math.min(numRef.current, p + 2); q++) {
          for (const t of await getParas(q)) context.push(`[page ${q}] ${t}`);
        }
        const r = await api("/api/assistant/ask", { method: "POST", body: { document_id: id, question: arg, context } });
        return r.answer;
      }
    },
  });

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
    setTheme(getTheme());
    const r = parseFloat(localStorage.getItem("tts:rate") || "1") || 1;
    rateRef.current = r;
    setRate(r);
    setHl(localStorage.getItem("ui:hl") !== "0");
    const rawSaved = localStorage.getItem("tts:voice") || "ann";
    const mapped = rawSaved === "aria" ? "ann" : rawSaved === "sonia" ? "mary" : rawSaved;
    const valid = HUMAN_VOICES.some((v) => v.id === mapped) ? mapped : "ann";
    voiceRef.current = valid;
    setVoiceURI(valid);
    return () => stopAudio();

  }, []);

  function chooseTheme(value) {
    setTheme(value);
    applyTheme(value);
  }

  useEffect(() => {
    if (status !== "ready") return;
    let last = Date.now();
    let visible = !document.hidden;
    const saveVisibleTime = () => {
      const now = Date.now();
      if (visible) {
        const seconds = Math.floor((now - last) / 1000);
        if (seconds > 0) {
          const total = Number(localStorage.getItem("reading-seconds")) || 0;
          localStorage.setItem("reading-seconds", String(total + seconds));
        }
      }
      last = visible && !document.hidden ? last + Math.floor((now - last) / 1000) * 1000 : now;
      visible = !document.hidden;
    };
    const timer = setInterval(saveVisibleTime, 15000);
    document.addEventListener("visibilitychange", saveVisibleTime);
    window.addEventListener("pagehide", saveVisibleTime);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", saveVisibleTime);
      window.removeEventListener("pagehide", saveVisibleTime);
      saveVisibleTime();
    };
  }, [status]);

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
          let res;
          try {
            res = await api(`/api/documents/${id}/file`, { raw: true });
          } catch (e) {
            if (e.status === 404 || e.status === 500) {
              throw new Error("This PDF's file is no longer on the server. Go back to the library, delete it, and upload it again.");
            }
            throw e;
          }
          blob = await res.blob();
          try { await idbPut("pdfs", id, blob); } catch {}
        }
        const data = new Uint8Array(await blob.arrayBuffer());
        const task = pdfjs.getDocument({ data });
        task.onPassword = (update, reason) => {
          const pw = window.prompt(reason === 2 ? "Wrong password. Try again:" : "This PDF is password-protected. Enter the password:");
          if (pw) update(pw);
          else task.destroy();
        };
        const pdf = await task.promise;
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
        if (sp.get("autoplay") === "1") setTimeout(() => { if (!dead) play(p, startIdx); }, 220);
        api(`/api/documents/${id}/opened`, { method: "POST" }).catch(() => {}); // tells the admin report this book was read
      } catch (e) {
        if (!dead) {
          setStatus("error");
          setError(e.name === "PasswordException" ? "This PDF needs a password. Reload the page to try again." : e.message || "Could not open this PDF.");
        }
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
    try {
      const day = localDayKey();
      const activity = JSON.parse(localStorage.getItem("reading-activity") || "{}");
      activity[day] = [...new Set([...(activity[day] || []), page])];
      localStorage.setItem("reading-activity", JSON.stringify(activity));
    } catch {}
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api(`/api/documents/${id}/progress`, { method: "PUT", body: { page, paragraph: idx } }).catch(() => {});
    }, 1500);
  }, [page, idx, status]);

  useEffect(() => { setPageInput(String(page)); }, [page]);
  useEffect(() => { setSeekPage(page); }, [page]);

  // ---- keep the current paragraph in view ----
  useEffect(() => {
    const el = document.querySelector(".pdf-line-hl") || document.getElementById("p" + idx);
    if (!el) return;
    const target = window.innerHeight * (panel === "notes" ? 0.2 : 0.3);
    window.scrollBy({ top: el.getBoundingClientRect().top - target, behavior: "smooth" });
  }, [idx, chunk, page, paras, panel, hl]);

  // ---- lock-screen / headset controls ----
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: title || "PDF", artist: "HIM Ministries" });
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
    set("play", () => latest.current.toggle());
    set("pause", () => latest.current.toggle());
    set("nexttrack", () => latest.current.move(1));
    set("previoustrack", () => latest.current.move(-1));
  }, [title]);

  // ---- derived values ----
  const currentVoice = HUMAN_VOICES.find((v) => v.id === voiceURI) || HUMAN_VOICES[0];

  const pageNotes = notes.filter((n) => n.page === page);
  const syncLabel = { saved: "Saved on device", syncing: "Syncing...", synced: "Saved and synced", offline: "Offline: saved on device" }[syncState];
  const pct = paras.length ? Math.round(((idx + 1) / paras.length) * 100) : 0;
  const pinnedText = draft.paragraph != null && draft.page === page ? paras[draft.paragraph] : null;

  return (
    <main className="reader-shell">
      <div className="top">
        <Link href="/" className="ib back-lib-btn" aria-label="Back to library" title="Back to library">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </Link>
        <div className="t">
          <b>{title || "Loading..."}</b>
          <span className="muted sm">Page {page} of {numPages || "..."}</span>
        </div>
        <div className="reader-right-tools">
          <div className="page-nav-pill" role="group" aria-label="Page navigation">
            <button type="button" className="pnav-btn" aria-label="Previous page" title="Previous page" onClick={() => goPage(page - 1, -1)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <input
              className="pg" type="number" min="1" max={numPages || 1} value={pageInput} aria-label="Go to page"
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") goPage(pageInput); }}
            />
            <button type="button" className="pnav-btn" aria-label="Next page" title="Next page" onClick={() => goPage(page + 1, 1)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <NotificationBell />
          <select className="reader-theme" value={theme} onChange={(e) => chooseTheme(e.target.value)} aria-label="Appearance theme">
            {THEMES.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </div>

      <div className="reader-stage">
        {status === "ready" && <PageRail pdf={pdfRef.current} numPages={numPages} currentPage={page} onSelect={(p) => goPage(p)} />}
        <main className={"rtext" + (panel === "notes" ? " pad" : "")}>
        {status === "loading" && <p className="muted">Opening your PDF...</p>}
        {error && <p className="err" role="alert">{error}</p>}
        {status === "ready" && pdfRef.current && (
          <PdfPageView pdf={pdfRef.current} pageNumber={page} paras={paras} activeIdx={idx} activeChunk={chunk} hlEnabled={hl} onSelectPara={(i) => play(page, i, 0)} />
        )}
        {paras.length === 0 && status === "ready" && !error && (
          <p className="muted" style={{ marginTop: 12 }}>This page has no readable text (a cover, a picture or a scanned page). Use the page arrows to jump to the next page with text.</p>
        )}
        </main>
      </div>

      <div className="right-tray-dock">
        {!panel && status === "ready" && (
          <button className="fab2 docked-pencil" aria-label="Open notes" title="Open notes" onClick={openNotes}><Icon d={P.pencil} /></button>
        )}

        <div className={"player right-tray" + (trayCompact ? " compact" : "")} style={{ "--tray-w": `${trayWidth}px` }}>
        <div className="tray-resizer" role="separator" aria-orientation="vertical" aria-label="Resize audio player" onPointerDown={startTrayResize} title="Drag to resize sound tray" />
        <div className="in">
          <div className="tray-head">
            <span className="muted sm">P{paras.length ? idx + 1 : 0}/{paras.length} · Pg {page}/{numPages || "..."}</span>
            <button type="button" className="tray-min" onClick={() => setTrayCompact((c) => !c)} aria-label={trayCompact ? "Expand audio tray" : "Minimize audio tray"}>
              {trayCompact ? "Expand" : "Minimize"}
            </button>
          </div>
          {!trayCompact && (
            <>
              <label className="page-seek">
                <span>Pg <b>{seekPage}</b></span>
                <input type="range" min="1" max={numPages || 1} value={Math.min(seekPage, numPages || 1)} aria-label="Jump to page"
                  onChange={(e) => setSeekPage(Number(e.target.value))}
                  onPointerUp={(e) => goPage(Number(e.currentTarget.value))}
                  onKeyUp={(e) => goPage(Number(e.currentTarget.value))} />
              </label>
              <div className="wave" role="img" aria-label={`Progress on this page, ${pct} percent`}>
                {BARS.slice(0, 28).map((h, i) => <i key={i} className={(i / 28) * 100 < pct ? "on" : ""} style={{ height: Math.max(8, Math.round(h * 1.3)) }} />)}
              </div>
            </>
          )}
          <div className="ctrl">
            <button className="ib" style={{ width: 40, height: 40 }} aria-label="Previous paragraph" onClick={() => move(-1)}><Icon size={21} d={P.prev} /></button>
            <button className="play" aria-label={playing ? "Pause" : "Play"} onClick={toggle} disabled={status !== "ready"}>
              <Icon size={24} fill d={playing ? P.pause : P.play} />
            </button>
            <button className="ib" style={{ width: 40, height: 40 }} aria-label="Next paragraph" onClick={() => move(1)}><Icon size={21} d={P.next} /></button>
            <button className={"orb sm " + voice.state} aria-label="Voice command (Ctrl+Space)" title="Voice command (Ctrl+Space)" onClick={voice.toggle} disabled={status !== "ready"}><Icon size={20} d={P.mic} /></button>
          </div>
          {voice.caption && <div className="vcap" role="status" aria-live="polite">{voice.caption}</div>}
          {!trayCompact && (
            <div className="pills">
              <button className="pill" onClick={() => setPanel("voice")}><Icon size={14} d={P.speed} />{rate}x</button>
              <button className="pill" onClick={() => setPanel("voice")}><Icon size={14} d={P.mic} />{currentVoice.name}</button>
              <button className="pill" onClick={() => setPanel("voice")}><Icon size={14} d={P.moon} />{sleepMin ? `${sleepMin}m` : "Sleep"}</button>
              <button className={"pill" + (voice.handsFree ? " on" : "")} aria-pressed={voice.handsFree} title="Say “Hey Nasoma”, then a command" onClick={() => voice.setHandsFree(!voice.handsFree)}><Icon size={14} d={P.mic} />{voice.handsFree ? "Hands-free on" : "Hands-free"}</button>
            </div>
          )}
        </div>
        </div>
      </div>

      {panel === "voice" && <button className="scrim" aria-label="Close" onClick={closePanel} />}

      {panel === "notes" && (
        <div className={"sheet notes-docked" + (trayCompact ? " tray-min-mode" : "")} role="dialog" aria-label="Notes">
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
                <b style={{ color: "var(--accent-text)" }}>Pinned to page {draft.page}, paragraph {draft.paragraph + 1}</b>
                {pinnedText && <div className="muted">{pinnedText.slice(0, 90)}…</div>}
              </div>
            </div>
          )}
          <textarea className="noteArea" value={draft.body} onChange={(e) => editDraft({ body: e.target.value })} placeholder="Write a note. It saves on this device as you type, even offline." aria-label="Note text" />
          {voice.live && <div className="live" aria-live="polite">{voice.live}…</div>}
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
                  </div>
      )}

      {panel === "voice" && (
        <div className={"voice-pop" + (trayCompact ? " tray-min-mode" : "")} role="dialog" aria-label="Voice and speed">
          <div className="vp-head">
            <h2 className="vp-title">Voice & speed</h2>
            <button className="ib" style={{ width: 32, height: 32 }} aria-label="Close" onClick={() => setPanel(null)}><Icon size={17} d={P.close} /></button>
          </div>

          <div className="vp-rate-box">
            <div>
              <div className="vp-rate-val">{rate}x</div>
              <div className="muted" style={{ fontSize: 11.5 }}>~{Math.round(rate * 155)} words/min</div>
            </div>
            <input
              type="range"
              min="0.75"
              max="2.25"
              step="0.25"
              value={rate}
              style={{ width: 170, accentColor: "var(--accent)" }}
              onChange={(e) => changeRate(parseFloat(e.target.value))}
              aria-label="Reading speed"
            />
          </div>

          <div className="vp-presets">
            {[0.75, 1, 1.25, 1.5, 2].map((r) => (
              <button key={r} type="button" className={"vp-pre" + (r === rate ? " on" : "")} onClick={() => changeRate(r)}>{r}x</button>
            ))}
          </div>

          <div className="lbl" style={{ fontSize: 11 }}>NATURAL VOICES</div>
          <div className="vp-vgrid">
            {HUMAN_VOICES.map((v) => {
              const sel = v.id === voiceURI;
              return (
                <div key={v.id} className={"vp-vc" + (sel ? " sel" : "")}>
                  <button type="button" className="vp-vsel" aria-pressed={sel} onClick={() => changeVoice(v.id)}>
                    <span className="vp-av" style={{ background: v.color }}>{v.name[0]}</span>
                    <span className="vp-vt"><b>{v.name}</b><span>{v.accent}</span></span>
                  </button>
                  <button type="button" className="vp-pv" aria-label={`Preview ${v.name}`} onClick={() => previewVoice(v)}>
                    <Icon size={12} fill d={P.play} />

                  </button>
                </div>
              );
            })}
          </div>

          <div className="vp-row">
            <span>Highlight spoken sentence</span>
            <button type="button" className={"sw" + (hl ? " on" : "")} role="switch" aria-checked={hl} aria-label="Highlight the spoken sentence" onClick={() => changeHl(!hl)}><i /></button>
          </div>

          <div className="vp-row">
            <span>Sleep timer</span>
            <div className="row" style={{ gap: 5 }}>
              {[0, 15, 30, 60].map((m) => (
                <button key={m} type="button" className={"chip sm" + (sleepMin === m ? " on" : "")} style={{ height: 28, padding: "0 9px", fontSize: 11.5 }} onClick={() => setSleep(m)}>
                  {m === 0 ? "Off" : `${m}m`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ReaderPage() {
  return (
    <Suspense fallback={null}>
      <Reader />
    </Suspense>
  );
}
