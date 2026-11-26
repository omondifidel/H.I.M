"use client";
// Interactive study, shared by the PDF reader and the sermon page:
// scripture popovers, the highlight toolbar (save / quote card / explain), the quote-card maker, and the
// Study panel (summary + prayer points, Pray Along, reflection questions saved to the journal, verse memory).
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { splitRefs } from "../lib/scripture";
import { addJournal, removeVerse, savedVerses, saveVerse, updateVerse } from "../lib/diary";

const Svg = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const I = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  note: <path d="M4 20l4-1 11-11-3-3L5 16z" />,
  quote: <path d="M7 7h4v4c0 3-2 5-4 5M14 7h4v4c0 3-2 5-4 5" />,
  bulb: <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V16h8v-1.3A7 7 0 0012 2z" />,
  book: <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5" />,
  play: <path d="M7 4l13 8-13 8z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
};

// ---------- scripture popovers ----------
const verseCache = new Map();
export async function fetchVerse(ref, translation = "kjv") {
  const k = `${translation}:${ref}`;
  if (!verseCache.has(k)) verseCache.set(k, api(`/api/study/verse?ref=${encodeURIComponent(ref)}&translation=${translation}`)
    .catch((e) => { verseCache.delete(k); throw e; }));
  return verseCache.get(k);
}

/** One popover for a whole page. open(ref, element) shows that verse next to the element. */
export function useVersePopover() {
  const [at, setAt] = useState(null); // { ref, rect }
  const [tr, setTr] = useState("kjv");
  const [verse, setVerse] = useState(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const hoverTimer = useRef(null);

  useEffect(() => {
    if (!at) return;
    let live = true;
    setVerse(null); setErr(""); setSaved(savedVerses().some((v) => v.reference.toLowerCase() === at.ref.toLowerCase()));
    fetchVerse(at.ref, tr).then((v) => live && setVerse(v)).catch((e) => live && setErr(e.message || "Could not load that verse."));
    return () => { live = false; };
  }, [at, tr]);
  useEffect(() => {
    if (!at) return;
    const esc = (e) => { if (e.key === "Escape") setAt(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [at]);

  const open = (ref, el) => setAt({ ref, rect: el.getBoundingClientRect() });
  const hover = (ref, el) => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => open(ref, el), 350); };
  const unhover = () => clearTimeout(hoverTimer.current);

  let popover = null;
  if (at) {
    const below = at.rect.top < window.innerHeight * 0.45;
    const style = { left: Math.max(12, Math.min(window.innerWidth - 332, at.rect.left - 20)),
                    ...(below ? { top: at.rect.bottom + 8 } : { bottom: window.innerHeight - at.rect.top + 8 }) };
    popover = (
      <div className="verse-pop" role="dialog" aria-label={at.ref} style={style}>
        <div className="vp-top">
          <b>{verse?.reference || at.ref}</b>
          <div className="row" style={{ gap: 4 }}>
            {["kjv", "web"].map((t) => <button key={t} className={"chip sm" + (tr === t ? " on" : "")} aria-pressed={tr === t} onClick={() => setTr(t)}>{t.toUpperCase()}</button>)}
            <button className="ib" style={{ width: 30, height: 30 }} aria-label="Close verse" onClick={() => setAt(null)}><Svg d={I.close} /></button>
          </div>
        </div>
        {err ? <p className="err sm">{err}</p> : verse ? <p className="verse-text">{verse.text}</p> : <p className="muted sm">Opening {at.ref}…</p>}
        {verse && (
          <div className="row between">
            <small className="muted">{verse.translation}</small>
            <button className="chip sm" disabled={saved} onClick={() => { saveVerse(verse); setSaved(true); }}>
              <Svg size={13} d={I.star} />{saved ? "In your verses" : "Save to memorise"}
            </button>
          </div>
        )}
      </div>
    );
  }
  return { open, hover, unhover, popover, close: () => setAt(null) };
}

/** Text with every Bible reference turned into a tappable link (sermon transcripts, summaries). */
export function ScriptureText({ text, verses }) {
  return splitRefs(text).map((p, i) => (typeof p === "string" ? p : (
    <button key={i} type="button" className="scripture-ref" onClick={(e) => verses.open(p.ref, e.currentTarget)}
      onMouseEnter={(e) => verses.hover(p.ref, e.currentTarget)} onMouseLeave={verses.unhover}>{p.text}</button>
  )));
}

// ---------- highlight to action ----------
/** Watches selections inside `containerRef` and offers Save / Quote card / Explain simply. */
export function SelectionToolbar({ containerRef, onSave, source, around }) {
  const [sel, setSel] = useState(null); // { text, rect }
  const [explain, setExplain] = useState(null); // { text } | { error } | "busy"
  const [card, setCard] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let t;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = window.getSelection();
        const text = s && s.rangeCount ? s.toString().replace(/\s+/g, " ").trim() : "";
        const root = containerRef.current;
        if (!text || text.length < 3 || !root || !root.contains(s.anchorNode)) return setSel((cur) => (cur && !text ? null : cur));
        setSel({ text: text.slice(0, 1500), rect: s.getRangeAt(0).getBoundingClientRect() });
        setExplain(null); setSaved(false);
      }, 180);
    };
    document.addEventListener("selectionchange", check);
    return () => { document.removeEventListener("selectionchange", check); clearTimeout(t); };
  }, [containerRef]);

  async function doExplain() {
    setExplain("busy");
    try { setExplain({ text: (await api("/api/study/explain", { method: "POST", body: { text: sel.text, around: (around?.(sel.text) || "").slice(0, 3000) } })).explanation }); }
    catch (e) { setExplain({ error: e.message }); }
  }

  if (card) return <QuoteCard text={card} source={source} onClose={() => setCard(null)} />;
  if (!sel) return null;
  const top = Math.max(70, sel.rect.top - 52);
  const left = Math.max(12, Math.min(window.innerWidth - 320, sel.rect.left + sel.rect.width / 2 - 150));
  const keep = (e) => e.preventDefault(); // clicking the toolbar must not clear the selection
  return (
    <div className="sel-bar" style={{ top, left }} role="toolbar" aria-label="Highlight actions" onMouseDown={keep}>
      <div className="sel-actions">
        <button onClick={() => { onSave(sel.text); setSaved(true); }} disabled={saved}><Svg d={I.note} />{saved ? "Saved" : "Save to notes"}</button>
        <button onClick={() => setCard(sel.text)}><Svg d={I.quote} />Quote card</button>
        <button onClick={doExplain} disabled={explain === "busy"}><Svg d={I.bulb} />{explain === "busy" ? "Thinking…" : "Explain simply"}</button>
        <button aria-label="Close" onClick={() => { setSel(null); window.getSelection()?.removeAllRanges(); }}><Svg d={I.close} /></button>
      </div>
      {explain && explain !== "busy" && <p className={"sel-explain" + (explain.error ? " err" : "")} aria-live="polite">{explain.error || explain.text}</p>}
    </div>
  );
}

