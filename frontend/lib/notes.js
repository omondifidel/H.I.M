import { api } from "./api";
import { idbAll, idbClear, idbDel, idbGet, idbPut } from "./db";

export function newNoteId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}

/** Live (not deleted) notes of one PDF, ordered by page then paragraph. */
export async function listNotes(docId) {
  const all = await idbAll("notes");
  return all
    .filter((n) => n.document_id === docId && !n.deleted)
    .sort((a, b) => a.page - b.page || (a.paragraph ?? -1) - (b.paragraph ?? -1) || a.updated_at.localeCompare(b.updated_at));
}

/** Save locally first (works offline). `dirty` means "not yet sent to the server". */
export async function putNote(note) {
  await idbPut("notes", note.id, { ...note, dirty: true });
}

export async function removeNote(id) {
  const n = await idbGet("notes", id);
  if (!n) return;
  await idbPut("notes", id, { ...n, deleted: true, updated_at: new Date().toISOString(), dirty: true });
}

export async function clearLocalNotes() {
  await idbClear("notes");
  localStorage.removeItem("notes:since");
}

let inflight = null;
export function syncNotes() {
  if (!inflight) inflight = doSync().finally(() => { inflight = null; });
  return inflight;
}

async function doSync() {
  try {
    // 1. push local changes
    const all = await idbAll("notes");
    for (const n of all.filter((x) => x.dirty)) {
      try {
        await api(`/api/notes/${n.id}`, {
          method: "PUT",
          body: { document_id: n.document_id, page: n.page, paragraph: n.paragraph, body: n.body, updated_at: n.updated_at, deleted: n.deleted },
        });
        const cur = await idbGet("notes", n.id);
        if (cur && cur.updated_at === n.updated_at) await idbPut("notes", n.id, { ...cur, dirty: false });
      } catch (e) {
        if (e.status === 404) await idbDel("notes", n.id); // its PDF no longer exists on the server
        else throw e;
      }
    }
    // 2. pull changes made elsewhere (newer edit wins)
    const since = localStorage.getItem("notes:since");
    const remote = await api("/api/notes" + (since ? `?since=${encodeURIComponent(since)}` : ""));
    let maxMs = 0;
    for (const r of remote) {
      const rMs = new Date(r.updated_at).getTime();
      if (rMs > maxMs) maxMs = rMs;
      const cur = await idbGet("notes", r.id);
      if (!cur || (!cur.dirty && rMs > new Date(cur.updated_at).getTime())) {
        await idbPut("notes", r.id, { ...r, dirty: false });
      }
    }
    // small safety margin because devices' clocks can differ a little
    if (maxMs) localStorage.setItem("notes:since", new Date(maxMs - 10 * 60 * 1000).toISOString());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
