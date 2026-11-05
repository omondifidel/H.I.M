// Copies the PDF.js worker into /public so it is served locally (works offline).
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.js");
const dst = path.join(__dirname, "..", "public", "pdf.worker.min.js");
if (fs.existsSync(src)) { fs.copyFileSync(src, dst); console.log("PDF.js worker copied."); }
else console.warn("pdf.worker.min.js not found; run npm install again.");
