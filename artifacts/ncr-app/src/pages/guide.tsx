import { Layout } from "@/components/layout";
import { useState } from "react";
import { useAuth } from "@/contexts/auth";
import {
  BookOpen, FileWarning, FlaskConical, Settings2, ChevronRight,
  CheckCircle2, Circle, ArrowRight, MessageSquare, Bell,
  ClipboardList, Search, Filter, Upload, Save, Eye,
  UserPlus, Webhook, Bot, BarChart3, ChevronDown, ChevronUp,
  Zap, Shield, AlertTriangle,
} from "lucide-react";

type Section = "overview" | "submit" | "ledger" | "qc" | "admin" | "notify";

interface StepProps {
  number: number;
  title: string;
  description: string;
  sub?: string[];
  highlight?: boolean;
}

function Step({ number, title, description, sub, highlight }: StepProps) {
  return (
    <div className={`flex gap-4 p-4 rounded-xl border transition-all ${
      highlight
        ? "border-[#1A1A1A] bg-[#F8F9FA]"
        : "border-[#F2F4F6] bg-white"
    }`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold ${
        highlight ? "bg-[#1A1A1A] text-white" : "bg-[#F2F4F6] text-[#4E5968]"
      }`}>
        {number}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[14px] text-[#191F28] mb-0.5">{title}</p>
        <p className="text-[13px] text-[#4E5968] leading-relaxed">{description}</p>
        {sub && sub.length > 0 && (
          <ul className="mt-2 space-y-1">
            {sub.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px] text-[#8B95A1]">
                <span className="mt-0.5 text-[#BEC5CC]">•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface AccordionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Accordion({ title, children, defaultOpen = false }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#F2F4F6] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3.5 bg-white hover:bg-[#F8F9FA] transition-colors text-left"
      >
        <span className="font-semibold text-[14px] text-[#191F28]">{title}</span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-[#8B95A1] flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[#8B95A1] flex-shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 bg-white border-t border-[#F2F4F6] space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

const STATUS_FLOW = [
  { key: "OPEN", label: "접수", color: "bg-blue-100 text-blue-700 border-blue-200", desc: "보고서가 등록된 초기 상태" },
  { key: "IN_REVIEW", label: "검토 중", color: "bg-amber-100 text-amber-700 border-amber-200", desc: "QC 담당자가 검토 시작" },
  { key: "PENDING_COLLAB", label: "협업 대기", color: "bg-purple-100 text-purple-700 border-purple-200", desc: "타 부서 협조 필요 시" },
  { key: "RESOLVED", label: "조치 완료", color: "bg-emerald-100 text-emerald-700 border-emerald-200", desc: "원인 분석·조치 내용 입력 완료" },
  { key: "APPROVED", label: "승인 완료", color: "bg-teal-100 text-teal-700 border-teal-200", desc: "최종 승인 처리" },
  { key: "ERP_SYNCED", label: "ERP 등록", color: "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]", desc: "ERP 시스템 연동 완료" },
];

const SECTIONS = [
  { key: "overview" as Section, label: "시스템 개요", Icon: ClipboardList },
  { key: "submit" as Section, label: "보고서 등록", Icon: FileWarning },
  { key: "ledger" as Section, label: "관리대장", Icon: BookOpen },
  { key: "qc" as Section, label: "QC 분석", Icon: FlaskConical, adminOnly: true },
  { key: "admin" as Section, label: "관리자 패널", Icon: Settings2, adminOnly: true },
  { key: "notify" as Section, label: "수산톡 알림", Icon: Bell },
];

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const visibleSections = SECTIONS.filter(s => !s.adminOnly || isAdmin);

  return (
    <Layout>
      <div className="max-w-[1200px] mx-auto px-4 py-6 md:py-8">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-[#191F28] flex items-center gap-2.5">
            <div className="bg-[#1A1A1A] text-white p-1.5 rounded-lg">
              <BookOpen className="h-4 w-4" />
            </div>
            사용 가이드
          </h1>
          <p className="text-[13px] text-[#8B95A1] mt-1">
            부적합 보고 시스템(NCR) 전체 기능 안내 및 단계별 사용 방법입니다.
          </p>
        </div>

        <div className="flex gap-6 flex-col md:flex-row">
          {/* 사이드 네비 */}
          <aside className="md:w-48 flex-shrink-0">
            <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
              {visibleSections.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap flex-shrink-0 md:w-full ${
                    activeSection === key
                      ? "bg-[#1A1A1A] text-white"
                      : "text-[#4E5968] hover:bg-[#F2F4F6]"
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {label}
                </button>
              ))}
            </nav>
          </aside>

          {/* 본문 */}
          <main className="flex-1 min-w-0 space-y-4">
            {/* ─── 시스템 개요 ─── */}
            {activeSection === "overview" && (
              <div className="space-y-5">
                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <h2 className="text-[17px] font-bold text-[#191F28] mb-3">시스템 개요</h2>
                  <p className="text-[14px] text-[#4E5968] leading-relaxed">
                    <strong className="text-[#191F28]">부적합 보고 시스템(NCR)</strong>은 수산세보틱스 제조 현장에서 발생하는
                    공정·품질 부적합 사항을 온라인으로 접수하고, QC 담당자가 검토·조치·승인까지 관리하는 내부 플랫폼입니다.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                    {[
                      { Icon: FileWarning, label: "보고서 등록", desc: "부적합 발생 즉시 온라인 접수" },
                      { Icon: BookOpen, label: "관리대장", desc: "전체 보고서 현황 조회·분석" },
                      { Icon: FlaskConical, label: "QC 분석", desc: "검토·조치·승인 처리 (관리자)", admin: true },
                      { Icon: Bell, label: "수산톡 알림", desc: "상태 변경 시 DM 자동 발송" },
                    ].map(({ Icon, label, desc, admin }) => (
                      (!admin || isAdmin) && (
                        <div key={label} className="flex items-start gap-3 p-3.5 rounded-xl bg-[#F8F9FA] border border-[#F2F4F6]">
                          <div className="bg-[#1A1A1A] text-white p-2 rounded-lg flex-shrink-0">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-semibold text-[13px] text-[#191F28]">{label}</p>
                            <p className="text-[12px] text-[#8B95A1] mt-0.5">{desc}</p>
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                </div>

                {/* 처리 흐름 */}
                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <h2 className="text-[17px] font-bold text-[#191F28] mb-1">처리 흐름</h2>
                  <p className="text-[13px] text-[#8B95A1] mb-4">보고서가 접수된 후 최종 ERP 등록까지의 상태 변화입니다.</p>
                  <div className="flex flex-col gap-2">
                    {STATUS_FLOW.map((s, i) => (
                      <div key={s.key} className="flex items-start gap-3">
                        <div className="flex flex-col items-center">
                          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${s.color} whitespace-nowrap`}>
                            {s.label}
                          </span>
                          {i < STATUS_FLOW.length - 1 && (
                            <div className="w-px h-4 bg-[#E5E8EB] mt-1" />
                          )}
                        </div>
                        <p className="text-[13px] text-[#4E5968] pt-0.5">{s.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 역할 안내 */}
                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <h2 className="text-[17px] font-bold text-[#191F28] mb-3">역할별 권한</h2>
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl border border-[#F2F4F6]">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="h-4 w-4 text-[#1A1A1A]" />
                        <span className="font-semibold text-[13px] text-[#191F28]">일반 사용자</span>
                      </div>
                      <ul className="space-y-1 text-[13px] text-[#4E5968]">
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> 보고서 등록 (접수)</li>
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> 관리대장 조회</li>
                      </ul>
                    </div>
                    <div className="p-3.5 rounded-xl border border-[#1A1A1A] bg-[#F8F9FA]">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="h-4 w-4 text-[#1A1A1A]" />
                        <span className="font-semibold text-[13px] text-[#191F28]">관리자 (Admin)</span>
                        <span className="text-[10px] bg-[#1A1A1A] text-white px-1.5 py-0.5 rounded">현재 권한</span>
                      </div>
                      <ul className="space-y-1 text-[13px] text-[#4E5968]">
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> 보고서 등록 + 관리대장</li>
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> QC 분석 — 검토·조치·승인</li>
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> 관리자 패널 — 사용자·부서·RPA 관리</li>
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> 보고서 수정·삭제</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── 보고서 등록 ─── */}
            {activeSection === "submit" && (
              <div className="space-y-5">
                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <FileWarning className="h-5 w-5 text-[#1A1A1A]" />
                    <h2 className="text-[17px] font-bold text-[#191F28]">보고서 등록</h2>
                  </div>
                  <p className="text-[13px] text-[#8B95A1] mb-4">
                    현장에서 부적합이 발생했을 때 즉시 보고서를 등록합니다.
                    상단 메뉴 <strong className="text-[#191F28]">보고서 등록</strong>을 클릭하세요.
                  </p>

                  <div className="space-y-3">
                    <Step number={1} title="공장 선택" description="아산공장 또는 화성공장을 선택합니다." highlight />
                    <Step
                      number={2}
                      title="품목 검색"
                      description="ERP에서 품목코드 또는 품목명을 검색해 선택합니다."
                      sub={["검색창에 품목명 일부를 입력하면 자동완성 목록이 표시됩니다.", "선택하면 품목코드·모델명이 자동으로 채워집니다."]}
                    />
                    <Step
                      number={3}
                      title="공정 선택"
                      description="부적합이 발생한 공정을 선택합니다."
                      sub={["목록에 없으면 관리자에게 공정 추가를 요청하세요."]}
                    />
                    <Step
                      number={4}
                      title="부적합 정보 입력"
                      description="불량 수량, 발생일, 불량 유형, 담당 협력사 등을 입력합니다."
                      sub={[
                        "불량 수량: 실제 발생한 부적합 수량 (숫자만 입력)",
                        "발생일: 부적합이 처음 발견된 날짜",
                        "불량 유형: 해당하는 불량 유형을 선택 (복수 선택 가능)",
                      ]}
                    />
                    <Step
                      number={5}
                      title="현장 사진 첨부 (선택)"
                      description="카메라 버튼을 눌러 부적합 현장 사진을 최대 5장까지 첨부할 수 있습니다."
                      sub={["사진은 자동으로 압축 처리됩니다.", "모바일에서는 카메라 직접 촬영도 가능합니다."]}
                    />
                    <Step
                      number={6}
                      title="특이사항 입력 (선택)"
                      description="추가 설명이 필요한 경우 자유롭게 입력합니다."
                    />
                    <Step
                      number={7}
                      title="접수하기 버튼 클릭"
                      description="모든 필수 항목 입력 후 하단의 '접수하기' 버튼을 눌러 등록을 완료합니다."
                      highlight
                    />
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[13px] font-semibold text-amber-800">등록 완료 후</p>
                    <p className="text-[13px] text-amber-700 mt-0.5">
                      보고서가 접수되면 QC 담당자에게 수산톡 DM 알림이 자동으로 발송됩니다.
                      접수된 보고서는 <strong>관리대장</strong>에서 확인할 수 있습니다.
                    </p>
                  </div>
                </div>

                <Accordion title="자주 묻는 질문 — 보고서 등록" defaultOpen>
                  <div className="space-y-3 text-[13px] text-[#4E5968]">
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. 품목 검색이 안 됩니다.</p>
                      <p className="mt-0.5">ERP 연동 품목만 검색됩니다. 공장 선택을 먼저 하신 후 검색해 주세요. 그래도 안 되면 관리자에게 문의하세요.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. 등록한 보고서를 수정하고 싶습니다.</p>
                      <p className="mt-0.5">일반 사용자는 등록 후 수정이 불가합니다. 관리자에게 수정 요청하거나, 관리자 패널에서 직접 수정 가능합니다.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. 사진을 5장 이상 올리고 싶습니다.</p>
                      <p className="mt-0.5">현재 최대 5장까지 첨부 가능합니다. 중요도 순으로 선별해서 올려주세요.</p>
                    </div>
                  </div>
                </Accordion>
              </div>
            )}

            {/* ─── 관리대장 ─── */}
            {activeSection === "ledger" && (
              <div className="space-y-5">
                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className="h-5 w-5 text-[#1A1A1A]" />
                    <h2 className="text-[17px] font-bold text-[#191F28]">관리대장</h2>
                  </div>
                  <p className="text-[13px] text-[#8B95A1] mb-4">
                    전체 부적합 보고서 목록과 통계를 확인합니다.
                    상단 메뉴 <strong className="text-[#191F28]">관리대장</strong>을 클릭하세요.
                  </p>
                  <div className="space-y-3">
                    <Step
                      number={1}
                      title="검색 및 필터"
                      description="상단 검색창에 품목명·모델명·보고서 번호로 검색하거나, 상태·공장·공정 필터를 적용합니다."
                      sub={["필터는 복수 조합 가능합니다.", "검색 후 새로고침(↺) 버튼으로 최신 데이터를 불러옵니다."]}
                      highlight
                    />
                    <Step
                      number={2}
                      title="목록 확인"
                      description="테이블에서 보고서 번호, 품목, 공정, QC 상태, 경과일 등을 한눈에 확인합니다."
                      sub={[
                        "7일 이상 경과된 미처리 보고서는 빨간색 경고 배지가 표시됩니다.",
                        "5~6일 경과 시 주황색 경고 배지가 표시됩니다.",
                      ]}
                    />
                    <Step
                      number={3}
                      title="상세 보기"
                      description="목록에서 행을 클릭하면 오른쪽(또는 하단)에 상세 패널이 열립니다."
                      sub={[
                        "보고서 전체 내용·사진·처리 이력을 확인할 수 있습니다.",
                        "댓글 기능으로 담당자 간 소통이 가능합니다.",
                      ]}
                    />
                    <Step
                      number={4}
                      title="통계 차트"
                      description="상단 통계 카드와 불량 유형별 차트로 전체 현황을 파악합니다."
                      sub={[
                        "총 건수, 미처리, 지연(7일 초과) 건수가 표시됩니다.",
                        "불량 유형별 빈도 차트로 반복 불량 패턴을 파악할 수 있습니다.",
                      ]}
                    />
                  </div>
                </div>

                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <h3 className="text-[15px] font-bold text-[#191F28] mb-3">상태 아이콘 의미</h3>
                  <div className="space-y-2">
                    {STATUS_FLOW.map(s => (
                      <div key={s.key} className="flex items-center gap-3">
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border w-20 text-center ${s.color}`}>
                          {s.label}
                        </span>
                        <span className="text-[13px] text-[#4E5968]">{s.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Accordion title="자주 묻는 질문 — 관리대장">
                  <div className="space-y-3 text-[13px] text-[#4E5968]">
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. 목록을 Excel로 내보낼 수 있나요?</p>
                      <p className="mt-0.5">현재 Excel 직접 내보내기는 지원되지 않습니다. 관리자 패널 → RPA 동기화를 통해 ERP로 데이터를 전송할 수 있습니다.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. 오래된 보고서가 검색이 안 됩니다.</p>
                      <p className="mt-0.5">기본적으로 최근 보고서부터 표시됩니다. 필터를 '전체'로 설정하고 검색해 보세요.</p>
                    </div>
                  </div>
                </Accordion>
              </div>
            )}

            {/* ─── QC 분석 ─── */}
            {activeSection === "qc" && isAdmin && (
              <div className="space-y-5">
                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <FlaskConical className="h-5 w-5 text-[#1A1A1A]" />
                    <h2 className="text-[17px] font-bold text-[#191F28]">QC 분석</h2>
                  </div>
                  <p className="text-[13px] text-[#8B95A1] mb-4">
                    접수된 보고서를 검토·분석하고 조치 내용을 입력한 뒤 승인 처리합니다.
                    상단 메뉴 <strong className="text-[#191F28]">QC 분석</strong>을 클릭하세요.
                  </p>
                  <div className="space-y-3">
                    <Step
                      number={1}
                      title="보고서 목록 확인"
                      description="QC 분석 화면에서 상태별로 필터링된 보고서 목록을 확인합니다."
                      sub={[
                        "'미완료' 탭: 처리가 필요한 보고서만 표시 (기본값)",
                        "상태별 탭으로 전환하여 특정 단계 보고서만 볼 수 있습니다.",
                      ]}
                      highlight
                    />
                    <Step
                      number={2}
                      title="보고서 클릭 → 상세 화면 진입"
                      description="목록에서 처리할 보고서를 클릭해 QC 상세 화면으로 이동합니다."
                    />
                    <Step
                      number={3}
                      title="검토 시작"
                      description="QC 상세 화면 상단의 '검토 시작' 버튼을 클릭합니다."
                      sub={["상태가 '접수' → '검토 중'으로 변경됩니다.", "담당자에게 수산톡 알림이 발송됩니다."]}
                      highlight
                    />
                    <Step
                      number={4}
                      title="QC 정보 입력"
                      description="원인 분석, 불량 유형 분류, 처리 방법, 담당 부서 등을 입력합니다."
                      sub={[
                        "불량 유형: 외관·치수·기능·재료 등 세부 분류 선택",
                        "처리 방법: 폐기·수리·재작업·특채 등 선택",
                        "협업 부서가 필요하면 '협업 대기' 상태로 전환 가능합니다.",
                      ]}
                    />
                    <Step
                      number={5}
                      title="저장"
                      description="입력 내용을 저장합니다. 저장 후에도 수정 가능합니다."
                    />
                    <Step
                      number={6}
                      title="조치 완료 처리"
                      description="모든 조치가 완료되면 '조치 완료' 버튼을 클릭합니다."
                      sub={["상태가 '조치 완료'로 변경됩니다."]}
                    />
                    <Step
                      number={7}
                      title="최종 승인"
                      description="'승인' 버튼을 클릭해 보고서를 최종 승인 처리합니다."
                      sub={["상태가 '승인 완료'로 변경됩니다.", "이후 ERP 동기화 단계로 이동합니다."]}
                      highlight
                    />
                  </div>
                </div>

                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <h3 className="text-[15px] font-bold text-[#191F28] mb-3">댓글 & 이력</h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-[#F8F9FA]">
                      <MessageSquare className="h-4 w-4 text-[#4E5968] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-[13px] text-[#191F28]">댓글 기능</p>
                        <p className="text-[13px] text-[#4E5968] mt-0.5">담당자 간 추가 소통은 QC 상세 화면 하단 댓글창에서 할 수 있습니다.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-[#F8F9FA]">
                      <Eye className="h-4 w-4 text-[#4E5968] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-[13px] text-[#191F28]">감사 이력</p>
                        <p className="text-[13px] text-[#4E5968] mt-0.5">상태 변경·수정 이력이 타임라인 형태로 자동 기록됩니다.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <Accordion title="자주 묻는 질문 — QC 분석">
                  <div className="space-y-3 text-[13px] text-[#4E5968]">
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. 실수로 승인 처리했습니다.</p>
                      <p className="mt-0.5">승인 완료 후 되돌리기는 관리자 패널에서만 가능합니다. 관리자 패널 → 보고서 관리에서 상태를 직접 수정하세요.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. '협업 대기'는 어떤 경우에 사용하나요?</p>
                      <p className="mt-0.5">타 부서(생산, 구매, 설계 등)의 확인이나 조치가 필요할 때 사용합니다. 해당 부서에 알림이 발송됩니다.</p>
                    </div>
                  </div>
                </Accordion>
              </div>
            )}

            {/* ─── 관리자 패널 ─── */}
            {activeSection === "admin" && isAdmin && (
              <div className="space-y-5">
                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Settings2 className="h-5 w-5 text-[#1A1A1A]" />
                    <h2 className="text-[17px] font-bold text-[#191F28]">관리자 패널</h2>
                  </div>
                  <p className="text-[13px] text-[#8B95A1] mb-4">
                    사용자·부서·RPA 등 시스템 전반을 관리합니다.
                    상단 메뉴 <strong className="text-[#191F28]">관리자 패널</strong>을 클릭하세요.
                  </p>

                  <div className="space-y-4">
                    {/* 사용자 탭 */}
                    <div className="border border-[#F2F4F6] rounded-xl overflow-hidden">
                      <div className="bg-[#F8F9FA] px-4 py-2.5 flex items-center gap-2 border-b border-[#F2F4F6]">
                        <UserPlus className="h-4 w-4 text-[#4E5968]" />
                        <span className="font-semibold text-[13px] text-[#191F28]">탭 ① 사용자 관리</span>
                      </div>
                      <div className="p-4 space-y-2.5">
                        <Step number={1} title="사용자 목록 확인" description="현재 등록된 전체 사용자와 역할, 활성 상태를 확인합니다." />
                        <Step number={2} title="신규 사용자 추가" description="'+ 사용자 추가' 버튼 클릭 → 이름, 아이디, 이메일, 비밀번호, 역할 입력 후 저장합니다." highlight />
                        <Step number={3} title="비밀번호 변경" description="사용자 행의 '비밀번호 변경' 버튼으로 임시 비밀번호를 재설정합니다." />
                        <Step number={4} title="계정 활성/비활성" description="사용자를 비활성화하면 로그인이 차단됩니다. 퇴사자 처리 시 활용하세요." />
                      </div>
                    </div>

                    {/* 부서 탭 */}
                    <div className="border border-[#F2F4F6] rounded-xl overflow-hidden">
                      <div className="bg-[#F8F9FA] px-4 py-2.5 flex items-center gap-2 border-b border-[#F2F4F6]">
                        <Webhook className="h-4 w-4 text-[#4E5968]" />
                        <span className="font-semibold text-[13px] text-[#191F28]">탭 ② 부서 / Webhook 설정</span>
                      </div>
                      <div className="p-4 space-y-2.5">
                        <Step number={1} title="부서 목록 확인" description="수산톡 알림을 받는 부서 목록과 Webhook URL을 확인합니다." />
                        <Step number={2} title="Webhook URL 설정" description="각 부서의 수산톡 Webhook URL을 입력·저장합니다. URL이 없으면 해당 부서 알림이 발송되지 않습니다." highlight />
                        <Step number={3} title="알림 테스트" description="'테스트 전송' 버튼으로 설정이 올바른지 확인합니다." />
                      </div>
                    </div>

                    {/* RPA 탭 */}
                    <div className="border border-[#F2F4F6] rounded-xl overflow-hidden">
                      <div className="bg-[#F8F9FA] px-4 py-2.5 flex items-center gap-2 border-b border-[#F2F4F6]">
                        <Bot className="h-4 w-4 text-[#4E5968]" />
                        <span className="font-semibold text-[13px] text-[#191F28]">탭 ③ RPA 동기화</span>
                      </div>
                      <div className="p-4 space-y-2.5">
                        <Step number={1} title="동기화 대상 선택" description="ERP로 전송할 승인 완료 보고서를 확인합니다." />
                        <Step number={2} title="RPA 실행" description="'동기화 실행' 버튼을 클릭하면 RPA 봇이 ERP에 데이터를 자동 입력합니다." highlight />
                        <Step number={3} title="결과 확인" description="동기화 완료 시 상태가 'ERP 등록'으로 변경됩니다." />
                      </div>
                    </div>

                    {/* 보고서 관리 탭 */}
                    <div className="border border-[#F2F4F6] rounded-xl overflow-hidden">
                      <div className="bg-[#F8F9FA] px-4 py-2.5 flex items-center gap-2 border-b border-[#F2F4F6]">
                        <BarChart3 className="h-4 w-4 text-[#4E5968]" />
                        <span className="font-semibold text-[13px] text-[#191F28]">탭 ④ 보고서 관리</span>
                      </div>
                      <div className="p-4 space-y-2.5">
                        <Step number={1} title="전체 보고서 목록" description="모든 보고서를 검색·필터링해 확인합니다." />
                        <Step number={2} title="보고서 수정" description="보고서 내용·상태를 직접 수정합니다. (잘못된 접수 수정, 상태 되돌리기 등)" highlight />
                        <Step number={3} title="보고서 삭제" description="잘못 등록된 보고서를 삭제합니다. 삭제된 데이터는 복구되지 않으니 주의하세요." />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── 수산톡 알림 ─── */}
            {activeSection === "notify" && (
              <div className="space-y-5">
                <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Bell className="h-5 w-5 text-[#1A1A1A]" />
                    <h2 className="text-[17px] font-bold text-[#191F28]">수산톡 알림</h2>
                  </div>
                  <p className="text-[13px] text-[#8B95A1] mb-4">
                    보고서 접수·상태 변경 시 수산톡 DM으로 자동 알림이 발송됩니다.
                    DM 안의 버튼으로 앱 없이도 바로 처리할 수 있습니다.
                  </p>
                  <div className="space-y-3">
                    <Step
                      number={1}
                      title="자동 알림 발송"
                      description="다음 이벤트 발생 시 수산톡 DM이 자동 발송됩니다."
                      sub={[
                        "신규 보고서 접수 시 → QC 담당자에게 알림",
                        "상태 변경(검토 시작·조치 완료·승인 등) 시 → 관련 담당자에게 알림",
                        "7일 이상 미처리 보고서 발생 시 → 경고 알림",
                      ]}
                      highlight
                    />
                    <Step
                      number={2}
                      title="DM 내 버튼 기능"
                      description="수산톡 DM에는 상황에 따라 아래 버튼이 표시됩니다."
                      sub={[
                        "검토 시작 — 보고서를 '검토 중' 상태로 전환",
                        "조치 완료 — 보고서를 '조치 완료' 상태로 전환",
                        "승인 — 보고서를 '승인 완료' 상태로 전환",
                        "반려 — 보고서를 '접수' 상태로 되돌림",
                        "보고서 열기 — 앱의 해당 보고서 화면으로 이동",
                      ]}
                    />
                    <Step
                      number={3}
                      title="버튼 클릭 처리"
                      description="DM 안의 버튼을 클릭하면 앱에 로그인하지 않고도 상태가 즉시 변경됩니다."
                      sub={["처리 결과(성공/실패)가 수산톡 DM으로 다시 안내됩니다."]}
                      highlight
                    />
                  </div>
                </div>

                {isAdmin && (
                  <div className="bg-white border border-[#F2F4F6] rounded-2xl p-5">
                    <h3 className="text-[15px] font-bold text-[#191F28] mb-3">알림 설정 (관리자)</h3>
                    <div className="space-y-2.5">
                      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#F8F9FA]">
                        <Webhook className="h-4 w-4 text-[#4E5968] flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-[13px] text-[#191F28]">부서별 Webhook 설정</p>
                          <p className="text-[13px] text-[#4E5968] mt-0.5">
                            관리자 패널 → 부서 탭에서 각 부서의 수산톡 Webhook URL을 입력하면 해당 부서 채널로 알림이 전송됩니다.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-[#F8F9FA]">
                        <Zap className="h-4 w-4 text-[#4E5968] flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-[13px] text-[#191F28]">시뮬레이터 (테스트)</p>
                          <p className="text-[13px] text-[#4E5968] mt-0.5">
                            관리자 패널 → 🧪 시뮬레이터 탭에서 실제 DM 없이 버튼 동작을 테스트할 수 있습니다.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <Accordion title="자주 묻는 질문 — 수산톡 알림">
                  <div className="space-y-3 text-[13px] text-[#4E5968]">
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. 수산톡 알림이 오지 않습니다.</p>
                      <p className="mt-0.5">관리자 패널 → 부서 탭에서 Webhook URL이 올바르게 설정되었는지 확인하세요. URL이 비어 있으면 알림이 발송되지 않습니다.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. DM 버튼을 눌렀는데 오류가 납니다.</p>
                      <p className="mt-0.5">이미 다른 담당자가 처리했거나, 해당 상태 전환이 불가한 경우입니다. 앱에서 현재 상태를 확인해 주세요.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#191F28]">Q. 특정 사람에게만 알림을 보낼 수 있나요?</p>
                      <p className="mt-0.5">현재는 부서 채널 단위로 알림이 발송됩니다. 개인별 알림은 추후 기능 추가를 검토 중입니다.</p>
                    </div>
                  </div>
                </Accordion>
              </div>
            )}
          </main>
        </div>
      </div>
    </Layout>
  );
}
