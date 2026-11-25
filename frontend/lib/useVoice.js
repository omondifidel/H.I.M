// Voice control: tap the mic orb / press Ctrl+Space, or turn on hands-free and say "Hey Nasoma".
// The page decides what each command does. Kept identical in frontend/lib and frontend-stt/lib.
import { useEffect, useRef, useState } from "react";
import { afterWake, dictation, firstSentence, forgetLast, interpret, wakeParts, listen, parseCommand, sentence, speak, voiceSupported, wakeCommand } from "./voice";

/**
 * opts.pause()        stop playback, return true if it was playing (it resumes after the command)
 * opts.resume()       start playback again
 * opts.command(c)     run { cmd, arg }; return a short caption, or for "ask" the answer to speak
 * opts.dictate(text)  append one dictated sentence to the open note
 * opts.voice          optional { rate, voiceURI } for spoken answers
 */
const MIC_ERRORS = {
  "not-allowed": "Microphone blocked. Allow it in the browser's site settings.",
  "service-not-allowed": "Microphone blocked. Allow it in the browser's site settings.",
  "audio-capture": "No microphone found. Plug one in or check Windows sound settings.",
  network: "Couldn't reach the speech service. Check your internet and try again.",
  "no-speech": "I didn't hear anything. Tap the mic and speak right away.",
};

const FOLLOW_UP_MS = 8000; // like "Hey Google" continued conversation: no wake word needed right after a command

const HELP = "You can say: pause, resume, read faster or slower, go to page 12, go to minute 5, skip back 30 seconds, " +
  "next paragraph, bookmark this, read my bookmark, take me back, read that again, what page am I on, " +
  "switch to Mary, sleep in 20 minutes, dark, light or sepia mode, take a note, show my notes, search for a word or verse, " +
  "open a book, back to the library, or ask any question about what is open. Other wordings and Kiswahili work too, " +
  "and I remember new wordings. If I get one wrong, say forget that.";
// commands that start or stop playback themselves, so it must not be resumed afterwards
const PLAYBACK = new Set(["pause", "resume", "readBookmark", "repeat"]);

