// Run: node frontend/lib/findPara.check.mjs
import assert from "node:assert/strict";
import { findParagraph } from "./findPara.js";

const page = [
  "Chapter 1: Starting a small garden.",
  "Faith, they say, moves mountains; patience moves gardens.",
  "Water the basil and mint in the morning. Faith grows like mint.",
  "Mountains of compost help, too.",
];
assert.equal(findParagraph(page, "faith moves mountains"), 1); // not word for word here, but it has all three words
assert.equal(findParagraph(page, "patience moves gardens"), 1); // exact phrase
assert.equal(findParagraph(page, "basil mint morning"), 2); // most of the topic words
assert.equal(findParagraph(page, "John 3 16"), -1); // not on this page: stay at the top
assert.equal(findParagraph(page, ""), -1);
assert.equal(findParagraph(["Imani inahamisha milima, amen."], "imani inahamisha"), 0); // Kiswahili
console.log("findPara.js: all checks passed");
