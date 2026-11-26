"use client";
// Read-only sermon player for search results: opens at ?t=<seconds> and follows the transcript.
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../lib/api";
import { clock } from "../../components/DeepSearch";
import { ScriptureText, SelectionToolbar, StudyPanel, useVersePopover } from "../../components/Study";
import { addDiaryNote } from "../../lib/diary";

function Sermon() {
  const sp = useSearchParams();
  const id = sp.get("id");
  const t = Number(sp.get("t")) || 0;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioNote, setAudioNote] = useState("");
  const [now, setNow] = useState(t);
  const audioRef = useRef(null);
  const started = useRef(false);
  const textRef = useRef(null);
  const asked = useRef(false);
  const verses = useVersePopover();
  const [study, setStudy] = useState(null); // null | "summary" | "reflect" | "verses"
  const [reflectAsk, setReflectAsk] = useState(false);
  function nearEnd(seconds) {
    if (asked.current || !data?.duration || seconds < data.duration - 20) return;
    asked.current = true;
    setReflectAsk(true);
  }
  const saved = useRef(t);
  // your place is saved every few seconds, so the library's Sermons page can resume it
  function savePlace(seconds) {
    saved.current = seconds;
    api(`/api/sermons/${id}/position`, { method: "PUT", body: { position: seconds } }).catch(() => {});
  }
  useEffect(() => { try { localStorage.setItem("last-sermon", id); } catch {} }, [id]);

  useEffect(() => {
    let url = null, gone = false;
    (async () => {
      try {
        const s = await api(`/api/transcriptions/${id}/listen`);
        if (gone) return;
        setData(s);
        if (!s.has_audio) return setAudioNote("The recording is no longer stored. You can still read what was said.");
        setAudioNote("Loading the recording…");
        // ponytail: whole file as a blob (same as the editor) because <audio> can't send the login token;
        // stream with a short-lived signed URL if long sermons load too slowly
        const blob = await (await api(`/api/transcriptions/${id}/listen/audio`, { raw: true })).blob();
        if (gone) return;
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setAudioNote("");
      } catch (e) {
        if (!gone) setError(e.status === 401 ? "Please sign in to listen." : e.message);
      }
    })();
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [id]);

  // the paragraph being heard; scroll the matched one into view once
  const paras = data?.paragraphs || [];
  let cur = 0;
  paras.forEach((p, i) => { if (p.start <= now + 0.25) cur = i; });
  useEffect(() => {
    if (!paras.length) return;
    document.getElementById(`p${cur}`)?.scrollIntoView({ block: "center", behavior: started.current ? "smooth" : "auto" });
  }, [cur, paras.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function seek(s) {
    const a = audioRef.current;
    setNow(s);
    if (a) { a.currentTime = s; a.play().catch(() => {}); }
  }

  if (error) return <main className="wrap" style={{ paddingTop: 40 }}><p className="err">{error}</p><Link className="btn ghost" href="/">Back to the library</Link></main>;
  if (!data) return <main className="wrap" style={{ paddingTop: 40 }}><p className="muted">Opening the sermon…</p></main>;

  return (
    <main className="wrap sermon-view">
      <div className="row between" style={{ paddingTop: 20 }}>
        <Link className="chip sm" href="/" style={{ display: "inline-flex", alignItems: "center" }}>← Back</Link>
        {data.mine && <a className="chip sm" href={`/transcribe/editor/?id=${data.id}`} style={{ display: "inline-flex", alignItems: "center" }}>Edit in Transcribe</a>}
      </div>
      <div className="greet" style={{ marginTop: 16 }}>Sermon · {clock(data.duration)}</div>
      <h1 className="title">{data.title}</h1>

      <div className="sermon-player">
        {audioUrl ? (
          <audio ref={audioRef} src={audioUrl} controls preload="metadata" style={{ width: "100%" }}
            onLoadedMetadata={(e) => { if (!started.current) { started.current = true; e.currentTarget.currentTime = t; e.currentTarget.play().catch(() => {}); } }}
            onPause={(e) => savePlace(e.currentTarget.currentTime)}
            onEnded={(e) => nearEnd(e.currentTarget.duration)}
            onTimeUpdate={(e) => { const s = e.currentTarget.currentTime; setNow(s); nearEnd(s); if (Math.abs(s - saved.current) >= 5) savePlace(s); }} />
        ) : <p className="muted sm">{audioNote}</p>}
      </div>

      {reflectAsk && !study && (
        <div className="reflect-toast inline" role="status">
          <span><b>The sermon is ending.</b> Take two minutes to reflect on it?</span>
          <div className="row" style={{ gap: 6 }}>
            <button className="chip sm on" onClick={() => { setStudy("reflect"); setReflectAsk(false); }}>Reflect</button>
            <button className="chip sm" onClick={() => setReflectAsk(false)}>Not now</button>
          </div>
        </div>
      )}
      {study ? (
        <StudyPanel docked={false} title={data.title} tab={study} verses={verses} onClose={() => setStudy(null)}
          target={{ key: `sermon:${data.id}`, label: "this sermon", request: async () => ({ transcription_id: data.id }) }} />
      ) : (
        <button className="btn ghost study-open" onClick={() => setStudy("summary")}>Study this sermon: summary, prayer points, reflection</button>
      )}

      <div className="sermon-text" ref={textRef}>
        {paras.map((p, i) => (
          <p key={i} id={`p${i}`} className={"spara" + (i === cur ? " on" : "")}>
            <button className="chip sm" onClick={() => seek(p.start)} disabled={!audioUrl} aria-label={`Play from ${clock(p.start)}`}>{clock(p.start)}</button>
            <span><ScriptureText text={p.text} verses={verses} /></span>
          </p>
        ))}
      </div>
      <SelectionToolbar containerRef={textRef} source={data.title}
        onSave={(text) => addDiaryNote({ title: data.title, body: `“${text}”` })}
        around={(text) => (paras.find((p) => p.text.includes(text.slice(0, 40)))?.text || "")} />
      {verses.popover}
    </main>
  );
}

export default function SermonPage() {
  return (
    <Suspense fallback={null}>
      <Sermon />
    </Suspense>
  );
}
