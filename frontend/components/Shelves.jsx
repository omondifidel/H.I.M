"use client";
// HIM Library pages (PDFs, Books, Sermons, Study notes): everything grouped by discipleship section, with your progress.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api";

const COLORS = ["#7B5BB5", "#3D8FD9", "#B7791F", "#D9603B", "#D6587E"]; // section dots and bars, in programme order
const KIND = {
  pdf: { title: "PDFs", intro: "Short teachings of 5 to 40 pages, grouped by discipleship stage.", noun: "PDFs", done: "read",
         labels: ["Read", "Continue", "Start now"], stats: ["Read", "In progress", "Not started"] },
  book: { title: "Books", intro: "Full-length books from the programme, grouped by discipleship stage.", noun: "books", done: "finished",
          labels: ["Read again", "Continue", "Start now"], stats: ["Finished", "In progress", "Not started"] },
  sermon: { title: "Sermons", intro: "Grouped by discipleship stage. Your place is saved every few seconds.", noun: "sermons", done: "finished",
            labels: ["Again", "Resume", "Listen"], stats: ["Finished", "In progress", "Not started"] },
  notes: { title: "Study notes", intro: "Outlines, summaries and class notes, grouped by discipleship stage.", noun: "notes", done: "read",
           labels: ["Read", "Continue", "Open"], stats: ["Read", "In progress", "Not started"] },
};
export const SHELF_KIND = { pdfs: "pdf", books: "book", sermons: "sermon", studynotes: "notes" }; // tab -> kind
const TYPES = [["pdf", "PDF"], ["book", "Book"], ["sermon", "Sermon"], ["notes", "Notes"]];
const PAGE_MINUTES = 1.3; // reading time estimate per page
const pct = (f) => Math.round(f * 100);
const hm = (s) => { const m = s > 0 ? Math.max(1, Math.round(s / 60)) : 0; return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`; };
const local = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

function docItem(d) {
  const pages = d.pages || Number(local("pages:" + d.id)) || 0;
  const status = pages && d.last_page >= pages ? "done" : d.last_page > 1 || d.last_paragraph > 0 ? "going" : "new";
  const frac = status === "done" ? 1 : status === "going" && pages ? d.last_page / pages : 0;
  const size = pages ? `${pages} pages · ${Math.max(1, Math.round(pages * PAGE_MINUTES))} min` : "Counting pages…";
  return { id: d.id, title: d.title.replace(/\.pdf$/i, ""), section: d.section, author: d.author, pages, status, frac,
           href: `/reader/?id=${d.id}`, mine: !d.shared, last: d.last_page, kind: d.kind, doc: true, position: 0, duration: 0,
           meta: status === "going" ? `${size} · ${pct(frac)}% read` : size };
}

function sermonItem(s) {
  const status = s.duration && s.position >= s.duration - 20 ? "done" : s.position > 5 ? "going" : "new";
  const frac = status === "done" ? 1 : s.duration ? s.position / s.duration : 0;
  return { id: s.id, title: s.title, section: s.section, status, frac, position: s.position, duration: s.duration,
           href: `/sermon/?id=${s.id}&t=${status === "going" ? Math.floor(s.position) : 0}`,
           meta: `${s.speaker ? s.speaker + " · " : ""}${hm(s.duration)}`,
           state: status === "done" ? "Finished" : status === "going" ? `${pct(frac)}% · ${hm(s.duration - s.position)} left` : "Not started" };
}

const Svg = ({ d, size = 16, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const PLAY = <path d="M7 4l13 8-13 8z" />;
const CHECK = <path d="M5 12l5 5 9-10" />;
const AGAIN = <path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7M4 4v4h4" />;
const NEXT = <path d="M9 6l6 6-6 6" />;
const DOC = <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>;

function Action({ item, kind }) {
  const [doneLabel, goLabel, newLabel] = KIND[kind].labels;
  const cls = item.status === "done" ? "ghost" : item.status === "going" ? "go" : "new";
  const icon = item.status === "done" ? (kind === "pdf" ? CHECK : AGAIN) : item.status === "new" ? PLAY : null;
  const label = item.status === "done" ? doneLabel : item.status === "going" ? goLabel : newLabel;
  return <Link className={"sh-btn " + cls} href={item.href}>{icon && <Svg size={13} fill={icon === PLAY} d={icon} />}{label}</Link>;
}

const Bar = ({ item, color }) => (
  <div className="sh-bar"><i style={{ width: `${pct(item.frac)}%`, background: item.status === "done" ? "var(--good)" : color }} /></div>
);

function SortPick({ item, sections, onSection, onKind }) {
  return (
    <span className="sh-picks">
      <select className="sh-sort" value={item.section || ""} aria-label={`Section for ${item.title}`} onChange={(e) => onSection(item.id, e.target.value)}>
        <option value="">Not sorted</option>
        {sections.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
      </select>
      <select className="sh-sort" value={item.kind} aria-label={`Type of ${item.title}`} onChange={(e) => onKind(item.id, e.target.value)}>
        {TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    </span>
  );
}

function Row({ item, kind, color, arrange, sections, onSection, onKind }) {
  return (
    <div className="sh-row" style={{ "--c": color }}>
      <span className="sh-tile"><Svg size={18} d={DOC} /></span>
      <div className="sh-row-main">
        <Link href={item.href} className="sh-row-title">{item.title}</Link>
        <small>{item.meta}</small>
        {arrange && item.mine ? <SortPick item={item} sections={sections} onSection={onSection} onKind={onKind} /> : <Bar item={item} color={color} />}
      </div>
      <Action item={item} kind={kind} />
    </div>
  );
}

function Cover({ item, color, index, arrange, sections, onSection, onKind }) {
  return (
    <div className="sh-book" style={{ "--c": color }}>
      <Link href={item.href} className={"sh-cover" + (index % 2 ? " deep" : "")}>
        <b>{item.title}</b>
        <small>{item.author}</small>
        {item.status === "done" && <span className="sh-check"><Svg size={13} d={CHECK} /></span>}
      </Link>
      <Bar item={item} color={color} />
      <small className="sh-book-meta">{item.status === "done" ? "Finished" : item.status === "going" ? `${pct(item.frac)}% read` : "Not started"}{item.pages ? ` · ${item.pages} pages` : ""}</small>
      {arrange && item.mine ? <SortPick item={item} sections={sections} onSection={onSection} onKind={onKind} /> : <Action item={item} kind="book" />}
    </div>
  );
}

function SermonCard({ item, color }) {
  return (
    <div className="sh-row sermon" style={{ "--c": color }}>
      <Link href={item.href} className="sh-thumb" aria-label={`Play ${item.title}`}>
        <span className="sh-thumb-play"><Svg size={12} fill d={PLAY} /></span>
        <span className="sh-wave" aria-hidden="true">{[5, 9, 6, 11, 7, 10, 5, 8].map((h, i) => <i key={i} style={{ height: h }} />)}</span>
      </Link>
      <div className="sh-row-main">
        <Link href={item.href} className="sh-row-title">{item.title}</Link>
        <small>{item.meta}</small>
        <Bar item={item} color={color} />
        <small>{item.state}</small>
      </div>
      <Action item={item} kind="sermon" />
    </div>
  );
}

function MiniPlayer({ item, onPosition }) {
  const audio = useRef(null);
  const saved = useRef(item.position);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(item.position);
  const [rate, setRate] = useState(1);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  function save(t) {
    saved.current = t;
    onPosition(item.id, t);
    api(`/api/sermons/${item.id}/position`, { method: "PUT", body: { position: t } }).catch(() => {});
  }
  async function toggle() {
    const a = audio.current;
    if (url) return a.paused ? a.play().catch(() => {}) : a.pause();
    setBusy(true);
    try {
      // ponytail: whole recording as a blob (the <audio> tag can't send the login token), same as the sermon page
      const blob = await (await api(`/api/transcriptions/${item.id}/listen/audio`, { raw: true })).blob();
      setUrl(URL.createObjectURL(blob));
      try { localStorage.setItem("last-sermon", item.id); } catch {}
    } catch {}
    setBusy(false);
  }
  const skip = (s) => { if (audio.current && url) audio.current.currentTime = Math.max(0, audio.current.currentTime + s); };
  const speed = () => { const r = rate >= 2 ? 1 : rate + 0.25; setRate(r); if (audio.current) audio.current.playbackRate = r; };

  return (
    <div className="sh-player" aria-label="Sermon player">
      <span className="sh-thumb small"><span className="sh-thumb-play"><Svg size={11} fill d={PLAY} /></span></span>
      <div className="sh-player-main">
        <b>{item.title}</b>
        <small>{item.meta.split(" · ")[0]} · {hm(now)} / {hm(item.duration)}</small>
        <div className="sh-bar"><i style={{ width: `${item.duration ? (now / item.duration) * 100 : 0}%` }} /></div>
      </div>
      <button className="sh-round" onClick={() => skip(-15)} aria-label="Back 15 seconds"><Svg size={17} d={AGAIN} /></button>
      <button className="sh-round big" onClick={toggle} disabled={busy} aria-label={playing ? "Pause" : "Play"}>
        {busy ? "…" : <Svg size={18} fill d={playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : PLAY} />}
      </button>
      <button className="sh-round flip" onClick={() => skip(15)} aria-label="Forward 15 seconds"><Svg size={17} d={AGAIN} /></button>
      <button className="sh-speed" onClick={speed} aria-label="Playback speed">{rate.toFixed(rate % 1 ? 2 : 1)}x</button>
      <audio ref={audio} src={url || undefined}
        onLoadedMetadata={(e) => { e.currentTarget.currentTime = item.status === "done" ? 0 : now; e.currentTarget.playbackRate = rate; e.currentTarget.play().catch(() => {}); }}
        onPlay={() => setPlaying(true)}
        onPause={(e) => { setPlaying(false); save(e.currentTarget.currentTime); }}
        onTimeUpdate={(e) => { const t = e.currentTarget.currentTime; setNow(t); if (Math.abs(t - saved.current) >= 5) save(t); }} />
    </div>
  );
}

export default function Shelves({ kind, docs, sermons, sections, streak, setTab, onUpload, onSection, onKind, onSermonPosition, busy }) {
  const [focus, setFocus] = useState("");
  const [arrange, setArrange] = useState(false);
  useEffect(() => { setFocus(""); setArrange(false); }, [kind]);
  const K = KIND[kind];
  const written = docs.filter((d) => d.kind === kind).map(docItem); // sermons can also be uploaded as PDFs
  const items = kind === "sermon" ? [...sermons.map(sermonItem), ...written] : written;
  const colorOf = (name) => { const i = sections.findIndex((s) => s.name === name); return i < 0 ? "var(--muted)" : COLORS[i % COLORS.length]; };
  const known = new Set(sections.map((s) => s.name));
  const groups = [...sections, { name: "Not sorted yet", short: "Not sorted" }]
    .map((s) => ({ ...s, color: colorOf(s.name),
                   items: items.filter((i) => (s.short === "Not sorted" ? !known.has(i.section) : i.section === s.name)) }))
    .filter((g) => g.items.length);
  const empty = sections.filter((s) => !groups.some((g) => g.name === s.name)).length;
  const count = (st) => items.filter((i) => i.status === st).length;
  const done = count("done");
  const total = kind === "sermon" ? items.reduce((t, i) => t + i.duration, 0) : items.length;
  const progress = kind === "sermon" ? items.reduce((t, i) => t + Math.min(i.position, i.duration), 0) : done;
  const going = items.filter((i) => i.status === "going");
  const lastId = local(kind === "sermon" ? "last-sermon" : "last");
  const playable = kind === "sermon" ? items.filter((i) => !i.doc) : items; // the mini player only plays recordings
  const resume = playable.find((i) => i.status === "going" && i.id === lastId) || playable.find((i) => i.status === "going") || playable.find((i) => i.status === "new");
  const canArrange = items.some((i) => i.mine);
  const shown = focus ? groups.filter((g) => g.name === focus) : groups;
  // PDFs: open the two sections you are busy in (or the first two); the rest stay as slim rows
  const busyFirst = [...shown].sort((a, b) => (b.items.some((i) => i.status === "going") - a.items.some((i) => i.status === "going")));
  const open = kind === "pdf" && !focus ? busyFirst.slice(0, 2) : shown;
  const rows = kind === "pdf" && !focus ? shown.filter((g) => !open.includes(g)) : [];

  const head = (g, all) => {
    const gDone = g.items.filter((i) => i.status === "done").length;
    return (
      <div className="sh-head" style={{ "--c": g.color }}>
        <h2><i className="sh-dot" />{g.name}<small>{gDone} of {g.items.length} {K.done}</small></h2>
        <span className="sh-mini"><i style={{ width: `${pct(gDone / g.items.length)}%` }} /></span>
        {all ? <button className="sh-all" onClick={() => setFocus("")}>All sections</button>
             : <button className="sh-all" onClick={() => { setFocus(g.name); window.scrollTo({ top: 0, behavior: "smooth" }); }}>See all <Svg size={13} d={NEXT} /></button>}
      </div>
    );
  };
  const body = (g) => {
    const list = focus ? g.items : g.items.slice(0, kind === "book" ? 12 : 6);
    if (kind === "book") return <div className={"sh-shelf" + (focus ? " wrap" : "")}>{list.map((it, n) => <Cover key={it.id} item={it} index={n} color={g.color} arrange={arrange} sections={sections} onSection={onSection} onKind={onKind} />)}</div>;
    return <div className="sh-grid">{list.map((it) => (kind === "sermon" && !it.doc ? <SermonCard key={it.id} item={it} color={g.color} />
      : <Row key={it.id} item={it} kind={kind === "sermon" ? "pdf" : kind} color={g.color} arrange={arrange} sections={sections} onSection={onSection} onKind={onKind} />))}</div>;
  };

  return (
    <div className={"shelves" + (kind === "sermon" && resume ? " with-player" : "")}>
      <div className="sh-top">
        <div>
          <div className="greet">HIM Library</div>
          <h1 className="title">{K.title}</h1>
          <p className="muted sh-intro">{K.intro}</p>
        </div>
        <div className="sh-top-right">
          <div className="sh-seg" role="group" aria-label="Library">
            {[["pdfs", "PDFs"], ["books", "Books"], ["sermons", "Sermons"], ["studynotes", "Notes"]].map(([t, label]) => (
              <button key={t} className={SHELF_KIND[t] === kind ? "on" : ""} aria-pressed={SHELF_KIND[t] === kind} onClick={() => setTab(t)}>{label}</button>
            ))}
          </div>
          <span className="sh-streak"><Svg size={13} d={<path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" />} /><b>{streak}</b> day streak</span>
        </div>
      </div>

      <section className="sh-card">
        <div className="sh-progress">
          <span className="eyebrow">YOUR PROGRESS IN {K.title.toUpperCase()}</span>
          <div className="sh-big"><b>{total ? pct(progress / total) : 0}%</b>
            <span>{kind === "sermon" ? `${hm(progress)} of ${hm(total)} listened` : `${done} of ${items.length} ${K.noun} ${K.done}`}</span></div>
          <div className="sh-bar thick"><i style={{ width: `${total ? pct(progress / total) : 0}%` }} /></div>
        </div>
        <div className="sh-side">
          <div className="sh-stats">
            {[done, going.length, count("new")].map((n, i) => <div key={i}><b>{n}</b><small>{K.stats[i]}</small></div>)}
          </div>
          {resume && (
            <Link className="sh-resume" href={resume.href}>
              <Svg size={15} fill d={PLAY} />
              <span><b>Resume: {resume.title}</b>
                <small>{kind === "sermon" ? (resume.status === "going" ? `${hm(resume.duration - resume.position)} left` : "Start listening")
                  : resume.pages ? `Page ${resume.last} of ${resume.pages}` : "Start reading"}</small></span>
            </Link>
          )}
        </div>
      </section>

      {kind === "pdf" && groups.length > 0 && (
        <div className="sh-chips" role="group" aria-label="Discipleship stages">
          <span className="sh-chips-label">Discipleship stage</span>
          <button className={"chip" + (!focus ? " on" : "")} onClick={() => setFocus("")}>All {groups.length}</button>
          {groups.map((g) => <button key={g.name} className={"chip" + (focus === g.name ? " on" : "")} onClick={() => setFocus(g.name)}>{g.short}</button>)}
        </div>
      )}
      {canArrange && (
        <div className="sh-arrange">
          <button className={"chip sm" + (arrange ? " on" : "")} aria-pressed={arrange} onClick={() => setArrange(!arrange)}>{arrange ? "Done sorting" : "Sort into sections"}</button>
          {arrange && <span className="muted sm">New uploads are sorted for you. Fix the stage or type under any of your {K.noun}. Shared ones are sorted by their owner.</span>}
        </div>
      )}

      {kind === "book" && !focus && going.length > 0 && (
        <section className="sh-continue">
          <div className="sh-head plain"><h2>Continue reading</h2><small className="muted">Pick up where you left off</small></div>
          <div className="sh-cont-row">
            {going.slice(0, 3).map((it) => (
              <Link key={it.id} href={it.href} className="sh-cont" style={{ "--c": colorOf(it.section) }}>
                <span className="sh-cont-cover" />
                <span><b>{it.title}</b><span className="sh-bar"><i style={{ width: `${pct(it.frac)}%`, background: "var(--c)" }} /></span>
                  <small>{pct(it.frac)}% read, Page {it.last} of {it.pages}</small></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {items.length === 0 ? (
        <div className="empty-library">
          <b>No {K.noun} yet</b>
          <span className="muted">{kind === "sermon" ? "Finished sermons from Transcribe appear here, and sermon PDFs you add with the + button."
            : kind === "notes" ? "Add study notes or outlines with the + button."
            : `Add a PDF with the + button. ${kind === "book" ? `Anything over 40 pages shows up here as a book.` : "Up to 40 pages counts as a PDF."}`} The library works out the type and stage for you.</span>
        </div>
      ) : (
        open.map((g) => <section key={g.name} className="sh-section">{head(g, !!focus)}{body(g)}</section>)
      )}

      {rows.length > 0 && (
        <section className="sh-section">
          <div className="sh-head plain"><h2>More sections</h2><small className="muted">Tap a section to open its PDFs</small></div>
          <div className="sh-rows">
            {rows.map((g) => {
              const f = g.items.filter((i) => i.status === "done").length / g.items.length;
              return (
                <button key={g.name} className="sh-more" style={{ "--c": g.color }} onClick={() => setFocus(g.name)}>
                  <i className="sh-dot" /><b>{g.name}</b><small>{g.items.length} PDFs</small>
                  <span className="sh-mini wide"><i style={{ width: `${pct(f)}%` }} /></span><b className="sh-pct">{pct(f)}%</b><Svg size={15} d={NEXT} />
                </button>
              );
            })}
          </div>
        </section>
      )}
      {!focus && items.length > 0 && empty > 0 && (
        <p className="sh-note">{empty} {empty === 1 ? "section has" : "sections have"} no {K.noun} yet. They will appear here as soon as {K.noun} are added.</p>
      )}

      {kind === "sermon" && resume && <MiniPlayer key={resume.id} item={resume} onPosition={onSermonPosition} />}
      {(
        <label className="upload" aria-label={focus ? `Add a PDF to ${focus}` : "Add PDF"} title={focus ? `Add a PDF to ${focus}` : "Add PDF"}>
          {busy ? "…" : <Svg size={26} d={<path d="M12 5v14M5 12h14" />} />}
          <input type="file" accept="application/pdf" hidden disabled={busy} onChange={(e) => onUpload(e, focus && known.has(focus) ? focus : "")} />
        </label>
      )}
    </div>
  );
}
