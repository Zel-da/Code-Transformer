import { useState, FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { ClipboardList, Loader2, Eye, EyeOff, Mail, User } from "lucide-react";
import { useAuth } from "@/contexts/auth";

type LoginTab = "id" | "email";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const redirectTo = params.get("redirect") ?? "/submit";

  const [tab, setTab] = useState<LoginTab>("id");

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleIdLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      setLocation(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/email-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "로그인 실패");
      }
      const data = (await res.json()) as { token: string; user: unknown };
      localStorage.setItem("ncr_auth_token", data.token);
      localStorage.setItem("ncr_auth_user", JSON.stringify(data.user));
      window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}${redirectTo}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    } finally {
      setLoading(false);
    }
  };

  const INP = "w-full h-12 rounded-2xl bg-[#F8F9FA] border border-[#E5E8EB] px-4 text-[15px] text-[#191F28] placeholder:text-[#BEC5CC] outline-none focus:border-[#1A1A1A] transition-colors";

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#F8F9FA] px-5"
      style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <div className="bg-[#1A1A1A] text-white p-3 rounded-2xl mb-4">
            <ClipboardList className="h-7 w-7" strokeWidth={2} />
          </div>
          <h1 className="text-[22px] font-bold text-[#191F28] tracking-tight">공정 부적합 등록 및 관리</h1>
          <p className="text-[13px] text-[#8B95A1] mt-1">로그인하세요</p>
        </div>

        <div className="flex bg-[#F2F4F6] rounded-2xl p-1 mb-4 gap-1">
          <button
            type="button"
            onClick={() => { setTab("id"); setError(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-[13px] font-semibold transition-all ${
              tab === "id"
                ? "bg-white text-[#191F28] shadow-sm"
                : "text-[#8B95A1] hover:text-[#4E5968]"
            }`}
          >
            <User className="h-3.5 w-3.5" />
            아이디 로그인
          </button>
          <button
            type="button"
            onClick={() => { setTab("email"); setError(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl text-[13px] font-semibold transition-all ${
              tab === "email"
                ? "bg-white text-[#191F28] shadow-sm"
                : "text-[#8B95A1] hover:text-[#4E5968]"
            }`}
          >
            <Mail className="h-3.5 w-3.5" />
            사내 메일 로그인
          </button>
        </div>

        {tab === "id" ? (
          <form onSubmit={handleIdLogin} className="bg-white rounded-3xl border border-[#F2F4F6] shadow-sm p-6 flex flex-col gap-4">
            <div>
              <label className="text-[13px] font-semibold text-[#191F28] mb-2 block">아이디</label>
              <input
                className={INP}
                type="text"
                placeholder="아이디를 입력하세요"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>

            <div>
              <label className="text-[13px] font-semibold text-[#191F28] mb-2 block">비밀번호</label>
              <div className="relative">
                <input
                  className={`${INP} pr-12`}
                  type={showPw ? "text" : "password"}
                  placeholder="비밀번호를 입력하세요"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#BEC5CC] hover:text-[#8B95A1] transition-colors"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-[13px] text-red-500 font-medium text-center bg-red-50 rounded-xl py-2.5 px-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="mt-1 w-full h-12 rounded-2xl bg-[#1A1A1A] text-white font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#333] transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "로그인"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleEmailLogin} className="bg-white rounded-3xl border border-[#F2F4F6] shadow-sm p-6 flex flex-col gap-4">
            <div>
              <label className="text-[13px] font-semibold text-[#191F28] mb-2 block">사내 이메일</label>
              <input
                className={INP}
                type="email"
                placeholder="example@soosan.co.kr"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
              />
            </div>

            <div>
              <label className="text-[13px] font-semibold text-[#191F28] mb-2 block">비밀번호</label>
              <div className="relative">
                <input
                  className={`${INP} pr-12`}
                  type={showPw ? "text" : "password"}
                  placeholder="이메일 비밀번호를 입력하세요"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#BEC5CC] hover:text-[#8B95A1] transition-colors"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <p className="text-[12px] text-[#8B95A1] text-center">
              회사 메일 계정(soosan.co.kr)으로 로그인합니다
            </p>

            {error && (
              <p className="text-[13px] text-red-500 font-medium text-center bg-red-50 rounded-xl py-2.5 px-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="mt-1 w-full h-12 rounded-2xl bg-[#1A1A1A] text-white font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#333] transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "메일 계정으로 로그인"}
            </button>
          </form>
        )}

        <p className="text-center text-[12px] text-[#BEC5CC] mt-6">
          계정이 없으면 관리자에게 문의하세요
        </p>
      </div>
    </div>
  );
}