// ---------- quote cards ----------
function wrap(ctx, text, width) {
  const lines = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > width && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

const CARD_STYLES = [
  { id: "dawn", bg: ["#1E3A5F", "#4A8BC8"], ink: "#FFFFFF", sub: "rgba(255,255,255,.75)" },
  { id: "olive", bg: ["#2F3B23", "#7C8B4E"], ink: "#FFFDF4", sub: "rgba(255,253,244,.75)" },
  { id: "paper", bg: ["#F7F0E1", "#EADBC0"], ink: "#3A2E1F", sub: "rgba(58,46,31,.7)" },
  { id: "royal", bg: ["#2A1745", "#7A4FB5"], ink: "#FFFFFF", sub: "rgba(255,255,255,.75)" },
];

export function QuoteCard({ text, source, onClose }) {
  const canvasRef = useRef(null);
  const [style, setStyle] = useState(CARD_STYLES[0]);
  const [size, setSize] = useState("post"); // post 1080x1350 (Instagram/WhatsApp), story 1080x1920
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const c = canvasRef.current;
    const W = 1080, H = size === "story" ? 1920 : 1350;
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, style.bg[0]); g.addColorStop(1, style.bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = style.sub; ctx.font = "bold 220px Georgia, serif"; ctx.fillText("“", 90, 330);
    const quote = text.length > 420 ? text.slice(0, 417).trimEnd() + "…" : text;
    let fontSize = 64, lines;
    do { ctx.font = `${fontSize}px Georgia, "Source Serif 4", serif`; lines = wrap(ctx, quote, W - 200); fontSize -= 4; }
    while (lines.length * fontSize * 1.4 > H - 620 && fontSize > 34);
    const lh = (fontSize + 4) * 1.4;
    let y = (H - lines.length * lh) / 2 + 40;
    ctx.fillStyle = style.ink;
    for (const l of lines) { ctx.fillText(l, 100, y); y += lh; }
    ctx.fillStyle = style.sub; ctx.font = "600 34px system-ui, sans-serif";
    ctx.fillText(("— " + (source || "")).slice(0, 60), 100, y + 50);
    ctx.font = "700 30px system-ui, sans-serif"; ctx.fillText("HIM LIBRARY", 100, H - 90);
  }, [text, source, style, size]);

  async function share() {
    const blob = await new Promise((r) => canvasRef.current.toBlob(r, "image/png"));
    const file = new File([blob], "him-quote.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: `“${text}” — ${source}` }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "him-quote.png"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setMsg("Saved as an image. Post it on WhatsApp or Instagram from your downloads.");
  }

  return (
    <div className="qc-wrap" role="dialog" aria-label="Quote card">
      <button className="scrim" aria-label="Close" onClick={onClose} />
      <div className="qc">
        <div className="row between"><h2 className="sh">Quote card</h2><button className="ib" aria-label="Close" onClick={onClose}><Svg d={I.close} /></button></div>
        <canvas ref={canvasRef} className={"qc-canvas " + size} aria-label="Preview of the quote card" />
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {CARD_STYLES.map((s) => <button key={s.id} className={"qc-swatch" + (s === style ? " on" : "")} style={{ background: `linear-gradient(135deg, ${s.bg[0]}, ${s.bg[1]})` }} aria-label={`${s.id} style`} aria-pressed={s === style} onClick={() => setStyle(s)} />)}
          <span style={{ flex: 1 }} />
          {[["post", "Post"], ["story", "Status / Story"]].map(([k, l]) => <button key={k} className={"chip sm" + (size === k ? " on" : "")} aria-pressed={size === k} onClick={() => setSize(k)}>{l}</button>)}
        </div>
        <button className="btn" onClick={share}>Share to WhatsApp, Instagram…</button>
        {msg && <p className="muted sm">{msg}</p>}
      </div>
    </div>
  );
}

