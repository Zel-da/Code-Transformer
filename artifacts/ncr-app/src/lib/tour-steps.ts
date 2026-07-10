import type { TourStep } from "@/contexts/tour";

export const TOUR_ALL: TourStep[] = [
  // ── 관리대장 ─────────────────────────────────────
  {
    id: "ledger-stats",
    target: "[data-tour='ledger-stats']",
    route: "/ledger",
    title: "📊 통계 현황",
    content: "전체 보고서 수, 미처리 건수, 7일 이상 지연된 건수를 한눈에 확인합니다. 빨간 숫자가 있다면 지연 보고서가 있다는 뜻입니다.",
    position: "bottom",
  },
  {
    id: "ledger-search",
    target: "[data-tour='ledger-search']",
    route: "/ledger",
    title: "🔍 검색창",
    content: "품목명, 모델명, 보고서 번호로 빠르게 검색합니다. 입력하면 실시간으로 목록이 필터링됩니다.",
    position: "bottom",
  },
  {
    id: "ledger-filter",
    target: "[data-tour='ledger-filter']",
    route: "/ledger",
    title: "🏷 상태 필터",
    content: "QC 상태(접수·검토 중·조치 완료·승인 등)별로 보고서를 걸러볼 수 있습니다. '미완료'를 선택하면 아직 처리되지 않은 보고서만 표시됩니다.",
    position: "bottom",
  },
  {
    id: "ledger-table",
    target: "[data-tour='ledger-table']",
    route: "/ledger",
    title: "📋 보고서 목록",
    content: "등록된 부적합 보고서 전체 목록입니다. 행을 클릭하면 우측에 상세 정보 패널이 열립니다. 7일 이상 경과된 보고서는 빨간 경고 배지가 표시됩니다.",
    position: "top",
  },
  {
    id: "ledger-chart",
    target: "[data-tour='ledger-chart']",
    route: "/ledger",
    title: "📈 불량 유형 차트",
    content: "어떤 유형의 불량이 가장 많이 발생하는지 차트로 확인합니다. 반복 발생 패턴을 파악해 개선 조치에 활용하세요.",
    position: "top",
  },
  // ── 보고서 등록 ───────────────────────────────────
  {
    id: "submit-header",
    target: "[data-tour='submit-header']",
    route: "/submit",
    title: "📝 보고서 등록",
    content: "부적합이 발생했을 때 이 화면에서 즉시 등록합니다. 모바일에서도 동일하게 사용할 수 있습니다.",
    position: "bottom",
  },
  {
    id: "submit-product-type",
    target: "[data-tour='submit-product-type']",
    route: "/submit",
    title: "① 제품 구분",
    content: "양산품 또는 개발품 중 해당하는 유형을 선택합니다. 개발품 선택 시 연구소 담당자에게 자동 전파됩니다.",
    position: "bottom",
  },
  {
    id: "submit-factory",
    target: "[data-tour='submit-factory']",
    route: "/submit",
    title: "② 공장 선택",
    content: "부적합이 발생한 공장(아산 또는 화성)을 선택합니다. 공장에 따라 조회되는 ERP 품목이 달라집니다.",
    position: "bottom",
  },
  {
    id: "submit-item",
    target: "[data-tour='submit-item']",
    route: "/submit",
    title: "③ 품목 검색",
    content: "ERP에 등록된 품목을 검색해 선택합니다. 품목명 또는 품목 코드 일부를 입력하면 자동완성 목록이 나타납니다. 선택하면 품목코드·모델명이 자동으로 채워집니다.",
    position: "bottom",
  },
  {
    id: "submit-process",
    target: "[data-tour='submit-process']",
    route: "/submit",
    title: "④ 공정 선택",
    content: "부적합이 발생한 공정을 선택합니다. 목록에 없는 공정은 관리자에게 추가를 요청하세요.",
    position: "bottom",
  },
  {
    id: "submit-defect-info",
    target: "[data-tour='submit-defect-info']",
    route: "/submit",
    title: "⑤ 부적합 정보",
    content: "불량 수량, 발생일, 부적합 유형을 입력합니다. 불량 유형은 복수 선택이 가능합니다.",
    position: "top",
  },
  {
    id: "submit-photo",
    target: "[data-tour='submit-photo']",
    route: "/submit",
    title: "⑥ 사진 첨부",
    content: "현장 사진을 최대 5장 첨부할 수 있습니다. 모바일에서는 카메라로 바로 촬영해 첨부할 수 있습니다. 사진은 자동으로 압축됩니다.",
    position: "top",
  },
  {
    id: "submit-btn",
    target: "[data-tour='submit-btn']",
    route: "/submit",
    title: "⑦ 접수하기",
    content: "모든 필수 항목을 채운 뒤 이 버튼을 눌러 보고서를 등록합니다. 접수 즉시 QC 담당자에게 수산톡 DM 알림이 발송됩니다.",
    position: "top",
  },
  // ── QC 분석 ──────────────────────────────────────
  {
    id: "qc-stats",
    target: "[data-tour='qc-stats']",
    route: "/qc",
    title: "📊 QC 요약",
    content: "전체 보고서, 분석 미완료, 조치 완료 건수를 확인합니다. 미완료 건수가 많다면 우선 처리가 필요합니다.",
    position: "bottom",
  },
  {
    id: "qc-filter",
    target: "[data-tour='qc-filter']",
    route: "/qc",
    title: "🏷 상태별 필터",
    content: "처리할 보고서를 상태별로 필터링합니다. '미완료'가 기본값으로, 아직 처리가 필요한 보고서만 보여줍니다.",
    position: "bottom",
  },
  {
    id: "qc-list",
    target: "[data-tour='qc-list']",
    route: "/qc",
    title: "📋 보고서 선택",
    content: "목록에서 처리할 보고서를 클릭하면 QC 상세 화면으로 이동합니다. 상세 화면에서 검토→조치→승인 순으로 처리합니다.",
    position: "top",
  },
  // ── 관리자 패널 ───────────────────────────────────
  {
    id: "manage-tabs",
    target: "[data-tour='manage-tabs']",
    route: "/manage",
    title: "🛠 관리자 패널 탭",
    content: "사용자 관리, 부서 Webhook 설정, RPA 동기화, 보고서 관리, 시뮬레이터 탭으로 구성되어 있습니다.",
    position: "bottom",
  },
  {
    id: "manage-user-add",
    target: "[data-tour='manage-user-add']",
    route: "/manage",
    title: "👤 사용자 추가",
    content: "이 버튼으로 새 사용자를 등록합니다. 이름, 아이디, 이메일, 비밀번호, 역할(일반/관리자)을 설정할 수 있습니다.",
    position: "bottom",
  },
  {
    id: "manage-dept",
    target: "[data-tour='manage-dept']",
    route: "/manage",
    title: "🔔 부서 Webhook 설정",
    content: "각 부서의 수산톡 Webhook URL을 입력하면 해당 부서로 자동 알림이 발송됩니다. URL이 없으면 알림이 가지 않습니다.",
    position: "bottom",
  },
];

export const TOUR_SUBMIT_ONLY: TourStep[] = TOUR_ALL.filter(s =>
  ["submit-header","submit-product-type","submit-factory","submit-item","submit-process","submit-defect-info","submit-photo","submit-btn"].includes(s.id)
);

export const TOUR_QC_ONLY: TourStep[] = TOUR_ALL.filter(s =>
  ["qc-stats","qc-filter","qc-list"].includes(s.id)
);

export const TOUR_LEDGER_ONLY: TourStep[] = TOUR_ALL.filter(s =>
  ["ledger-stats","ledger-search","ledger-filter","ledger-table","ledger-chart"].includes(s.id)
);
