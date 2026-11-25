export const THEMES = [
  { id: "light", name: "Pure White", description: "Crisp studio white with clean slate borders", bg: "#FFFFFF" },
  { id: "bluewhite", name: "Sky & Slate", description: "Airy coastal blue and crisp white surfaces", bg: "#F3F8FD" },
  { id: "greenpurple", name: "Mint & Lavender", description: "Soft botanical mint with pastel lavender glow", bg: "#F3F7F2" },
  { id: "dark", name: "Midnight Ink", description: "Deep charcoal surfaces easy on the eyes at night", bg: "#17151A" },
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
  try {
    localStorage.setItem("theme", found.id);
  } catch {}
}
