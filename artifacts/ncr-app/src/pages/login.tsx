import { useState, FormEvent } from "react";
import { useLocation } from "wouter";
import { ClipboardList, Loader2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      setLocation("/submit");
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
          <h1 className="text-[22px] font-bold text-[#191F28] tracking-tight">부적합 보고 시스템</h1>
          <p className="text-[13px] text-[#8B95A1] mt-1">NCR 관리 시스템에 로그인하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-[#F2F4F6] shadow-sm p-6 flex flex-col gap-4">
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

        <p className="text-center text-[12px] text-[#BEC5CC] mt-6">
          계정이 없으면 관리자에게 문의하세요
        </p>
      </div>
    </div>
  );
}
