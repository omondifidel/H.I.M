"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, getToken, getUser, setSession, setToken } from "../lib/api";
import { idbAll, idbDel, idbDelPrefix, idbGet, idbKeys, idbPut } from "../lib/db";
import { clearLocalNotes, removeNote, syncNotes } from "../lib/notes";
import { applyTheme, getTheme, THEMES } from "../lib/theme";
import NotificationBell from "../components/NotificationBell";
import DeepSearch from "../components/DeepSearch";
import Shelves from "../components/Shelves";
import { extractParagraphs, loadPdfjs } from "../lib/pdfText";

const Icon = ({ d, size = 24, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const HimMark = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 8.5v11M12 8.5c-2.2-2-5-2.2-8-1.1v10c3-.9 5.8-.6 8 1.1M12 8.5c2.2-2 5-2.2 8-1.1v10c-3-.9-5.8-.6-8 1.1M10 4h4m-2-2v5" />
  </svg>
);
const P = {
  book: <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13" />,
  pencil: <path d="M4 20l4-1 11-11-3-3L5 16z" />,
  download: <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4" />,
  play: <path d="M7 4l13 8-13 8z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  spark: <path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.6 6.6C3.7 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 004.1-.9" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  mic: <path d="M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3" />,
};
const NAV = {
  home: <><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /></>,
  pdfs: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  books: <><path d="M4.5 4h5v16h-5zM11.5 4h4v16h-4zM17 5.5l3-.8 2.7 15-3 .8z" /></>,
  sermons: <><path d="M4 15v-3a8 8 0 0116 0v3" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></>,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  library: <><path d="M5 5.5A2.5 2.5 0 017.5 3H11v18H7.5A2.5 2.5 0 015 18.5z" /><path d="M13 3h3.5A2.5 2.5 0 0119 5.5v13a2.5 2.5 0 01-2.5 2.5H13z" /><path d="M8 7h.5M16 7h.5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  notes: <><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4M9 12h6M9 16h6" /></>,
  offline: <><path d="M12 3.5v10M8.5 10l3.5 3.5 3.5-3.5M5 16v3h14v-3" /></>,
  settings: <><path d="M4 7h5m4 0h7M4 17h2m4 0h10M9 4v6m-2 4v6" /></>,
};
const JOURNEY_ICONS = {
  books: <><path d="M4.5 6h6v14h-6zM13.5 4h6v16h-6z" /><path d="M6.5 9h2M15.5 7h2M12 6v14" /></>,
  pages: <><path d="M6 4h8l4 4v12H6z" /><path d="M14 4v4h4M9 12h6M9 16h4" /></>,
  complete: <><circle cx="12" cy="12" r="9" /><path d="m7.5 12 3 3 6-6" /></>,
  minutes: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2M9 2.5h6" /></>,
};

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const coverJobs = new Map();
const coverListeners = new Map();
let activeCoverWorkers = 0;
const coverQueue = [];

function runNextCover() {
  while (activeCoverWorkers < 2 && coverQueue.length > 0) {
    const task = coverQueue.shift();
    activeCoverWorkers++;
    task().finally(() => {
      activeCoverWorkers--;
      runNextCover();
    });
  }
}

function enqueueCoverWork(fn) {
  return new Promise((resolve, reject) => {
    coverQueue.push(() => fn().then(resolve, reject));
    runNextCover();
  });
}

function notifyCoverReady(id, blob) {
  const subs = coverListeners.get(id);
  if (subs) subs.forEach((fn) => fn(blob));
}

function ensureCoverBlob(id, sourceUrl, onPageCount) {
  if (coverJobs.has(id)) return coverJobs.get(id);
  const job = (async () => {
    let blob = await idbGet("covers", id);
    const hasPages = Boolean(Number(localStorage.getItem("pages:" + id)));
    if (blob && hasPages) return blob;

    return enqueueCoverWork(async () => {
      let cachedBlob = await idbGet("covers", id);
      let pdfBlob = await idbGet("pdfs", id);
      if (!pdfBlob && (!cachedBlob || !Number(localStorage.getItem("pages:" + id)))) {
        if (sourceUrl) {
          const response = await fetch(sourceUrl);
          if (!response.ok) throw new Error("Could not load sample PDF.");
          pdfBlob = await response.blob();
        } else {
          const response = await api(`/api/documents/${id}/file`, { raw: true });
          pdfBlob = await response.blob();
        }
      }
      if (pdfBlob) {
        const pdfjs = await loadPdfjs();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await pdfBlob.arrayBuffer()) }).promise;
        try {
          if (Number(localStorage.getItem("pages:" + id)) !== pdf.numPages) {
            localStorage.setItem("pages:" + id, String(pdf.numPages));
            onPageCount?.();
          }
          if (!cachedBlob) {
            const page = await pdf.getPage(1);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: 260 / base.width });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
            cachedBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
            if (cachedBlob) {
              await idbPut("covers", id, cachedBlob);
              notifyCoverReady(id, cachedBlob);
            }
          }
        } finally {
          await pdf.destroy();
        }
      }
      return cachedBlob;
    });
  })().finally(() => {
    coverJobs.delete(id);
  });
  coverJobs.set(id, job);
  return job;
}

