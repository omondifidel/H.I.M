// Run: node frontend/lib/scripture.check.mjs
import assert from "node:assert/strict";
import { findRefs, splitRefs } from "./scripture.js";

const refs = (t) => findRefs(t).map((r) => r.ref);

assert.deepEqual(refs("For God so loved the world (John 3:16)."), ["John 3:16"]);
assert.deepEqual(refs("Faith is the substance, Heb. 11:1-3, and 1 Cor 13:4–7 says love is patient."),
  ["Hebrews 11:1-3", "1 Corinthians 13:4-7"]);
assert.deepEqual(refs("Read Psalm 23 tonight, then Ps 91:1 and II Kings 2:9."), ["Psalms 23", "Psalms 91:1", "2 Kings 2:9"]);
assert.deepEqual(refs("turn with me to John chapter 3 verse 16, and Romans 8 verse 28"), ["John 3:16", "Romans 8:28"]);
assert.deepEqual(refs("First John 4:8 and 1 John 1:9; Song of Solomon 2:4; Rev 12:11"),
  ["1 John 4:8", "1 John 1:9", "Song of Solomon 2:4", "Revelation 12:11"]);
assert.deepEqual(refs("Isaiah 53:5 and Is 53:5 and Gen 1:1-2:3"), ["Isaiah 53:5", "Isaiah 53:5", "Genesis 1:1-2:3"]);

// prose that only looks like scripture
assert.deepEqual(refs("mark 2 boxes, Job 5 was hard, Am 3 here, Is 4 enough? Acts 2 at 10:30"), []);
assert.deepEqual(refs("Acts 2:38 and Job 1:21"), ["Acts 2:38", "Job 1:21"]);
assert.deepEqual(refs("Corinthians 13 needs a number; 2 Romans 3:1 is not a book"), []);
assert.deepEqual(refs("page 12:30 and 3:16"), []);

const parts = splitRefs("See John 3:16 now");
assert.equal(parts.length, 3);
assert.equal(parts[0], "See ");
assert.equal(parts[1].ref, "John 3:16");
assert.equal(parts[2], " now");
console.log("scripture checks passed");
