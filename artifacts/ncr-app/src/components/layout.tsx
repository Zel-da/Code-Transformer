import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, FileWarning, ClipboardList, Settings2 } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const isActive = (path: string) =>
    path === "/admin" ? location === "/admin" || location === "/" : location === path;

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
            <Link href="/admin" className="flex flex-col cursor-pointer">
              <span className="font-bold text-[15px] leading-none text-[#191F28] tracking-tight">부적합 보고</span>
              <span className="text-[10px] text-[#8B95A1] leading-tight mt-0.5">NCR 관리 시스템</span>
            </Link>
          </div>

          <nav className="hidden md:flex items-center space-x-1">
            {[
              { href: "/admin", label: "대시보드" },
              { href: "/submit", label: "보고서 등록" },
              { href: "/manage", label: "관리자 패널" },
            ].map(({ href, label }) => (
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

          <div className="flex flex-1 items-center justify-end">
            <div className="hidden md:flex items-center space-x-1.5 text-[12px] text-[#8B95A1] bg-[#F2F4F6] px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
              <span>시스템 정상</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-x-hidden">
        {children}
      </main>

      <footer className="md:hidden sticky bottom-0 z-40 w-full border-t border-[#F2F4F6] bg-white pb-safe">
        <nav className="flex h-16">
          {[
            { href: "/admin", label: "대시보드", Icon: LayoutDashboard },
            { href: "/submit", label: "보고서 등록", Icon: FileWarning },
            { href: "/manage", label: "관리자", Icon: Settings2 },
          ].map(({ href, label, Icon }, i, arr) => (
            <Link key={href} href={href} className="flex-1">
              <span className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${
                isActive(href) ? "text-[#191F28]" : "text-[#BEC5CC]"
              }`}>
                <Icon className="h-5 w-5" strokeWidth={isActive(href) ? 2.5 : 1.8} />
                <span className="text-[10px] font-medium">{label}</span>
              </span>
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
