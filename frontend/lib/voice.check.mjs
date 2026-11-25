// Run: node frontend/lib/voice.check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterWake, dictation, nextRate, parseCommand as p, sentence, toNumber, wakeCommand, firstSentence, makeCutter, wakeParts, phraseKey, interpret, forgetLast, LAST_PAGE } from "./voice.js";

// ---- coverage: every action the AI may choose has a quick phrase and is handled somewhere in the app ----
const EXAMPLE = {
  pause: "pause", resume: "resume", rate: "read faster", page: "go to page 4", minute: "go to minute 5", skip: "skip back 30 seconds",
  paragraph: "next paragraph", turn: "next page", bookmark: "bookmark this", readBookmark: "read my bookmark", back: "take me back",
  repeat: "read that again", theme: "sepia mode", note: "take a note", notes: "show my notes", lastNote: "go to my last note",
  deleteNote: "delete that note", handsfree: "stop listening", voice: "switch to Mary", sleep: "sleep in 20 minutes",
  highlight: "turn highlighting off", where: "what page am I on", home: "back to the library", search: "search for faith moves mountains",
  openBook: "open the book Garden Notes", undo: "undo", save: "save", export: "download the transcript", nextCheck: "next uncertain word",
  help: "what can I say", ask: "what did he say about grace?",
};
const root = new URL("../../", import.meta.url);
const actions = [...readFileSync(new URL("backend/app/modules/assistant/router.py", root), "utf8").match(/COMMANDS = """([\s\S]*?)"""/)[1]
  .matchAll(/^(\w+):/gm)].map((m) => m[1]);
const handled = ["frontend/app/reader/page.jsx", "frontend-stt/app/editor/page.jsx", "frontend/lib/useVoice.js"]
  .map((f) => readFileSync(new URL(f, root), "utf8")).join("\n");
for (const a of actions) {
  assert.ok(EXAMPLE[a], `action "${a}" has no example phrase here`);
  assert.equal(p(EXAMPLE[a])?.cmd, a, `"${EXAMPLE[a]}" should be ${a}`);
  assert.ok(handled.includes(`"${a}"`), `action "${a}" is not handled by the reader, the editor or useVoice`);
}
// the new actions, a few more wordings each
assert.deepEqual(p("what page am I on?"), { cmd: "where" });
assert.deepEqual(p("go to the last page"), { cmd: "page", arg: LAST_PAGE });
assert.deepEqual(p("beginning of the book"), { cmd: "page", arg: 1 });
assert.deepEqual(p("let Brian read"), { cmd: "voice", arg: "brian" });
assert.deepEqual(p("cancel the sleep timer"), { cmd: "sleep", arg: 0 });
assert.deepEqual(p("stop reading in ten minutes"), { cmd: "sleep", arg: 10 });
assert.deepEqual(p("find me the sermon where the words faith moves mountains were said"), { cmd: "search", arg: "the sermon where the words faith moves mountains were said" });
// polite requests are requests, not questions about the book
assert.deepEqual(p("Could you take me back?"), { cmd: "back" });
assert.deepEqual(p("can you read faster please"), { cmd: "rate", arg: "+" });
assert.equal(p("Could you go back to the part I saved earlier?"), null); // no quick phrase: the AI decides
assert.deepEqual(p("Can I ask what he said about faith?"), { cmd: "ask", arg: "Can I ask what he said about faith?" });

// memory commands
for (const s of ["reread the bookmarked paragraph", "Read my bookmark.", "read from my bookmark", "go to the bookmark",
  "play the bookmarked part again", "read my last bookmark", "take me to my bookmark"]) assert.deepEqual(p(s), { cmd: "readBookmark" }, s);