function Cover({ id, title, children, onPageCount, sourceUrl }) {
  const h = hash(id);
  const ref = useRef(null);
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    let observer;

    function applyBlob(blob) {
      if (!active || !blob) return;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    }

    if (!coverListeners.has(id)) coverListeners.set(id, new Set());
    coverListeners.get(id).add(applyBlob);

    async function createCover() {
      try {
        const blob = await ensureCoverBlob(id, sourceUrl, onPageCount);
        applyBlob(blob);
      } catch {}
    }

    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      createCover();
    } else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          createCover();
        }
      }, { rootMargin: "160px" });
      observer.observe(node);
    }
    return () => {
      active = false;
      observer?.disconnect();
      coverListeners.get(id)?.delete(applyBlob);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, onPageCount, sourceUrl]);

  return (
    <span ref={ref} className="cover-art">
      <span className={`cover-generated c${h % 4}`} aria-hidden="true">
      <span className="cover-symbol"><Icon size={28} d={P.book} /></span>
        <span className="cover-generated-title">{cleanTitle(title || "Your book")}</span>
        <span className="cover-generated-rule" />
      </span>
      {src && <img className="cover-preview" src={src} alt="" />}
      {children}
    </span>
  );
}
const coverClass = (id) => "cv c" + (hash(id) % 4);
const cleanTitle = (t) => t.replace(/\.pdf$/i, "");
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
const dayKey = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const DEMO_WEEK = [
  { label: "Mon", count: 2 },
  { label: "Tue", count: 4 },
  { label: "Wed", count: 3 },
  { label: "Thu", count: 6 },
  { label: "Fri", count: 2 },
  { label: "Sat", count: 7 },
  { label: "Sun", count: 3 },
];
const SAMPLE_BOOKS = [
  {
    id: "sample-garden-notes",
    title: "Garden Notes",
    description: "A short sample PDF with a page-one cover preview.",
    file: "/samples/Sample-1-Garden-Notes.pdf",
  },
  {
    id: "sample-money-basics",
    title: "Money Basics",
    description: "A second sample PDF, ready to open in your browser.",
    file: "/samples/Sample-2-Money-Basics.pdf",
  },
];
const NOTE_LAYOUTS = [
  { id: "clipped", name: "Bookmarks", description: "Silk ribbons with notched tails" },
  { id: "hanging", name: "Hanging", description: "Notes suspended on strings" },
  { id: "journal", name: "Journal", description: "A tidy reading list" },
];
const DEMO_NOTES = [
  { id: "sample-1", title: "The Art of Beginning", page: 12, body: "A first step does not need to be perfect. It only needs to point you toward the person you hope to become.", tone: "peach" },
  { id: "sample-2", title: "A Garden of Patience", page: 38, body: "Growth is often quiet. The roots are doing their work long before the flowers arrive.", tone: "blue" },
  { id: "sample-3", title: "Notes on Courage", page: 7, body: "Courage can be as small as showing up again, with an open heart and a little more hope.", tone: "green" },
  { id: "sample-4", title: "The Listening Life", page: 24, body: "Make room for the pause. Sometimes the most important thought comes after the words end.", tone: "lavender" },
  { id: "sample-5", title: "The Quiet Morning", page: 19, body: "Begin with what is in front of you. A cup of tea, an open page, one unhurried breath.", tone: "peach" },
  { id: "sample-6", title: "Seeds of Wisdom", page: 51, body: "Good questions are seeds. Give them time, attention, and the space to take root.", tone: "blue" },
  { id: "sample-7", title: "A Place to Rest", page: 33, body: "Rest is not the opposite of progress. It is the ground that lets progress grow.", tone: "green" },
  { id: "sample-8", title: "The Open Door", page: 8, body: "Welcome can be simple: a chair pulled closer, a name remembered, a little time given freely.", tone: "lavender" },
  { id: "sample-9", title: "On Being Present", page: 42, body: "Attention is a generous gift. Give it to the person beside you and to the moment you are in.", tone: "peach" },
  { id: "sample-10", title: "Small Acts of Hope", page: 16, body: "Hope often arrives dressed as an ordinary kindness, repeated one more time than expected.", tone: "blue" },
  { id: "sample-11", title: "The Patient Craft", page: 27, body: "A life is made in the returning: to the work, to the people, and to what matters most.", tone: "green" },
  { id: "sample-12", title: "A Better Question", page: 63, body: "Instead of asking how far remains, ask what this next step can teach you.", tone: "lavender" },
  { id: "sample-13", title: "Light Through Leaves", page: 11, body: "Even filtered light is still light. Let the good that reaches you be enough for today.", tone: "peach" },
  { id: "sample-14", title: "The Practice of Care", page: 36, body: "Care is less a grand promise than a hundred little choices to notice and respond.", tone: "blue" },
  { id: "sample-15", title: "Words Worth Carrying", page: 74, body: "Keep the words that make you kinder. Let the rest pass through like weather.", tone: "green" },
  { id: "sample-16", title: "Room to Grow", page: 29, body: "You can be grateful for how far you have come and still make room for who you are becoming.", tone: "lavender" },
];
const DEMO_QUOTE = {
  text: "Every page is a small door. Each day you return, the world on the other side grows a little wider.",
  title: "A sample reflection",
  page: "—",
};

const WAVE = [30, 56, 78, 44, 64, 90, 52, 36, 70, 48, 84, 40, 60, 28, 74, 46, 58, 34];
const MINI = [12, 24, 32, 18, 28, 14, 22, 10];

function strength(pw) {
  if (!pw) return { score: 0, label: "" };
  if (pw.length < 8) return { score: 1, label: "Too short" };
  let s = 1;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  s = Math.min(4, s);
  return { score: s, label: ["", "Weak", "Okay", "Good", "Strong"][s] };
}

