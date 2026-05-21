import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, FileWarning, ClipboardList, Settings2, Download, Bell, X, LogOut, User, BookOpen } from "lucide-react";
import { usePWAInstall, useNotifications } from "@/hooks/usePWA";
import { useAuth } from "@/contexts/auth";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { canInstall, install } = usePWAInstall();
  const { permission, requestPermission } = useNotifications();
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const [notifDismissed, setNotifDismissed] = useState(false);
  const { user, logout } = useAuth();

  const isActive = (path: string) =>
    path === "/admin" ? location === "/admin" || location === "/" : location === path;

  useEffect(() => {
    const dismissed = localStorage.getItem("ncr-notif-dismissed");
    if (!dismissed && permission === "default") {
      const t = setTimeout(() => setShowNotifBanner(true), 2000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [permission]);

  const handleNotifAllow = async () => {
    const result = await requestPermission();
    setShowNotifBanner(false);
    if (result === "granted") localStorage.setItem("ncr-notif-dismissed", "1");
  };

  const handleNotifDismiss = () => {
    setShowNotifBanner(false);
    setNotifDismissed(true);
    localStorage.setItem("ncr-notif-dismissed", "1");
  };

  const navItems = user?.role === "admin"
    ? [
        { href: "/admin", label: "대시보드" },
        { href: "/ledger", label: "관리대장" },
        { href: "/submit", label: "보고서 등록" },
        { href: "/manage", label: "관리자 패널" },
      ]
    : [
        { href: "/ledger", label: "관리대장" },
        { href: "/submit", label: "보고서 등록" },
      ];

  const mobileNavItems = user?.role === "admin"
    ? [
        { href: "/admin", label: "대시보드", Icon: LayoutDashboard },
        { href: "/ledger", label: "관리대장", Icon: BookOpen },
        { href: "/submit", label: "보고서 등록", Icon: FileWarning },
        { href: "/manage", label: "관리자", Icon: Settings2 },
      ]
    : [
        { href: "/ledger", label: "관리대장", Icon: BookOpen },
        { href: "/submit", label: "보고서 등록", Icon: FileWarning },
      ];

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-[#F8F9FA] text-[#191F28]"
      style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}
    >
      <header className="sticky top-0 z-40 w-full border-b border-[#F2F4F6] bg-white">
        <div className="flex h-14 items-center px-5 max-w-[1400px] mx-auto">

          <div className="mr-8 flex items-center space-x-2.5">
            <div className="bg-[#1A1A1A] text-white p-1.5 rounded-lg">
              <ClipboardList className="h-4 w-4" strokeWidth={2} />
            </div>
            <Link href={user?.role === "admin" ? "/admin" : "/submit"} className="flex flex-col cursor-pointer">
              <span className="font-bold text-[15px] leading-none text-[#191F28] tracking-tight">부적합 보고</span>
              <span className="text-[10px] text-[#8B95A1] leading-tight mt-0.5">NCR 관리 시스템</span>
            </Link>
          </div>

          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map(({ href, label }) => (
              <Link key={href} href={href}>
                <span className={`px-3 py-1.5 rounded-lg cursor-pointer text-[14px] font-medium transition-colors ${
                  isActive(href)
                    ? "bg-[#1A1A1A] text-white font-semibold"
                    : "text-[#8B95A1] hover:text-[#191F28] hover:bg-[#F2F4F6]"
                }`}>
                  {label}
                </span>
              </Link>
            ))}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-2">
            {canInstall && (
              <button
                onClick={install}
                className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A1A1A] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                앱 설치
              </button>
            )}

            {user && (
              <div className="hidden md:flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-[12px] text-[#4E5968] bg-[#F2F4F6] px-2.5 py-1.5 rounded-full">
                  <User className="h-3 w-3" />
                  <span className="font-medium">{user.displayName}</span>
                  {user.role === "admin" && (
                    <span className="text-[10px] bg-[#1A1A1A] text-white rounded px-1.5 py-0.5 ml-0.5">관리자</span>
                  )}
                </div>
                <button
                  onClick={logout}
                  className="flex items-center gap-1 text-[12px] text-[#8B95A1] hover:text-[#191F28] transition-colors px-2 py-1.5 rounded-lg hover:bg-[#F2F4F6]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {showNotifBanner && !notifDismissed && permission === "default" && (
        <div className="bg-[#1A1A1A] text-white px-5 py-3 flex items-center justify-between gap-3 z-30">
          <div className="flex items-center gap-2.5 min-w-0">
            <Bell className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="text-[13px] font-medium truncate">
              보고서 접수·상태 변경 알림을 받으시겠어요?
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleNotifAllow}
              className="text-[12px] font-semibold bg-white text-[#191F28] px-3 py-1 rounded-lg hover:bg-[#F2F4F6] transition-colors"
            >
              허용
            </button>
            <button onClick={handleNotifDismiss} className="text-[#8B95A1] hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-x-hidden">
        {children}
      </main>

      <footer className="md:hidden sticky bottom-0 z-40 w-full border-t border-[#F2F4F6] bg-white pb-safe">
        <nav className="flex h-16">
          {mobileNavItems.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className="flex-1">
              <span className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${
                isActive(href) ? "text-[#191F28]" : "text-[#BEC5CC]"
              }`}>
                <Icon className="h-5 w-5" strokeWidth={isActive(href) ? 2.5 : 1.8} />
                <span className="text-[10px] font-medium">{label}</span>
              </span>
            </Link>
          ))}
          <button
            onClick={logout}
            className="flex-1 flex flex-col items-center justify-center space-y-1 text-[#BEC5CC] hover:text-[#191F28] transition-colors"
          >
            <LogOut className="h-5 w-5" strokeWidth={1.8} />
            <span className="text-[10px] font-medium">로그아웃</span>
          </button>
        </nav>

        {canInstall && (
          <div className="border-t border-[#F2F4F6] px-4 py-2 flex items-center justify-between bg-[#F8F9FA]">
            <span className="text-[12px] text-[#4E5968]">홈 화면에 추가하면 앱처럼 사용할 수 있어요</span>
            <button
              onClick={install}
              className="flex items-center gap-1 text-[12px] font-semibold bg-[#1A1A1A] text-white px-3 py-1.5 rounded-lg shrink-0"
            >
              <Download className="h-3 w-3" />
              설치
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
