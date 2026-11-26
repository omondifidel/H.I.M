export const THEMES = [
  { id: "bluewhite", name: "Sky & Slate", description: "Airy coastal blue and crisp white surfaces", bg: "#F3F8FD" },
  { id: "greenpurple", name: "Mint & Lavender", description: "Soft botanical mint with pastel lavender glow", bg: "#F3F7F2" },
  { id: "sepia", name: "Warm Parchment", description: "Soft cream and warm paper tones for long reading", bg: "#FAF6F0" },
  { id: "olive", name: "Olive Grove", description: "Earthy sage and botanical forest greens", bg: "#F3F6F1" },
  { id: "dark", name: "Midnight", description: "Deep slate navy surfaces easy on the eyes at night", bg: "#0F172A" },
];

const LEGACY_MAP = {
  light: "bluewhite",
  pure: "bluewhite",
  sky: "bluewhite",
  mint: "greenpurple",
  parchment: "sepia",
};

export function normalizeTheme(raw) {
  if (!raw) return "bluewhite";
  const mapped = LEGACY_MAP[raw] || raw;
  return THEMES.some((t) => t.id === mapped) ? mapped : "bluewhite";
}

export function getTheme() {
  if (typeof window === "undefined") return "bluewhite";
  return normalizeTheme(localStorage.getItem("theme"));
}

export function applyTheme(id) {
  if (typeof document === "undefined") return;
  const normalized = normalizeTheme(id);
  const found = THEMES.find((t) => t.id === normalized) || THEMES[0];
  document.documentElement.dataset.theme = found.id;
  document.documentElement.style.colorScheme = found.id === "dark" ? "dark" : "only light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", found.bg);
  try {
    localStorage.setItem("theme", found.id);
  } catch {}
}
