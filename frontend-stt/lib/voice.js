// Hands-free voice control: browser speech recognition, command parsing and spoken answers.
// Kept identical in frontend/lib and frontend-stt/lib. Check: node frontend/lib/voice.check.mjs

const Recognition = () => typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
const canRecord = () => typeof window !== "undefined" && !!(navigator.mediaDevices && window.AudioWorkletNode);
export const voiceSupported = () => !!Recognition() || canRecord();

// Chrome's built-in recognition streams audio to Google. When that is blocked (antivirus, firewall, no Google
// services) it fails with "network"; from then on this page records phrases itself and sends them to Whisper.
let useWhisper = false;

/** Starts the microphone. Returns stop(). onEnd(error) always fires once. */
export function listen(opts) {
  if (useWhisper || !Recognition()) return record(opts);
  const { onInterim, onFinal, onEnd, continuous = false } = opts;
  const r = new (Recognition())();
  let error = "", heard = false, stopped = false, fallback = null;
  r.lang = navigator.language || "en-US";
  r.interimResults = true;
  r.continuous = continuous;
  r.onresult = (e) => {
    heard = true;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) { if (text) onFinal(text); } else interim += text + " ";
    }
    if (interim.trim()) onInterim?.(interim.trim());
  };
  r.onerror = (e) => { error = e.error; };
  r.onend = () => {
    if (error === "network" && !heard && !stopped && canRecord()) { useWhisper = true; fallback = record(opts); return; }
    onEnd(error);
  };
  r.start();
  return () => { stopped = true; if (fallback) fallback(); else r.stop(); };
}

export const MIC_LEVEL = 8; // loudness (0-128) that counts as speech; raise it in a noisy room
const QUIET_S = 1.2;        // this much silence ends a phrase
const WAKE_S = 6;           // over sound that never goes quiet (the book read aloud), send a piece this long...
const OVERLAP_S = 2.5;      // ...overlapping the last one by this much, so "Hey Nasoma" is never cut in half
const BACKLOG_S = 5;        // a new listener first hears the last few seconds nobody has turned into text yet
const PREROLL_S = 0.4;      // keep a little audio from just before speech starts
const CHUNK = 2048;         // samples per microphone callback

/**
 * Where phrases start and end, from one loudness value per chunk (pure, checked in voice.check.mjs).
 * push(i, level) returns a [from, to) range to transcribe, "no-speech", or null.
 */
export function makeCutter({ start, live = start, perS, continuous, wake }) {
  const n = (s) => Math.round(s * perS);
  let from = start, spoke = false, lastLoud = start;
  const max = n(wake ? WAKE_S : 30);
  return {
    get spoke() { return spoke; },
    get from() { return from; },
    push(i, level) {
      const loud = level > MIC_LEVEL;
      if (!spoke) {
        if (loud) { spoke = true; lastLoud = i; from = Math.max(from, i - n(PREROLL_S)); return null; }
        from = Math.max(from, i - n(PREROLL_S));
        return !continuous && i - live > n(7) ? "no-speech" : null; // 7 s of live silence
      }
      if (loud) lastLoud = i;
      if (i - lastLoud > n(QUIET_S)) { const r = [from, i]; spoke = false; from = i; return r; }
      if (i - from >= max) { const r = [from, i]; from = wake ? i - n(OVERLAP_S) : i; return r; }
      return null;
    },
  };
}

// Whisper path: one microphone stays open while voice is in use, so there is no gap between listeners
// (after a command the next one is heard even if you start talking straight away).
let ear = null;

// Runs on the audio thread and hands the page CHUNK samples at a time; messages queue up if the page is busy.
const WORKLET = `registerProcessor("ear", class extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${CHUNK}); this.n = 0; }
  process([input]) {
    const ch = input[0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === ${CHUNK}) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(${CHUNK}); this.n = 0; }
    }
    return true;
  }
});`;

