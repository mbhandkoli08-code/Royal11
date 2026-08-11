import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TOKEN_KEY = "royal11_token";

const AuthContext = createContext(null);

// FastAPI 422 returns `detail` as an array of {msg,...} objects. Rendering that
// raw value crashes React, so always flatten it to a string first.
export const formatApiErrorDetail = (detail) => {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
};

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const activityPinged = useRef(false);

  // One-time, non-punitive engagement nudge if the player has been away a while.
  const pingActivity = useCallback(async (tok) => {
    if (activityPinged.current) return;
    activityPinged.current = true;
    try {
      const { data } = await axios.post(`${API}/auth/activity`, {}, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (data?.nudge) {
        toast("Welcome back to ROYAL11!", {
          description: `You've been away ${data.days_away} days — your coins are safe. Jump back in!`,
        });
      }
    } catch {
      /* nudge is best-effort; never block the app */
    }
  }, []);

  // Validate any existing token on mount by fetching the current user.
  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await axios.get(`${API}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (active) {
          setUser(data);
          if (data.role === "PLAYER") pingActivity(token);
        }
      } catch {
        if (active) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setUser(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    bootstrap();
    return () => {
      active = false;
    };
  }, [token, pingActivity]);

  const login = useCallback(async (email, password) => {
    const { data } = await axios.post(`${API}/auth/login`, { email, password });
    localStorage.setItem(TOKEN_KEY, data.access_token);
    setToken(data.access_token);
    setUser(data.user);
    if (data.user.role === "PLAYER") pingActivity(data.access_token);
    return data.user;
  }, [pingActivity]);

  const register = useCallback(async (email, password, display_name, referral_code) => {
    const { data } = await axios.post(`${API}/auth/register`, {
      email,
      password,
      display_name,
      ...(referral_code ? { referral_code } : {}),
    });
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem("r11_welcome", "1");  // trigger one-time agent welcome
    setToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      isAuthenticated: !!token && !!user,
      login,
      register,
      logout,
    }),
    [token, user, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
