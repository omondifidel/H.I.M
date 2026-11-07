const BASE = process.env.NEXT_PUBLIC_API_URL || "";

export const getToken = () => (typeof window !== "undefined" ? localStorage.getItem("token") : null);
export const setToken = (t) => (t ? localStorage.setItem("token", t) : localStorage.removeItem("token"));

export async function api(path, { method = "GET", body, form, raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (form) payload = form;
  else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event("auth-lost"));
  }
  if (!res.ok) {
    let msg = res.statusText || `Request failed (error ${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = "Please check your details and try again.";
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}