for (const s of ["take me back", "Where was I?", "back to where I was", "go back to where I was"]) assert.deepEqual(p(s), { cmd: "back" }, s);
for (const s of ["repeat", "read that again", "repeat that paragraph", "one more time", "say it again"]) assert.deepEqual(p(s), { cmd: "repeat" }, s);
assert.deepEqual(p("bookmark this paragraph"), { cmd: "bookmark" }); // still saves a bookmark
assert.deepEqual(p("go back"), { cmd: "skip", arg: -10 }); // still skips back
assert.deepEqual(p("forget that"), { cmd: "forget" });
// learning: polite words don't matter, and a learned phrase is answered without asking the server
assert.equal(phraseKey("Please, could you reread the bookmarked paragraph?"), "reread the bookmarked paragraph");
const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
store["voice:learned"] = JSON.stringify({ "bump the speed up a little": { cmd: "rate", arg: "+" } });
assert.deepEqual(await interpret("Can you bump the speed up a little, please"), { cmd: "rate", arg: "+" });
assert.equal(forgetLast(), "bump the speed up a little");
assert.equal(JSON.parse(store["voice:learned"])["bump the speed up a little"], undefined);
assert.equal(forgetLast(), null);
assert.deepEqual(wakeParts("Hey Nasoma, go to page 3. Hey Nasoma, sepia mode."), ["go to page 3.", "sepia mode."]);
assert.deepEqual(wakeParts("the garden grows hey nasoma pause"), ["pause"]);
assert.deepEqual(wakeParts("no wake word here"), []);
// the wake word as speech-to-text really writes it
for (const [said, rest] of [["Hey Nesoma, pause.", "pause."], ["Hi Nasuma go to page 3", "go to page 3"], ["Hey, Na Soma. Read faster.", "Read faster."],
  ["Nasoma, next page", "next page"], ["Hey Masoma sepia mode", "sepia mode"], ["Okay Nasomah, pause", "pause"], ["hey assistant pause", "pause"]]) {
  assert.equal(afterWake(said), rest, said);
}
for (const said of ["NASA launched a rocket", "hey there", "the season of Panama", "Osama", "and the garden grows", "Hey Sam, pause"]) {
  assert.equal(afterWake(said), null, said);
}
assert.deepEqual(wakeParts("Hey Nesoma, sepia mode. Hi Nasuma, go to page 2."), ["sepia mode.", "go to page 2."]);

const cases = {
  "Pause": { cmd: "pause" },
  "stop reading": { cmd: "pause" },
  "Resume.": { cmd: "resume" },
  "read faster": { cmd: "rate", arg: "+" },
  "slow down": { cmd: "rate", arg: "-" },
  "read faster 1.25x": { cmd: "rate", arg: 1.25 },
  "set the speed to 1.5": { cmd: "rate", arg: 1.5 },
  "Go to page 42.": { cmd: "page", arg: 42 },
  "go to page forty two": { cmd: "page", arg: 42 },
  "page two hundred and five": { cmd: "page", arg: 205 },
  "go to minute 5": { cmd: "minute", arg: 5 },
  "Bookmark this paragraph": { cmd: "bookmark" },
  "switch to sepia mode": { cmd: "theme", arg: "sepia" },
  "dark mode": { cmd: "theme", arg: "dark" },
  "Open notes and write faith comes by hearing": { cmd: "note", arg: "faith comes by hearing" },
  "take a note": { cmd: "note", arg: "" },
  "Open notes, and write faith comes by hearing.": { cmd: "note", arg: "faith comes by hearing" },
  "What did Sir Elvin say about faith in this message": { cmd: "ask", arg: "What did Sir Elvin say about faith in this message" },
  "ask summarize this page": { cmd: "ask", arg: "summarize this page" },
  "is this about grace?": { cmd: "ask", arg: "is this about grace?" },
  "Stop listening": { cmd: "handsfree", arg: false },
  "turn hands-free off": { cmd: "handsfree", arg: false },
  "hands free on": { cmd: "handsfree", arg: true },
  "show my notes": { cmd: "notes", arg: true },
  "close notes": { cmd: "notes", arg: false },
  "go to my last note": { cmd: "lastNote" },
  "play from the last bookmark": { cmd: "readBookmark" },
  "delete that note": { cmd: "deleteNote" },
  "next paragraph": { cmd: "paragraph", arg: 1 },
  "previous paragraph": { cmd: "paragraph", arg: -1 },
  "next page": { cmd: "turn", arg: 1 },
  "previous page": { cmd: "turn", arg: -1 },
  "skip forward 30 seconds": { cmd: "skip", arg: 30 },
  "go back": { cmd: "skip", arg: -10 },
  "rewind": { cmd: "skip", arg: -10 },
  "skip back ten seconds": { cmd: "skip", arg: -10 },
  "banana bread": null,
  "go to page potato": null,
};
for (const [say, want] of Object.entries(cases)) assert.deepEqual(p(say), want, say);

