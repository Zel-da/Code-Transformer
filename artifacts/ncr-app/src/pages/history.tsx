import { Layout } from "@/components/layout";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/auth";
import { Search, Loader2, X, Factory } from "lucide-react";

const FACTORY_TO_PLANT: Record<string, string> = {
  아산: "SA00",
  화성: "SH00",
};

type DefectRow = {
  id: number;
  erpReportNo: string;
  plantCd: string | null;
  factory: string | null;
  flawGbn: string | null;
  processCd: string | null;
  itemCode: string | null;
  itemName: string | null;
  itemGroupCd: string | null;
  parItemCode: string | null;
  outHogi: string | null;
  flawQty: string | null;
  typeCd: string | null;
  flawState: string | null;
  actResult: string | null;
  decideResult: string | null;
  capAction: string | null;
  deptNm: string | null;
  insrtDate: string | null;
  insrtUserId: string | null;
};

const GBN_LABEL: Record<string, string> = {
  QC: "공정",
  QO: "출하",
  AS: "A/S",
  QI: "수입",
  QA: "QA",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function HistoryPage() {
  const { user } = useAuth();
  const defaultPlant = user?.factory ? FACTORY_TO_PLANT[user.factory] ?? "" : "";

  const [plantFilter, setPlantFilter] = useState<string>(defaultPlant);
  const [gbnFilter, setGbnFilter] = useState<string>("QC");  // 기본 공정 부적합
  const [queryText, setQueryText] = useState<string>("");
  const [debouncedQ, setDebouncedQ] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DefectRow[]>([]);
  const [selected, setSelected] = useState<DefectRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 사용자 프로필 바뀌면 공장 기본값 갱신
  useEffect(() => {
    if (user?.factory && !plantFilter) {
      setPlantFilter(FACTORY_TO_PLANT[user.factory] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // 검색어 debounce (400ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(queryText.trim()), 400);
    return () => clearTimeout(t);
  }, [queryText]);

  const fetchUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (plantFilter) params.set("plant", plantFilter);
    if (gbnFilter) params.set("gbn", gbnFilter);
    if (debouncedQ) params.set("q", debouncedQ);
    params.set("limit", "80");
    return `/api/erp/defect-history?${params.toString()}`;
  }, [plantFilter, gbnFilter, debouncedQ]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    fetch(fetchUrl, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ count: number; rows: DefectRow[] }>;
      })
      .then((data) => {
        if (cancel) return;
        setRows(data.rows ?? []);
      })
      .catch((e) => {
        if (cancel) return;
        setError(String(e));
        setRows([]);
      })
      .finally(() => {
        if (cancel) return;
        setLoading(false);
      });
    return () => { cancel = true; };
  }, [fetchUrl]);

  return (
    <Layout>
      <div className="max-w-screen-md mx-auto px-4 pt-5 pb-24">
        <div className="mb-5">
          <h1 className="text-[20px] font-bold text-[#191F28]">과거 부적합 이력</h1>
          <p className="text-[12px] text-[#8B95A1] mt-1">
            ERP 등록된 과거 사례와 조치 내용. 같은 품목·공정에서 전에 어떻게 해결했는지 바로 확인.
          </p>
        </div>

        {/* 필터 */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] p-4 mb-4 space-y-3">
          {/* 공장 chip */}
          <div className="flex items-center gap-2 flex-wrap">
            <Factory className="h-4 w-4 text-[#8B95A1]" />
            <span className="text-[11px] text-[#8B95A1] mr-1">공장</span>
            {[
              { v: "", label: "전체" },
              { v: "SA00", label: "아산" },
              { v: "SH00", label: "화성" },
            ].map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setPlantFilter(opt.v)}
                className={`h-8 px-3 rounded-full text-[12px] font-semibold transition-colors ${
                  plantFilter === opt.v
                    ? "bg-[#1A1A1A] text-white"
                    : "bg-[#F8F9FA] text-[#4E5968] border border-[#F2F4F6]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 구분 chip */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[#8B95A1] mr-1 ml-6">구분</span>
            {[
              { v: "QC", label: "공정" },
              { v: "QO", label: "출하" },
              { v: "AS", label: "A/S" },
              { v: "", label: "전체" },
            ].map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setGbnFilter(opt.v)}
                className={`h-8 px-3 rounded-full text-[12px] font-semibold transition-colors ${
                  gbnFilter === opt.v
                    ? "bg-[#1A1A1A] text-white"
                    : "bg-[#F8F9FA] text-[#4E5968] border border-[#F2F4F6]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 검색어 */}
          <div className="relative">
            <Search className="h-4 w-4 text-[#BEC5CC] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="품목코드·그룹·현상·조치 검색"
              className="w-full h-11 rounded-xl bg-[#F8F9FA] pl-9 pr-9 text-[14px] outline-none text-[#191F28] placeholder-[#BEC5CC] border-2 border-transparent focus:border-[#1A1A1A]"
            />
            {queryText && (
              <button
                type="button"
                onClick={() => setQueryText("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#8B95A1] hover:text-[#191F28]"
                aria-label="검색어 지우기"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* 상태 표시 */}
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[12px] text-[#8B95A1]">
            {loading ? "조회 중…" : `${rows.length}건`}
          </span>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-[#8B95A1]" />}
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[12px] text-red-700 mb-3">
            조회 실패: {error}
          </div>
        )}

        {/* 리스트 */}
        <div className="space-y-2">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r)}
              className="w-full text-left bg-white rounded-xl border border-[#F2F4F6] p-4 hover:bg-[#FAFBFC] active:bg-[#F2F4F6] transition-colors"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[13px] font-bold text-[#191F28] truncate">{r.erpReportNo}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {r.factory && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#EEF2F6] text-[#4E5968]">
                      {r.factory}
                    </span>
                  )}
                  {r.flawGbn && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">
                      {GBN_LABEL[r.flawGbn] ?? r.flawGbn}
                    </span>
                  )}
                  <span className="text-[10px] text-[#8B95A1] tabular-nums">{fmtDate(r.insrtDate)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-[#4E5968] mb-1.5 flex-wrap">
                {r.processCd && <span>공정 <b>{r.processCd}</b></span>}
                {r.itemCode && <span>· 품목 <b>{r.itemCode}</b></span>}
                {r.itemName && <span className="text-[#8B95A1] truncate">{r.itemName}</span>}
              </div>
              {r.flawState && (
                <div className="text-[12px] text-[#191F28] line-clamp-2 mb-0.5">
                  <span className="text-[10px] text-[#8B95A1] mr-1">현상</span>
                  {r.flawState}
                </div>
              )}
              {r.actResult && (
                <div className="text-[12px] text-[#4E5968] line-clamp-2">
                  <span className="text-[10px] text-[#8B95A1] mr-1">조치</span>
                  {r.actResult}
                </div>
              )}
            </button>
          ))}

          {!loading && rows.length === 0 && !error && (
            <div className="bg-white rounded-xl border border-[#F2F4F6] px-4 py-10 text-center">
              <p className="text-[13px] text-[#8B95A1]">조건에 맞는 과거 사례가 없습니다</p>
              <p className="text-[11px] text-[#BEC5CC] mt-1">필터를 완화해보세요</p>
            </div>
          )}
        </div>
      </div>

      {/* 상세 모달 */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-[#F2F4F6] px-5 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-[#191F28] truncate">{selected.erpReportNo}</div>
                <div className="text-[11px] text-[#8B95A1] mt-0.5">
                  {fmtDate(selected.insrtDate)} · {selected.factory} · {GBN_LABEL[selected.flawGbn ?? ""] ?? selected.flawGbn}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="p-2 -mr-2" aria-label="닫기">
                <X className="h-5 w-5 text-[#4E5968]" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 text-[13px]">
              <Field label="공정 · 품목">
                <div className="space-y-0.5">
                  {selected.processCd && <div>공정 {selected.processCd}</div>}
                  {selected.itemCode && <div>품목 {selected.itemCode} {selected.itemName ? `· ${selected.itemName}` : ""}</div>}
                  {selected.itemGroupCd && <div className="text-[#8B95A1]">그룹 {selected.itemGroupCd}</div>}
                  {selected.parItemCode && <div className="text-[#8B95A1]">상위 {selected.parItemCode}</div>}
                  {selected.outHogi && <div>호기 {selected.outHogi}</div>}
                </div>
              </Field>
              <Field label="수량 · 유형">
                <div className="flex gap-3">
                  {selected.flawQty != null && <span>불량수량 <b>{selected.flawQty}</b></span>}
                  {selected.typeCd && <span>유형 <b>{selected.typeCd}</b></span>}
                </div>
              </Field>
              <Field label="현상">{selected.flawState || <em className="text-[#8B95A1]">—</em>}</Field>
              <Field label="조치결과">{selected.actResult || <em className="text-[#8B95A1]">—</em>}</Field>
              {selected.capAction && <Field label="시정·예방조치">{selected.capAction}</Field>}
              {selected.decideResult && <Field label="판정">{selected.decideResult}</Field>}
              <Field label="부서 · 등록자">
                <div className="text-[#8B95A1]">
                  {selected.deptNm} · {selected.insrtUserId}
                </div>
              </Field>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-[#8B95A1] font-semibold mb-1">{label}</div>
      <div className="text-[13px] text-[#191F28] whitespace-pre-wrap">{children}</div>
    </div>
  );
}
