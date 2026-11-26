"use client";
// Deep Word Finder: one search over sermons, books and your notes. Each result opens at the exact page or second.
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api";

const KINDS = [["all", "Everything"], ["sermon", "Sermons"], ["book", "Books"], ["note", "My notes"]];
const LABEL = { sermon: "Sermon", book: "Book", note: "Note" };
const EXAMPLES = ["“faith moves mountains”", "John 3:16", "sermons about forgiveness", "tafuta mahubiri kuhusu imani"];

export const clock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
const cleanTitle = (t) => (t || "Untitled").replace(/\.pdf$/i, "");

/** Where a result opens: sermons and sermon notes at the second, books and book notes at the page. */
export function resultHref(r) {
  if (r.start != null) return `/sermon/?id=${r.id}&t=${Math.floor(r.start)}`;
  return `/reader/?id=${r.id}&page=${r.page || 1}`;
}

export default function DeepSearch() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [stage, setStage] = useState(""); // Discipleship Stage = library section
  const [stages, setStages] = useState([]);
  useEffect(() => { api("/api/sections").then(setStages).catch(() => {}); }, []);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run(text = q, k = kind, st = stage) {
    if (!text.trim()) return;
    setBusy(true);
    setErr("");
    try {
      setRes(await api(`/api/search?q=${encodeURIComponent(text)}&kind=${k}&section=${encodeURIComponent(st)}`));
    } catch (e) {
      setErr(e.message);
      setRes(null);
    }
    setBusy(false);
  }
  const pickKind = (k) => { setKind(k); if (res) run(q, k); };
  const looking = res && [...res.parsed.phrases.map((p) => `“${p}”`), ...res.parsed.refs, ...res.parsed.terms].join(", ");

  return (
    <div className="deep-search">
      <div className="greet">Find any word ever said or written</div>
      <h1 className="title">Search</h1>
      <form className="searchbox" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); run(); }} role="search">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sermons, books and notes"
          placeholder="Find me the sermon where the words “faith moves mountains” were said" />
        <button className="btn" style={{ height: 38 }} disabled={busy || !q.trim()}>{busy ? "Searching…" : "Search"}</button>
      </form>
      <div className="row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }} role="group" aria-label="Search in">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" className={"chip sm" + (kind === k ? " on" : "")} aria-pressed={kind === k} onClick={() => pickKind(k)}>{label}</button>
        ))}
        {stages.length > 0 && (
          <select className={"chip sm" + (stage ? " on" : "")} value={stage} aria-label="Discipleship stage"
            onChange={(e) => { setStage(e.target.value); if (res) run(q, kind, e.target.value); }}>
            <option value="">Every stage</option>
            {stages.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        )}
      </div>
      {err && <div className="err" role="alert">{err}</div>}

      {!res && !err && (
        <div className="muted" style={{ marginTop: 20, fontSize: 14 }}>
          Put exact words in quotes. Bible verses work in English or Kiswahili. Try:{" "}
          {EXAMPLES.map((ex, i) => (
            <span key={ex}>{i > 0 && " · "}<button type="button" className="linkish" onClick={() => { setQ(ex); run(ex); }}>{ex}</button></span>
          ))}
        </div>
      )}

      {res && (
        <div aria-live="polite" style={{ marginTop: 18 }}>
          <div className="muted sm">
            {res.results.length ? `${res.results.length} ${res.results.length === 1 ? "match" : "matches"}` : "Nothing found"}
            {looking && ` for ${looking}`}{res.kind !== "all" && ` in ${KINDS.find(([k]) => k === res.kind)[1].toLowerCase()}`}
          </div>
          {!res.results.length && (
            <p className="muted" style={{ fontSize: 14 }}>Try fewer words, check the spelling, or search “Everything”.</p>
          )}
          {res.results.map((r, i) => (
            <Link key={i} className="nrow hit" href={resultHref(r)}>
              <div className="muted sm">
                <b className="hit-kind">{LABEL[r.kind]}</b> · {cleanTitle(r.title)} · {r.start != null ? `▶ ${clock(r.start)}` : `Page ${r.page}`}
              </div>
              <div className="hit-text">{r.snippet.map((p, j) => (p.hit ? <mark key={j}>{p.t}</mark> : <span key={j}>{p.t}</span>))}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
