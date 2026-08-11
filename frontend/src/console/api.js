import { useMemo } from "react";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// A tiny authed axios wrapper so every Console panel talks to the backend the
// same way without repeating the Bearer header boilerplate.
export const useConsoleApi = () => {
  const { token } = useAuth();
  return useMemo(() => {
    const h = { headers: { Authorization: `Bearer ${token}` } };
    return {
      get: (p, cfg = {}) => axios.get(`${API}${p}`, { ...h, ...cfg }),
      post: (p, body, cfg = {}) => axios.post(`${API}${p}`, body, { ...h, ...cfg }),
      patch: (p, body, cfg = {}) => axios.patch(`${API}${p}`, body, { ...h, ...cfg }),
      del: (p, cfg = {}) => axios.delete(`${API}${p}`, { ...h, ...cfg }),
    };
  }, [token]);
};

export const fmtCoins = (n) => (n ?? 0).toLocaleString("en-IN");

export const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

export const shortId = (id) => (id ? `${id.slice(0, 8)}` : "—");
