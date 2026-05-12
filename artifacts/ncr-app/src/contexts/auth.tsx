import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

export interface UserProfile {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "worker";
  deptCd: string | null;
  factory: string | null;
  plantCd: string | null;
  processName: string | null;
  processCd: string | null;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const userRaw = localStorage.getItem(USER_KEY);
      const user = userRaw ? (JSON.parse(userRaw) as UserProfile) : null;
      return { user, token, loading: !!token && !user };
    } catch {
      return { user: null, token: null, loading: false };
    }
  });

  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));
  }, []);

  useEffect(() => {
    if (state.token && !state.user) {
      refreshUser();
    }
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

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ user: null, token: null, loading: false });
  };

  const refreshUser = async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const res = await fetch(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { logout(); return; }
      const user = (await res.json()) as UserProfile;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setState({ user, token, loading: false });
    } catch {
      logout();
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