// ---------- Pray Along (reads each prayer point aloud in your reading voice, with room to pray) ----------
function PrayAlong({ points }) {
  const [at, setAt] = useState(-1);
  const stop = useRef(null);
  useEffect(() => () => stop.current?.(), []);

  async function start() {
    let cancelled = false, audio = null, timer = null;
    stop.current = () => { cancelled = true; audio?.pause(); clearTimeout(timer); setAt(-1); };
    const voice = localStorage.getItem("tts:voice") || "ann";
    for (let i = 0; i < points.length && !cancelled; i++) {
      setAt(i);
      try {
        const res = await fetch("/api/tts/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: points[i], voice }) });
        if (!res.ok) throw new Error();
        const url = URL.createObjectURL(await res.blob());
        audio = new Audio(url);
        await new Promise((done) => { audio.onended = done; audio.onerror = done; audio.play().catch(done); });
        URL.revokeObjectURL(url);
      } catch { /* no voice: still give time to pray the point */ }
      await new Promise((r) => { timer = setTimeout(r, 6000); }); // silence to pray it in your own words
    }
    if (!cancelled) setAt(points.length);
  }

  return (
    <div className="pray">
      <div className="row between">
        <span className="lbl" style={{ margin: 0 }}>PRAYER POINTS</span>
        {at >= 0 && at < points.length
          ? <button className="chip sm" onClick={() => stop.current?.()}><Svg size={13} d={I.stop} />Stop</button>
          : <button className="chip sm on" onClick={start}><Svg size={13} d={I.play} />Pray along</button>}
      </div>
      <ol className="pray-list">
        {points.map((p, i) => <li key={i} className={i === at ? "on" : i < at ? "done" : ""}>{p}</li>)}
      </ol>
      {at === points.length && <p className="muted sm">Amen. Take a moment of quiet before you go on.</p>}
    </div>
  );
}

// ---------- Verse memory (verses saved from popovers, with words hidden a little more each round) ----------
const HIDE = [0, 0.25, 0.5, 0.75, 1];
const hidden = (i, level) => ((i * 37) % 100) / 100 < HIDE[level];
function Memorise() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(null);
  const [shown, setShown] = useState(new Set());
  useEffect(() => setList(savedVerses()), []);
  const refresh = () => setList(savedVerses());

  if (!list.length) return <p className="muted sm">Tap any Bible reference in a book or sermon, then “Save to memorise”. Your verses collect here and you can learn them a few words at a time.</p>;
  const v = list.find((x) => x.reference === open);
  if (v) {
    const words = v.text.split(/\s+/);
    const level = v.level || 0;
    return (
      <div className="mem">
        <div className="row between"><b>{v.reference}</b><button className="chip sm" onClick={() => setOpen(null)}>All verses</button></div>
        <p className="mem-text">{words.map((w, i) => (hidden(i, level) && !shown.has(i)
          ? <span key={i}><button className="mem-blank" aria-label="Show this word" onClick={() => setShown(new Set([...shown, i]))}>{"_".repeat(Math.min(8, w.length))}</button> </span>
          : <span key={i}>{w} </span>))}</p>
        <div className="mem-level" aria-label={`Level ${level + 1} of 5`}>{HIDE.map((_, i) => <i key={i} className={i <= level ? "on" : ""} />)}</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="chip sm" disabled={level === 0} onClick={() => { updateVerse(v.reference, { level: level - 1 }); setShown(new Set()); refresh(); }}>Easier</button>
          <button className="chip sm on" disabled={level === HIDE.length - 1} onClick={() => { updateVerse(v.reference, { level: level + 1 }); setShown(new Set()); refresh(); }}>I know it, hide more</button>
        </div>
        {level === HIDE.length - 1 && <p className="muted sm">Say the whole verse from memory, then tap the blanks to check yourself.</p>}
      </div>
    );
  }
  return (
    <div className="mem-list">
      {list.map((x) => (
        <div key={x.reference} className="nc">
          <button className="nbtn" onClick={() => { setOpen(x.reference); setShown(new Set()); }}>
            <b>{x.reference}</b><span className="muted sm">{x.text.slice(0, 80)}…</span>
          </button>
          <div className="mem-level small">{HIDE.map((_, i) => <i key={i} className={i <= (x.level || 0) ? "on" : ""} />)}</div>
          <button className="tool del" onClick={() => { removeVerse(x.reference); refresh(); }}>Remove</button>
        </div>
      ))}
    </div>
  );
}

