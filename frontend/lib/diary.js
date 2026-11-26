// Writes into the Diary (components/DiaryWorkspace.jsx), which keeps everything in this browser under one key
// per person. The reader and sermon pages use this for reflections (journal) and saved highlights (notes).
import { getUser } from "./api";

const key = () => `him:diary:v1:${getUser()?.email || "reader"}`;
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function update(change) {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(key()) || "{}") || {}; } catch {}
  change(data);
  localStorage.setItem(key(), JSON.stringify(data)); // the Diary merges this over its defaults when it opens
}

/** A reflection or written answer in the Diary's Journal. */
export function addJournal({ title, body, mood = "focused" }) {
  update((d) => { d.journal = [{ id: id(), title, mood, body, createdAt: new Date().toISOString() }, ...(d.journal || [])]; });
}

/** A highlight or quick thought in the Diary's sticky Notes. */
export function addDiaryNote({ title, body, tone = "sky" }) {
  update((d) => { d.notes = [{ id: id(), title, body, tone, pinned: false, updatedAt: new Date().toISOString() }, ...(d.notes || [])]; });
}

// ---- the verse vault (verses you saved from scripture popovers, for memorising) ----
const VERSES = "him:verses:v1";
export function savedVerses() {
  try { return JSON.parse(localStorage.getItem(VERSES) || "[]"); } catch { return []; }
}
export function saveVerse(v) {
  const list = savedVerses().filter((x) => x.reference !== v.reference);
  localStorage.setItem(VERSES, JSON.stringify([{ ...v, savedAt: new Date().toISOString(), level: 0 }, ...list].slice(0, 200)));
}
export function updateVerse(reference, patch) {
  localStorage.setItem(VERSES, JSON.stringify(savedVerses().map((v) => (v.reference === reference ? { ...v, ...patch } : v))));
}
export function removeVerse(reference) {
  localStorage.setItem(VERSES, JSON.stringify(savedVerses().filter((v) => v.reference !== reference)));
}
