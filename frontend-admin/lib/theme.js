export const THEMES = [
  { id: "pure", name: "Pure White", bg: "#FFFFFF" },
  { id: "sky", name: "Sky & Slate", bg: "#F1F5F9" },
  { id: "mint", name: "Mint & Lavender", bg: "#F3F8F6" },
  { id: "dark", name: "Midnight Ink", bg: "#0B0F17" },
];

export function getTheme() {
  if (typeof window === "undefined") return "sky";
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light") return "pure";
    if (THEMES.some((t) => t.id === saved)) return saved;
  } catch {}
  return "sky";
}

export function applyTheme(id) {
  if (typeof document === "undefined") return;
  const theme = THEMES.find((t) => t.id === id) || THEMES[1];
  document.documentElement.setAttribute("data-theme", theme.id);
  const isDark = theme.id === "dark";
  document.documentElement.style.colorScheme = isDark ? "dark" : "only light";
  try {
    localStorage.setItem("theme", theme.id);
  } catch {}
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = theme.bg;
}
