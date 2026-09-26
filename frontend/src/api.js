const BASE = "http://127.0.0.1:4000";

export const token = {
  get: () => localStorage.getItem("bv_token"),
  set: (t) => localStorage.setItem("bv_token", t),
  clear: () => localStorage.removeItem("bv_token"),
};

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token.get() ? { authorization: `Bearer ${token.get()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "request failed");
  return data;
}
