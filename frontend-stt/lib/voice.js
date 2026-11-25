// Hands-free voice control: browser speech recognition, command parsing and spoken answers.
// Kept identical in frontend/lib and frontend-stt/lib. Check: node frontend/lib/voice.check.mjs

const Recognition = () => typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
const canRecord = () => typeof window !== "undefined" && !!(navigator.mediaDevices && window.MediaRecorder);
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
const QUIET_MS = 1200;      // this much silence ends a phrase

/** Whisper path: records each spoken phrase (split on silence) and turns it into text on the server.
 *  maxMs cuts a phrase that never goes quiet, e.g. the book being read aloud while you talk over it. */
function record({ onInterim, onFinal, onEnd, continuous = false, maxMs = 30000 }) {
  let stopped = false, ended = false, stream = null, audio = null;
  const end = (err) => {
    if (ended) return;
    ended = true;
    stream?.getTracks().forEach((t) => t.stop());
    audio?.close().catch(() => {});
    onEnd(err);
  };
  (async () => {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {
      return end(e.name === "NotFoundError" ? "audio-capture" : "not-allowed");
    }
    audio = new AudioContext();
    const meter = audio.createAnalyser();
    audio.createMediaStreamSource(stream).connect(meter);
    const buf = new Uint8Array(meter.fftSize);
    const level = () => { meter.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += (v - 128) ** 2; return Math.sqrt(s / buf.length); };

    // Records until a pause after speech. Resolves with the clip, or null if nobody spoke.
    const phrase = () => new Promise((resolve) => {
      const chunks = [], rec = new MediaRecorder(stream), t0 = performance.now();
      let spoke = false, lastLoud = t0;
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => resolve(spoke ? new Blob(chunks, { type: rec.mimeType }) : null);
      rec.start();
      const tick = () => {
        const now = performance.now();
        if (level() > MIC_LEVEL) { lastLoud = now; if (!spoke) { spoke = true; onInterim?.("…"); } }
        if (stopped || (spoke && now - lastLoud > QUIET_MS) || now - t0 > maxMs || (!continuous && !spoke && now - t0 > 7000)) rec.stop();
        else setTimeout(tick, 100);
      };
      tick();
    });

    let heard = false;
    do {
      const clip = await phrase();
      if (!clip) continue;
      const form = new FormData();
      form.append("file", clip, "speech.webm");
      try {
        const { api } = await import("./api"); // browser only; keeps this file runnable in node for the checks
        const { text } = await api("/api/assistant/listen", { method: "POST", form });
        if (text) { heard = true; onFinal(text); }
      } catch {
        return end("network");
      }
    } while (continuous && !stopped);
    end(heard || stopped ? "" : "no-speech");
  })();
  return () => { stopped = true; };
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
export function afterWake(t) {
  const m = t.match(/\b(?:hey|hi|okay|ok)[\s,]+(?:na ?soma|nasomo|assistant)\b[\s,.!]*(.*)$/i);
  return m ? m[1].trim() : null;
}

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
