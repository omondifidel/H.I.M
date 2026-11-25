// Run: node frontend/lib/voice.check.mjs
import assert from "node:assert/strict";
import { afterWake, dictation, nextRate, parseCommand as p, sentence, toNumber, wakeCommand, firstSentence } from "./voice.js";

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
console.log("voice.js: all checks passed");