assert.equal(toNumber("ninety nine"), 99);
assert.equal(nextRate(1, "+"), 1.25);
assert.equal(nextRate(2, "+", 2), 2);
assert.equal(nextRate(0.5, "-"), 0.5);
assert.equal(sentence("grace is enough"), "Grace is enough.");
assert.deepEqual(dictation("and that is all stop note"), { text: "and that is all", stop: true });
assert.deepEqual(dictation("keep going"), { text: "keep going", stop: false });
assert.equal(afterWake("Hey Nasoma"), "");
assert.equal(afterWake("okay, na soma pause"), "pause");
assert.equal(afterWake("the garden needs water hey assistant go to page 4"), "go to page 4");
assert.equal(afterWake("hey there"), null);
// a command said over the book being read aloud: the reading that follows must not spoil it
assert.equal(wakeCommand("pause. Choose a spot with good soil"), "pause");
assert.equal(wakeCommand("read at 1.25x. The garden needs"), "read at 1.25x");
assert.equal(wakeCommand("what did he say about faith? Choose a spot"), "what did he say about faith");
assert.equal(wakeCommand("go to page 2"), "go to page 2");
assert.equal(wakeCommand("choose a spot with good soil"), null); // nothing usable: listen again
assert.deepEqual(p("What can I say?"), { cmd: "help" });
assert.deepEqual(p("help"), { cmd: "help" });
assert.equal(firstSentence("bump the speed up. Choose a spot"), "bump the speed up");
assert.equal(firstSentence("read at 1.25x"), "read at 1.25x");
// the phrase cutter (10 chunks a second): where recordings start and end
const run = (opts, levels) => { const c = makeCutter({ perS: 10, ...opts }), out = []; levels.forEach((v, i) => { const r = c.push(i + (opts.start || 0), v); if (r) out.push(r); }); return out; };
const loud = (n) => Array(n).fill(50), quiet = (n) => Array(n).fill(0);
// a phrase, then silence: one piece, with a little audio from before it
assert.deepEqual(run({ start: 0, continuous: true }, [...quiet(20), ...loud(15), ...quiet(20)]), [[16, 47]]);
// said before this listener started (backlog, live from chunk 50) still counts
assert.deepEqual(run({ start: 0, live: 50, continuous: false }, [...quiet(10), ...loud(10), ...quiet(20)]), [[6, 32]]);
// command mode gives up after 7 s of live silence
assert.equal(run({ start: 0, continuous: false }, quiet(80))[0], "no-speech");
// reading aloud never goes quiet: overlapping pieces, so any 2.5 s (a "Hey Nasoma ...") fits whole in one of them
const pieces = run({ start: 0, continuous: true, wake: true }, loud(300));
assert.ok(pieces.length >= 6);
for (let a = 0; a + 25 <= Math.max(...pieces.map((p) => p[1])); a++) assert.ok(pieces.some(([f, t]) => f <= a && a + 25 <= t), `span at ${a} is split`);
console.log("voice.js: all checks passed");
