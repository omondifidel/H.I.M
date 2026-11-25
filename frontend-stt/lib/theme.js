export const THEMES = [
  { id: "light", name: "Pure White", bg: "#FFFFFF" },
  { id: "bluewhite", name: "Sky & Slate", bg: "#F3F8FD" },
  { id: "greenpurple", name: "Mint & Lavender", bg: "#F3F7F2" },
  { id: "dark", name: "Midnight Ink", bg: "#17151A" },
  { id: "sepia", name: "Sepia Page", bg: "#F4ECD8" },
];

export function getTheme() {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem("theme");
  return THEMES.some((t) => t.id === saved) ? saved : "light";
}

export function applyTheme(id) {
  if (typeof document === "undefined") return;
  const found = THEMES.find((t) => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = found.id;
  document.documentElement.style.colorScheme = found.id === "dark" ? "dark" : "only light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", found.bg);
  try { localStorage.setItem("theme", found.id); } catch {}
}
