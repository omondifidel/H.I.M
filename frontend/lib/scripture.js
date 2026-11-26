// Finds Bible references in book and sermon text: "John 3:16", "Heb. 11:1-3", "1 Cor 13:4", "Psalm 23",
// and the spoken form in transcripts, "John chapter 3 verse 16". Returns where each one is and a clean
// reference for the verse lookup. Abbreviations need a verse ("Is 53:5"), so "Job 5" or "Mark 2" in plain
// prose are left alone; full book names may stand with a chapter only ("Psalm 23"), unless the name
// is also an everyday word (Job, Mark, Acts...).

// [canonical name, other ways people write it]
const BOOKS = [
  ["Genesis", "Gen", "Ge", "Gn"], ["Exodus", "Exod", "Exo", "Ex"], ["Leviticus", "Lev", "Lv"], ["Numbers", "Num", "Nm"],
  ["Deuteronomy", "Deut", "Dt"], ["Joshua", "Josh", "Jos"], ["Judges", "Judg", "Jdg"], ["Ruth", "Rth"],
  ["Samuel", "Sam", "Sa"], ["Kings", "Kgs", "Ki"], ["Chronicles", "Chron", "Chr"], ["Ezra", "Ezr"],
  ["Nehemiah", "Neh"], ["Esther", "Esth", "Est"], ["Job", "Jb"], ["Psalms", "Psalm", "Pss", "Psa", "Ps"],
  ["Proverbs", "Prov", "Prv", "Pr"], ["Ecclesiastes", "Eccles", "Eccl", "Ecc"],
  ["Song of Solomon", "Song of Songs", "Song"], ["Isaiah", "Isa", "Is"], ["Jeremiah", "Jer"],
  ["Lamentations", "Lam"], ["Ezekiel", "Ezek", "Eze"], ["Daniel", "Dan", "Dn"], ["Hosea", "Hos"], ["Joel", "Jl"],
  ["Amos", "Am"], ["Obadiah", "Obad", "Ob"], ["Jonah", "Jnh"], ["Micah", "Mic"], ["Nahum", "Nah"],
  ["Habakkuk", "Hab"], ["Zephaniah", "Zeph", "Zep"], ["Haggai", "Hag"], ["Zechariah", "Zech", "Zec"],
  ["Malachi", "Mal"], ["Matthew", "Matt", "Mt"], ["Mark", "Mrk", "Mk"], ["Luke", "Lk"], ["John", "Jhn", "Jn"],
  ["Acts", "Ac"], ["Romans", "Rom", "Rm"], ["Corinthians", "Cor"], ["Galatians", "Gal"],
  ["Ephesians", "Ephes", "Eph"], ["Philippians", "Phil", "Php"], ["Colossians", "Col"],
  ["Thessalonians", "Thess", "Thes"], ["Timothy", "Tim"], ["Titus", "Tit"], ["Philemon", "Philem", "Phm"],
  ["Hebrews", "Heb"], ["James", "Jas"], ["Peter", "Pet", "Pt"], ["Jude", "Jud"], ["Revelation", "Revelations", "Rev"],
];
const NEEDS_NUMBER = new Set(["Samuel", "Kings", "Chronicles", "Corinthians", "Thessalonians", "Timothy", "Peter"]);
const FULL = new Set(["Psalm", "Song of Songs", "Revelations"]); // also count as full names
const EVERYDAY = new Set(["Job", "Mark", "Acts", "Numbers", "Judges"]); // also plain words: need a verse
const CANON = new Map();
for (const [name, ...alts] of BOOKS) for (const a of [name, ...alts]) CANON.set(a.toLowerCase(), name);
const ORDINAL = { i: 1, ii: 2, iii: 3, first: 1, second: 2, third: 3, "1st": 1, "2nd": 2, "3rd": 3, 1: 1, 2: 2, 3: 3 };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
const names = [...CANON.keys()].sort((a, b) => b.length - a.length).map(esc).join("|");
const RE = new RegExp(
  "(?<![A-Za-z0-9])(?:(1st|2nd|3rd|1|2|3|III|II|I|First|Second|Third)\\s*)?" + // 1 John, II Kings
  `(${names})\\.?` +
  "\\s+(?:chapter\\s+)?(\\d{1,3})" +
  "(?:(?:\\s*:\\s*|\\s*,?\\s+verses?\\s+|\\s+v{1,2}\\.?\\s*)(\\d{1,3}))?" + // 3:16 | chapter 3 verse 16
  "(?:\\s*[-–]\\s*(\\d{1,3})(?:\\s*:\\s*(\\d{1,3}))?)?" + // 16-18 | 16–4:2
  "(?![\\d:])",
  "gi",
);

export function findRefs(text) {
  const out = [];
  if (!text) return out;
  for (const m of text.matchAll(RE)) {
    const [whole, pre, alias, ch, verse, to, toVerse] = m;
    const typed = alias.replace(/\s+/g, " ");
    const name = CANON.get(typed.toLowerCase());
    if (typed[0] !== typed[0].toUpperCase()) continue; // "mark 2" in a sentence is not Mark 2
    const isFull = typed.toLowerCase() === name.toLowerCase() || FULL.has(typed);
    if (!verse && (!isFull || EVERYDAY.has(name))) continue; // abbreviations only with a verse
    const n = pre ? ORDINAL[pre.toLowerCase()] : 0;
    if (NEEDS_NUMBER.has(name) && !n) continue;
    if (n && !NEEDS_NUMBER.has(name) && name !== "John") continue; // "2 Romans" is not a book
    if (+ch < 1 || +ch > 150 || (name === "Psalms" ? false : +ch > 66 && !verse)) continue;
    const book = (n ? n + " " : "") + name;
    let ref = `${book} ${+ch}${verse ? ":" + +verse : ""}`;
    if (to) ref += toVerse ? `-${+to}:${+toVerse}` : `-${+to}`;
    out.push({ start: m.index, end: m.index + whole.length, ref, text: whole });
  }
  return out;
}

/** Splits text into plain strings and {ref, text} pieces, in order. */
export function splitRefs(text) {
  const parts = [];
  let at = 0;
  for (const r of findRefs(text)) {
    if (r.start > at) parts.push(text.slice(at, r.start));
    parts.push(r);
    at = r.end;
  }
  if (at < (text || "").length) parts.push(text.slice(at));
  return parts;
}