function openEar() {
  if (ear) { clearTimeout(ear.closeTimer); return ear; }
  const e = (ear = { chunks: [], first: 0, used: 0, perS: 48000 / CHUNK, rate: 48000, listeners: new Set() });
  e.end = () => e.first + e.chunks.length;
  e.ready = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new AudioContext();
    // Chrome starts audio "suspended" until the page is clicked (e.g. hands-free turned back on at page load)
    const wakeUp = () => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); };
    wakeUp();
    ctx.onstatechange = wakeUp;
    addEventListener("pointerdown", wakeUp);
    addEventListener("keydown", wakeUp);
    // Recorded on the audio thread: a busy page can't make it skip audio (ScriptProcessor on the main thread did).
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
    const node = new AudioWorkletNode(ctx, "ear");
    ctx.createMediaStreamSource(stream).connect(node);
    // Into a stream, not the speakers: after ~30 s of silent output Chrome switches the context to a
    // power-saving clock that runs slow, and a third of what you said was lost.
    node.connect(ctx.createMediaStreamDestination());
    Object.assign(e, { stream, ctx, rate: ctx.sampleRate, perS: ctx.sampleRate / CHUNK });
    e.cleanup = () => { removeEventListener("pointerdown", wakeUp); removeEventListener("keydown", wakeUp); };
    node.port.onmessage = ({ data }) => {
      let sum = 0;
      for (const v of data) sum += v * v;
      e.chunks.push({ data, level: Math.sqrt(sum / data.length) * 128 });
      const keep = Math.min(e.end() - Math.round((BACKLOG_S + 1) * e.perS), ...[...e.listeners].map((l) => l.oldest()));
      if (keep > e.first) { e.chunks.splice(0, keep - e.first); e.first = keep; }
      for (const l of [...e.listeners]) l.feed();
    };
  })();
  e.ready.catch(() => { if (ear === e) ear = null; });
  return e;
}

function closeEarSoon(e) {
  if (e.listeners.size) return;
  clearTimeout(e.closeTimer);
  e.closeTimer = setTimeout(() => { // stays open between hands-free listeners; closes (mic light off) when idle
    if (e.listeners.size) return;
    e.stream?.getTracks().forEach((t) => t.stop());
    e.ctx?.close().catch(() => {});
    e.cleanup?.();
    if (ear === e) ear = null;
  }, 15000);
}

/** 16 kHz mono WAV of chunks [from, to): small to upload and what Whisper expects anyway. */
function toWav(e, from, to) {
  const parts = e.chunks.slice(Math.max(0, from - e.first), to - e.first).map((c) => c.data);
  const step = e.rate / 16000;
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Int16Array(Math.floor(total / step));
  let k = 0, acc = 0, cnt = 0, pos = 0, next = step;
  for (const p of parts) {
    for (const v of p) {
      acc += v; cnt++; pos++;
      if (pos >= next && k < out.length) { out[k++] = Math.max(-1, Math.min(1, acc / cnt)) * 32767; acc = cnt = 0; next += step; }
    }
  }
  const buf = new DataView(new ArrayBuffer(44 + out.length * 2));
  const str = (o, t) => { for (let j = 0; j < t.length; j++) buf.setUint8(o + j, t.charCodeAt(j)); };
  str(0, "RIFF"); buf.setUint32(4, 36 + out.length * 2, true); str(8, "WAVEfmt ");
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, 16000, true); buf.setUint32(28, 32000, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  str(36, "data"); buf.setUint32(40, out.length * 2, true);
  out.forEach((v, j) => buf.setInt16(44 + j * 2, v, true));
  return new Blob([buf], { type: "audio/wav" });
}

/** Whisper path: turns each spoken phrase into text on the server. wake: listening for "Hey Nasoma" in the
 *  background (overlapping pieces over continuous sound; nothing is held back when it stops). */
function record({ onInterim, onFinal, onEnd, continuous = false, wake = false }) {
  let stopped = false, ended = false, heard = false, said = false, queue = Promise.resolve(), cut = null;
  const e = openEar();
  const l = { cursor: 0, oldest: () => (cut ? Math.min(cut.from, l.cursor) : l.cursor) };
  const end = (err) => {
    if (ended) return;
    ended = true;
    e.listeners.delete(l);
    closeEarSoon(e);
    onEnd(err);
  };
  const send = (from, to) => {
    e.used = Math.max(e.used, to);
    const wav = toWav(e, from, to);
    queue = queue.then(async () => {
      if (ended) return;
      const form = new FormData();
      form.append("file", wav, "speech.wav");
      const { api } = await import("./api"); // browser only; keeps this file runnable in node for the checks
      const { text } = await api("/api/assistant/listen", { method: "POST", form });
      if (text && !ended) { heard = true; onFinal(text); }
    }).catch(() => end("network"));
  };
  const stop = (err = "", keep = !wake) => {
    if (stopped) return;
    stopped = true;
    e.listeners.delete(l);
    if (keep && cut?.spoke) send(cut.from, l.cursor); // words said just before you tapped the mic still count
    queue.then(() => end(err === "no-speech" && heard ? "" : err));
  };
  l.feed = () => {
    for (const last = e.end(); l.cursor < last && !stopped; l.cursor++) {
      const r = cut.push(l.cursor, e.chunks[l.cursor - e.first].level);
      if (cut.spoke && !said) { said = true; onInterim?.("…"); }
      if (r === "no-speech") return stop("no-speech", false);
      if (r) {
        said = false;
        send(r[0], r[1]);
        if (!continuous) return stop("", false);
      }
    }
  };
  e.ready.then(() => {
    if (stopped) return end("");
    l.cursor = Math.max(e.used, e.end() - Math.round(BACKLOG_S * e.perS), e.first);
    cut = makeCutter({ start: l.cursor, live: e.end(), perS: e.perS, continuous, wake });
    e.listeners.add(l);
    l.feed(); // the backlog first: what was said while nobody was listening
  }, (err) => end(err?.name === "NotFoundError" ? "audio-capture" : "not-allowed"));
  return () => stop();
}