function AuthForm({ onDone }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [show, setShow] = useState(false);
  const [errs, setErrs] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [theme, setTheme] = useState("light");
  const reg = mode === "register";
  const st = strength(password);

  useEffect(() => { setTheme(getTheme()); }, []);

  function chooseTheme(value) {
    setTheme(value);
    applyTheme(value);
  }

  function wiggle() {
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }
  function switchMode(m) {
    setMode(m);
    setErrs({});
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    const v = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) v.email = "Enter a valid email address.";
    if (!password) v.password = "Enter your password.";
    else if (reg && password.length < 8) v.password = "Use at least 8 characters.";
    if (reg && !invite.trim()) v.invite = "Enter your invite code.";
    setErrs(v);
    if (Object.keys(v).length) { wiggle(); return; }
    setBusy(true);
    try {
      const res = await api(`/api/auth/${mode}`, { method: "POST", body: { email, password, invite_code: invite } });
      setSession(res);
      onDone(res.home);
    } catch (err) {
      if (err.status === 403) setErrs({ invite: err.message });
      else if (err.status === 409) setErrs({ email: err.message });
      else setError(err.message);
      wiggle();
    }
    setBusy(false);
  }

  return (
    <div className="authx">
      <section className="brand">
        <div className="row between">
          <div className="logo"><i><HimMark size={20} /></i>HIM Ministries</div>
          <div className="row">
            {reg && <span className="badge only-m">Invite only</span>}
            <select className="auth-theme" value={theme} onChange={(e) => chooseTheme(e.target.value)} aria-label="Appearance theme">
              {THEMES.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
        </div>

        {reg ? (
          <div className="strip only-m" aria-hidden="true">
            <i className="c1" /><i className="c2" /><i className="c3" />
            <span className="pbig"><Icon size={30} fill d={P.play} /></span>
          </div>
        ) : (
          <div className="art" aria-hidden="true">
            <div className="pc a book-thumb">
              <span className="bk-spine" />
              <div className="bk-inner">
                <span className="bk-tag">STUDY</span>
                <div className="bk-crest">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 6v12M8 10h8"/><rect x="4" y="3" width="16" height="18" rx="3"/></svg>
                </div>
                <div className="bk-title">Faith &amp; Grace</div>
                <div className="bk-lines"><i /><i style={{ width: "68%" }} /></div>
                <span className="bk-foot">142 pages</span>
              </div>
            </div>
            <div className="pc b book-thumb">
              <span className="bk-spine" />
              <div className="bk-inner">
                <span className="bk-tag">DEVOTIONAL</span>
                <div className="bk-crest">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                </div>
                <div className="bk-title">Walking in Light</div>
                <div className="bk-lines"><i /><i style={{ width: "74%" }} /></div>
                <span className="bk-foot">98 pages</span>
              </div>
            </div>
            <div className="pc f">
              <div className="ln t" />
              <div className="ln" style={{ width: "90%" }} />
              <div className="ln" style={{ width: "60%", background: "var(--accent)" }} />
              <div className="ln" style={{ width: "80%" }} />
              <div className="mini">
                {MINI.map((h, i) => <i key={i} style={{ height: h, animationDelay: `${-i * 0.15}s`, opacity: i < 4 ? 1 : 0.45 }} />)}
              </div>
              <div className="pb"><Icon size={22} fill d={P.play} /></div>
            </div>
          </div>
        )}

        <div>
          <h1 className="ah only-m">{reg ? "Join with your invite code" : "Your PDFs, read to you."}</h1>
          <h1 className="ah only-d">Listen to everything you read.</h1>
          <p className="as only-m" style={{ marginTop: 12 }}>
            {reg ? "Create your account and start listening in under a minute." : "Sign in to pick up right where you stopped listening."}
          </p>
          <p className="as only-d" style={{ marginTop: 16 }}>Upload a PDF, press play, and let it read to you while you write notes beside it.</p>
        </div>

        <div className="feats">
          <div className="ft"><span className="ic"><Icon size={22} d={P.mic} /></span><div><b>Natural voices, your speed</b><div className="muted sm">Change voice and pace any time.</div></div></div>
          <div className="ft"><span className="ic"><Icon size={22} d={P.pencil} /></span><div><b>Notes that work offline</b><div className="muted sm">Pinned to the paragraph you are on.</div></div></div>
          <div className="ft"><span className="ic"><Icon size={22} d={P.download} /></span><div><b>Pick up where you stopped</b><div className="muted sm">On your phone, tablet or computer.</div></div></div>
        </div>

        <div className="bars" aria-hidden="true">
          {WAVE.map((h, i) => <i key={i} className={i < 7 ? "on" : ""} style={{ height: h, animationDelay: `${-(i % 9) * 0.17}s` }} />)}
        </div>
      </section>

      <section className="formside">
        <form className={"formbox" + (shake ? " shake" : "")} onSubmit={submit} noValidate>
          <h2 className="fh only-d">{reg ? "Create your account" : "Welcome back"}</h2>
          <p className="muted only-d" style={{ margin: "-6px 0 6px" }}>{reg ? "Use the invite code you were given." : "Sign in to your library."}</p>
          <div className="seg only-d" role="group" aria-label="Sign in or create account">
            <button type="button" className={!reg ? "on" : ""} aria-pressed={!reg} onClick={() => switchMode("login")}>Sign in</button>
            <button type="button" className={reg ? "on" : ""} aria-pressed={reg} onClick={() => switchMode("register")}>Create account</button>
          </div>

          <div>
            <label className={"fld" + (errs.email ? " bad" : "")}>
              <Icon size={20} d={P.mail} />
              <input type="email" autoComplete="email" placeholder="Email" aria-label="Email" aria-invalid={!!errs.email} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {errs.email && <div className="ferr" role="alert">{errs.email}</div>}
          </div>

          <div>
            <label className={"fld" + (errs.password ? " bad" : "")}>
              <Icon size={20} d={P.lock} />
              <input type={show ? "text" : "password"} autoComplete={reg ? "new-password" : "current-password"} placeholder={reg ? "Password (8+ characters)" : "Password"} aria-label="Password" aria-invalid={!!errs.password} value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="eye" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} onClick={() => setShow(!show)}>
                <Icon size={20} d={show ? P.eyeOff : P.eye} />
              </button>
            </label>
            {errs.password && <div className="ferr" role="alert">{errs.password}</div>}
            <div className={"col" + (reg && password ? " open" : "")}>
              <div>
                <div className="meter" aria-live="polite">
                  {[1, 2, 3, 4].map((n) => <i key={n} className={n <= st.score ? "on s" + st.score : ""} />)}
                  <span className={"s" + st.score}>{st.label}</span>
                </div>
              </div>
            </div>
          </div>

          <div className={"col" + (reg ? " open" : "")}>
            <div>
              <label className={"fld" + (errs.invite ? " bad" : "")}>
                <Icon size={20} d={P.key} />
                <input type="text" autoComplete="off" placeholder="Invite code" aria-label="Invite code" aria-invalid={!!errs.invite} tabIndex={reg ? 0 : -1} value={invite} onChange={(e) => setInvite(e.target.value)} />
              </label>
              {errs.invite && <div className="ferr" role="alert">{errs.invite}</div>}
            </div>
          </div>

          <button className="cta" disabled={busy}>
            {busy ? <><span className="spin" />{reg ? "Creating account..." : "Signing in..."}</> : <>{reg ? "Create account" : "Sign in"}<Icon size={20} d={P.arrow} /></>}
          </button>
          {error && <div className="err" role="alert" style={{ margin: 0 }}>{error}</div>}

          <button type="button" className="alt only-m" onClick={() => switchMode(reg ? "login" : "register")}>
            {reg ? "Back to sign in" : "I have an invite code"}
          </button>
          <p className="muted sm only-d" style={{ margin: "6px 0 0", textAlign: "center" }}>Invite only. Ask the person who shared this app for a code.</p>

          <div className="chips3 only-m">
            <span><Icon size={16} d={P.download} />Works offline</span>
            <span><Icon size={16} d={P.pencil} />Notes that sync</span>
            <span><Icon size={16} d={P.mic} />Choose your voice</span>
          </div>
        </form>
      </section>
    </div>
  );
}

