import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, FileWarning, ClipboardList } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-white/80 backdrop-blur-sm shadow-sm">
        <div className="container flex h-14 items-center px-4 md:px-6 max-w-full">

          <div className="mr-8 flex items-center space-x-2.5">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-lg">
              <ClipboardList className="h-4 w-4" strokeWidth={2} />
            </div>
            <Link href="/admin" className="flex flex-col cursor-pointer">
              <span className="font-bold text-base leading-none text-foreground tracking-tight">부적합 보고</span>
              <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">NCR 관리 시스템</span>
            </Link>
          </div>

          <nav className="hidden md:flex items-center space-x-1">
            <Link href="/admin">
              <span className={`px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-colors ${
                location === "/admin" || location === "/"
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}>
                대시보드
              </span>
            </Link>
            <Link href="/submit">
              <span className={`px-3 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-colors ${
                location === "/submit"
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}>
                보고서 등록
              </span>
            </Link>
          </nav>

          <div className="flex flex-1 items-center justify-end">
            <div className="hidden md:flex items-center space-x-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
              <span>시스템 정상</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-x-hidden">
        {children}
      </main>

      <footer className="md:hidden sticky bottom-0 z-40 w-full border-t border-border bg-white/90 backdrop-blur-sm pb-safe">
        <nav className="flex h-16">
          <Link href="/admin" className="flex-1">
            <span className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${
              location === "/admin" || location === "/" ? "text-primary" : "text-muted-foreground"
            }`}>
              <LayoutDashboard className="h-5 w-5" strokeWidth={location === "/admin" || location === "/" ? 2.5 : 1.8} />
              <span className="text-[10px] font-medium">대시보드</span>
            </span>
          </Link>
          <div className="w-px bg-border my-3"></div>
          <Link href="/submit" className="flex-1">
            <span className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${
              location === "/submit" ? "text-primary" : "text-muted-foreground"
            }`}>
              <FileWarning className="h-5 w-5" strokeWidth={location === "/submit" ? 2.5 : 1.8} />
              <span className="text-[10px] font-medium">보고서 등록</span>
            </span>
          </Link>
        </nav>
      </footer>
    </div>
  );
}
