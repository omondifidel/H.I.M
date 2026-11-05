let pdfjsPromise;
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/build/pdf").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
      return m;
    });
  }
  return pdfjsPromise;
}

/** Turns one PDF page into an array of paragraph strings (page numbers and headers dropped). */
export async function extractParagraphs(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const [, y0, , y1] = page.view;
  const height = y1 - y0;
  const { items } = await page.getTextContent();

  const lines = [];
  let cur = null;
  for (const it of items) {
    if (!("str" in it)) continue;
    const y = it.transform[5];
    const size = Math.abs(it.transform[3]) || it.height || 10;
    if (!cur || Math.abs(cur.y - y) > size * 0.5) {
      cur = { y, size, text: "" };
      lines.push(cur);
    }
    cur.text += it.str;
  }

  const clean = lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text);

  const isEdge = (l) => {
    const rel = (l.y - y0) / height;
    return (rel < 0.06 || rel > 0.94) && (l.text.length < 50 || /^\d+$/.test(l.text));
  };
  const body = clean.filter((l) => !isEdge(l));

  const gaps = [];
  for (let i = 1; i < body.length; i++) {
    const g = body[i - 1].y - body[i].y;
    if (g > 0) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12;

  const paras = [];
  let buf = "";
  const flush = () => {
    if (buf.trim().length > 1) paras.push(buf.trim());
    buf = "";
  };
  body.forEach((l, i) => {
    if (i > 0) {
      const prev = body[i - 1];
      const gap = prev.y - l.y;
      if (gap > median * 1.45 || gap < 0 || Math.abs(l.size - prev.size) > 1.5) flush();
    }
    if (buf.endsWith("-")) buf = buf.slice(0, -1) + l.text;
    else buf += (buf ? " " : "") + l.text;
  });
  flush();
  return paras;
}
