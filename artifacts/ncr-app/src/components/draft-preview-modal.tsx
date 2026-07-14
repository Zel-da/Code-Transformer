import { Clock, RotateCcw, Trash2, X } from "lucide-react";

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

export interface DraftEntry {
  label: string;
  value: string;
}

interface DraftPreviewModalProps {
  open: boolean;
  savedAt: number;
  entries: DraftEntry[];
  onApply: () => void;
  onDiscard: () => void;
  onClose: () => void;
}

export function DraftPreviewModal({
  open,
  savedAt,
  entries,
  onApply,
  onDiscard,
  onClose,
}: DraftPreviewModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col">
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500 shrink-0" />
              <p className="text-[15px] font-bold text-amber-800">임시저장된 내용</p>
            </div>
            <p className="text-[12px] text-amber-600 mt-0.5 ml-6">
              {formatSavedAt(savedAt)}에 자동저장됨
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 max-h-64 overflow-y-auto space-y-2.5">
          {entries.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-6">저장된 내용이 없습니다</p>
          ) : (
            entries.map(({ label, value }) => (
              <div key={label} className="flex gap-3 text-[13px]">
                <span className="text-gray-400 shrink-0 w-24 pt-px">{label}</span>
                <span className="text-gray-800 font-medium break-all leading-snug">{value}</span>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onDiscard}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold text-amber-700 border border-amber-300 bg-white hover:bg-amber-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            새로 작성
          </button>
          <button
            type="button"
            onClick={onApply}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            적용
          </button>
        </div>
      </div>
    </div>
  );
}
