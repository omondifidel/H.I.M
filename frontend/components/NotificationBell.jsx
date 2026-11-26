"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

const KIND_META = {
  announcement: { label: "Announcement", cls: "k-ann" },
  new_book: { label: "New Book", cls: "k-book" },
  system: { label: "System", cls: "k-sys" },
  reminder: { label: "Reminder", cls: "k-rem" },
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState("all");
  const wrapRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api("/api/notifications");
      setItems(res.items || []);
      setUnread(res.unread || 0);
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function markOne(item) {
    if (!item.read) {
      setItems((list) => list.map((x) => (x.id === item.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      api(`/api/notifications/${item.id}/read`, { method: "POST" }).catch(() => {});
    }
    if (item.link) window.location.href = item.link;
  }

  async function markAll() {
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    setUnread(0);
    api("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-btn"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        onClick={() => { const next = !open; setOpen(next); if (next) refresh(); }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="notif-pop" role="dialog" aria-label="Notification center">
          <div className="notif-head">
            <b>Notifications</b>
            {unread > 0 && <button type="button" className="notif-clear" onClick={markAll}>Mark all read</button>}
          </div>
          <div className="notif-filters">
            {[["all", "All"], ["announcement", "Announcements"], ["new_book", "Books"], ["system", "System"], ["reminder", "Reminders"]].map(([k, lbl]) => (
              <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{lbl}</button>
            ))}
          </div>
          <div className="notif-list">
            {shown.length === 0 && <div className="muted sm" style={{ padding: "22px 12px", textAlign: "center" }}>No notifications here yet.</div>}
            {shown.map((n) => {
              const meta = KIND_META[n.kind] || KIND_META.announcement;
              return (
                <button key={n.id} type="button" className={"notif-item" + (n.read ? "" : " unread")} onClick={() => markOne(n)}>
                  <div className="notif-item-top">
                    <span className={"notif-kind " + meta.cls}>{meta.label}</span>
                    <span className="muted sm">{new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  </div>
                  <b>{n.title}</b>
                  {n.body && <p>{n.body}</p>}
                </button>
              );
            })}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
