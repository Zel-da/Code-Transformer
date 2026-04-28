import { Badge } from "@/components/ui/badge";

type SyncStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export function StatusBadge({ status }: { status: SyncStatus | string }) {
  let badgeColor = "bg-muted text-muted-foreground border-border";
  let glowColor = "shadow-none";

  switch (status) {
    case "PENDING":
      badgeColor = "bg-[#f59e0b]/10 text-[#fbbf24] border-[#f59e0b]";
      glowColor = "shadow-[0_0_8px_rgba(245,158,11,0.2)]";
      break;
    case "PROCESSING":
      badgeColor = "bg-[#0ea5e9]/10 text-[#38bdf8] border-[#0ea5e9]";
      glowColor = "shadow-[0_0_8px_rgba(14,165,233,0.2)]";
      break;
    case "COMPLETED":
      badgeColor = "bg-[#10b981]/10 text-[#34d399] border-[#10b981]";
      glowColor = "shadow-[0_0_8px_rgba(16,185,129,0.2)]";
      break;
    case "FAILED":
      badgeColor = "bg-[#ef4444]/10 text-[#f87171] border-[#ef4444]";
      glowColor = "shadow-[0_0_8px_rgba(239,68,68,0.2)]";
      break;
  }

  return (
    <Badge 
      variant="outline" 
      className={`font-mono uppercase text-[10px] tracking-wider font-bold px-2.5 py-0.5 whitespace-nowrap rounded-none border-[1.5px] ${badgeColor} ${glowColor}`}
    >
      {/* Visual pulse indicator for active/pending states */}
      {(status === "PENDING" || status === "PROCESSING") && (
        <span className="mr-1.5 flex h-1.5 w-1.5 relative items-center justify-center">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-none opacity-75 ${
            status === 'PENDING' ? 'bg-[#fbbf24]' : 'bg-[#38bdf8]'
          }`}></span>
          <span className={`relative inline-flex rounded-none h-1 w-1 ${
            status === 'PENDING' ? 'bg-[#fbbf24]' : 'bg-[#38bdf8]'
          }`}></span>
        </span>
      )}
      {status}
    </Badge>
  );
}
