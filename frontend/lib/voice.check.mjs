// Run: node frontend/lib/voice.check.mjs
import assert from "node:assert/strict";
import { afterWake, dictation, nextRate, parseCommand as p, sentence, toNumber, wakeCommand, firstSentence, makeCutter, wakeParts } from "./voice.js";
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
  "play from the last bookmark": { cmd: "lastNote" },
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
