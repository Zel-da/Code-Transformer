import { useGetReportSummary, getGetReportSummaryQueryKey } from "@workspace/api-client-react";
import { useMemo } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, PieChart, Pie, Legend,
} from "recharts";
import { Printer } from "lucide-react";
import { useSearch } from "wouter";

const CHART_COLORS = ["#1e3a5f","#2563eb","#16a34a","#9333ea","#dc2626","#0891b2","#ea580c","#65a30d"];

const QC_LABELS: Record<string, string> = {
  OPEN: "접수",
  IN_REVIEW: "검토중",
  PENDING_COLLAB: "협업중",
  RESOLVED: "조치완료",
  APPROVED: "승인",
  ERP_SYNCED: "ERP등록",
};

function PageBreak() {
  return <div className="print-page-break" />;
}

function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="section-title">
      <span className="section-number">{number}</span>
      <span>{title}</span>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <table className="print-table">
      <thead>
        <tr>
          {headers.map((h, i) => <th key={i}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => <td key={j}>{cell}</td>)}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={headers.length} style={{ textAlign: "center", color: "#888" }}>데이터 없음</td></tr>
        )}
      </tbody>
    </table>
  );
}

export default function ReportPrintPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const type = params.get("type") === "analysis" ? "analysis" : "management";
  const today = new Date();

  const summaryParams = useMemo(() => ({}), []);
  const { data: ds, isLoading } = useGetReportSummary(summaryParams, {
    query: { queryKey: getGetReportSummaryQueryKey(summaryParams) },
  });

  const openCount = ds?.byQcStatus.find(r => r.status === "OPEN")?.count ?? 0;
  const inProgressCount = (ds?.byQcStatus ?? [])
    .filter(r => ["IN_REVIEW","PENDING_COLLAB","RESOLVED"].includes(r.status ?? ""))
    .reduce((s, r) => s + r.count, 0);
  const doneCount = (ds?.byQcStatus ?? [])
    .filter(r => ["APPROVED","ERP_SYNCED"].includes(r.status ?? ""))
    .reduce((s, r) => s + r.count, 0);
  const total = ds?.total ?? 0;
  const longPendingCount = ds?.longPendingCount ?? 0;

  const processData = (ds?.byProcess ?? []).filter(r => r.processName).slice(0, type === "analysis" ? 15 : 10)
    .map(r => ({ name: r.processName ?? "미분류", count: r.count }));
  const flawData = (ds?.byFlawType ?? []).filter(r => r.flawTypeCd).slice(0, 10)
    .map(r => ({ name: r.flawTypeCd ?? "미분류", count: r.count }));
  const deptData = (ds?.byDept ?? []).filter(r => r.deptName || r.deptCd).slice(0, 15)
    .map(r => ({ name: r.deptName ?? r.deptCd ?? "미분류", count: r.count }));
  const vendorData = (ds?.byVendor ?? []).filter(r => r.vendorNm).slice(0, type === "analysis" ? 10 : 5)
    .map(r => ({ name: r.vendorNm ?? "", count: r.count }));
  const monthData = (ds?.byMonth ?? []).map(r => ({ name: r.month, count: r.count }));
  const longPendingList = ds?.longPendingList ?? [];

  const statusPieData = [
    { name: "접수", value: openCount },
    { name: "조치 중", value: inProgressCount },
    { name: "판정완료", value: doneCount },
  ].filter(d => d.value > 0);
  const pieColors = ["#2563eb", "#f59e0b", "#16a34a"];

  const isManagement = type === "management";
  const reportTitle = isManagement ? "공정 부적합 현황 보고서" : "공정 부적합 분석 보고서";
  const reportSubtitle = isManagement ? "경영진 보고용" : "품질팀 분석용";

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif" }}>
        <p>보고서 데이터를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;900&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Noto Sans KR', sans-serif; background: #f0f0f0; color: #1a1a1a; }

        .no-print { }
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .page { box-shadow: none; margin: 0; border-radius: 0; page-break-after: always; }
          .page:last-child { page-break-after: auto; }
          .print-page-break { page-break-after: always; height: 0; }
          @page { size: A4 portrait; margin: 0; }
        }

        .print-btn {
          position: fixed; top: 20px; right: 20px; z-index: 9999;
          background: #1a1a1a; color: white; border: none; border-radius: 12px;
          padding: 10px 20px; font-size: 14px; font-weight: 600;
          cursor: pointer; display: flex; align-items: center; gap: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        .print-btn:hover { background: #333; }

        .page {
          width: 210mm; min-height: 297mm; background: white;
          margin: 20px auto; padding: 15mm 15mm 12mm;
          box-shadow: 0 4px 24px rgba(0,0,0,0.12); border-radius: 4px;
        }

        .cover {
          display: flex; flex-direction: column;
          justify-content: space-between; height: 267mm;
        }
        .cover-top { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; padding-top: 40mm; }
        .cover-badge {
          display: inline-block; background: #1e3a5f; color: white;
          font-size: 10px; font-weight: 700; letter-spacing: 2px;
          padding: 6px 14px; border-radius: 4px; margin-bottom: 20px;
          text-transform: uppercase;
        }
        .cover-title { font-size: 28px; font-weight: 900; color: #1a1a1a; line-height: 1.25; margin-bottom: 10px; }
        .cover-subtitle { font-size: 14px; color: #666; margin-bottom: 32px; }
        .cover-divider { width: 60px; height: 4px; background: #1e3a5f; border-radius: 2px; margin-bottom: 32px; }
        .cover-meta { font-size: 12px; color: #444; line-height: 2; }
        .cover-meta strong { color: #1a1a1a; }
        .cover-footer {
          border-top: 2px solid #1e3a5f; padding-top: 16px;
          display: flex; justify-content: space-between; align-items: center;
        }
        .cover-company { font-size: 13px; font-weight: 700; color: #1e3a5f; }
        .cover-page-num { font-size: 11px; color: #888; }

        .page-header {
          display: flex; justify-content: space-between; align-items: center;
          border-bottom: 2px solid #1e3a5f; margin-bottom: 20px; padding-bottom: 10px;
        }
        .page-header-title { font-size: 11px; font-weight: 600; color: #1e3a5f; }
        .page-header-date { font-size: 10px; color: #888; }

        .section-title {
          font-size: 14px; font-weight: 800; color: #1a1a1a;
          margin: 20px 0 12px; display: flex; align-items: center; gap: 10px;
        }
        .section-number {
          background: #1e3a5f; color: white;
          width: 22px; height: 22px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; flex-shrink: 0;
        }

        .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 8px; }
        .kpi-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 8px; }
        .kpi-card {
          border: 1.5px solid #e5e7eb; border-radius: 8px; padding: 12px 10px;
          text-align: center; background: #fafafa;
        }
        .kpi-value { font-size: 26px; font-weight: 900; color: #1e3a5f; line-height: 1; }
        .kpi-label { font-size: 10px; color: #666; margin-top: 5px; font-weight: 600; }
        .kpi-sub { font-size: 9px; color: #999; margin-top: 2px; }

        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .chart-box { border: 1.5px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
        .chart-box-title {
          font-size: 11px; font-weight: 700; color: #1a1a1a;
          padding: 8px 12px; background: #f8f9fa; border-bottom: 1px solid #e5e7eb;
        }
        .chart-box-body { padding: 8px 4px; }

        .print-table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 4px; }
        .print-table th {
          background: #1e3a5f; color: white; padding: 7px 10px;
          text-align: left; font-weight: 600; font-size: 10px;
        }
        .print-table td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; }
        .print-table tr:nth-child(even) td { background: #f9fafb; }
        .print-table tr:last-child td { border-bottom: none; }

        .status-bar-wrap { margin: 4px 0; }
        .status-bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .status-bar-label { font-size: 11px; font-weight: 600; width: 60px; flex-shrink: 0; }
        .status-bar-track { flex: 1; height: 10px; background: #e5e7eb; border-radius: 5px; overflow: hidden; }
        .status-bar-fill { height: 100%; border-radius: 5px; }
        .status-bar-count { font-size: 11px; font-weight: 700; width: 40px; text-align: right; flex-shrink: 0; }
        .status-bar-pct { font-size: 9px; color: #888; width: 36px; text-align: right; flex-shrink: 0; }

        .summary-note { font-size: 9.5px; color: #888; margin-top: 6px; line-height: 1.6; }
        .badge-red { display: inline-block; background: #fee2e2; color: #dc2626; border-radius: 4px; padding: 1px 6px; font-size: 9px; font-weight: 700; }
        .badge-amber { display: inline-block; background: #fef3c7; color: #b45309; border-radius: 4px; padding: 1px 6px; font-size: 9px; font-weight: 700; }
        .highlight-row td { font-weight: 700; color: #dc2626 !important; background: #fff5f5 !important; }
      `}</style>

      <button className="print-btn no-print" onClick={() => window.print()}>
        <Printer size={16} /> 인쇄 / PDF 저장
      </button>

      {/* ─── 표지 ─── */}
      <div className="page">
        <div className="cover">
          <div className="cover-top">
            <span className="cover-badge">{isManagement ? "Management Report" : "Analysis Report"}</span>
            <div className="cover-title">{reportTitle}</div>
            <div className="cover-subtitle">{reportSubtitle}</div>
            <div className="cover-divider" />
            <div className="cover-meta">
              <div><strong>작성일</strong> &nbsp;&nbsp; {format(today, "yyyy년 MM월 dd일", { locale: ko })}</div>
              <div><strong>보고 기준</strong> &nbsp;&nbsp; 전체 기간 누계</div>
              <div><strong>총 부적합 건수</strong> &nbsp;&nbsp; {total.toLocaleString()}건</div>
              {longPendingCount > 0 && (
                <div><strong>장기미결 현황</strong> &nbsp;&nbsp; <span style={{ color: "#dc2626", fontWeight: 700 }}>{longPendingCount}건 (5일↑ 미결)</span></div>
              )}
            </div>
          </div>
          <div className="cover-footer">
            <div className="cover-company">수산세보틱스 품질관리팀</div>
            <div className="cover-page-num">공정 부적합 등록 및 관리 시스템</div>
          </div>
        </div>
      </div>

      {/* ─── Page 2: 핵심 지표 + 처리상태 현황 ─── */}
      <div className="page">
        <div className="page-header">
          <span className="page-header-title">{reportTitle}</span>
          <span className="page-header-date">{format(today, "yyyy.MM.dd")}</span>
        </div>

        <SectionTitle number="1" title="핵심 지표 (KPI)" />
        <div className="kpi-grid">
          <KpiCard label="전체 건수" value={total.toLocaleString()} sub="건" />
          <KpiCard label="접수" value={openCount.toLocaleString()} sub="건" />
          <KpiCard label="조치 중" value={inProgressCount.toLocaleString()} sub="건" />
          <KpiCard label="판정완료" value={doneCount.toLocaleString()} sub="건" />
          <KpiCard
            label="장기미결 (5일↑)"
            value={longPendingCount.toLocaleString()}
            sub={longPendingCount > 0 ? "⚠ 요주의" : "양호"}
          />
        </div>
        <div className="summary-note">
          * 처리율: {total > 0 ? ((doneCount / total) * 100).toFixed(1) : 0}% &nbsp;|&nbsp;
          미결율: {total > 0 ? (((openCount + inProgressCount) / total) * 100).toFixed(1) : 0}% &nbsp;|&nbsp;
          평균 손실공수: {ds?.totalLostManHours && total > 0 ? (ds.totalLostManHours / total).toFixed(1) : 0}H/건
        </div>

        <SectionTitle number="2" title="처리상태별 현황" />
        <div className="two-col">
          <div>
            <div className="status-bar-wrap">
              {[
                { label: "접수", count: openCount, color: "#2563eb" },
                { label: "조치 중", count: inProgressCount, color: "#f59e0b" },
                { label: "판정완료", count: doneCount, color: "#16a34a" },
              ].map(({ label, count, color }) => (
                <div className="status-bar-row" key={label}>
                  <span className="status-bar-label">{label}</span>
                  <div className="status-bar-track">
                    <div className="status-bar-fill" style={{ width: `${total > 0 ? (count / total) * 100 : 0}%`, background: color }} />
                  </div>
                  <span className="status-bar-count">{count}건</span>
                  <span className="status-bar-pct">{total > 0 ? ((count / total) * 100).toFixed(1) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ height: 140 }}>
            {statusPieData.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={9}>
                    {statusPieData.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v}건`]} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <SectionTitle number="3" title={`라인별 불량 건수 (상위 ${processData.length}개)`} />
        <div className="chart-box">
          <div className="chart-box-title">공정(라인)별 발생 건수</div>
          <div className="chart-box-body">
            {processData.length > 0 ? (
              <ResponsiveContainer width="100%" height={processData.length * 22 + 20}>
                <BarChart data={processData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip contentStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="count" name="건수" fill="#1e3a5f" radius={[0, 4, 4, 0]} maxBarSize={16} label={{ position: "right", fontSize: 9, fill: "#333" }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p style={{ textAlign: "center", fontSize: "11px", color: "#888", padding: "20px" }}>데이터 없음</p>}
          </div>
        </div>
      </div>

      {/* ─── Page 3: 업체 현황 + 월별 추이 ─── */}
      <div className="page">
        <div className="page-header">
          <span className="page-header-title">{reportTitle}</span>
          <span className="page-header-date">{format(today, "yyyy.MM.dd")}</span>
        </div>

        <SectionTitle number="4" title={`업체 WORST ${vendorData.length} (불량 건수 기준)`} />
        <DataTable
          headers={["순위", "거래처명", "불량 건수", "비율"]}
          rows={vendorData.map((v, i) => [
            i + 1,
            v.name,
            `${v.count}건`,
            `${total > 0 ? ((v.count / total) * 100).toFixed(1) : 0}%`,
          ])}
        />

        <SectionTitle number="5" title="월별 발생 추이 (최근 12개월)" />
        <div className="chart-box">
          <div className="chart-box-title">월별 부적합 발생 건수 추이</div>
          <div className="chart-box-body">
            {monthData.length > 0 ? (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={monthData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: "11px" }} />
                  <Line type="monotone" dataKey="count" name="발생 건수" stroke="#1e3a5f" strokeWidth={2} dot={{ fill: "#1e3a5f", r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p style={{ textAlign: "center", fontSize: "11px", color: "#888", padding: "20px" }}>데이터 없음</p>}
          </div>
        </div>

        {monthData.length > 0 && (
          <>
            <div style={{ marginTop: 8 }}>
              <DataTable
                headers={["월", "발생 건수", "전월 대비"]}
                rows={monthData.map((m, i) => {
                  const prev = i > 0 ? monthData[i - 1].count : null;
                  const diff = prev !== null ? m.count - prev : null;
                  return [
                    m.name,
                    `${m.count}건`,
                    diff === null ? "-" : diff > 0 ? `+${diff}건 ▲` : diff < 0 ? `${diff}건 ▼` : "0건 →",
                  ];
                })}
              />
            </div>
          </>
        )}

        {!isManagement && (
          <>
            <SectionTitle number="6" title="유형별 불량 현황" />
            <div className="two-col">
              <div className="chart-box">
                <div className="chart-box-title">불량 유형 분포</div>
                <div className="chart-box-body">
                  {flawData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={flawData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 8 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ fontSize: "11px" }} />
                        <Bar dataKey="count" name="건수" radius={[4, 4, 0, 0]} maxBarSize={30}>
                          {flawData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p style={{ textAlign: "center", fontSize: "11px", color: "#888", padding: "20px" }}>데이터 없음</p>}
                </div>
              </div>
              <div>
                <DataTable
                  headers={["유형코드", "건수", "비율"]}
                  rows={flawData.map(f => [f.name, `${f.count}건`, `${total > 0 ? ((f.count / total) * 100).toFixed(1) : 0}%`])}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ─── Page 4 (분석용): 귀책부서 + 장기미결 ─── */}
      {!isManagement && (
        <div className="page">
          <div className="page-header">
            <span className="page-header-title">{reportTitle}</span>
            <span className="page-header-date">{format(today, "yyyy.MM.dd")}</span>
          </div>

          <SectionTitle number="7" title="귀책부서별 현황" />
          <div className="two-col">
            <div className="chart-box">
              <div className="chart-box-title">부서별 귀책 건수</div>
              <div className="chart-box-body">
                {deptData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={deptData.length * 22 + 20}>
                    <BarChart data={deptData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} width={80} />
                      <Tooltip contentStyle={{ fontSize: "11px" }} />
                      <Bar dataKey="count" name="건수" fill="#9333ea" radius={[0, 4, 4, 0]} maxBarSize={14} label={{ position: "right", fontSize: 9, fill: "#333" }} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p style={{ textAlign: "center", fontSize: "11px", color: "#888", padding: "20px" }}>데이터 없음</p>}
              </div>
            </div>
            <div>
              <DataTable
                headers={["부서명", "건수", "비율"]}
                rows={deptData.map(d => [d.name, `${d.count}건`, `${total > 0 ? ((d.count / total) * 100).toFixed(1) : 0}%`])}
              />
            </div>
          </div>

          <SectionTitle number="8" title={`장기미결 현황 (5일 이상, 총 ${longPendingList.length}건)`} />
          {longPendingList.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px", background: "#f0fdf4", borderRadius: "8px", border: "1.5px solid #bbf7d0" }}>
              <p style={{ fontSize: "12px", color: "#16a34a", fontWeight: 700 }}>장기미결 건이 없습니다 ✓</p>
            </div>
          ) : (() => {
            const PAGE_SIZE = 30;
            const chunks: typeof longPendingList[] = [];
            for (let i = 0; i < longPendingList.length; i += PAGE_SIZE) {
              chunks.push(longPendingList.slice(i, i + PAGE_SIZE));
            }
            return chunks.map((chunk, ci) => (
              <div key={ci}>
                {ci === 0 && (
                  <div style={{ background: "#fff5f5", border: "1.5px solid #fecaca", borderRadius: "8px", padding: "8px 12px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "11px", color: "#dc2626", fontWeight: 700 }}>
                      ⚠ {longPendingList.length}건의 보고서가 5일 이상 미결 상태입니다. 즉각적인 조치가 필요합니다.
                    </span>
                  </div>
                )}
                {ci > 0 && (
                  <div style={{ fontSize: "10px", color: "#888", marginBottom: "6px" }}>
                    ({ci * PAGE_SIZE + 1}–{Math.min((ci + 1) * PAGE_SIZE, longPendingList.length)}번 / 총 {longPendingList.length}건)
                  </div>
                )}
                <DataTable
                  headers={["No", "NCR 번호", "품목코드", "공정명", "발생일", "처리상태", "경과일"]}
                  rows={chunk.map((r, i) => [
                    ci * PAGE_SIZE + i + 1,
                    r.ncrNumber ?? `#${r.id}`,
                    r.itemCode,
                    r.processName,
                    r.occurrenceDate ? format(new Date(r.occurrenceDate), "yyyy-MM-dd") : "-",
                    QC_LABELS[r.qcStatus ?? ""] ?? r.qcStatus ?? "-",
                    `${r.daysElapsed}일`,
                  ])}
                />
                {ci < chunks.length - 1 && <PageBreak />}
              </div>
            ));
          })()}

          <div style={{ marginTop: "auto", paddingTop: "20px", borderTop: "1px solid #e5e7eb" }}>
            <p style={{ fontSize: "9px", color: "#aaa", textAlign: "center" }}>
              본 보고서는 수산세보틱스 공정 부적합 등록 및 관리 시스템에서 자동 생성되었습니다. &nbsp;|&nbsp; 생성일시: {format(today, "yyyy-MM-dd HH:mm")}
            </p>
          </div>
        </div>
      )}

      {/* 보고용 마지막 페이지 하단 */}
      {isManagement && (
        <div className="page" style={{ minHeight: "auto", padding: "15mm" }}>
          <div className="page-header">
            <span className="page-header-title">{reportTitle}</span>
            <span className="page-header-date">{format(today, "yyyy.MM.dd")}</span>
          </div>
          <SectionTitle number="6" title="종합 의견 및 향후 조치 계획" />
          <div style={{ border: "1.5px solid #e5e7eb", borderRadius: "8px", padding: "16px", minHeight: "80mm", background: "#fafafa" }}>
            <p style={{ fontSize: "11px", color: "#999", lineHeight: "2" }}>
              (인쇄 후 수기 작성 또는 담당자 의견 입력)
            </p>
          </div>
          <div style={{ marginTop: "20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            {["작성자", "검토자", "승인자"].map(role => (
              <div key={role} style={{ border: "1.5px solid #e5e7eb", borderRadius: "8px", padding: "12px", textAlign: "center", minHeight: "50px" }}>
                <p style={{ fontSize: "10px", color: "#666", marginBottom: "8px", fontWeight: 600 }}>{role}</p>
                <div style={{ borderBottom: "1px solid #ccc", marginTop: "20px" }} />
                <p style={{ fontSize: "9px", color: "#aaa", marginTop: "4px" }}>(서명)</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "24px", borderTop: "1px solid #e5e7eb", paddingTop: "12px" }}>
            <p style={{ fontSize: "9px", color: "#aaa", textAlign: "center" }}>
              본 보고서는 수산세보틱스 공정 부적합 등록 및 관리 시스템에서 자동 생성되었습니다. &nbsp;|&nbsp; 생성일시: {format(today, "yyyy-MM-dd HH:mm")}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
