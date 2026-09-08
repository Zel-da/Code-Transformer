import { useState, FormEvent } from "react";
import { useSearch } from "wouter";
import { ClipboardList, Loader2, Eye, EyeOff } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;
const TEMP_TOKEN_KEY = "ncr_temp_auth_token";

export default function LoginPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const redirectTo = params.get("redirect") ?? "/submit";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedTempPassword, setUsedTempPassword] = useState(false);
  const [fallbackPassword, setFallbackPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);

  const handleLogin = async (e: FormEvent) => {
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
      const data = (await res.json()) as {
        token: string;
        user: unknown;
        requiresPasswordSetup?: boolean;
      };
      if (data.requiresPasswordSetup) {
        sessionStorage.setItem(TEMP_TOKEN_KEY, data.token);
        setUsedTempPassword(true);
        return;
      }
      localStorage.setItem("ncr_auth_token", data.token);
      localStorage.setItem("ncr_auth_user", JSON.stringify(data.user));
      window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}${redirectTo}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    } finally {
      setLoading(false);
    }
  };

  const handleTemporaryPasswordSetup = async (e: FormEvent) => {
    e.preventDefault();
    setSetupError(null);

    if (!fallbackPassword) {
      setSetupError("그룹웨어에서 사용하는 비밀번호를 입력해주세요.");
      return;
    }
    if (fallbackPassword !== passwordConfirmation) {
      setSetupError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    const temporaryToken = sessionStorage.getItem(TEMP_TOKEN_KEY);
    if (!temporaryToken) {
      setSetupError("임시 로그인 정보가 만료되었습니다. 다시 로그인해주세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/complete-temp-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${temporaryToken}`,
        },
        body: JSON.stringify({ password: fallbackPassword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "비밀번호 등록에 실패했습니다.");
      }

      const data = (await res.json()) as { token: string; user: unknown };
      sessionStorage.removeItem(TEMP_TOKEN_KEY);
      localStorage.setItem("ncr_auth_token", data.token);
      localStorage.setItem("ncr_auth_user", JSON.stringify(data.user));
      window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}${redirectTo}`;
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "비밀번호 등록에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const cancelTemporaryLogin = () => {
    sessionStorage.removeItem(TEMP_TOKEN_KEY);
    setUsedTempPassword(false);
    setFallbackPassword("");
    setPasswordConfirmation("");
    setSetupError(null);
    setPassword("");
  };

  const INP = "w-full h-12 rounded-2xl bg-[#F8F9FA] border border-[#E5E8EB] px-4 text-[15px] text-[#191F28] placeholder:text-[#BEC5CC] outline-none focus:border-[#1A1A1A] transition-colors";

  // 임시 비밀번호 로그인은 내부 폴백 비밀번호를 등록해야만 완료된다.
  if (usedTempPassword) {
    return (
      <div
        className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#F8F9FA] px-5"
        style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}
      >
        <div className="w-full max-w-sm">
          <form onSubmit={handleTemporaryPasswordSetup} className="bg-white rounded-3xl border border-[#F2F4F6] shadow-sm p-6 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center">
                <ClipboardList className="h-6 w-6 text-amber-500" strokeWidth={2} />
              </div>
              <h2 className="text-[17px] font-bold text-[#191F28]">그룹웨어 비밀번호 등록</h2>
            </div>
            <p className="text-[13px] text-[#4E5968] leading-relaxed">
              현재 관리자가 발급한 <span className="font-semibold text-amber-600">임시 비밀번호</span>로 로그인되었습니다.
              <br /><br />
              앞으로 사용할 <span className="font-semibold">그룹웨어 비밀번호</span>를 등록해주세요. 이후 로그인할 때마다 그룹웨어 인증을 먼저 시도하고, 연결에 실패한 경우에만 이 비밀번호로 로그인합니다.
            </p>
            <div className="text-left space-y-3">
              <div>
                <label className="text-[13px] font-semibold text-[#191F28] mb-2 block">그룹웨어 비밀번호</label>
                <input
                  className={INP}
                  type="password"
                  value={fallbackPassword}
                  onChange={e => setFallbackPassword(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#191F28] mb-2 block">비밀번호 확인</label>
                <input
                  className={INP}
                  type="password"
                  value={passwordConfirmation}
                  onChange={e => setPasswordConfirmation(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            {setupError && (
              <p className="text-[13px] text-red-500 font-medium text-center bg-red-50 rounded-xl py-2.5 px-3">
                {setupError}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !fallbackPassword || !passwordConfirmation}
              className="w-full h-12 rounded-2xl bg-[#1A1A1A] text-white font-bold text-[15px] flex items-center justify-center hover:bg-[#333] transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "등록하고 계속하기"}
            </button>
            <button
              type="button"
              onClick={cancelTemporaryLogin}
              className="text-[13px] text-[#8B95A1] hover:text-[#4E5968] transition-colors"
            >
              다시 로그인
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#F8F9FA] px-5"
      style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="bg-[#1A1A1A] text-white p-3 rounded-2xl mb-4">
            <ClipboardList className="h-7 w-7" strokeWidth={2} />
          </div>
          <h1 className="text-[22px] font-bold text-[#191F28] tracking-tight">공정 부적합 등록 및 관리</h1>
          <p className="text-[13px] text-[#8B95A1] mt-1">회사 메일 계정으로 로그인하세요</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="bg-white rounded-3xl border border-[#F2F4F6] shadow-sm p-6 flex flex-col gap-4">
          <div>
            <label className="text-[13px] font-semibold text-[#191F28] mb-2 block">사내 이메일 또는 관리자 아이디</label>
            <input
              className={INP}
              type="text"
              placeholder="example@soosan.co.kr 또는 admin"
              value={email}
              onChange={e => setEmail(e.target.value)}
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
                placeholder="그룹웨어 비밀번호를 입력하세요"
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
            disabled={loading || !email || !password}
            className="mt-1 w-full h-12 rounded-2xl bg-[#1A1A1A] text-white font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#333] transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "로그인"}
          </button>
        </form>

        <p className="text-center text-[12px] text-[#BEC5CC] mt-6">
          계정이 없으면 관리자에게 문의하세요
        </p>
      </div>
    </div>
  );
}
