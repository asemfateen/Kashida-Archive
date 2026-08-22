import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const TOKEN_KEY = "kashida_token";

// Module-level ref so api.js can trigger logout on 401 without a circular import.
let onUnauthorized = null;
export function setOnUnauthorized(fn) {
  onUnauthorized = fn;
}
export function notifyUnauthorized() {
  if (onUnauthorized) onUnauthorized();
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const login = useCallback(async (username, password) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "login failed");
    setToken(body.token);
    try {
      localStorage.setItem(TOKEN_KEY, body.token);
    } catch {
      /* ignore */
    }
    return body.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Wire up the module-level 401 callback so api.js can trigger logout.
  useEffect(() => {
    setOnUnauthorized(() => logout);
    return () => setOnUnauthorized(null);
  }, [logout]);

  const value = useMemo(
    () => ({ token, isAuthed: Boolean(token), login, logout }),
    [token, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
