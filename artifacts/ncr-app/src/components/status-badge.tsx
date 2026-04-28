import { Badge } from "@/components/ui/badge";

type SyncStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export function StatusBadge({ status }: { status: SyncStatus | string }) {
  let badgeColor = "bg-muted text-muted-foreground";
  let label = status;

  switch (status) {
    case "PENDING":
      badgeColor = "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30";
      break;
    case "PROCESSING":
      badgeColor = "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
      break;
    case "COMPLETED":
      badgeColor = "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
      break;
    case "FAILED":
      badgeColor = "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
      break;
  }

  return (
    <Badge variant="outline" className={`${badgeColor} uppercase text-[10px] font-bold px-2 py-0.5 whitespace-nowrap`}>
      {label}
    </Badge>
  );
}