// ---------- the Study panel ----------
/**
 * target: { key, label, request } where request is the body for /api/study/summary.
 * title: the book or sermon, used for journal entries.
 */
export function StudyPanel({ title, target, tab: startTab = "summary", verses, onClose, docked = true }) {
  const [tab, setTab] = useState(startTab);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [answers, setAnswers] = useState({});
  const [saved, setSaved] = useState(false);
  useEffect(() => setTab(startTab), [startTab]);

  useEffect(() => {
    setErr(""); setSaved(false); setAnswers({});
    try { setData(JSON.parse(localStorage.getItem("study:" + target.key) || "null")); } catch { setData(null); }
  }, [target.key]);
  useEffect(() => { if (tab === "reflect" && !data && !busy) load(); }, [tab, data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setBusy(true); setErr("");
    try {
      const body = await target.request();
      const out = await api("/api/study/summary", { method: "POST", body: { label: target.label, ...body } });
      setData(out);
      try { localStorage.setItem("study:" + target.key, JSON.stringify(out)); } catch {}
    } catch (e) { setErr(e.message || "Could not make a summary."); }
    setBusy(false);
  }

  function saveReflection() {
    const qs = data?.reflection_questions || [];
    const body = qs.map((q, i) => `${q}\n${(answers[i] || "").trim() || "…"}`).join("\n\n");
    addJournal({ title: `Reflection: ${title} (${target.label})`, body, mood: "focused" });
    setSaved(true);
  }

  const list = (items) => <ul className="study-list">{items.map((t, i) => <li key={i}><ScriptureText text={t} verses={verses} /></li>)}</ul>;
  return (
    <div className={docked ? "sheet notes-docked study-sheet" : "study-inline"} role="dialog" aria-label="Study">
      <div className="row between">
        <h2 className="sh">Study</h2>
        {onClose && <button className="ib" aria-label="Close study" onClick={onClose}><Svg d={I.close} /></button>}
      </div>
      <div className="seg">
        {[["summary", "Summary"], ["reflect", "Reflect"], ["verses", "My verses"]].map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="grow study-body">
        {tab !== "verses" && <div className="muted sm">{target.label}</div>}
        {err && <p className="err sm" role="alert">{err}</p>}
        {tab === "summary" && (!data ? (
          <button className="btn" onClick={load} disabled={busy}>{busy ? "Reading it for you…" : `Summarise ${target.label}`}</button>
        ) : (
          <>
            <div className="lbl">TAKEAWAYS</div>{list(data.takeaways)}
            <div className="lbl">KEY POINTS</div>{list(data.key_points)}
            {data.prayer_points.length > 0 && <PrayAlong points={data.prayer_points} />}
            <div className="row" style={{ gap: 6 }}>
              <button className="chip sm" onClick={() => setTab("reflect")}>Reflect on it</button>
              <button className="chip sm" onClick={load} disabled={busy}>{busy ? "…" : "Make it again"}</button>
            </div>
          </>
        ))}
        {tab === "reflect" && (busy && !data ? <p className="muted sm">Preparing questions…</p> : data && (
          <>
            {(data.reflection_questions || []).map((q, i) => (
              <label key={i} className="reflect-q">
                <span>{q}</span>
                <textarea className="noteArea" rows={3} value={answers[i] || ""} onChange={(e) => { setAnswers({ ...answers, [i]: e.target.value }); setSaved(false); }} placeholder="Write honestly. Only you see this." />
              </label>
            ))}
            <button className="btn" onClick={saveReflection} disabled={saved || !Object.values(answers).some((a) => a.trim())}>{saved ? "Saved to your journal" : "Save to my journal"}</button>
            {saved && <p className="muted sm">Find it in Diary, Journal.</p>}
          </>
        ))}
        {tab === "verses" && <Memorise />}
      </div>
    </div>
  );
}
