import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, AlertTriangle, FileWarning, TerminalSquare } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      {/* Top Bar - Hard industrial look */}
      <header className="sticky top-0 z-40 w-full border-b-[2px] border-border bg-card shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
        <div className="container flex h-16 items-center px-4 md:px-6 max-w-full">
          
          {/* Logo / System ID */}
          <div className="mr-8 flex items-center space-x-3">
            <div className="bg-primary text-primary-foreground p-1.5">
              <TerminalSquare className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <Link href="/admin" className="flex flex-col cursor-pointer">
              <span className="font-mono font-bold text-lg leading-none tracking-tight text-white">NCR.SYS</span>
              <span className="text-[10px] font-mono tracking-widest text-primary font-semibold uppercase opacity-80 leading-tight">Control Node</span>
            </Link>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center space-x-1">
            <Link href="/admin">
              <span className={`px-4 py-2 cursor-pointer text-sm font-mono tracking-wider font-bold transition-all border-b-2 ${
                location === "/admin" || location === "/" 
                  ? "border-primary text-primary bg-primary/10" 
                  : "border-transparent text-muted-foreground hover:text-white hover:bg-muted"
              }`}>
                [01] DASHBOARD
              </span>
            </Link>
            <Link href="/submit">
              <span className={`px-4 py-2 cursor-pointer text-sm font-mono tracking-wider font-bold transition-all border-b-2 ${
                location === "/submit" 
                  ? "border-primary text-primary bg-primary/10" 
                  : "border-transparent text-muted-foreground hover:text-white hover:bg-muted"
              }`}>
                [02] SUBMIT_REPORT
              </span>
            </Link>
          </nav>

          {/* Right side status indicators */}
          <div className="flex flex-1 items-center justify-end space-x-4">
            <div className="hidden md:flex items-center space-x-2 text-xs font-mono">
              <span className="text-muted-foreground">NODE:</span>
              <span className="text-green-400">ONLINE</span>
            </div>
            <div className="md:hidden flex items-center bg-destructive/10 text-destructive border border-destructive px-2 py-1 text-xs font-mono font-bold">
              <AlertTriangle className="h-3 w-3 mr-1" />
              NCR
            </div>
          </div>
        </div>
      </header>
      
      <main className="flex-1 overflow-x-hidden relative">
        {/* Subtle scanline effect */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px] opacity-20 z-50 mix-blend-overlay"></div>
        {children}
      </main>

      {/* Mobile Bottom Nav - Chunky touch targets */}
      <footer className="md:hidden sticky bottom-0 z-40 w-full border-t-[2px] border-border bg-card pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
        <nav className="flex h-16 relative">
          <Link href="/admin" className="flex-1">
            <span className={`flex flex-col items-center justify-center w-full h-full space-y-1 relative ${
              location === "/admin" || location === "/" ? "text-primary" : "text-muted-foreground"
            }`}>
              {location === "/admin" || location === "/" ? (
                <div className="absolute top-0 inset-x-0 h-[2px] bg-primary"></div>
              ) : null}
              <LayoutDashboard className="h-6 w-6" strokeWidth={location === "/admin" || location === "/" ? 2.5 : 2} />
              <span className="text-[10px] font-mono tracking-wider font-bold">DASHBOARD</span>
            </span>
          </Link>
          <div className="w-[1px] bg-border my-2"></div>
          <Link href="/submit" className="flex-1">
            <span className={`flex flex-col items-center justify-center w-full h-full space-y-1 relative ${
              location === "/submit" ? "text-primary" : "text-muted-foreground"
            }`}>
              {location === "/submit" ? (
                <div className="absolute top-0 inset-x-0 h-[2px] bg-primary"></div>
              ) : null}
              <FileWarning className="h-6 w-6" strokeWidth={location === "/submit" ? 2.5 : 2} />
              <span className="text-[10px] font-mono tracking-wider font-bold">SUBMIT_NCR</span>
            </span>
          </Link>
        </nav>
      </footer>
    </div>
  );
}
