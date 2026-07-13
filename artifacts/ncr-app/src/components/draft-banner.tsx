import { Clock, RotateCcw, Trash2 } from "lucide-react";

interface DraftBannerProps {
  savedAt: number;
  onRestore: () => void;
  onDiscard: () => void;
}

function formatSavedAt(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  return new Date(ts).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DraftBanner({ savedAt, onRestore, onDiscard }: DraftBannerProps) {
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3">
      <Clock className="h-4 w-4 text-amber-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-amber-800">작성 중이던 내용이 있습니다</p>
        <p className="text-[11px] text-amber-600 mt-0.5">{formatSavedAt(savedAt)}에 자동저장됨</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onDiscard}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-amber-700 border border-amber-300 bg-white hover:bg-amber-100 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
          새로 작성
        </button>
        <button
          type="button"
          onClick={onRestore}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          이어서 작성
        </button>
      </div>
    </div>
  );
}