function Library({ onLogout, user }) {
  const [docs, setDocs] = useState([]);
  const [sections, setSections] = useState([]);
  const [sermons, setSermons] = useState([]);
  const [more, setMore] = useState(false);
  const [offline, setOffline] = useState(new Set());
  const [notes, setNotes] = useState([]);
  const [tab, setTab] = useState("library");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [noteLayout, setNoteLayout] = useState("hanging");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [theme, setTheme] = useState("light");
  const [activity, setActivity] = useState({});
  const [, setPageStatsVersion] = useState(0);
  const [dailyGoal, setDailyGoal] = useState(5);
  const [chartMode, setChartMode] = useState("pie");
  const [bookQuote, setBookQuote] = useState(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [focusSeconds, setFocusSeconds] = useState(25 * 60);
  const [focusDuration, setFocusDuration] = useState(25);
  const [focusDraft, setFocusDraft] = useState("25");
  const [focusError, setFocusError] = useState("");
  const [focusRunning, setFocusRunning] = useState(false);
  const [miniPage, setMiniPage] = useState(1);
  const [miniSpeed, setMiniSpeed] = useState("1");
  const quoteAttempted = useRef(false);

  const loadNotes = useCallback(async () => {
    try {
      const all = await idbAll("notes");
      setNotes(all.filter((n) => !n.deleted).sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    } catch {}
  }, []);

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
    for (const [path, set] of [["/api/sections", setSections], ["/api/sermons", setSermons]]) {
      try {
        const value = await api(path);
        set(value);
        localStorage.setItem("cache:" + path, JSON.stringify(value));
      } catch {
        try { set(JSON.parse(localStorage.getItem("cache:" + path) || "[]")); } catch {}
      }
    }
    try {
      setOffline(new Set(await idbKeys("pdfs")));
    } catch {}
    await loadNotes();
    if (navigator.onLine) syncNotes().then(loadNotes);
    setLibraryLoaded(true);
  }, [loadNotes]);

  useEffect(() => {
    setTheme(getTheme());
    try { setActivity(JSON.parse(localStorage.getItem("reading-activity") || "{}")); } catch {}
    setDailyGoal(Number(localStorage.getItem("reading-goal")) || 5);
    const savedChart = localStorage.getItem("reading-chart");
    if (savedChart === "bar" || savedChart === "pie") setChartMode(savedChart);
    const savedNoteLayout = localStorage.getItem("notes-layout");
    if (NOTE_LAYOUTS.some(({ id }) => id === savedNoteLayout)) setNoteLayout(savedNoteLayout);
    const savedFocusDuration = Number(localStorage.getItem("focus-duration"));
    if (Number.isInteger(savedFocusDuration) && savedFocusDuration >= 1 && savedFocusDuration <= 180) {
      setFocusDuration(savedFocusDuration);
      setFocusDraft(String(savedFocusDuration));
      setFocusSeconds(savedFocusDuration * 60);
    }
    setMiniSpeed(localStorage.getItem("tts:rate") || "1");
    load();
  }, [load]);

  async function upload(e, section = "") {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("section", section);
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
      await idbDel("covers", d.id);
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

  async function sortInto(id, section) {
    setDocs((items) => items.map((d) => (d.id === id ? { ...d, section } : d)));
    try {
      await api(`/api/documents/${id}`, { method: "PATCH", body: { section } });
    } catch (err) {
      setMsg(err.message);
      load();
    }
  }

  const sermonPosition = useCallback((id, position) => {
    setSermons((items) => items.map((s) => (s.id === id ? { ...s, position } : s)));
  }, []);

  function chooseTheme(t) {
    setTheme(t);
    applyTheme(t);
  }

  function chooseChartMode(mode) {
    if (mode !== "bar" && mode !== "pie") return;
    setChartMode(mode);
    localStorage.setItem("reading-chart", mode);
  }

  function chooseNoteLayout(layout) {
    if (!NOTE_LAYOUTS.some(({ id }) => id === layout)) return;
    setNoteLayout(layout);
    localStorage.setItem("notes-layout", layout);
  }

  const pickBookQuote = useCallback(async () => {
    if (!docs.length) return;
    setQuoteBusy(true);
    setQuoteError("");
    try {
      const docById = new Map(docs.map((doc) => [String(doc.id), doc]));
      let keys = [];
      try {
        keys = (await idbKeys("paras")).filter((key) => {
          const value = String(key);
          const separator = value.lastIndexOf(":");
          return separator > 0 && docById.has(value.slice(0, separator));
        });
      } catch {}
      for (let attempt = 0; attempt < Math.min(20, keys.length); attempt++) {
        const key = keys.splice(Math.floor(Math.random() * keys.length), 1)[0];
        let paragraphs;
        try { paragraphs = await idbGet("paras", key); } catch { continue; }
        const options = Array.isArray(paragraphs) ? paragraphs.filter((text) => typeof text === "string" && text.trim().length >= 45) : [];
        if (options.length) {
          const [documentId, page] = String(key).split(":");
          const doc = docById.get(documentId);
          const text = options[Math.floor(Math.random() * options.length)].replace(/\s+/g, " ").trim();
          setBookQuote({ text, title: cleanTitle(doc?.title || "Your book"), page });
          return;
        }
      }

      const books = [...docs].sort(() => Math.random() - 0.5);
      for (const doc of books.slice(0, 3)) {
        let blob = await idbGet("pdfs", doc.id);
        if (!blob) {
          const response = await api(`/api/documents/${doc.id}/file`, { raw: true });
          blob = await response.blob();
        }
        const pdfjs = await loadPdfjs();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        try {
          const pageCount = Math.min(pdf.numPages, 5);
          for (let page = 1; page <= pageCount; page++) {
            const paragraphs = await extractParagraphs(pdf, page);
            const options = paragraphs.filter((text) => text.trim().length >= 45);
            if (options.length) {
              await idbPut("paras", `${doc.id}:${page}`, paragraphs);
              const text = options[Math.floor(Math.random() * options.length)].replace(/\s+/g, " ").trim();
              setBookQuote({ text, title: cleanTitle(doc.title), page });
              return;
            }
          }
        } finally {
          await pdf.destroy();
        }
      }
      setQuoteError("No readable passages found yet. Try a text-based PDF.");
    } catch (error) {
      setQuoteError(error.message || "Could not find a passage in your books.");
    } finally {
      setQuoteBusy(false);
    }
  }, [docs]);

  useEffect(() => {
    if (tab === "library" && docs.length && !quoteAttempted.current) {
      quoteAttempted.current = true;
      pickBookQuote();
    }
  }, [tab, docs.length, pickBookQuote]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const demoMode = libraryLoaded && docs.length === 0;
  const displayedQuote = bookQuote || (demoMode ? DEMO_QUOTE : null);
  const lastId = typeof window !== "undefined" ? localStorage.getItem("last") : null;
  const last = docs.find((d) => d.id === lastId);
  const lastPages = last ? Number(localStorage.getItem("pages:" + last.id)) || 0 : 0;
  const started = (d) => d.last_page > 1 || d.last_paragraph > 0;
  const todayPages = (activity[dayKey()] || []).length;
  let streak = 0;
  let streakOffset = todayPages ? 0 : -1;
  while (activity[dayKey(streakOffset)]) {
    streak++;
    streakOffset--;
  }

  let shown = docs.filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase()));
  if (tab === "offline") shown = shown.filter((d) => offline.has(d.id));
  if (filter === "progress") shown = shown.filter(started);
  if (filter === "unread") shown = shown.filter((d) => !started(d));
  shown = [...shown].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "size") return b.size - a.size;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
  const titleOf = (id) => (docs.find((d) => d.id === id) || {}).title || "PDF";
  const pagesFor = (id) => typeof window !== "undefined" ? Number(localStorage.getItem("pages:" + id)) || 0 : 0;
  const onPageCount = useCallback(() => setPageStatsVersion((version) => version + 1), []);
  const totalPages = docs.reduce((total, doc) => total + pagesFor(doc.id), 0);
  const pagesRead = docs.reduce((total, doc) => {
    let currentPage = doc.last_page || 0;
    if (typeof window !== "undefined") {
      try {
        currentPage = Math.max(currentPage, Number(JSON.parse(localStorage.getItem("progress:" + doc.id) || "null")?.page) || 0);
      } catch {}
    }
    return total + Math.min(pagesFor(doc.id), currentPage);
  }, 0);
  const completion = totalPages ? Math.round((pagesRead / totalPages) * 100) : 0;
  const minutesRead = typeof window !== "undefined" ? Math.floor((Number(localStorage.getItem("reading-seconds")) || 0) / 60) : 0;
  const liveWeekData = Array.from({ length: 7 }, (_, index) => {
    const offset = index - 6;
    const date = new Date(Date.now() + offset * 86400000);
    return {
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      count: (activity[dayKey(offset)] || []).length,
    };
  });
  const weekData = demoMode ? DEMO_WEEK : liveWeekData;
  const weeklyPages = weekData.reduce((total, day) => total + day.count, 0);
  const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];
  let chartAngle = 0;
  const pieSegments = weekData.map((day, index) => {
    const start = chartAngle;
    chartAngle += weeklyPages ? (day.count / weeklyPages) * 360 : 0;
    return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}deg ${chartAngle}deg`;
  });
  const pieBackground = weeklyPages ? `conic-gradient(${pieSegments.join(",")})` : "conic-gradient(var(--surface2) 0deg 360deg)";
  const journey = demoMode
    ? { books: 4, pages: 1240, completion: 46, minutes: 218 }
    : { books: docs.length, pages: pagesRead, completion, minutes: minutesRead };
  const displayedTodayPages = demoMode ? 3 : todayPages;
  const displayedStreak = demoMode ? 4 : streak;
  const focusProgress = ((focusDuration * 60 - focusSeconds) / (focusDuration * 60)) * 100;
  const focusTime = `${String(Math.floor(focusSeconds / 60)).padStart(2, "0")}:${String(focusSeconds % 60).padStart(2, "0")}`;
  const shelfTabs = [["pdfs", "PDFs", NAV.pdfs, docs.filter((d) => d.kind === "pdf").length],
    ["books", "Books", NAV.books, docs.filter((d) => d.kind === "book").length], ["sermons", "Sermons", NAV.sermons, sermons.length]];
  const toolTabs = [["search", "Search", NAV.search], ["notes", "Notes", NAV.notes], ["offline", "Offline", NAV.offline], ["settings", "Settings", NAV.settings]];
  const go = (k) => { setTab(k); setMore(false); if (k === "notes") loadNotes(); };
  const sideTab = ([k, label, d, n]) => (
    <button key={k} className={"side-tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => go(k)}>
      <Icon size={20} d={d} />{label}{n > 0 && <span className="side-count">{n}</span>}
    </button>
  );

  useEffect(() => { if (last) setMiniPage(last.last_page || 1); }, [last?.id, last?.last_page]);

  useEffect(() => {
    if (!focusRunning) return;
    const timer = setInterval(() => setFocusSeconds((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => clearInterval(timer);
  }, [focusRunning]);

  useEffect(() => {
    if (focusSeconds === 0) setFocusRunning(false);
  }, [focusSeconds]);

  async function deleteNote(note) {
    if (!confirm("Delete this note? It will be removed from your synced notes.")) return;
    try {
      await removeNote(note.id);
      await loadNotes();
      if (navigator.onLine) {
        const result = await syncNotes();
        if (!result.ok) setMsg(`Note deleted on this device, but could not sync: ${result.error}`);
        await loadNotes();
      }
    } catch (error) {
      setMsg(error.message || "Could not delete the note.");
    }
  }

  function toggleFocus() {
    if (focusRunning) {
      setFocusRunning(false);
      return;
    }
    if (focusSeconds === 0) setFocusSeconds(focusDuration * 60);
    setFocusRunning(true);
  }

  function applyFocusDuration() {
    const duration = Number(focusDraft);
    if (!Number.isInteger(duration) || duration < 1 || duration > 180) {
      setFocusError("Choose a whole number from 1 to 180 minutes.");
      return;
    }
    setFocusError("");
    setFocusDuration(duration);
    setFocusSeconds(duration * 60);
    localStorage.setItem("focus-duration", String(duration));
  }

  function resetFocus() {
    setFocusRunning(false);
    setFocusSeconds(focusDuration * 60);
  }

  async function seekLast(page) {
    if (!last) return;
    const position = { page, idx: 0 };
    setMiniPage(page);
    localStorage.setItem("progress:" + last.id, JSON.stringify(position));
    setDocs((items) => items.map((item) => item.id === last.id ? { ...item, last_page: page, last_paragraph: 0 } : item));
    api(`/api/documents/${last.id}/progress`, { method: "PUT", body: { page, paragraph: 0 } }).catch(() => {});
  }

  function chooseMiniSpeed(value) {
    setMiniSpeed(value);
    localStorage.setItem("tts:rate", value);
  }

  return (
    <div className={"library-shell" + (last ? " has-player" : "")}>
      <aside className="library-sidebar">
        <a className="brandmark" href="/" aria-label="HIM Ministries home">
          <span className="brandmark-icon"><HimMark size={21} /></span>
          <span>HIM <span>Ministries</span></span>
        </a>
        <div className="sidebar-label">YOUR SPACE</div>
        <nav className="sidebar-nav" aria-label="Your space">{sideTab(["library", "Home", NAV.home])}</nav>
        <div className="sidebar-label sub">HIM LIBRARY</div>
        <nav className="sidebar-nav" aria-label="HIM Library">{shelfTabs.map(sideTab)}</nav>
        <div className="sidebar-label sub">TOOLS</div>
        <nav className="sidebar-nav" aria-label="Tools">{toolTabs.map(sideTab)}</nav>
        <div className="sidebar-bottom">
          <div className="profile-dot">{(user?.email || "R")[0].toUpperCase()}</div>
          <div className="profile-copy"><b>{user?.email || "Reader"}</b><span>Personal library</span></div>
        </div>
      </aside>

      <main className="wrap">
        <header className="library-header">
          <a className="brandmark mobile-brand" href="/" aria-label="HIM Ministries home">
            <span className="brandmark-icon"><HimMark size={20} /></span>
            <span>HIM <span>Ministries</span></span>
          </a>
          <div className="header-tools">
            <select
              className="topbar-theme"
              value={theme}
              onChange={(e) => { setTheme(e.target.value); applyTheme(e.target.value); }}
              aria-label="Appearance theme"
            >
              {THEMES.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
            <NotificationBell />
            <div className="header-account">
              <span className="profile-dot">{(user?.email || "R")[0].toUpperCase()}</span>
              <span>{user?.email || "Reader"}</span>
            </div>
          </div>
        </header>

      {msg && <div className="err" role="alert">{msg}</div>}

      {tab === "library" || tab === "offline" ? (
        <>
          <div className="row between">
            <div>
              <div className="greet">{tab === "offline" ? "Available without internet" : greeting}</div>
              <h1 className="title library-title"><span className="page-title-icon"><Icon size={20} d={P.book} /></span>{tab === "offline" ? "Offline books" : "Your reading library"}</h1>
            </div>
            {tab === "library" && <span className="library-count">{docs.length} {docs.length === 1 ? "book" : "books"}</span>}
          </div>

          {tab === "library" && (
            <div className="library-stats" aria-label="Library overview">
              <div><span className="stat-icon"><Icon size={19} d={P.book} /></span><span><b>{docs.length}</b><small>Books saved</small></span></div>
              <div><span className="stat-icon green"><Icon size={19} d={P.play} /></span><span><b>{docs.filter(started).length}</b><small>In progress</small></span></div>
              <div><span className="stat-icon blue"><Icon size={19} d={P.download} /></span><span><b>{offline.size}</b><small>Available offline</small></span></div>
            </div>
          )}

          {tab === "library" && (
            <div className="reading-insights">
              <section className="settings-card rhythm-card">
                <div className="insight-card-heading">
                  <div className="settings-card-heading">
                    <span className="settings-card-icon"><Icon size={20} d={P.spark} /></span>
                    <div><span className="eyebrow">YOUR READING RHYTHM</span><h2>This week, in pages</h2></div>
                  </div>
                  {demoMode && <span className="sample-badge">SAMPLE</span>}
                </div>
                <div className="rhythm-summary">
                  <div className="goal-ring" style={{ "--goal-progress": `${Math.min(100, (displayedTodayPages / dailyGoal) * 100)}%` }}>
                    <div><b>{displayedTodayPages}</b><span>today</span></div>
                  </div>
                  <div className="rhythm-copy">
                    <b>{displayedTodayPages >= dailyGoal ? "Beautiful work today." : "A little reading goes a long way."}</b>
                    <span>{displayedTodayPages} of {dailyGoal} pages today</span>
                    <label className="goal-setting">Daily goal
                      <select className="goal-select" value={dailyGoal} onChange={(e) => { const value = Number(e.target.value); setDailyGoal(value); localStorage.setItem("reading-goal", String(value)); }}>
                        {[3, 5, 10, 15, 20].map((goal) => <option key={goal} value={goal}>{goal} pages</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="streak-chip"><span className="streak-spark"><Icon size={17} fill d={P.spark} /></span><b>{displayedStreak}</b><span>day streak</span></div>
                </div>
                <div className="week-summary">
                  <span className="muted sm">{weeklyPages} pages gathered this week</span>
                  <div className="chart-switch" role="group" aria-label="Reading chart type">
                    <button className={chartMode === "bar" ? "on" : ""} aria-pressed={chartMode === "bar"} onClick={() => chooseChartMode("bar")}>Bars</button>
                    <button className={chartMode === "pie" ? "on" : ""} aria-pressed={chartMode === "pie"} onClick={() => chooseChartMode("pie")}>Pie</button>
                  </div>
                </div>
                {chartMode === "bar" ? (
                  <div className="weekly-chart bar-view" role="img" aria-label="Pages read each day during the last seven days">
                    {weekData.map((day, index) => (
                      <div key={day.label + index} className="week-column" title={`${day.label}: ${day.count} pages`}>
                        <b>{day.count || ""}</b>
                        <span><i style={{ height: `${Math.max(day.count ? 9 : 3, Math.min(100, (day.count / Math.max(dailyGoal, ...weekData.map((item) => item.count), 1)) * 100))}%` }} /></span>
                        <small>{day.label}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pie-view">
                    <div className="week-pie" role="img" aria-label={`${weeklyPages} pages read across seven days`} style={{ background: pieBackground }}>
                      <span><b>{weeklyPages}</b><small>pages</small></span>
                    </div>
                    <div className="pie-legend">
                      {weekData.map((day, index) => (
                        <span key={day.label + index}><i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />{day.label}<b>{day.count}</b></span>
                      ))}
                    </div>
                  </div>
                )}
                {demoMode && <p className="sample-caption">Sample activity preview · your reading data stays untouched.</p>}
              </section>
              <section className="settings-card quote-card">
                <div className="insight-card-heading">
                  <div className="settings-card-heading">
                    <span className="settings-card-icon quote-icon"><Icon size={20} d={P.book} /></span>
                    <div><span className="eyebrow">A LINE TO KEEP</span><h2>From your bookshelf</h2></div>
                  </div>
                  {demoMode && <span className="sample-badge">SAMPLE</span>}
                </div>
                <div className="quote-art" aria-hidden="true"><span>“</span><i /><i /><i /></div>
                {displayedQuote ? (
                  <>
                    <blockquote>{displayedQuote.text}</blockquote>
                    <div className="quote-source"><span>{displayedQuote.title}</span><small>{displayedQuote.page === "—" ? "Demo passage" : `Page ${displayedQuote.page}`}</small></div>
                  </>
                ) : (
                  <p className="quote-placeholder">{quoteBusy ? "Looking through your books for a passage…" : "No passage ready yet. Tap below to try again."}</p>
                )}
                {quoteError && !demoMode && <p className="quote-error" role="status">{quoteError}</p>}
                {demoMode && <p className="sample-caption">Demo text only · add a book to see passages from your own library.</p>}
                <button className="quote-refresh" disabled={quoteBusy} onClick={() => docs.length ? pickBookQuote() : setMsg("Add a PDF to discover passages from your own library.")}>
                  <Icon size={16} d={P.spark} />{quoteBusy ? "Looking through your books…" : docs.length ? "Find another passage" : "Add a book for real passages"}
                </button>
              </section>
            </div>
          )}

          {last && (
            <div className="hero">
              <Link href={`/reader/?id=${last.id}`} className={coverClass(last.id)} aria-label={`Open ${last.title}`}>
                <Cover id={last.id} title={last.title} onPageCount={onPageCount} />
              </Link>
              <div className="info">
                <div>
                  <div className="eyebrow">PICK UP WHERE YOU LEFT OFF</div>
                  <div className="htitle">{cleanTitle(last.title)}</div>
                  <div className="muted sm" style={{ marginTop: 4 }}>
                    Page {last.last_page}{lastPages ? ` of ${lastPages}` : ""}
                  </div>
                </div>
                <div className="row" style={{ gap: 12 }}>
                  <Link href={`/reader/?id=${last.id}`} className="go" aria-label="Resume listening"><Icon size={22} fill d={P.play} /></Link>
                  <div className="bar"><i style={{ width: (lastPages ? Math.min(100, (last.last_page / lastPages) * 100) : 0) + "%" }} /></div>
                </div>
              </div>
            </div>
          )}

          <div className="library-tools">
            <label className="searchbox">
              <Icon size={19} d={<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>} />
              <input className="input" placeholder="Search your books" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your books" />
            </label>
            <label className="sortbox">
              <span className="muted sm">Sort</span>
              <select className="sort-select" aria-label="Sort books" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="recent">Recently added</option>
                <option value="title">Title A–Z</option>
                <option value="size">File size</option>
              </select>
            </label>
          </div>
          <div className="chips">
            <button className={"chip" + (filter === "all" ? " on" : "")} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All books</button>
            <button className={"chip" + (filter === "progress" ? " on" : "")} aria-pressed={filter === "progress"} onClick={() => setFilter("progress")}>In progress</button>
            <button className={"chip" + (filter === "unread" ? " on" : "")} aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Not started</button>
          </div>

          <div className="row between" style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{tab === "offline" ? "Saved on this device" : "All books"}</h2>
            <span className="muted sm">{shown.length} PDFs</span>
          </div>
          {shown.length === 0 && (
            <div className="empty-library">
              <span className="empty-icon"><Icon size={28} d={P.book} /></span>
              <b>{query ? "No books match that search" : tab === "offline" ? "Nothing saved offline yet" : "Your next favorite is waiting"}</b>
              <span className="muted">{query ? "Try another title or clear your search." : tab === "offline" ? "Save a book for reading anywhere, even without internet." : "Add a PDF to build your personal reading library."}</span>
            </div>
          )}
          {tab === "library" && demoMode && !query && (
            <section className="sample-shelf" aria-labelledby="sample-shelf-title">
              <div className="sample-shelf-heading">
                <div><span className="eyebrow">A SMALL PLACE TO BEGIN</span><h2 id="sample-shelf-title">Try a sample book</h2></div>
                <span className="sample-badge">REAL PDFS</span>
              </div>
              <p className="sample-shelf-intro">Open a sample in your browser. These previews stay separate from your library and reading totals.</p>
              <div className="sample-books">
                {SAMPLE_BOOKS.map((book) => (
                  <article className="sample-book" key={book.id}>
                    <a className="sample-book-cover cv" href={book.file} target="_blank" rel="noreferrer" aria-label={`Open sample PDF: ${book.title}`}>
                      <Cover id={book.id} title={book.title} sourceUrl={book.file}>
                        <span className="sample-cover-label"><b>{book.title}</b><small>HIM MINISTRIES · SAMPLE PDF</small></span>
                      </Cover>
                    </a>
                    <div className="sample-book-meta">
                      <b>{book.title}</b>
                      <p>{book.description}</p>
                      <a href={book.file} target="_blank" rel="noreferrer">Open sample PDF</a>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <div className="grid">
            {shown.map((d) => (
              <div key={d.id}>
                <Link href={`/reader/?id=${d.id}`} className={coverClass(d.id)} aria-label={`Open ${d.title}`}>
                  <Cover id={d.id} title={d.title} onPageCount={onPageCount} />
                  {offline.has(d.id) && <span className="badge">Offline</span>}
                </Link>
                <div className="book-meta">
                  <div className="dt">{cleanTitle(d.title)}</div>
                  <button className="book-open" aria-label={`Open ${d.title}`} onClick={() => { window.location.href = `/reader/?id=${d.id}`; }}><Icon size={17} d={P.arrow} /></button>
                </div>
                {d.shared && <div className="muted sm">Shared with you</div>}
                <div className="muted sm book-subtitle">{fmtSize(d.size)} · {started(d) ? `Reading · page ${d.last_page}` : "Ready to read"}</div>
                {started(d) && (
                  <div className="book-progress" aria-label={`Last opened on page ${d.last_page}`}>
                    <i style={{ width: `${Math.min(100, Math.max(8, (d.last_page / (pagesFor(d.id) || (d.last_page + 5))) * 100))}%` }} />
                  </div>
                )}
                <div className="row book-actions">
                  {!offline.has(d.id) && <button className="chip sm" onClick={() => saveOffline(d)}>Save offline</button>}
                  {!d.shared && <button className="ib" style={{ width: 36, height: 36 }} aria-label={`Delete ${d.title}`} onClick={() => remove(d)}><Icon size={18} d={P.trash} /></button>}
                </div>
              </div>
            ))}
          </div>
          {tab === "library" && (
            <div className="journey-layout">
              <section className="reading-totals" aria-label="Reading totals">
                <div className="totals-heading">
                  <div className="totals-heading-top">
                    <span className="eyebrow">YOUR READING JOURNEY</span>
                    {demoMode && <span className="sample-badge">SAMPLE PREVIEW</span>}
                  </div>
                  <h2>The story in your reading</h2>
                  <p>{demoMode ? "Illustrative numbers only; your real library stays untouched." : "A quiet record of the pages you have actually read."}</p>
                </div>
                <div className="totals-grid">
                  <div className="total-item"><span className="total-icon journey-books"><Icon size={18} d={JOURNEY_ICONS.books} /></span><span><b>{journey.books}</b><small>Books in library</small></span></div>
                  <div className="total-item"><span className="total-icon journey-pages"><Icon size={18} d={JOURNEY_ICONS.pages} /></span><span><b>{journey.pages.toLocaleString()}</b><small>Pages read</small></span></div>
                  <div className="total-item"><span className="total-icon journey-complete"><Icon size={18} d={JOURNEY_ICONS.complete} /></span><span><b>{journey.completion}%</b><small>Library completed</small></span></div>
                  <div className="total-item"><span className="total-icon journey-minutes"><Icon size={18} d={JOURNEY_ICONS.minutes} /></span><span><b>{journey.minutes}</b><small>Minutes read</small></span></div>
                </div>
                <div className="completion-track" aria-label={`${journey.completion}% of your library completed`}>
                  <i style={{ width: `${journey.completion}%` }} />
                </div>
              </section>
              <section className="settings-card focus-card">
                <div className="insight-card-heading">
                  <div className="settings-card-heading">
                    <span className="settings-card-icon"><Icon size={20} d={P.clock} /></span>
                    <div><span className="eyebrow">A LITTLE SPACE FOR YOU</span><h2>Focus session</h2></div>
                  </div>
                </div>
                <div className="focus-controls-layout">
                  <div className="focus-dial" style={{ "--focus-progress": `${focusProgress}%` }}>
                    <span><b>{focusTime}</b><small>{focusDuration} MINUTES</small></span>
                  </div>
                  <div className="focus-duration">
                    <label htmlFor="focus-duration">Session length</label>
                    <div className="focus-duration-controls">
                      <input id="focus-duration" type="number" min="1" max="180" step="1" value={focusDraft} disabled={focusRunning} onChange={(event) => { setFocusDraft(event.target.value); setFocusError(""); }} />
                      <span>min</span>
                      <button type="button" onClick={applyFocusDuration} disabled={focusRunning}>Set</button>
                    </div>
                    {focusError ? <small className="focus-error" role="alert">{focusError}</small> : <small>1–180 minutes</small>}
                  </div>
                </div>
                <p className="focus-message">{focusSeconds === 0 ? "Lovely work. Take a short, well-earned pause." : focusRunning ? "One book. One quiet stretch of time." : "Give one book your full attention."}</p>
                <div className="focus-actions">
                  <button className="focus-start" onClick={toggleFocus}>{focusRunning ? "Pause session" : focusSeconds === 0 ? "Start again" : "Start focus"}</button>
                  <button className="focus-reset" onClick={resetFocus} aria-label="Reset focus timer">Reset</button>
                </div>
                <span className="focus-footnote">A reading sprint, at your pace.</span>
              </section>
            </div>
          )}
        </>
      ) : null}

      {(tab === "pdfs" || tab === "books" || tab === "sermons") && (
        <Shelves kind={tab === "sermons" ? "sermon" : tab.slice(0, -1)} docs={docs} sermons={sermons} sections={sections}
          streak={streak} setTab={go} onUpload={upload} onSection={sortInto} onSermonPosition={sermonPosition} busy={busy} />
      )}

      {tab === "search" && <DeepSearch />}

      {tab === "notes" && (
        <div className="notes-page">
          <div className="greet">Thoughts worth keeping</div>
          <div className="notes-title-row">
            <div><h1 className="title">Notes, held close</h1><p className="muted">Your little reminders, gathered from the pages you love.</p></div>
            <span className="notes-count">{notes.length || DEMO_NOTES.length} {notes.length === 1 ? "note" : "notes"}</span>
          </div>
          <div className="notes-arrangement">
            <div className="notes-arrangement-copy"><b>Arrange your notes</b><small>Your choice is saved on this device and adapts to mobile.</small></div>
            <div className="note-layout-options" role="group" aria-label="Note arrangement">
              {NOTE_LAYOUTS.map(({ id, name, description }) => (
                <button key={id} type="button" className={`note-layout-choice${noteLayout === id ? " selected" : ""}`} aria-pressed={noteLayout === id} onClick={() => chooseNoteLayout(id)}>
                  <span className={`layout-preview ${id}`} aria-hidden="true"><i /><i /><i /></span>
                  <span className="note-layout-copy"><b>{name}</b><small>{description}</small></span>
                </button>
              ))}
            </div>
          </div>
          {notes.length ? (
            <div className={`notes-grid note-layout-${noteLayout}`}>
              {notes.map((note, index) => (
                <article key={note.id} className={`note-card note-${index % 4}`}>
                  <span className="note-clip" aria-hidden="true" />
                  <Link
                    className="note-card-open"
                    href={`/reader/?id=${note.document_id}&page=${note.page}`}
                    aria-label={`Open note from ${cleanTitle(titleOf(note.document_id))}, page ${note.page}`}
                  >
                    <div className="note-card-top">
                      <span className="note-book-label"><Icon size={14} d={P.book} />{cleanTitle(titleOf(note.document_id))}</span>
                      <span className="note-page">P. {note.page}</span>
                    </div>
                    <p className="note-card-copy">{note.body?.slice(0, 300) || "A blank page for a new thought."}</p>
                    <div className="note-card-bottom"><span>Tap to revisit</span><Icon size={17} d={P.arrow} /></div>
                  </Link>
                  <button className="note-delete" type="button" aria-label={`Delete note from ${cleanTitle(titleOf(note.document_id))}`} title="Delete note" onClick={() => deleteNote(note)}>
                    <Icon size={15} d={P.trash} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <>
              <div className="sample-note-banner"><span className="sample-badge">SAMPLE NOTES</span><span>Preview the note wall. These examples are not saved to your account.</span></div>
              <div className={`notes-grid sample-notes note-layout-${noteLayout}`}>
                {DEMO_NOTES.map((note) => (
                  <article key={note.id} className={`note-card sample-note ${note.tone}`}>
                    <span className="note-clip" aria-hidden="true" />
                    <div className="note-card-top">
                      <span className="note-book-label"><Icon size={14} d={P.book} />{note.title}</span>
                      <span className="note-page">P. {note.page}</span>
                    </div>
                    <p className="note-card-copy">{note.body}</p>
                    <div className="note-card-bottom">
                      <span>Sample thought · not saved</span>
                      <button aria-label="Browse books to create your own note" onClick={() => { setTab("library"); setMsg("Add a PDF, then open it and tap the pencil to create your first note."); }}><Icon size={17} d={P.arrow} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div className="settings-page">
          <div className="greet">Make it yours</div>
          <h1 className="title">Settings</h1>
          <p className="settings-intro">A comfortable reading space, set up just for you.</p>
          <div className="settings-grid">
            <section className="settings-card theme-settings">
              <div className="settings-card-heading">
                <span className="settings-card-icon"><Icon size={20} d={P.spark} /></span>
                <div><span className="eyebrow">PERSONALIZE</span><h2>Choose your theme</h2></div>
              </div>
              <p className="muted">Pick the colors that feel right. Your choice follows you into every book.</p>
              <div className="theme-options" role="group" aria-label="Appearance theme">
                {THEMES.map(({ id, name, description }) => (
                  <button key={id} className={"theme-option" + (theme === id ? " selected" : "")} aria-pressed={theme === id} onClick={() => chooseTheme(id)}>
                    <span className={`theme-preview ${id}`} aria-hidden="true"><i /><i /><i /></span>
                    <span className="theme-option-copy"><b>{name}</b><small>{description}</small></span>
                    <span className="theme-check" aria-hidden="true">{theme === id ? "✓" : ""}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-card account-settings">
              <div className="settings-card-heading">
                <span className="settings-card-icon account"><Icon size={20} d={P.mail} /></span>
                <div><span className="eyebrow">YOUR SPACE</span><h2>My account</h2></div>
              </div>
              <div className="account-identity">
                <span className="account-avatar">{(user?.email || "R")[0].toUpperCase()}</span>
                <span><b>{user?.email || "Reader"}</b><small>{user?.role === "admin" ? "Administrator account" : "Personal reading account"}</small></span>
              </div>
              <div className="account-details">
                <span>Signed in</span><b>{user?.email || "Guest reader"}</b>
              </div>
              {(user?.apps?.includes("transcribe") || user?.role === "admin") && (
                <div className="account-apps">
                  <span className="lbl">CONNECTED APPS</span>
                  {user?.apps?.includes("transcribe") && <a href="/transcribe/">Transcribe <Icon size={16} d={P.arrow} /></a>}
                  {user.role === "admin" && <a href="/admin/">Admin dashboard <Icon size={16} d={P.arrow} /></a>}
                </div>
              )}
              <button className="btn ghost account-signout" onClick={onLogout}>Sign out</button>
            </section>
          </div>
        </div>
      )}

      {(tab === "library" || tab === "offline") && (
        <label className="upload" aria-label="Add PDF">
          {busy ? "…" : <Icon size={26} d={P.plus} />}
          <input id="pdf-upload" type="file" accept="application/pdf" onChange={upload} hidden disabled={busy} />
        </label>
      )}

      {tab === "library" && last && (
        <div className="mini-player" aria-label="Continue listening">
          <Link href={`/reader/?id=${last.id}`} className={"mini-cover " + coverClass(last.id)} aria-label={`Open ${last.title}`}>
            <Cover id={last.id} title={last.title} onPageCount={onPageCount} />
          </Link>
          <div className="mini-book">
            <b>{cleanTitle(last.title)}</b>
            <span className="muted sm">Page {miniPage}{lastPages ? ` of ${lastPages}` : ""}</span>
          </div>
          <label className="mini-timeline">
            <span className="sr-only">Reading position</span>
            <input type="range" min="1" max={lastPages || Math.max(last.last_page + 5, 10)} value={Math.min(miniPage, lastPages || Math.max(last.last_page + 5, 10))} aria-label="Scrub to a page"
              onChange={(e) => setMiniPage(Number(e.target.value))}
              onPointerUp={(e) => seekLast(Number(e.currentTarget.value))}
              onKeyUp={(e) => seekLast(Number(e.currentTarget.value))} />
          </label>
          <label className="mini-speed">
            <span className="sr-only">Playback speed</span>
            <select value={miniSpeed} onChange={(e) => chooseMiniSpeed(e.target.value)} aria-label="Playback speed">
              {[1, 1.25, 1.5, 1.75, 2].map((speed) => <option key={speed} value={speed}>{speed.toFixed(1)}x</option>)}
            </select>
          </label>
          <Link href={`/reader/?id=${last.id}&autoplay=1`} className="mini-play" aria-label="Play from last page"><Icon size={20} fill d={P.play} /></Link>
          <Link href={`/reader/?id=${last.id}`} className="mini-expand" aria-label="Open full reader"><Icon size={20} d={P.arrow} /></Link>
        </div>
      )}

      {more && (
        <div className="more-sheet" role="menu" aria-label="More">
          {toolTabs.map(([k, label, d]) => (
            <button key={k} role="menuitem" className={tab === k ? "on" : ""} onClick={() => go(k)}><Icon size={20} d={d} />{label}</button>
          ))}
        </div>
      )}
      <nav className="tabbar" aria-label="Main">
        {[["library", "Home", NAV.home], ...shelfTabs].map(([k, label, d]) => (
          <button key={k} className={"tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => go(k)}>
            <Icon d={d} />
            {label}
          </button>
        ))}
        <button className={"tab" + (more || toolTabs.some(([k]) => k === tab) ? " on" : "")} aria-expanded={more} onClick={() => setMore(!more)}>
          <Icon d={NAV.more} />More
        </button>
      </nav>
      </main>
    </div>
  );
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [user, setUserState] = useState(null);

  // Called right after a successful sign-in: send the person to the app their email belongs to.
  function enter(home) {
    if (home && home !== "/") {
      window.location.href = home;
      return;
    }
    setUserState(getUser());
    setAuthed(true);
  }

  useEffect(() => {
    const lost = () => setAuthed(false);
    window.addEventListener("auth-lost", lost);
    (async () => {
      if (getToken()) {
        try {
          const me = await api("/api/auth/me");
          localStorage.setItem("user", JSON.stringify(me.user));
          if (!me.user.apps.includes("library")) {
            window.location.href = me.home; // no Library access: go to the right app
            return;
          }
          setUserState(me.user);
          setAuthed(true);
        } catch (e) {
          if (e.status !== 401 && getToken()) {
            setUserState(getUser()); // offline: keep working with what we know
            setAuthed(true);
          }
        }
      }
      setReady(true);
    })();
    return () => window.removeEventListener("auth-lost", lost);
  }, []);

  if (!ready) return null;
  return authed ? (
    <Library user={user} onLogout={() => { clearLocalNotes().catch(() => {}); setToken(null); setAuthed(false); }} />
  ) : (
    <AuthForm onDone={enter} />
  );
}
