// Theme: "system" (follows the device), "light" or "dark". Saved on this device.
export function getTheme() {
  if (typeof window === "undefined") return "system";
  return localStorage.getItem("theme") || "system";
}

export function applyTheme(t) {
  const root = document.documentElement;
  if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
  else root.removeAttribute("data-theme");
  localStorage.setItem("theme", t);
}