/** Speaks text sentence by sentence (long utterances get cut off in Chrome). Resolves when done or cancelled. */
export function speak(text, { rate = 1, voiceURI } = {}) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = synth.getVoices().find((v) => v.voiceURI === voiceURI);
  const parts = text.match(/[^.!?]+[.!?]*/g) || [text];
  return new Promise((done) => {
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p.trim());
      u.rate = rate;
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      if (i === parts.length - 1) u.onend = u.onerror = () => done();
      else u.onerror = () => done();
      synth.speak(u);
    });
  });
}

const NUMS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "42", "forty two", "two hundred and five" -> number, else null. */
export function toNumber(s) {
  s = s.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  let n = null;
  for (const w of s.split(/[\s-]+/)) {
    if (w === "and") continue;
    if (w === "hundred") n = (n || 1) * 100;
    else if (w in NUMS) n = (n || 0) + NUMS[w];
    else return null;
  }
  return n;
}

/** Next reading speed: a number sets it, "+"/"-" steps by 0.25. */
export function nextRate(cur, arg, max = 3) {
  const r = typeof arg === "number" ? arg : cur + (arg === "+" ? 0.25 : -0.25);
  return Math.min(max, Math.max(0.5, Math.round(r * 4) / 4));
}

/** Tidies one dictated phrase into a sentence. */
export const sentence = (t) => {
  t = t.trim();
  return t && t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
};

/** Dictation ends when a phrase finishes with "stop note" (or end/close/finish the note/dictation). */
export function dictation(t) {
  const m = t.match(/^(.*?)\s*\b(?:stop|end|close|finish)(?: the)? (?:notes?|dictation)[.!]?$/i);
  return m ? { text: m[1], stop: true } : { text: t, stop: false };
}

/** Any other wording ("bump the speed up a bit", "nenda ukurasa wa tano"): the server's AI picks the action.
 *  Resolves to { cmd, arg } or null. */
export async function interpret(text) {
  const { api } = await import("./api"); // browser only, like the Whisper path
  const { command } = await api("/api/assistant/command", { method: "POST", body: { text } });
  return command;
}

/** The first sentence of a transcript that runs on (Whisper punctuates). "1.25x" stays whole. */
export const firstSentence = (t) => t.split(/[.!?](?:\s|$)/)[0];

/** The command said after the wake word. Over a voice reading aloud the transcript runs on
 *  ("pause. Choose a spot with good soil"), so the first sentence is tried before the whole thing. */
export function wakeCommand(rest) {
  return [firstSentence(rest), rest].find((r) => r && parseCommand(r)) || null;
}

/** Hands-free wake phrase: "Hey Nasoma" or "Hey assistant". Returns what was said after it ("" if nothing), or null. */
const WAKE = /\b(?:hey|hi|okay|ok)[\s,]+(?:na ?soma|nasomo|assistant)\b[\s,.!]*/i;
export function afterWake(t) {
  const i = t.search(WAKE);
  return i < 0 ? null : t.slice(i).replace(WAKE, "").trim();
}

/** Several commands in one breath: "Hey Nasoma, page 3. Hey Nasoma, sepia mode" -> ["page 3.", "sepia mode"]. */
export const wakeParts = (t) => t.split(new RegExp(WAKE.source, "gi")).slice(1).map((s) => s.trim());

