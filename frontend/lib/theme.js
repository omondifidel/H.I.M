export const THEMES = [
  { id: "light", name: "Pure White", description: "Crisp studio white with clean slate borders" },
  { id: "bluewhite", name: "Sky & Slate", description: "Airy coastal blue and crisp white surfaces" },
  { id: "greenpurple", name: "Mint & Lavender", description: "Soft botanical mint with pastel lavender glow" },
  { id: "dark", name: "Midnight Ink", description: "Deep charcoal surfaces easy on the eyes at night" },
];

export function getTheme() {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem("theme");
  return THEMES.some((t) => t.id === saved) ? saved : "light";
}

export function applyTheme(id) {
  if (typeof document === "undefined") return;
  const next = THEMES.some((t) => t.id === id) ? id : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {}
}