export function useVoice(opts) {
  const o = useRef(opts);
  o.current = opts;
  const [state, setStateRaw] = useState("idle"); // idle | wake | listen | dictate | think | speak
  const [caption, setCaption] = useState("");
  const [live, setLive] = useState(""); // words of the note being spoken right now
  const [handsFree, setHandsFreeRaw] = useState(false);
  const stateRef = useRef("idle");
  const handsFreeRef = useRef(false);
  const stopRef = useRef(null);
  const resumeRef = useRef(false);
  const silence = useRef(null);
  const wakeTimer = useRef(null);
  const wakeNext = useRef(null);
  const queued = useRef([]); // more commands said in the same breath, run one after another
  const followUntil = useRef(0); // just after a command, the next one works without "Hey Nasoma"
  const setState = (s) => { stateRef.current = s; setStateRaw(s); };

  function finish(msg) {
    clearTimeout(silence.current);
    stopRef.current = null;
    setLive("");
    setState("idle");
    if (msg) setCaption(msg);
    if (queued.current.length) return run(queued.current.shift()); // playback stays paused until the last one
    followUntil.current = Date.now() + FOLLOW_UP_MS;
    if (resumeRef.current) { resumeRef.current = false; o.current.resume(); }
    if (handsFreeRef.current) { clearTimeout(wakeTimer.current); wakeTimer.current = setTimeout(wake, 50); } // the mic stays open, so nothing said meanwhile is lost
  }

  /** Hands-free: listens in the background for "Hey Nasoma" (Chrome ends long sessions, so it restarts). */
  function wake() {
    if (!handsFreeRef.current || stateRef.current !== "idle") return;
    let ducked = false;
    setState("wake");
    const stop = listen({
      continuous: true,
      wake: true, // background listening: overlapping pieces, nothing held back on stop
      onInterim: (t) => {
        if (!ducked && afterWake(t) != null) { ducked = true; resumeRef.current = o.current.pause(); setCaption("Listening…"); }
      },
      onFinal: (t) => {
        if (stateRef.current !== "wake") return;
        if (afterWake(t) == null) {
          // No wake word. A plain known command right after the last one still counts ("next page");
          // otherwise say what was heard, so a wake word the speech service spelled oddly is visible.
          const plain = parseCommand(firstSentence(t));
          if (!plain || plain.cmd === "ask") return;
          if (Date.now() > followUntil.current) return setCaption(`Say “Hey Nasoma” first (heard “${firstSentence(t)}”)`);
          t = "hey nasoma " + t;
        }
        const [rest, ...more] = wakeParts(t);
        queued.current = more.filter(Boolean).map((m) => wakeCommand(m) || firstSentence(m));
        if (!ducked) { ducked = true; resumeRef.current = o.current.pause(); }
        setState("listen");
        const cmd = rest && wakeCommand(rest);
        // unusual wording goes to the AI; if even that fails, playback is paused, so listen for one cleanly
        const retry = () => { hear(); setCaption(`I can't do “${firstSentence(rest)}”. Say a command, or “what can I say?”`); };
        wakeNext.current = cmd ? () => run(cmd) : rest ? () => run(firstSentence(rest), "", retry) : hear;
        stopRef.current?.();
      },
      onEnd: (err) => {
        if (stopRef.current === stop) stopRef.current = null;
        const next = wakeNext.current;
        wakeNext.current = null;
        if (next) return next();
        if (stateRef.current !== "wake") return;
        setState("idle");
        if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") return setHandsFree(false, MIC_ERRORS[err]);
        if (ducked && resumeRef.current) { resumeRef.current = false; o.current.resume(); }
        clearTimeout(wakeTimer.current);
        wakeTimer.current = setTimeout(wake, err && err !== "no-speech" ? 3000 : 50); // back off on network errors
      },
    });
    stopRef.current = stop;
  }

  function setHandsFree(on, msg) {
    handsFreeRef.current = on;
    setHandsFreeRaw(on);
    if (!on) queued.current = [];
    try { localStorage.setItem("voice:handsfree", on ? "1" : "0"); } catch {}
    clearTimeout(wakeTimer.current);
    if (on && !voiceSupported()) return setHandsFree(false, "Voice control needs Chrome or Edge.");
    if (msg) setCaption(msg);
    else setCaption(on ? "Hands-free on: say “Hey Nasoma”, then a command." : "Hands-free off.");
    if (on) wake();
    else if (stateRef.current === "wake") { setState("idle"); stopRef.current?.(); }
  }

  /** Listens for one command (playback is already paused). */
  function hear() {
    let heard = "";
    setState("listen");
    setCaption("Listening…");
    stopRef.current = listen({ onInterim: setCaption, onFinal: (t) => { heard = t; }, onEnd: (err) => run(heard, err) });
  }

  function start() {
    if (!voiceSupported()) return setCaption("Voice control needs Chrome or Edge.");
    resumeRef.current = o.current.pause();
    hear();
  }

  async function run(text, err, orElse) {
    stopRef.current = null;
    if (!text) return finish(MIC_ERRORS[err] || "I didn't catch that. Try again.");
    text = afterWake(text) || text; // people often say the wake word even after tapping the mic
    let c = parseCommand(text);
    if (!c) {
      setState("think");
      setCaption(`“${text}” — working out what you mean…`);
      c = await interpret(text).catch(() => null);
    }
    if (!c) return orElse ? orElse() : finish(`I can't do “${text}” yet. Say “what can I say?” for the list.`);
    if (c.cmd === "help") {
      setState("speak");
      setCaption(HELP);
      await speak(HELP, o.current.voice);
      return finish();
    }
    if (PLAYBACK.has(c.cmd)) resumeRef.current = false;
    if (c.cmd === "handsfree") { finish(); return setHandsFree(c.arg); }
    if (c.cmd === "forget") {
      const k = forgetLast();
      return finish(k ? `Forgotten: “${k}”. Say it another way, or tap the mic.` : "There is nothing new I learned to forget.");
    }
    if (c.cmd === "ask") { setState("think"); setCaption(`“${c.arg}” — thinking…`); }
    try {
      const out = await o.current.command(c);
      if (c.cmd === "note") return dictate(c.arg);
      if (c.cmd === "ask") {
        setState("speak");
        setCaption(out);
        const talking = speak(out, o.current.voice);
        await (handsFreeRef.current ? bargeIn(talking) : talking);
        return finish();
      }
      finish(out || text);
    } catch (e) {
      finish(e.message || "Something went wrong.");
    }
  }

  /** Hands-free: while an answer is spoken, "Hey Nasoma" (e.g. "Hey Nasoma, stop") cuts it off. */
  function bargeIn(talking) {
    return new Promise((done) => {
      const stop = listen({
        continuous: true,
        wake: true, // background listening: overlapping pieces, nothing held back on stop
        onFinal: (t) => { if (afterWake(t) != null) window.speechSynthesis.cancel(); },
        onEnd: () => done(),
      });
      stopRef.current = stop;
      talking.then(() => stop());
    });
  }

  function dictate(first) {
    const add = (t) => { const s = sentence(t); if (s) o.current.dictate(s); };
    const idle = () => { clearTimeout(silence.current); silence.current = setTimeout(() => stopRef.current?.(), 8000); };
    add(first);
    setState("dictate");
    setCaption("Taking notes… say “stop note” or tap the mic when done.");
    idle();
    stopRef.current = listen({
      continuous: true,
      onInterim: (t) => { setLive(t); idle(); },
      onFinal: (t) => {
        idle();
        setLive("");
        const d = dictation(t);
        add(d.text);
        if (d.stop) stopRef.current?.();
      },
      onEnd: () => finish("Note saved."),
    });
  }

  function toggle() {
    const s = stateRef.current;
    if (s === "idle") start();
    else if (s === "wake") { wakeNext.current = start; setState("idle"); stopRef.current?.(); }
    else if (s === "speak") window.speechSynthesis.cancel();
    else if (s === "listen" || s === "dictate") stopRef.current?.();
  }

  const latest = useRef({});
  latest.current = { toggle, setHandsFree };
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.code === "Space") { e.preventDefault(); latest.current.toggle(); }
    };
    window.addEventListener("keydown", onKey);
    let saved = false;
    try { saved = localStorage.getItem("voice:handsfree") === "1"; } catch {}
    if (saved) latest.current.setHandsFree(true);
    return () => {
      window.removeEventListener("keydown", onKey);
      handsFreeRef.current = false;
      stateRef.current = "idle";
      stopRef.current?.();
      clearTimeout(silence.current);
      clearTimeout(wakeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (state !== "idle" || !caption) return;
    const t = setTimeout(() => setCaption(""), 7000);
    return () => clearTimeout(t);
  }, [state, caption]);

  return { state, caption, live, handsFree, toggle, setHandsFree: (on) => setHandsFree(on) };
}
