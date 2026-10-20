import { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import { setAuthTokenGetter, setUnauthorizedHandler } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

export type UserRole = "admin" | "worker" | "reviewer" | "approver" | "collaborator";

export type NotifyLevel = "to" | "cc" | "none";

export interface UserProfile {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  deptCd: string | null;
  factory: string | null;
  plantCd: string | null;
  processName: string | null;
  processCd: string | null;
  notifyLevel: NotifyLevel;
  hasTempPassword?: boolean;
}

interface AuthState {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "ncr_auth_token";
const USER_KEY = "ncr_auth_user";

// Set the token getter at module level so it's available immediately —
// before any component useEffect runs (React runs children effects before
// parents, so a useEffect-based setter would be too late for child API calls).
setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

// Module-level logout ref so the unauthorized handler always calls the latest
// logout function, even before AuthProvider mounts.
const _logoutRef: { current: () => void } = { current: () => {} };
setUnauthorizedHandler(() => _logoutRef.current());

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    try {
      if (new URLSearchParams(window.location.search).get("sso") === "complete") {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
      const token = localStorage.getItem(TOKEN_KEY);
      const userRaw = localStorage.getItem(USER_KEY);
      const user = userRaw ? (JSON.parse(userRaw) as UserProfile) : null;
      return { user, token, loading: true };
    } catch {
      return { user: null, token: null, loading: false };
    }
  });

  const logoutRef = useRef<() => void>(() => {});

  useEffect(() => {
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    // SSO uses an HttpOnly cookie; no token needs to be read by JavaScript.
    refreshUser();
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? "로그인 실패");
    }
    const data = (await res.json()) as { token: string; user: UserProfile };
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setState({ user: data.user, token: data.token, loading: false });
  };

  const clearLocalAuth = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ user: null, token: null, loading: false });
  };

  const logout = async () => {
    try {
      const response = await fetch(`${API}/auth/sso/logout`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("logout_failed");
      clearLocalAuth();
    } catch {
      toast({ title: "로그아웃을 완료하지 못했습니다", description: "연결을 확인한 후 다시 시도해주세요.", variant: "destructive" });
    }
  };

  logoutRef.current = logout;
  // An already-rejected session must not leave a cached authenticated UI visible.
  _logoutRef.current = clearLocalAuth;

  const refreshUser = async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      const res = await fetch(`${API}/auth/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.status === 401) { clearLocalAuth(); return; }
      if (!res.ok) {
        // Never show a cached SSO identity when central validation fails.
        setState({ user: null, token, loading: false });
        return;
      }
      const user = (await res.json()) as UserProfile;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setState({ user, token, loading: false });
    } catch {
      setState({ user: null, token, loading: false });
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
