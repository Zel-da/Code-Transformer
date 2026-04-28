import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, FilePlus, Settings } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card">
        <div className="container flex h-14 max-w-screen-2xl items-center">
          <div className="mr-4 hidden md:flex">
            <Link href="/admin" className="mr-6 flex items-center space-x-2">
              <span className="hidden font-bold sm:inline-block">
                NCR System
              </span>
            </Link>
            <nav className="flex items-center space-x-6 text-sm font-medium">
              <Link
                href="/admin"
                className={`transition-colors hover:text-foreground/80 ${
                  location === "/admin" ? "text-foreground" : "text-foreground/60"
                }`}
              >
                Admin Dashboard
              </Link>
              <Link
                href="/submit"
                className={`transition-colors hover:text-foreground/80 ${
                  location === "/submit" ? "text-foreground" : "text-foreground/60"
                }`}
              >
                Submit Report
              </Link>
            </nav>
          </div>
          <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
            <div className="w-full flex-1 md:w-auto md:flex-none">
              <span className="font-bold md:hidden">부적합 관리 시스템</span>
            </div>
          </div>
        </div>
      </header>
      
      <main className="flex-1 overflow-x-hidden">
        {children}
      </main>

      <footer className="md:hidden sticky bottom-0 z-40 w-full border-t border-border bg-card pb-safe">
        <nav className="flex items-center justify-around h-16 px-4">
          <Link
            href="/admin"
            className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
              location === "/admin" ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <LayoutDashboard className="h-5 w-5" />
            <span className="text-[10px] font-medium">Dashboard</span>
          </Link>
          <Link
            href="/submit"
            className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
              location === "/submit" ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <FilePlus className="h-5 w-5" />
            <span className="text-[10px] font-medium">Submit</span>
          </Link>
        </nav>
      </footer>
    </div>
  );
}
