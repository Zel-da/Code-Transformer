import { Layout } from "@/components/layout";
import { useGetReportStats } from "@workspace/api-client-react";
import { format } from "date-fns";
import { BarChart3, Clock, CheckCircle2, XCircle, Lock, FlaskConical } from "lucide-react";

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  dot,
}: {
  title: string;
  value: number;
  subtitle?: string;
  icon: React.ElementType;
  dot?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#F2F4F6] px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-[#8B95A1]">{title}</span>
        {dot && <span className={`w-2 h-2 rounded-full ${dot}`}></span>}
        {!dot && <Icon className="h-3.5 w-3.5 text-[#BEC5CC]" />}
      </div>
      <div className="text-[22px] font-bold text-[#191F28] tracking-tight leading-tight">{value}</div>
      {subtitle && <div className="text-[10px] text-[#8B95A1] mt-0.5">{subtitle}</div>}
    </div>
  );
}

export default function AdminDashboard() {
  const { data: stats } = useGetReportStats();

  return (
    <Layout>
      <div className="max-w-[1400px] mx-auto px-5 py-5 space-y-5 pb-24">

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pt-1">
          <h1 className="text-[20px] font-bold text-[#191F28]">대시보드</h1>
          <p className="text-[12px] text-[#8B95A1]">{format(new Date(), "yyyy년 MM월 dd일 HH:mm")}</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            title="전체 보고서"
            value={stats?.total ?? 0}
            subtitle={`최근 7일 ${stats?.recentCount ?? 0}건`}
            icon={BarChart3}
          />
          <StatCard
            title="동기화 대기"
            value={stats?.bySyncStatus.find((s) => s.label === "PENDING")?.count ?? 0}
            icon={Clock}
            dot="bg-amber-400"
          />
          <StatCard
            title="동기화 실패"
            value={stats?.bySyncStatus.find((s) => s.label === "FAILED")?.count ?? 0}
            icon={XCircle}
            dot="bg-red-400"
          />
          <StatCard
            title="동기화 완료"
            value={stats?.bySyncStatus.find((s) => s.label === "COMPLETED")?.count ?? 0}
            icon={CheckCircle2}
            dot="bg-emerald-400"
          />
          <StatCard
            title="SLA 잠금"
            value={stats?.lockedCount ?? 0}
            icon={Lock}
            dot="bg-slate-400"
          />
          <StatCard
            title="연구소 대기"
            value={stats?.pendingLabCount ?? 0}
            subtitle="개발품 랩 통보 미완료"
            icon={FlaskConical}
            dot="bg-violet-400"
          />
        </div>

      </div>
    </Layout>
  );
}
