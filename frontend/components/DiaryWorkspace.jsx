"use client";
import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "him:diary:v1";

const MOODS = [
  { id: "grateful", label: "Grateful", emoji: "✨" },
  { id: "peaceful", label: "Peaceful", emoji: "🌿" },
  { id: "focused", label: "Focused", emoji: "🎯" },
  { id: "hopeful", label: "Hopeful", emoji: "🌅" },
  { id: "determined", label: "Determined", emoji: "🔥" },
];

const JOURNAL_PROMPTS = [
  "What truth or scripture stood out to you today, and how will you walk it out?",
  "Name three quiet wins from today that you want to remember a year from now.",
  "What is one habit or mindset shift that will multiply your focus this week?",
  "Write a letter of gratitude to your future self six months from today.",
  "What burden can you lay down tonight, and what bold step will you take tomorrow?",
];

const DREAM_CATEGORIES = ["Faith", "Career", "Family", "Health", "Home", "Impact"];

const STICKY_TONES = [
  { id: "sand", label: "Sand" },
  { id: "sky", label: "Sky" },
  { id: "sage", label: "Sage" },
  { id: "lavender", label: "Lavender" },
  { id: "amber", label: "Amber" },
];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultDiaryState() {
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
  return {
    journal: [
      {
        id: "j-welcome",
        title: "Stepping Into Purpose With Clarity",
        mood: "grateful",
        body: "Today I choose discipline over comfort. Every page read, every prayer spoken, and every small promise kept builds the foundation for what God is preparing ahead.",
        createdAt: new Date().toISOString(),
      },
    ],
    tasks: [
      {
        id: "t-1",
        title: "Review weekly reading & sermon notes for 20 minutes",
        priority: "high",
        dueAt: "",
        done: false,
        reminded: false,
      },
    ],
    dreams: [
      {
        id: "d-1",
        title: "A Peaceful Home & Flourishing Ministry",
        category: "Faith",
        targetYear: String(new Date().getFullYear() + 1),
        declaration: "I walk in wisdom, favor, and abundance. Every seed planted in faith is bearing lasting fruit in my home, work, and calling.",
        image: "",
        spokenCount: 1,
      },
    ],
    plans: [
      {
        id: "p-1",
        horizon: "weekly",
        wbsCode: "1.0",
        title: "Deep Focus & Spiritual Growth Sprint",
        deadline: nextWeek,
        items: [
          { id: "w-1", code: "1.1", text: "Complete 5 chapters of core study reading", deadline: today, done: true },
          { id: "w-2", code: "1.2", text: "Summarize key takeaways into actionable steps", deadline: nextWeek, done: false },
        ],
      },
      {
        id: "p-2",
        horizon: "monthly",
        wbsCode: "2.0",
        title: "Monthly Vision & Execution Milestone",
        deadline: nextMonth,
        items: [
          { id: "w-3", code: "2.1", text: "Audit monthly goals and align weekly schedule", deadline: nextWeek, done: false },
          { id: "w-4", code: "2.2", text: "Review progress and celebrate completed deliverables", deadline: nextMonth, done: false },
        ],
      },
    ],
    notes: [
      {
        id: "n-1",
        title: "Core Principle",
        body: "Clarity comes from action. Write the vision down, break it into steps, and speak life over it every morning.",
        tone: "sand",
        pinned: true,
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

function playGentleChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + idx * 0.14 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.14 + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.14);
      osc.stop(ctx.currentTime + idx * 0.14 + 0.6);
    });
  } catch {}
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image file."));
      img.onload = () => {
        const maxW = 720;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatCountdown(iso, nowMs) {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const diffMin = Math.round((target - nowMs) / 60000);
  if (diffMin < 0) return { label: `Overdue by ${Math.abs(diffMin)}m`, overdue: true };
  if (diffMin === 0) return { label: "Due right now", overdue: true };
  if (diffMin < 60) return { label: `In ${diffMin}m`, overdue: false };
  const hrs = Math.floor(diffMin / 60);
  if (hrs < 24) return { label: `In ${hrs}h ${diffMin % 60}m`, overdue: false };
  const days = Math.floor(hrs / 24);
  return { label: `In ${days}d`, overdue: false };
}

export default function DiaryWorkspace({ userEmail }) {
  const [section, setSection] = useState("journal"); // journal | tasks | dreams | plans | notes
  const [data, setData] = useState(defaultDiaryState);
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeAlarm, setActiveAlarm] = useState(null);

  // Journal state
  const [jTitle, setJTitle] = useState("");
  const [jMood, setJMood] = useState("grateful");
  const [jBody, setJBody] = useState("");
  const [jFilter, setJFilter] = useState("all");
  const [promptIdx, setPromptIdx] = useState(0);

  // Tasks state
  const [tTitle, setTTitle] = useState("");
  const [tPriority, setTPriority] = useState("high");
  const [tDueAt, setTDueAt] = useState("");

  // Dreams state
  const [dTitle, setDTitle] = useState("");
  const [dCategory, setDCategory] = useState("Faith");
  const [dYear, setDYear] = useState(String(new Date().getFullYear() + 1));
  const [dDeclaration, setDDeclaration] = useState("");
  const [dImage, setDImage] = useState("");
  const [dBusy, setDBusy] = useState(false);
  const [speakDream, setSpeakDream] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [spokenTranscript, setSpokenTranscript] = useState("");
  const recRef = useRef(null);

  // Plans & WBS state
  const [planHorizon, setPlanHorizon] = useState("weekly");
  const [pTitle, setPTitle] = useState("");
  const [pDeadline, setPDeadline] = useState("");
  const [childDrafts, setChildDrafts] = useState({});

  // Notes state
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");
  const [nTone, setNTone] = useState("sand");
  const [nSearch, setNSearch] = useState("");

  const storageKey = `${STORAGE_KEY}:${userEmail || "reader"}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && typeof saved === "object") {
        setData((prev) => ({ ...prev, ...saved }));
      }
    } catch {}
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {}
  }, [data, loaded, storageKey]);

  // Live 10-second clock for task reminder notifications
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      setData((prev) => {
        let triggered = null;
        const nextTasks = prev.tasks.map((task) => {
          if (!task.done && !task.reminded && task.dueAt) {
            const dueMs = new Date(task.dueAt).getTime();
            if (!Number.isNaN(dueMs) && dueMs <= now) {
              triggered = task;
              return { ...task, reminded: true };
            }
          }
          return task;
        });
        if (triggered) {
          setActiveAlarm(triggered);
          playGentleChime();
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              new Notification("HIM Diary Reminder", { body: triggered.title });
            } catch {}
          }
          return { ...prev, tasks: nextTasks };
        }
        return prev;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  function speakText(text, onDone) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.96;
    utter.pitch = 1.02;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => {
      setSpeaking(false);
      if (onDone) onDone();
    };
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }

  function stopSpeech() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }

  function toggleVoiceAffirmation(dream) {
    if (micActive) {
      try { recRef.current?.stop(); } catch {}
      setMicActive(false);
      return;
    }
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) {
      setSpokenTranscript(dream.declaration);
      setData((prev) => ({
        ...prev,
        dreams: prev.dreams.map((d) => d.id === dream.id ? { ...d, spokenCount: (d.spokenCount || 0) + 1 } : d),
      }));
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onstart = () => {
      setMicActive(true);
      setSpokenTranscript("");
    };
    rec.onresult = (ev) => {
      const text = Array.from(ev.results).map((r) => r[0].transcript).join(" ");
      setSpokenTranscript(text);
    };
    rec.onend = () => {
      setMicActive(false);
      setData((prev) => ({
        ...prev,
        dreams: prev.dreams.map((d) => d.id === dream.id ? { ...d, spokenCount: (d.spokenCount || 0) + 1 } : d),
      }));
      setSpeakDream((cur) => cur ? { ...cur, spokenCount: (cur.spokenCount || 0) + 1 } : cur);
    };
    rec.onerror = () => setMicActive(false);
    recRef.current = rec;
    rec.start();
  }

  // ---- Handlers ----
  function addJournalEntry(e) {
    e.preventDefault();
    if (!jBody.trim()) return;
    const entry = {
      id: uid(),
      title: jTitle.trim() || new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
      mood: jMood,
      body: jBody.trim(),
      createdAt: new Date().toISOString(),
    };
    setData((prev) => ({ ...prev, journal: [entry, ...prev.journal] }));
    setJTitle("");
    setJBody("");
  }

  async function addTask(e) {
    e.preventDefault();
    if (!tTitle.trim()) return;
    if (tDueAt && typeof Notification !== "undefined" && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch {}
    }
    const task = {
      id: uid(),
      title: tTitle.trim(),
      priority: tPriority,
      dueAt: tDueAt,
      done: false,
      reminded: false,
    };
    setData((prev) => ({ ...prev, tasks: [task, ...prev.tasks] }));
    setTTitle("");
    setTDueAt("");
  }

  function toggleTask(id) {
    setData((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
  }

  function snoozeAlarm(minutes = 10) {
    if (!activeAlarm) return;
    const nextDue = new Date(Date.now() + minutes * 60000).toISOString().slice(0, 16);
    setData((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === activeAlarm.id ? { ...t, dueAt: nextDue, reminded: false } : t)),
    }));
    setActiveAlarm(null);
  }

  async function handleDreamPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDBusy(true);
    try {
      const compressed = await compressImageFile(file);
      setDImage(compressed);
    } catch {}
    setDBusy(false);
  }

  function addDream(e) {
    e.preventDefault();
    if (!dTitle.trim()) return;
    const dream = {
      id: uid(),
      title: dTitle.trim(),
      category: dCategory,
      targetYear: dYear.trim() || String(new Date().getFullYear() + 1),
      declaration: dDeclaration.trim() || `I declare ${dTitle.trim()} into reality with faith, diligence, and gratitude.`,
      image: dImage,
      spokenCount: 0,
    };
    setData((prev) => ({ ...prev, dreams: [dream, ...prev.dreams] }));
    setDTitle("");
    setDDeclaration("");
    setDImage("");
  }

  function addPlan(e) {
    e.preventDefault();
    if (!pTitle.trim()) return;
    const sameHorizon = data.plans.filter((p) => p.horizon === planHorizon);
    const nextNum = sameHorizon.length + 1;
    const plan = {
      id: uid(),
      horizon: planHorizon,
      wbsCode: `${nextNum}.0`,
      title: pTitle.trim(),
      deadline: pDeadline,
      items: [],
    };
    setData((prev) => ({ ...prev, plans: [plan, ...prev.plans] }));
    setPTitle("");
    setPDeadline("");
  }

  function addWbsItem(planId) {
    const draft = childDrafts[planId] || { text: "", deadline: "" };
    if (!draft.text?.trim()) return;
    setData((prev) => ({
      ...prev,
      plans: prev.plans.map((p) => {
        if (p.id !== planId) return p;
        const prefix = p.wbsCode.replace(/\.0$/, "");
        const code = `${prefix}.${p.items.length + 1}`;
        return {
          ...p,
          items: [...p.items, { id: uid(), code, text: draft.text.trim(), deadline: draft.deadline || p.deadline, done: false }],
        };
      }),
    }));
    setChildDrafts((prev) => ({ ...prev, [planId]: { text: "", deadline: "" } }));
  }

  function toggleWbsItem(planId, itemId) {
    setData((prev) => ({
      ...prev,
      plans: prev.plans.map((p) =>
        p.id === planId
          ? { ...p, items: p.items.map((it) => (it.id === itemId ? { ...it, done: !it.done } : it)) }
          : p
      ),
    }));
  }

  function addStickyNote(e) {
    e.preventDefault();
    if (!nBody.trim()) return;
    const note = {
      id: uid(),
      title: nTitle.trim() || "Quick Note",
      body: nBody.trim(),
      tone: nTone,
      pinned: false,
      updatedAt: new Date().toISOString(),
    };
    setData((prev) => ({ ...prev, notes: [note, ...prev.notes] }));
    setNTitle("");
    setNBody("");
  }

  function promoteNoteToTask(note) {
    const task = {
      id: uid(),
      title: `${note.title}: ${note.body.slice(0, 72)}`,
      priority: "medium",
      dueAt: "",
      done: false,
      reminded: false,
    };
    setData((prev) => ({ ...prev, tasks: [task, ...prev.tasks] }));
    setSection("tasks");
  }

  const openTasks = data.tasks.filter((t) => !t.done).length;
  const doneTasks = data.tasks.filter((t) => t.done).length;
  const visiblePlans = data.plans.filter((p) => p.horizon === planHorizon);
  const filteredJournal = jFilter === "all" ? data.journal : data.journal.filter((j) => j.mood === jFilter);
  const filteredNotes = data.notes
    .filter((n) => !nSearch.trim() || `${n.title} ${n.body}`.toLowerCase().includes(nSearch.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  return (
    <div className="diary-shell">
      <section className="diary-hero">
        <div className="diary-hero-copy">
          <span className="eyebrow">PERSONAL SANCTUARY</span>
          <h1>My Diary</h1>
          <p>Capture reflections, schedule timed action reminders, visualize &amp; speak your dreams to life, and structure weekly or monthly plans with WBS milestones.</p>
        </div>
        <div className="diary-stats">
          <div className="diary-stat"><b>{data.journal.length}</b><span>Reflections</span></div>
          <div className="diary-stat"><b>{doneTasks}/{data.tasks.length}</b><span>Tasks done</span></div>
          <div className="diary-stat"><b>{data.dreams.length}</b><span>Dreams</span></div>
          <div className="diary-stat"><b>{data.plans.length}</b><span>WBS plans</span></div>
        </div>
      </section>

      {activeAlarm && (
        <div className="diary-alarm-banner" role="alert">
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", opacity: 0.88 }}>⏰ Scheduled Reminder Reached</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{activeAlarm.title}</div>
          </div>
          <div className="diary-alarm-actions">
            <button type="button" onClick={() => snoozeAlarm(10)}>Snooze 10m</button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                toggleTask(activeAlarm.id);
                setActiveAlarm(null);
              }}
            >
              Mark Complete
            </button>
          </div>
        </div>
      )}

      <nav className="diary-tabs" aria-label="Diary tools">
        {[
          ["journal", "Journal", "📖"],
          ["tasks", `Tasks (${openTasks})`, "✅"],
          ["dreams", "Dreams", "✨"],
          ["plans", "Plans & WBS", "🗺️"],
          ["notes", `Notes (${data.notes.length})`, "🗒️"],
        ].map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            className={`diary-tab mode-${id}` + (section === id ? " on" : "")}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      {/* ==================== 1. JOURNAL ==================== */}
      {section === "journal" && (
        <div className="diary-grid-2">
          <form className="diary-card journal-paper" onSubmit={addJournalEntry}>
            <span className="eyebrow">DAILY REFLECTION</span>
            <h2>Write in your journal</h2>
            <div className="prompt-box" style={{ marginTop: 12 }}>
              <span>{JOURNAL_PROMPTS[promptIdx]}</span>
              <button type="button" className="diary-btn soft sm" onClick={() => setPromptIdx((i) => (i + 1) % JOURNAL_PROMPTS.length)}>
                New prompt
              </button>
            </div>
            <div className="mood-row" role="group" aria-label="Current mood">
              {MOODS.map((m) => (
                <button key={m.id} type="button" className={"mood-pill" + (jMood === m.id ? " on" : "")} onClick={() => setJMood(m.id)}>
                  {m.emoji} {m.label}
                </button>
              ))}
            </div>
            <input
              className="diary-field"
              placeholder="Entry headline (optional)"
              value={jTitle}
              onChange={(e) => setJTitle(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <textarea
              className="diary-textarea"
              placeholder="Pour out your thoughts, prayers, gratitude, and lessons from today..."
              value={jBody}
              onChange={(e) => setJBody(e.target.value)}
            />
            <div className="row between" style={{ marginTop: 12 }}>
              <span className="muted sm">{jBody.trim().split(/\s+/).filter(Boolean).length} words</span>
              <button type="submit" className="diary-btn" style={{ background: "#7c4a21" }}>Save Reflection</button>
            </div>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <button type="button" className={"mood-pill" + (jFilter === "all" ? " on" : "")} onClick={() => setJFilter("all")}>All ({data.journal.length})</button>
              {MOODS.map((m) => (
                <button key={m.id} type="button" className={"mood-pill" + (jFilter === m.id ? " on" : "")} onClick={() => setJFilter(m.id)}>
                  {m.emoji} {m.label}
                </button>
              ))}
            </div>
            {filteredJournal.map((entry) => {
              const moodMeta = MOODS.find((m) => m.id === entry.mood) || MOODS[0];
              return (
                <article key={entry.id} className="journal-entry">
                  <div className="row between">
                    <div>
                      <span className="muted sm">{new Date(entry.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                      <h3 style={{ margin: "2px 0 0", fontSize: 17 }}>{entry.title}</h3>
                    </div>
                    <span className="badge">{moodMeta.emoji} {moodMeta.label}</span>
                  </div>
                  <p className="journal-entry-body">{entry.body}</p>
                  <div className="row between" style={{ marginTop: 4 }}>
                    <button type="button" className="diary-btn soft sm" onClick={() => speakText(`${entry.title}. ${entry.body}`)}>
                      🔊 Listen aloud
                    </button>
                    <button
                      type="button"
                      className="diary-btn soft sm"
                      onClick={() => setData((prev) => ({ ...prev, journal: prev.journal.filter((j) => j.id !== entry.id) }))}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== 2. TASKS & TIMED REMINDERS ==================== */}
      {section === "tasks" && (
        <div className="diary-grid-2">
          <form className="diary-card" onSubmit={addTask}>
            <span className="eyebrow">ACTION &amp; REMINDERS</span>
            <h2>Schedule an action item</h2>
            <p className="muted sm" style={{ margin: "4px 0 14px" }}>Set an exact date and time—HIM Diary will chime and notify you right when it is time to act.</p>
            <input
              className="diary-field"
              placeholder="What action will you take?"
              value={tTitle}
              onChange={(e) => setTTitle(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 10, marginBottom: 12 }}>
              <select className="diary-field" value={tPriority} onChange={(e) => setTPriority(e.target.value)} aria-label="Priority">
                <option value="high">High priority</option>
                <option value="medium">Medium priority</option>
                <option value="low">Low priority</option>
              </select>
              <input
                type="datetime-local"
                className="diary-field"
                value={tDueAt}
                onChange={(e) => setTDueAt(e.target.value)}
                aria-label="Reminder date and time"
              />
            </div>
            <button type="submit" className="diary-btn" style={{ width: "100%", background: "#1d4ed8" }}>Add Action &amp; Arm Reminder</button>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.tasks.length === 0 && <div className="diary-card muted">No actions yet. Add your first task with a reminder time on the left.</div>}
            {data.tasks.map((task) => {
              const countdown = formatCountdown(task.dueAt, nowMs);
              return (
                <div key={task.id} className={"task-row" + (task.done ? " done" : "")}>
                  <button type="button" className="task-check" aria-label={task.done ? "Mark incomplete" : "Mark complete"} onClick={() => toggleTask(task.id)}>
                    {task.done ? "✓" : ""}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, textDecoration: task.done ? "line-through" : "none" }}>{task.title}</div>
                    <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                      <span className={`prio-badge prio-${task.priority}`}>{task.priority}</span>
                      {task.dueAt && (
                        <span className={"rem-pill" + (countdown?.overdue && !task.done ? " overdue" : "")}>
                          ⏰ {new Date(task.dueAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {countdown && !task.done ? ` · ${countdown.label}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="diary-btn soft sm"
                    onClick={() => setData((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) }))}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== 3. DREAMS VISION BOARD & SPEAK IT TO LIFE ==================== */}
      {section === "dreams" && (
        <div className="diary-grid-2">
          <form className="diary-card" onSubmit={addDream}>
            <span className="eyebrow">VISION BOARD</span>
            <h2>Capture a Dream</h2>
            <p className="muted sm" style={{ margin: "4px 0 14px" }}>Upload a photo of what you are believing for, write your faith declaration, and speak it to life.</p>
            <input
              className="diary-field"
              placeholder="Dream or vision title (e.g., Debt-Free Family Home)"
              value={dTitle}
              onChange={(e) => setDTitle(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 10, marginBottom: 10 }}>
              <select className="diary-field" value={dCategory} onChange={(e) => setDCategory(e.target.value)}>
                {DREAM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className="diary-field" value={dYear} onChange={(e) => setDYear(e.target.value)} placeholder="Year" />
            </div>
            <label className="diary-btn soft" style={{ width: "100%", marginBottom: 10, cursor: "pointer" }}>
              {dBusy ? "Processing image..." : dImage ? "✓ Vision photo attached (change)" : "📷 Upload vision photo"}
              <input type="file" accept="image/*" hidden onChange={handleDreamPhoto} />
            </label>
            {dImage && (
              <img src={dImage} alt="Dream preview" style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 14, marginBottom: 10 }} />
            )}
            <textarea
              className="diary-textarea"
              style={{ minHeight: 96 }}
              placeholder="Write your declaration in the present tense (e.g., I am walking in wisdom, health, and open doors...)"
              value={dDeclaration}
              onChange={(e) => setDDeclaration(e.target.value)}
            />
            <button type="submit" className="diary-btn" style={{ width: "100%", marginTop: 12, background: "linear-gradient(135deg,#6d28d9,#db2777)" }}>
              Add to Vision Board
            </button>
          </form>

          <div className="dreams-grid">
            {data.dreams.map((dream) => (
              <article key={dream.id} className="dream-card">
                <div className="dream-cover">
                  {dream.image ? (
                    <img src={dream.image} alt={dream.title} />
                  ) : (
                    <span style={{ fontSize: 42 }} aria-hidden="true">✨</span>
                  )}
                  <span className="dream-cat">{dream.category}</span>
                  <span className="dream-year">{dream.targetYear}</span>
                </div>
                <div className="dream-body">
                  <h3>{dream.title}</h3>
                  <p className="dream-decl">“{dream.declaration}”</p>
                  <div className="row between" style={{ marginTop: "auto", paddingTop: 8 }}>
                    <button
                      type="button"
                      className="diary-btn sm"
                      style={{ background: "linear-gradient(135deg,#6d28d9,#db2777)" }}
                      onClick={() => {
                        setSpeakDream(dream);
                        setSpokenTranscript("");
                      }}
                    >
                      🎙️ Speak it to life
                    </button>
                    <span className="muted sm">Spoken {dream.spokenCount || 0}×</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* Speak It To Life Spotlight Modal */}
      {speakDream && (
        <div className="speak-modal-scrim" role="dialog" aria-modal="true" aria-label="Speak your dream to life">
          <div className="speak-modal">
            <div className="row between">
              <span className="badge" style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}>{speakDream.category} · {speakDream.targetYear}</span>
              <button
                type="button"
                className="diary-btn soft sm"
                onClick={() => {
                  stopSpeech();
                  if (micActive) { try { recRef.current?.stop(); } catch {} setMicActive(false); }
                  setSpeakDream(null);
                }}
              >
                Close
              </button>
            </div>
            {speakDream.image && (
              <img src={speakDream.image} alt={speakDream.title} style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 18 }} />
            )}
            <div className={"speak-orb" + (speaking || micActive ? " active" : "")}>
              <span style={{ fontSize: 28 }}>🎙️</span>
            </div>
            <div style={{ textAlign: "center" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: 23 }}>{speakDream.title}</h2>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "rgba(255,255,255,.9)", fontStyle: "italic" }}>
                “{speakDream.declaration}”
              </p>
            </div>
            {spokenTranscript && (
              <div style={{ padding: 12, borderRadius: 14, background: "rgba(255,255,255,.1)", fontSize: 13 }}>
                <b>Your spoken declaration:</b> “{spokenTranscript}”
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button
                type="button"
                className="diary-btn"
                style={{ background: "#a855f7" }}
                onClick={() =>
                  speaking
                    ? stopSpeech()
                    : speakText(`${speakDream.title}. ${speakDream.declaration}`, () => {
                        setData((prev) => ({
                          ...prev,
                          dreams: prev.dreams.map((d) =>
                            d.id === speakDream.id ? { ...d, spokenCount: (d.spokenCount || 0) + 1 } : d
                          ),
                        }));
                      })
                }
              >
                {speaking ? "⏹ Stop Voice" : "🔊 Hear It Spoken"}
              </button>
              <button
                type="button"
                className="diary-btn"
                style={{ background: micActive ? "#ef4444" : "#ec4899" }}
                onClick={() => toggleVoiceAffirmation(speakDream)}
              >
                {micActive ? "⏹ Finish Speaking" : "🎤 Speak Aloud Now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 4. PLANS & WBS ==================== */}
      {section === "plans" && (
        <div className="diary-grid-2">
          <form className="diary-card" onSubmit={addPlan}>
            <span className="eyebrow">STRATEGIC ROADMAP</span>
            <h2>Create a {planHorizon === "weekly" ? "Weekly" : "Monthly"} Plan</h2>
            <p className="muted sm" style={{ margin: "4px 0 14px" }}>Define your top-level objective and break it down into numbered WBS deliverables with deadlines.</p>
            <div className="seg" style={{ marginBottom: 12 }}>
              <button type="button" className={planHorizon === "weekly" ? "on" : ""} onClick={() => setPlanHorizon("weekly")}>Weekly Plan</button>
              <button type="button" className={planHorizon === "monthly" ? "on" : ""} onClick={() => setPlanHorizon("monthly")}>Monthly Plan</button>
            </div>
            <input
              className="diary-field"
              placeholder="Objective title (e.g., Launch Community Study Group)"
              value={pTitle}
              onChange={(e) => setPTitle(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <label className="muted sm" style={{ display: "block", marginBottom: 4 }}>Target deadline</label>
            <input type="date" className="diary-field" value={pDeadline} onChange={(e) => setPDeadline(e.target.value)} style={{ marginBottom: 12 }} />
            <button type="submit" className="diary-btn" style={{ width: "100%", background: "#0f766e" }}>Add WBS Objective</button>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="seg">
              <button type="button" className={planHorizon === "weekly" ? "on" : ""} onClick={() => setPlanHorizon("weekly")}>
                Weekly Plans ({data.plans.filter((p) => p.horizon === "weekly").length})
              </button>
              <button type="button" className={planHorizon === "monthly" ? "on" : ""} onClick={() => setPlanHorizon("monthly")}>
                Monthly Plans ({data.plans.filter((p) => p.horizon === "monthly").length})
              </button>
            </div>

            {visiblePlans.map((plan) => {
              const total = plan.items.length;
              const done = plan.items.filter((i) => i.done).length;
              const pct = total ? Math.round((done / total) * 100) : 0;
              const draft = childDrafts[plan.id] || { text: "", deadline: "" };
              return (
                <article key={plan.id} className="wbs-card">
                  <div className="row between">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="wbs-code">WBS {plan.wbsCode}</span>
                      <h3 style={{ margin: 0, fontSize: 17 }}>{plan.title}</h3>
                    </div>
                    <span className="badge">{pct}% complete</span>
                  </div>
                  {plan.deadline && <div className="muted sm">📅 Objective deadline: <b>{plan.deadline}</b></div>}
                  <div className="wbs-bar" aria-label={`Progress ${pct}%`}><i style={{ width: `${pct}%` }} /></div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {plan.items.map((item) => (
                      <div key={item.id} className="wbs-child">
                        <div className="row" style={{ gap: 10, flex: 1, minWidth: 0 }}>
                          <button
                            type="button"
                            className="task-check"
                            style={{ borderColor: "#0f766e", background: item.done ? "#0f766e" : "transparent" }}
                            onClick={() => toggleWbsItem(plan.id, item.id)}
                          >
                            {item.done ? "✓" : ""}
                          </button>
                          <span className="wbs-code">{item.code}</span>
                          <span style={{ fontSize: 13.5, fontWeight: 600, textDecoration: item.done ? "line-through" : "none" }}>{item.text}</span>
                        </div>
                        {item.deadline && <span className="muted sm">Due {item.deadline}</span>}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 140px auto", gap: 8, marginTop: 4 }}>
                    <input
                      className="diary-field"
                      placeholder="Add WBS deliverable..."
                      value={draft.text}
                      onChange={(e) => setChildDrafts((prev) => ({ ...prev, [plan.id]: { ...draft, text: e.target.value } }))}
                    />
                    <input
                      type="date"
                      className="diary-field"
                      value={draft.deadline}
                      onChange={(e) => setChildDrafts((prev) => ({ ...prev, [plan.id]: { ...draft, deadline: e.target.value } }))}
                    />
                    <button type="button" className="diary-btn" style={{ background: "#0f766e" }} onClick={() => addWbsItem(plan.id)}>+ Step</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== 5. CREATIVE NOTES WALL ==================== */}
      {section === "notes" && (
        <div className="diary-grid-2">
          <form className="diary-card" onSubmit={addStickyNote}>
            <span className="eyebrow">IDEA SCRATCHPAD</span>
            <h2>Pin a creative note</h2>
            <input
              className="diary-field"
              placeholder="Note title"
              value={nTitle}
              onChange={(e) => setNTitle(e.target.value)}
              style={{ margin: "12px 0 10px" }}
            />
            <div className="mood-row">
              {STICKY_TONES.map((t) => (
                <button key={t.id} type="button" className={"mood-pill" + (nTone === t.id ? " on" : "")} onClick={() => setNTone(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              className="diary-textarea"
              placeholder="Jot down an insight, outline, verse, or sudden spark..."
              value={nBody}
              onChange={(e) => setNBody(e.target.value)}
            />
            <button type="submit" className="diary-btn" style={{ width: "100%", marginTop: 12, background: "#b45309" }}>Pin Note</button>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              className="diary-field"
              placeholder="Search your diary notes..."
              value={nSearch}
              onChange={(e) => setNSearch(e.target.value)}
            />
            <div className="sticky-wall">
              {filteredNotes.map((note) => (
                <article key={note.id} className={`sticky-note sticky-${note.tone || "sand"}`}>
                  <div className="row between">
                    <b style={{ fontSize: 15 }}>{note.title}</b>
                    <button
                      type="button"
                      style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 14 }}
                      title={note.pinned ? "Unpin" : "Pin to top"}
                      onClick={() =>
                        setData((prev) => ({
                          ...prev,
                          notes: prev.notes.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)),
                        }))
                      }
                    >
                      {note.pinned ? "📌" : "📍"}
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", flex: 1 }}>{note.body}</p>
                  <div className="row between" style={{ paddingTop: 6 }}>
                    <button type="button" className="diary-btn soft sm" onClick={() => promoteNoteToTask(note)}>→ Task</button>
                    <button
                      type="button"
                      className="diary-btn soft sm"
                      onClick={() => setData((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== note.id) }))}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
