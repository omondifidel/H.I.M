// Which paragraph on a page matches what was searched, so a search result opens right there.
// Check: node frontend/lib/findPara.check.mjs

const norm = (s) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** Index of the paragraph that best matches `find` (the exact phrase wins, else the most of its words), or -1. */
export function findParagraph(paras, find) {
  const want = norm(find || "");
  const words = [...new Set(want.split(" ").filter((w) => w.length > 2))];
  if (!words.length) return -1;
  let best = -1, bestScore = 0;
  paras.forEach((p, i) => {
    const text = norm(p);
    const score = text.includes(want) ? 1000 : words.filter((w) => text.includes(` ${w} `)).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}