const THEMES = { dark: "dark", night: "dark", light: "light", day: "light", sepia: "sepia" };
const RULES = [
  [/^(?:help|commands|what can (?:i|you) (?:say|do)|what are (?:the|my) (?:commands|options))$/i, () => ({ cmd: "help" })],
  [/^(?:stop listening|(?:turn |switch )?hands[- ]?free(?: mode)? off|(?:turn|switch) off hands[- ]?free(?: mode)?)$/i, () => ({ cmd: "handsfree", arg: false })],
  [/^(?:(?:turn |switch )?hands[- ]?free(?: mode)? on|(?:turn|switch) on hands[- ]?free(?: mode)?|start listening)$/i, () => ({ cmd: "handsfree", arg: true })],
  [/^(?:close|hide) (?:the |my )?notes?$/i, () => ({ cmd: "notes", arg: false })],
  [/^(?:show|view|list) (?:me )?(?:the |my )?(?:notes|bookmarks)$/i, () => ({ cmd: "notes", arg: true })],
  [/^(?:go to|jump to|play from|open|read) (?:my |the )?last (?:note|bookmark)$/i, () => ({ cmd: "lastNote" })],
  [/^(?:delete|remove|erase) (?:the |that |this |my )?(?:last )?note$/i, () => ({ cmd: "deleteNote" })],
  [/^(next|previous) (paragraph|page)$/i, (m) => ({ cmd: /page/i.test(m[2]) ? "turn" : "paragraph", arg: /next/i.test(m[1]) ? 1 : -1 })],
  [/^(?:(?:skip|jump|go) )?(forward|ahead|back(?:wards?)?)(?: (.+?) seconds?)?$/i,
    (m) => ({ cmd: "skip", arg: (/back/i.test(m[1]) ? -1 : 1) * (m[2] ? toNumber(m[2]) ?? 10 : 10) })],
  [/^rewind$/i, () => ({ cmd: "skip", arg: -10 })],
  [/^(?:please )?(?:open (?:the |my )?notes?|take (?:a )?note|new note|write(?: down)?|note(?: that)?)(?:\s+(?:and\s+)?(?:write(?: down)?\s+)?(.*))?$/i,
    (m) => ({ cmd: "note", arg: m[1] || "" })],
  [/^(?:pause|stop|hold on|wait)(?: reading| playing| please)?$/i, () => ({ cmd: "pause" })],
  [/^(?:resume|play|continue|start|keep going|go on)(?: reading| playing| please)?$/i, () => ({ cmd: "resume" })],
  [/^(?:set |change )?(?:the )?(?:read(?:ing)? |play(?:back)? )?(?:speed|rate|faster|slower|at)\D*?(\d+(?:\.\d+)?)\s*(?:x|times)?$/i,
    (m) => ({ cmd: "rate", arg: Number(m[1]) })],
  [/^(?:read |play |go )?(faster|speed up|slower|slow down)$/i, (m) => ({ cmd: "rate", arg: /faster|up/i.test(m[1]) ? "+" : "-" })],
  [/^(?:(?:go|jump|skip|turn) to |open )?page (.+)$/i, (m) => toNumber(m[1]) != null && { cmd: "page", arg: toNumber(m[1]) }],
  [/^(?:(?:go|jump|skip) to )?minute (.+)$/i, (m) => toNumber(m[1]) != null && { cmd: "minute", arg: toNumber(m[1]) }],
  [/^(?:add (?:a )?)?bookmark\b|^mark this\b/i, () => ({ cmd: "bookmark" })],
  [/^(?:(?:switch|change|turn|set|go)(?: on)?(?: the)?(?: theme| mode)?(?: to)? )?(dark|night|light|day|sepia)(?: mode| theme)?$/i,
    (m) => ({ cmd: "theme", arg: THEMES[m[1].toLowerCase()] })],
  [/^(?:ask|question)\b[\s:,]*(.+)$/i, (m) => ({ cmd: "ask", arg: m[1] })],
  [/^(?:what|who|whom|why|how|when|where|which|did|does|do|is|are|was|were|can|could|should|explain|summari[sz]e|tell me)\b.+/i,
    (m) => ({ cmd: "ask", arg: m[0] })],
];

/** Turns a spoken phrase into { cmd, arg }, or null when it is not a command. */
export function parseCommand(raw) {
  // Whisper punctuates ("Open notes, and write..."), so commas never matter
  const text = raw.replace(/,/g, " ").trim().replace(/\s+/g, " ").replace(/[;:!]+$|\.+$/, "");
  const bare = text.replace(/\?+$/, ""); // "What can I say?" is still the help command
  for (const [re, make] of RULES) {
    const m = text.match(re) || bare.match(re);
    if (m) return make(m) || null;
  }
  return text.endsWith("?") ? { cmd: "ask", arg: text } : null;
}
