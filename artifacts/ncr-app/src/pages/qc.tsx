import { useParams, useLocation } from "wouter";
import { CommentThread } from "@/components/comment-thread";
import { AuditTimeline } from "@/components/audit-timeline";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useState } from "react";
import {
  useGetReport,
  useUpdateReportQc,
  useUpdateReportStatus,
  useListFlawTypes,
  useListItems,
  useListDepartments,
  useListPlants,
  useListProcesses,
  useListVendors,
  useListUsers,
  useCreateReportComment,
  getListReportsQueryKey,
  getGetReportQueryKey,
  getListVendorsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { differenceInDays, format } from "date-fns";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Save, Search, Loader2, Users, X, ZoomIn, X as XIcon } from "lucide-react";

const ERP_API_BASE =
  ((import.meta.env.VITE_ERP_API_BASE as string | undefined) ?? "").replace(/\/+$/, "");

function parseHogi(raw?: string): number | null {
  if (!raw) return null;
  const m = raw.match(/\d+/);
  return m ? Number(m[0]) : null;
}

type ErpCandidate = { code: string; name: string; category: string; id: number; createdAt: string };

type ErpLookup = {
  ok: boolean;
  itemCode?: string;
  modelName?: string;
  itemGroup?: string;
  itemGroupCd?: string;
  factory?: string;
  plantCd?: string;
  shipmentUnit?: string;
  vendorCd?: string | null;
  vendorNm?: string | null;
  orderCount?: number;
  matchedOrders?: { PRODT_ORDER_NO: string; ORDER_STATUS: string; PLAN_START: string | null }[];
  matchedVendors?: { vendorCd: string; vendorNm: string; taxNo: string | null }[];
  reason?: string;
  candidates?: ErpCandidate[];
};

const FACTORY_TO_PLANT_CD: Record<string, string> = { 아산: "SA00", 화성: "SH00" };
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const QC_STATUSES = ["OPEN", "IN_REVIEW", "PENDING_COLLAB", "RESOLVED", "APPROVED", "ERP_SYNCED"] as const;
const QC_STATUS_LABELS: Record<string, string> = {
  OPEN:           "접수",
  IN_REVIEW:      "검토 중",
  PENDING_COLLAB: "협업 대기",
  RESOLVED:       "조치 완료",
  APPROVED:       "승인 완료",
  ERP_SYNCED:     "ERP 등록",
};
const ACTION_DIRECTIONS = ["업체 방문 수정", "생산팀 자체 수정", "업체 반출 및 수정 입고"] as const;

const formSchema = z.object({
  itemCode: z.string().min(1, "부품코드를 입력해주세요"),
  modelName: z.string().nullable().optional(),
  registrantName: z.string().nullable().optional(),
  plantCd: z.string().nullable().optional(),
  factory: z.string().nullable().optional(),
  processName: z.string().min(1, "공정을 입력해주세요"),
  processCd: z.string().nullable().optional(),
  occurrenceDate: z.string().nullable().optional(),
  defectQty: z.coerce.number().int().min(0).nullable().optional(),
  shipmentUnit: z.string().nullable().optional(),
  description: z.string().min(1, "부적합 현상을 입력해주세요"),
  actionDirection: z.enum(ACTION_DIRECTIONS).nullable().optional(),
  deptCd: z.string().nullable().optional(),
  issuingTeam: z.string().nullable().optional(),
  flawTypeCd: z.string().nullable().optional(),
  lostManHours: z.coerce.number().min(0).nullable().optional(),
  qcCorrectiveResult: z.string().nullable().optional(),
  vendorCd: z.string().nullable().optional(),
  vendorNm: z.string().nullable().optional(),
  itemGroup: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  shipmentDateFrom: z.string().nullable().optional(),
  shipmentDateTo: z.string().nullable().optional(),
  managerCd: z.string().nullable().optional(),
  managerNm: z.string().nullable().optional(),
  judgmentResult: z.string().nullable().optional(),
  claimStatus: z.enum(["예", "아니오"]).nullable().optional(),
  relatedDeptStatus: z.enum(["예", "아니오"]).nullable().optional(),
  correctiveActionStatus: z.enum(["예", "아니오"]).nullable().optional(),
  qualityOpinion: z.string().nullable().optional(),
  partsCost: z.coerce.number().int().min(0).optional(),
  laborCost: z.coerce.number().int().min(0).optional(),
});

type FormValues = z.infer<typeof formSchema>;

function GroupDivider({ title }: { title: string }) {
  return (
    <div className="py-3 border-b border-[#F2F4F6]">
      <p className="text-[11px] font-bold text-[#8B95A1] uppercase tracking-wide">{title}</p>
    </div>
  );
}

function FieldRow({
  label,
  children,
  optional,
  error,
}: {
  label: string;
  children: React.ReactNode;
  optional?: boolean;
  error?: string;
}) {
  return (
    <div className="py-3 border-b border-[#F2F4F6] md:flex md:items-start md:gap-4">
      <div className="flex items-center gap-1.5 mb-2 md:mb-0 md:w-24 md:shrink-0 md:pt-2.5">
        <span className="text-[12px] font-semibold text-[#8B95A1] leading-tight">{label}</span>
        {optional && <span className="text-[10px] text-[#BEC5CC]">선택</span>}
      </div>
      <div className="flex-1 min-w-0">
        {children}
        {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
      </div>
    </div>
  );
}

const QC_STATUS_COLORS: Record<string, string> = {
  OPEN:           "bg-blue-50 text-blue-700 border-blue-200",
  IN_REVIEW:      "bg-amber-50 text-amber-700 border-amber-200",
  PENDING_COLLAB: "bg-purple-50 text-purple-700 border-purple-200",
  RESOLVED:       "bg-green-50 text-green-700 border-green-200",
  APPROVED:       "bg-teal-50 text-teal-700 border-teal-200",
  ERP_SYNCED:     "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]",
};

const QC_STATUS_PREV: Partial<Record<string, string>> = {
  IN_REVIEW:      "OPEN",
  PENDING_COLLAB: "IN_REVIEW",
  RESOLVED:       "IN_REVIEW",
  APPROVED:       "RESOLVED",
  ERP_SYNCED:     "APPROVED",
};

const INPUT_CLS = "w-full h-11 rounded-xl bg-[#F8F9FA] px-3.5 text-[14px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10";
const CHIP_SEL = "border-[#1A1A1A] bg-[#F2F4F6] text-[#1A1A1A]";
const CHIP_UNSEL = "border-[#E5E8EB] text-[#4E5968] hover:border-[#1A1A1A]/30";

function VendorPicker({ form }: { form: ReturnType<typeof useForm<FormValues>> }) {
  const [query, setQuery] = useState("");
  const vendorCd = form.watch("vendorCd");
  const vendorNm = form.watch("vendorNm");

  const vendorParams = { search: query, limit: 8 };
  const { data: vendors = [] } = useListVendors(
    vendorParams,
    { query: { enabled: query.trim().length >= 2, queryKey: getListVendorsQueryKey(vendorParams) } },
  );

  const select = (cd: string, nm: string) => {
    form.setValue("vendorCd", cd, { shouldValidate: true });
    form.setValue("vendorNm", nm, { shouldValidate: true });
    setQuery("");
  };

  const clear = () => {
    form.setValue("vendorCd", null, { shouldValidate: true });
    form.setValue("vendorNm", null, { shouldValidate: true });
    setQuery("");
  };

  return (
    <FieldRow label="거래처" optional>
      {vendorCd ? (
        <div className="flex items-center justify-between bg-[#F8F9FA] rounded-xl px-3.5 h-11">
          <div className="flex-1 min-w-0">
            <span className="font-bold text-[14px] text-[#191F28] truncate">{vendorCd}</span>
            {vendorNm && <span className="text-[12px] text-[#4E5968] ml-2 truncate">{vendorNm}</span>}
          </div>
          <button type="button" onClick={clear} className="ml-2 text-[12px] text-[#4E5968] underline shrink-0">변경</button>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="거래처명/코드/사업자번호 (2자 이상)"
            className={INPUT_CLS}
          />
          {query.trim().length >= 2 && vendors.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-[#E5E8EB] rounded-xl shadow-md max-h-52 overflow-y-auto">
              {vendors.map((v) => (
                <button
                  key={v.vendorCd}
                  type="button"
                  onClick={() => select(v.vendorCd, v.vendorNm)}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-[#F8F9FA] border-b border-[#F2F4F6] last:border-0"
                >
                  <p className="font-bold text-[13px] text-[#191F28]">{v.vendorCd} · {v.vendorNm}</p>
                  {v.taxNo && <p className="text-[11px] text-[#8B95A1] mt-0.5">사업자: {v.taxNo}</p>}
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && vendors.length === 0 && (
            <p className="text-[11px] text-[#8B95A1] mt-1.5">검색 결과 없음</p>
          )}
        </div>
      )}
    </FieldRow>
  );
}

export default function QcPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const id = Number(reportId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [slaBlockedOpen, setSlaBlockedOpen] = useState(false);

  const { data: report, isLoading } = useGetReport(id);
  const { data: flawTypes = [] } = useListFlawTypes();
  const { data: itemsData = [] } = useListItems({ limit: 100 });
  const { data: departments = [] } = useListDepartments();
  const { data: plants = [] } = useListPlants();
  const { user } = useAuth();
  const updateQc = useUpdateReportQc();
  const updateStatus = useUpdateReportStatus();
  const createComment = useCreateReportComment();
  const { data: allUsers = [] } = useListUsers();

  // PENDING_COLLAB 협업 요청 모달
  const [collabModalOpen, setCollabModalOpen] = useState(false);
  const [selectedCollabIds, setSelectedCollabIds] = useState<number[]>([]);
  const [collabNote, setCollabNote] = useState("");
  const collaborators = allUsers.filter((u) => u.isActive && u.id !== user?.id);

  // 역할 기반 전이 매트릭스 (서버와 동일)
  type QcStatus = "OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED";
  // ERP_SYNCED는 RPA 성공 시 자동 전이만 — 수동 전이 불가
  // RESOLVED → APPROVED: approver 전용 (spec: "QC 팀장(approver)만 최종 승인")
  // PENDING_COLLAB → RESOLVED: collaborator는 직접 종결 불가
  const TRANSITION_MATRIX: Record<QcStatus, Partial<Record<QcStatus, string[]>>> = {
    OPEN:           { IN_REVIEW: ["admin", "reviewer", "approver"] },
    IN_REVIEW:      { PENDING_COLLAB: ["admin", "reviewer"], RESOLVED: ["admin", "reviewer"], OPEN: ["admin"] },
    PENDING_COLLAB: { RESOLVED: ["admin", "reviewer"], IN_REVIEW: ["admin", "reviewer"] },
    RESOLVED:       { APPROVED: ["approver"], IN_REVIEW: ["admin", "reviewer"] },
    APPROVED:       {},
    ERP_SYNCED:     {},
  };

  const doTransition = async (to: QcStatus) => {
    await updateStatus.mutateAsync({ id, data: { status: to } });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(id) }),
    ]);
    toast({ title: "상태 변경 완료", description: `${QC_STATUS_LABELS[to] ?? to}(으)로 변경되었습니다.` });
  };

  const handleTransition = async (to: QcStatus) => {
    if (to === "PENDING_COLLAB") {
      setSelectedCollabIds([]);
      setCollabNote("");
      setCollabModalOpen(true);
      return;
    }
    try {
      await doTransition(to);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "상태 변경에 실패했습니다.";
      toast({ title: "오류", description: msg, variant: "destructive" });
    }
  };

  const handleCollabConfirm = async () => {
    try {
      if (selectedCollabIds.length > 0) {
        const names = selectedCollabIds.map((uid) => allUsers.find((u) => u.id === uid)?.displayName ?? "").filter(Boolean).join(", ");
        const body = collabNote.trim()
          ? `[협업 요청] ${collabNote.trim()}`
          : `[협업 요청] ${names}님의 검토를 요청합니다.`;
        await createComment.mutateAsync({
          id,
          data: { body, taggedUserIds: selectedCollabIds },
        });
      }
      await doTransition("PENDING_COLLAB");
      setCollabModalOpen(false);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "처리에 실패했습니다.";
      toast({ title: "오류", description: msg, variant: "destructive" });
    }
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      itemCode: "",
      modelName: null,
      registrantName: null,
      plantCd: null,
      factory: null,
      processName: "",
      processCd: null,
      occurrenceDate: null,
      defectQty: null,
      shipmentUnit: null,
      description: "",
      actionDirection: null,
      deptCd: null,
      issuingTeam: null,
      flawTypeCd: null,
      lostManHours: null,
      qcCorrectiveResult: null,
      vendorCd: null,
      vendorNm: null,
      itemGroup: null,
      remarks: null,
      shipmentDateFrom: null,
      shipmentDateTo: null,
      managerCd: null,
      managerNm: null,
      judgmentResult: null,
      claimStatus: null,
      relatedDeptStatus: null,
      correctiveActionStatus: null,
      qualityOpinion: null,
      partsCost: 0,
      laborCost: 0,
    },
  });

  // ERP 자동조회 패널 state
  const [erpSearchProduct, setErpSearchProduct] = useState("");
  const [erpSearchHogi, setErpSearchHogi] = useState("");
  const [erpSearchResult, setErpSearchResult] = useState<ErpLookup | null>(null);
  const [erpSearchLoading, setErpSearchLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(0);

  const selectedPlantCd = form.watch("plantCd");
  const { data: processes = [] } = useListProcesses(
    selectedPlantCd ? { plantCd: selectedPlantCd } : {}
  );

  useEffect(() => {
    if (report) {
      form.reset({
        itemCode: report.itemCode ?? "",
        modelName: report.modelName ?? null,
        registrantName: report.registrantName ?? null,
        plantCd: report.plantCd ?? null,
        factory: report.factory ?? null,
        processName: report.processName ?? "",
        processCd: report.processCd ?? null,
        occurrenceDate: report.occurrenceDate
          ? format(new Date(report.occurrenceDate), "yyyy-MM-dd")
          : null,
        defectQty: report.defectQty ?? null,
        shipmentUnit: report.shipmentUnit ?? null,
        description: report.description ?? "",
        actionDirection: (report.actionDirection as (typeof ACTION_DIRECTIONS)[number]) ?? null,
        deptCd: report.deptCd ?? null,
        issuingTeam: report.issuingTeam ?? null,
        flawTypeCd: report.flawTypeCd ?? null,
        lostManHours: report.lostManHours ?? null,
        qcCorrectiveResult: report.qcCorrectiveResult ?? null,
        vendorCd: report.vendorCd ?? null,
        vendorNm: report.vendorNm ?? null,
        itemGroup: report.itemGroup ?? null,
        remarks: report.remarks ?? null,
        shipmentDateFrom: report.shipmentDateFrom
          ? format(new Date(report.shipmentDateFrom), "yyyy-MM-dd")
          : null,
        shipmentDateTo: report.shipmentDateTo
          ? format(new Date(report.shipmentDateTo), "yyyy-MM-dd")
          : null,
        managerCd: report.managerCd ?? null,
        managerNm: report.managerNm ?? null,
        judgmentResult: report.judgmentResult ?? null,
        claimStatus: (report.claimStatus as "예" | "아니오" | null) ?? null,
        relatedDeptStatus: (report.relatedDeptStatus as "예" | "아니오" | null) ?? null,
        correctiveActionStatus: (report.correctiveActionStatus as "예" | "아니오" | null) ?? null,
        qualityOpinion: report.qualityOpinion ?? null,
        partsCost: report.partsCost ?? 0,
        laborCost: report.laborCost ?? 0,
      });
    }
  }, [report]);

  // ERP 결과(또는 후보)로 QC 폼 자동 입력
  const fillFromErp = (result: ErpLookup | ErpCandidate) => {
    const isCandidate = "code" in result;
    const itemCode = isCandidate ? result.code : result.itemCode;
    const modelName = isCandidate ? result.name : result.modelName;
    const factory = isCandidate ? undefined : result.factory;
    const plantCd = isCandidate ? undefined : result.plantCd;
    const shipmentUnit = isCandidate ? undefined : result.shipmentUnit;
    const vendorCd = isCandidate ? undefined : result.vendorCd;
    const vendorNm = isCandidate ? undefined : result.vendorNm;
    const itemGroup = isCandidate ? result.category : result.itemGroup;
    if (itemCode) form.setValue("itemCode", itemCode, { shouldValidate: true });
    if (modelName) form.setValue("modelName", modelName, { shouldValidate: true });
    if (factory) form.setValue("factory", factory, { shouldValidate: true });
    if (plantCd) form.setValue("plantCd", plantCd, { shouldValidate: true });
    else if (factory && FACTORY_TO_PLANT_CD[factory]) {
      form.setValue("plantCd", FACTORY_TO_PLANT_CD[factory], { shouldValidate: true });
    }
    if (shipmentUnit) form.setValue("shipmentUnit", shipmentUnit, { shouldValidate: true });
    if (vendorCd) form.setValue("vendorCd", vendorCd, { shouldValidate: true });
    if (vendorNm) form.setValue("vendorNm", vendorNm, { shouldValidate: true });
    if (itemGroup) form.setValue("itemGroup", itemGroup, { shouldValidate: true });
    setErpSearchResult(null);
    setErpSearchProduct("");
    setErpSearchHogi("");
  };

  // 부품코드/제품/품목그룹/거래처/호기 ─ 아무거나 입력 → 단건 자동입력, 다건 후보
  const searchErpByProduct = async () => {
    const product = erpSearchProduct.trim();
    const hogi = parseHogi(erpSearchHogi);
    if (!product && hogi == null) return;
    setErpSearchLoading(true);
    setErpSearchResult(null);
    try {
      const params = new URLSearchParams();
      if (product) params.set("product", product);
      if (hogi != null) params.set("hogi", String(hogi));
      const res = await fetch(`${ERP_API_BASE}/api/erp/input-data?${params}`);
      const data: ErpLookup = await res.json();
      if (data.ok) {
        fillFromErp(data);
        toast({ title: "자동 입력됨", description: `${data.itemCode ?? ""} ${data.modelName ?? ""}` });
      } else {
        setErpSearchResult(data);
      }
    } catch {
      setErpSearchResult({ ok: false, reason: "네트워크 오류가 발생했습니다." });
    } finally {
      setErpSearchLoading(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const selectedDept = departments.find((d) => d.deptCd === values.deptCd);
      await updateQc.mutateAsync({
        id,
        data: {
          itemCode: values.itemCode,
          modelName: values.modelName || null,
          registrantName: values.registrantName || null,
          plantCd: values.plantCd || null,
          factory: values.factory || null,
          processName: values.processName || null,
          processCd: values.processCd || null,
          occurrenceDate: values.occurrenceDate
            ? new Date(values.occurrenceDate).toISOString()
            : null,
          defectQty: values.defectQty != null ? Math.round(values.defectQty) : null,
          shipmentUnit: values.shipmentUnit || null,
          description: values.description,
          actionDirection: values.actionDirection || null,
          deptCd: values.deptCd || null,
          issuingTeam: selectedDept?.deptName ?? values.issuingTeam ?? null,
          flawTypeCd: values.flawTypeCd || null,
          lostManHours: values.lostManHours ?? null,
          qcCorrectiveResult: values.qcCorrectiveResult || null,
          vendorCd: values.vendorCd || null,
          vendorNm: values.vendorNm || null,
          itemGroup: values.itemGroup || null,
          remarks: values.remarks || null,
          shipmentDateFrom: values.shipmentDateFrom
            ? new Date(values.shipmentDateFrom).toISOString()
            : null,
          shipmentDateTo: values.shipmentDateTo
            ? new Date(values.shipmentDateTo).toISOString()
            : null,
          managerCd: values.managerCd || null,
          managerNm: values.managerNm || null,
          judgmentResult: values.judgmentResult || null,
          claimStatus: values.claimStatus || null,
          relatedDeptStatus: values.relatedDeptStatus || null,
          correctiveActionStatus: values.correctiveActionStatus || null,
          qualityOpinion: values.qualityOpinion || null,
          partsCost: values.partsCost ?? 0,
          laborCost: values.laborCost ?? 0,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(id) }),
      ]);
      toast({ title: "QC 분석 저장 완료", description: "분석 결과가 저장되었습니다." });
      navigate("/ledger");
    } catch (err: unknown) {
      // 403: SLA 7일 제한 → 팝업 모달
      const status = (err as { status?: number; response?: { status?: number } })?.status
        ?? (err as { status?: number; response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setSlaBlockedOpen(true);
      } else {
        toast({ title: "오류", description: "저장에 실패했습니다.", variant: "destructive" });
      }
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="h-[60vh] flex flex-col items-center justify-center gap-3 text-[#8B95A1]">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <p className="text-[13px]">불러오는 중...</p>
        </div>
      </Layout>
    );
  }

  if (!report) {
    return (
      <Layout>
        <div className="max-w-lg mx-auto px-5 py-10 text-center text-red-500 text-[13px]">보고서를 찾을 수 없습니다.</div>
      </Layout>
    );
  }

  const currentAction = form.watch("actionDirection");

  const reportStatus = (report?.qcStatus ?? "OPEN") as QcStatus;
  const availableTransitions = user
    ? (Object.entries(TRANSITION_MATRIX[reportStatus] ?? {}) as [QcStatus, string[]][])
        .filter(([, roles]) => roles.includes(user.role))
        .map(([to]) => to)
    : [];
  const prevQcStatus = QC_STATUS_PREV[reportStatus];
  const canGoBackQc = !!(prevQcStatus && availableTransitions.includes(prevQcStatus as QcStatus));
  const forwardQcTransitions = availableTransitions.filter((to) => to !== prevQcStatus);

  return (
    <Layout>
      {/* SLA 7일 제한 팝업 모달 */}
      <AlertDialog open={slaBlockedOpen} onOpenChange={setSlaBlockedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              수정 제한 — SLA 7일 초과
            </AlertDialogTitle>
            <AlertDialogDescription>
              발생일 기준 7일이 경과하여 일반 사용자는 보고서를 수정할 수 없습니다.
              수정이 필요한 경우 관리자에게 문의하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSlaBlockedOpen(false)}>
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="max-w-5xl mx-auto px-5 py-5 md:px-8 md:py-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate("/ledger")}
              className="h-8 w-8 rounded-xl bg-[#F2F4F6] flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] transition-colors shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-[18px] font-bold text-[#191F28]">QC 분석 입력</h1>
              <p className="text-[12px] text-[#8B95A1] truncate">
                보고서 #{String(report.id).padStart(4, "0")}
                {report.ncrNumber && (
                  <span className="ml-1.5 font-bold text-[#4E5968] bg-[#F2F4F6] rounded px-1.5 py-0.5">{report.ncrNumber}</span>
                )}
                {" "}· 접수 {format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}
              </p>
            </div>
          </div>
          <button
            type="submit"
            form="qc-form-main"
            disabled={updateQc.isPending}
            className="shrink-0 h-9 px-4 bg-[#1A1A1A] text-white font-semibold text-[13px] rounded-xl flex items-center gap-1.5 disabled:opacity-50 transition-opacity"
          >
            {updateQc.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            저장
          </button>
        </div>

        {/* SLA 경고 배너: 발생일 기준 7일 이상 경과 */}
        {report.occurrenceDate && differenceInDays(new Date(), new Date(report.occurrenceDate)) >= 7 && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-bold text-red-700">발생일 기준 7일 경과</p>
              <p className="text-[12px] text-red-500 mt-0.5">
                일반 사용자는 보고서 수정이 제한됩니다. 관리자 권한으로 계속 저장할 수 있습니다.
              </p>
            </div>
          </div>
        )}
        {/* SLA 경고 배너: 발생일 기준 5~6일 경과 */}
        {report.occurrenceDate && (() => {
          const d = differenceInDays(new Date(), new Date(report.occurrenceDate));
          return d >= 5 && d < 7;
        })() && (
          <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-bold text-amber-700">
                발생일 기준 {differenceInDays(new Date(), new Date(report.occurrenceDate))}일 경과
              </p>
              <p className="text-[12px] text-amber-600 mt-0.5">
                7일 이후 일반 사용자는 수정이 제한됩니다.
              </p>
            </div>
          </div>
        )}

        {/* ── 처리 상태 바 ── */}
        <div className="mb-4 bg-white rounded-2xl border border-[#F2F4F6] px-4 py-3">
          <p className="text-[11px] font-bold text-[#8B95A1] uppercase tracking-wide mb-2.5">처리 상태</p>
          <div className="flex flex-wrap items-center gap-2">
            {prevQcStatus && (
              <>
                {canGoBackQc ? (
                  <button
                    type="button"
                    onClick={() => handleTransition(prevQcStatus as QcStatus)}
                    disabled={updateStatus.isPending}
                    title={`${QC_STATUS_LABELS[prevQcStatus] ?? prevQcStatus}(으)로 되돌리기`}
                    className={`px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-all disabled:opacity-50 opacity-50 hover:opacity-100 ${QC_STATUS_COLORS[prevQcStatus] ?? "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]"}`}
                  >
                    {QC_STATUS_LABELS[prevQcStatus] ?? prevQcStatus}
                  </button>
                ) : (
                  <span className={`px-3.5 py-2 rounded-full text-[13px] font-semibold border opacity-40 ${QC_STATUS_COLORS[prevQcStatus] ?? "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]"}`}>
                    {QC_STATUS_LABELS[prevQcStatus] ?? prevQcStatus}
                  </span>
                )}
                <span className="text-[13px] text-[#8B95A1]">→</span>
              </>
            )}
            <span className={`px-3.5 py-2 rounded-full text-[13px] font-semibold border ${QC_STATUS_COLORS[reportStatus] ?? "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]"}`}>
              {QC_STATUS_LABELS[reportStatus] ?? reportStatus}
            </span>
            {forwardQcTransitions.length > 0 && (
              <span className="text-[13px] text-[#8B95A1]">→</span>
            )}
            {forwardQcTransitions.map((to) => (
              <button
                key={to}
                type="button"
                onClick={() => handleTransition(to)}
                disabled={updateStatus.isPending}
                className={`px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-all disabled:opacity-50 ${
                  to === "APPROVED" || to === "ERP_SYNCED"
                    ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                    : "bg-white text-[#191F28] border-[#E5E8EB] hover:border-[#1A1A1A]/30"
                }`}
              >
                {QC_STATUS_LABELS[to] ?? to}
              </button>
            ))}
            {availableTransitions.length === 0 && reportStatus === "ERP_SYNCED" && (
              <span className="text-[11px] text-[#8B95A1]">ERP 연동 완료</span>
            )}
          </div>
        </div>

        <Form {...form}>
          <form id="qc-form-main" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* ══ 왼쪽 카드: 접수 기본 정보 + 부적합 내용 ══ */}
            <div className="bg-white rounded-2xl border border-[#E0E8FF] h-fit overflow-hidden">
              <div className="bg-[#F0F4FF] px-4 py-2.5 flex items-center gap-2 border-b border-[#E0E8FF]">
                <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                <span className="text-[12px] font-bold text-blue-700 tracking-wide">접수 내용</span>
                <span className="text-[11px] text-blue-400">— 보고서 등록 시 작성된 값</span>
              </div>
              <div className="px-4">

              {/* ── 접수 기본 정보 ── */}
              <GroupDivider title="접수 기본 정보" />

              {/* 등록자 */}
              <FormField
                control={form.control}
                name="registrantName"
                render={({ field }) => (
                  <FieldRow label="등록자 이름" optional>
                    <FormItem>
                      <FormControl>
                        <input
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          className={INPUT_CLS}
                          placeholder="등록자명"
                        />
                      </FormControl>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 공장 */}
              <FormField
                control={form.control}
                name="plantCd"
                render={({ field }) => (
                  <FieldRow label="공장 선택" optional>
                    <FormItem>
                      <Select
                        onValueChange={(val) => {
                          const chosen = val === "__none__" ? null : val;
                          field.onChange(chosen);
                          const plant = plants.find((p) => p.plantCd === chosen);
                          form.setValue("factory", plant?.plantNm ?? null);
                          form.setValue("processCd", null);
                          form.setValue("processName", "");
                        }}
                        value={field.value ?? "__none__"}
                      >
                        <SelectTrigger className="h-11 rounded-xl bg-[#F8F9FA] border-0 text-[14px] text-[#191F28] focus:ring-0">
                          <SelectValue placeholder="공장 선택" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl max-h-60">
                          <SelectItem value="__none__">선택 안 함</SelectItem>
                          {plants.map((p) => (
                            <SelectItem key={p.plantCd} value={p.plantCd}>{p.plantNm}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 발생일 */}
              <FormField
                control={form.control}
                name="occurrenceDate"
                render={({ field }) => (
                  <FieldRow label="발생일" optional>
                    <FormItem>
                      <FormControl>
                        <input
                          type="date"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          className={INPUT_CLS}
                        />
                      </FormControl>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* ── 부적합 내용 ── */}
              <GroupDivider title="부적합 기본 정보" />

              {/* ERP 자동 조회 */}
              <div className="px-5 py-4 border-b border-[#F2F4F6]">
                <div className="mb-3">
                  <p className="text-[13px] font-semibold text-[#191F28] mb-0.5">제품 정보 조회</p>
                  <p className="text-[11px] text-[#8B95A1]">부품코드·제품명·품목그룹·거래처 중 아무거나 + (선택) 호기 — 단건이면 자동 입력</p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={erpSearchProduct}
                    onChange={(e) => setErpSearchProduct(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), searchErpByProduct())}
                    placeholder="부품코드/제품/품목그룹/거래처"
                    className="flex-1 h-11 rounded-xl bg-[#F8F9FA] px-3 text-[14px] outline-none text-[#191F28] placeholder-[#BEC5CC] border-2 border-transparent focus:border-[#1A1A1A]"
                  />
                  <input
                    type="text"
                    value={erpSearchHogi}
                    onChange={(e) => setErpSearchHogi(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), searchErpByProduct())}
                    placeholder="호기"
                    className="w-20 h-11 rounded-xl bg-[#F8F9FA] px-3 text-[14px] outline-none text-[#191F28] placeholder-[#BEC5CC] border-2 border-transparent focus:border-[#1A1A1A] text-center"
                  />
                  <button
                    type="button"
                    onClick={searchErpByProduct}
                    disabled={erpSearchLoading || (!erpSearchProduct.trim() && !erpSearchHogi.trim())}
                    className="h-11 px-4 rounded-xl bg-[#1A1A1A] text-white text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                  >
                    {erpSearchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    조회
                  </button>
                </div>

                {erpSearchResult && (
                  <div className="mt-3">
                    {erpSearchResult.ok ? (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-[14px] text-[#191F28] truncate">{erpSearchResult.itemCode}</p>
                          <p className="text-[12px] text-[#4E5968] mt-0.5 truncate">{erpSearchResult.modelName}</p>
                          <div className="flex gap-3 mt-1 flex-wrap">
                            {erpSearchResult.itemGroup && <span className="text-[11px] text-[#8B95A1]">품목그룹 {erpSearchResult.itemGroup}</span>}
                            {erpSearchResult.factory && <span className="text-[11px] text-[#8B95A1]">공장 {erpSearchResult.factory}</span>}
                            {erpSearchResult.shipmentUnit && <span className="text-[11px] text-[#8B95A1]">호기 {erpSearchResult.shipmentUnit}</span>}
                            {erpSearchResult.vendorNm && <span className="text-[11px] text-[#8B95A1]">거래처 {erpSearchResult.vendorNm}</span>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => fillFromErp(erpSearchResult!)}
                          className="shrink-0 px-3 py-2 bg-[#1A1A1A] text-white text-[12px] font-bold rounded-xl min-h-[44px]"
                        >
                          이대로<br />입력
                        </button>
                      </div>
                    ) : erpSearchResult.candidates && erpSearchResult.candidates.length > 0 ? (
                      <div className="rounded-xl border border-[#E5E8EB] overflow-hidden">
                        <div className="px-3 py-2 bg-[#F8F9FA] flex items-center justify-between">
                          <span className="text-[12px] font-semibold text-[#4E5968]">{erpSearchResult.candidates.length}건 검색됨</span>
                          <span className="text-[11px] text-[#8B95A1]">항목을 선택하면 자동 입력됩니다</span>
                        </div>
                        <div className="max-h-52 overflow-y-auto divide-y divide-[#F2F4F6]">
                          {erpSearchResult.candidates.map((c) => (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => fillFromErp(c)}
                              className="w-full px-3 py-2.5 text-left hover:bg-[#F8F9FA]"
                            >
                              <p className="font-semibold text-[13px] text-[#191F28]">{c.code}</p>
                              <p className="text-[11px] text-[#8B95A1] truncate">{c.name} · {c.category}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl bg-[#F8F9FA] border border-[#F2F4F6] px-3 py-2.5">
                        <p className="text-[12px] text-[#8B95A1]">{erpSearchResult.reason || "검색 결과가 없습니다."}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 부품코드 */}
              <FormField
                control={form.control}
                name="itemCode"
                render={({ field }) => (
                  <FieldRow label="제품코드" error={form.formState.errors.itemCode?.message}>
                    <FormItem>
                      <FormControl>
                        <input
                          {...field}
                          className={INPUT_CLS}
                          placeholder="부품코드 입력"
                          list="item-codes-qc"
                        />
                      </FormControl>
                      <datalist id="item-codes-qc">
                        {itemsData.map((item) => (
                          <option key={item.code} value={item.code}>{item.name}</option>
                        ))}
                      </datalist>
                      <FormMessage className="text-[12px]" />
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 모델명 */}
              <FormField
                control={form.control}
                name="modelName"
                render={({ field }) => (
                  <FieldRow label="제품명" optional>
                    <FormItem>
                      <FormControl>
                        <input
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          className={INPUT_CLS}
                          placeholder="모델명 (선택)"
                        />
                      </FormControl>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 공정 */}
              <FormField
                control={form.control}
                name="processCd"
                render={({ field }) => (
                  <FieldRow label="등록자 공정" error={form.formState.errors.processName?.message}>
                    <FormItem>
                      {processes.length > 0 ? (
                        <Select
                          onValueChange={(val) => {
                            const chosen = val === "__none__" ? null : val;
                            field.onChange(chosen);
                            const p = processes.find((pr) => pr.processCd === chosen);
                            form.setValue("processName", p?.processNm ?? "");
                          }}
                          value={field.value ?? "__none__"}
                        >
                          <SelectTrigger className="h-11 rounded-xl bg-[#F8F9FA] border-0 text-[14px] text-[#191F28] focus:ring-0">
                            <SelectValue placeholder="공정 선택" />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl max-h-60">
                            <SelectItem value="__none__">선택 안 함</SelectItem>
                            {processes.map((p) => (
                              <SelectItem key={p.processCd} value={p.processCd}>{p.processNm}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <input
                          value={form.watch("processName") ?? ""}
                          onChange={(e) => form.setValue("processName", e.target.value)}
                          className={INPUT_CLS}
                          placeholder="공정명 직접 입력"
                        />
                      )}
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 불량 수량 */}
              <FormField
                control={form.control}
                name="defectQty"
                render={({ field }) => (
                  <FieldRow label="부적합 수량" optional>
                    <FormItem>
                      <FormControl>
                        <input
                          type="number"
                          min="0"
                          className={INPUT_CLS}
                          placeholder="수량 (개)"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                        />
                      </FormControl>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 부적합 현상 */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FieldRow label="부적합 현상" error={form.formState.errors.description?.message}>
                    <FormItem>
                      <FormControl>
                        <textarea
                          className="w-full rounded-xl bg-[#F8F9FA] px-3.5 py-3 text-[14px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 resize-none"
                          rows={4}
                          placeholder="부적합 내용을 입력해주세요"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage className="text-[12px]" />
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* ── 첨부 사진 ── */}
              {(() => {
                const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                const allPhotos: string[] =
                  report.imageUrls && report.imageUrls.length > 0
                    ? report.imageUrls
                    : report.imageUrl
                    ? [report.imageUrl]
                    : [];
                if (allPhotos.length === 0) return null;
                return (
                  <>
                    <GroupDivider title={`첨부 사진 (${allPhotos.length}장)`} />
                    <div className={`py-3 grid gap-2 ${allPhotos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                      {allPhotos.map((url, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => { setLightboxIdx(i); setLightboxOpen(true); }}
                          className="relative overflow-hidden rounded-xl border border-[#E5E8EB] group"
                        >
                          <img
                            src={`${base}${url}`}
                            alt={`첨부 사진 ${i + 1}`}
                            className="w-full object-cover max-h-52 group-hover:opacity-90 transition-opacity"
                          />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                            <ZoomIn className="h-8 w-8 text-white drop-shadow-lg" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}

              </div>{/* ── 접수 내용 inner px-4 끝 ── */}
            </div>{/* ── 왼쪽 카드 끝 ── */}

            {/* ══ 오른쪽 카드: QC 분석 내용 ══ */}
            <div className="bg-white rounded-2xl border border-[#E6F4ED] overflow-hidden">
              <div className="bg-[#F0FAF4] px-4 py-2.5 flex items-center gap-2 border-b border-[#E6F4ED]">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-[12px] font-bold text-emerald-700 tracking-wide">QC 입력</span>
                <span className="text-[11px] text-emerald-400">— QC 담당자 작성 항목</span>
              </div>
              <div className="px-4">

              {/* ── QC 분석 내용 ── */}
              <GroupDivider title="QC 분석 내용" />

              {/* 거래처 */}
              <VendorPicker form={form} />

              {/* 조치 방향 */}
              <FieldRow label="조치 방향" optional>
                <div className="flex flex-col gap-2">
                  {ACTION_DIRECTIONS.map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => form.setValue("actionDirection", currentAction === dir ? null : dir)}
                      className={`w-full text-left px-4 py-3 rounded-xl text-[14px] font-semibold border-2 transition-all ${currentAction === dir ? CHIP_SEL : CHIP_UNSEL}`}
                    >
                      {dir}
                    </button>
                  ))}
                </div>
              </FieldRow>

              {/* 귀책부서 */}
              <FormField
                control={form.control}
                name="deptCd"
                render={({ field }) => (
                  <FieldRow label="귀책부서" optional>
                    <FormItem>
                      <Select
                        onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                        value={field.value ?? "__none__"}
                      >
                        <SelectTrigger className="h-11 rounded-xl bg-[#F8F9FA] border-0 text-[14px] text-[#191F28] focus:ring-0">
                          <SelectValue placeholder="부서 선택 (선택 안 함)" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl max-h-60">
                          <SelectItem value="__none__">선택 안 함</SelectItem>
                          {departments.map((dept) => (
                            <SelectItem key={dept.deptCd} value={dept.deptCd}>
                              <span className={dept.isFrequent ? "font-semibold" : ""}>{dept.deptName}</span>
                              {dept.isFrequent && (
                                <span className="ml-1.5 text-[10px] text-gray-500 bg-gray-100 rounded px-1">자주사용</span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 불량유형 */}
              <FormField
                control={form.control}
                name="flawTypeCd"
                render={({ field }) => (
                  <FieldRow label="불량유형" optional>
                    <FormItem>
                      <Select
                        onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                        value={field.value ?? "__none__"}
                      >
                        <SelectTrigger className="h-11 rounded-xl bg-[#F8F9FA] border-0 text-[14px] text-[#191F28] focus:ring-0">
                          <SelectValue placeholder="불량유형 선택" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl max-h-60">
                          <SelectItem value="__none__">선택 안 함</SelectItem>
                          {flawTypes.map((ft) => (
                            <SelectItem key={ft.typeCd} value={ft.typeCd}>{ft.typeNm}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 손실공수 */}
              <FormField
                control={form.control}
                name="lostManHours"
                render={({ field }) => (
                  <FieldRow label="손실공수 (h)" optional>
                    <FormItem>
                      <FormControl>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          className={INPUT_CLS}
                          placeholder="예: 2.5"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage className="text-[12px]" />
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 출하 기간 */}
              <FieldRow label="출하 기간" optional>
                <div className="grid grid-cols-2 gap-2">
                  <FormField
                    control={form.control}
                    name="shipmentDateFrom"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <input
                            type="date"
                            className={INPUT_CLS}
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value || null)}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="shipmentDateTo"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <input
                            type="date"
                            className={INPUT_CLS}
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value || null)}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </FieldRow>

              {/* 담당자 */}
              <FieldRow label="담당자" optional>
                <div className="grid grid-cols-2 gap-2">
                  <FormField
                    control={form.control}
                    name="managerCd"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <input
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value || null)}
                            className={INPUT_CLS}
                            placeholder="담당자 코드"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="managerNm"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <input
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value || null)}
                            className={INPUT_CLS}
                            placeholder="담당자명"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </FieldRow>

              {/* 비고 */}
              <FormField
                control={form.control}
                name="remarks"
                render={({ field }) => (
                  <FieldRow label="비고" optional>
                    <FormItem>
                      <FormControl>
                        <input
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          className={INPUT_CLS}
                          placeholder="비고 사항 입력"
                        />
                      </FormControl>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 판정결과 */}
              <FormField
                control={form.control}
                name="judgmentResult"
                render={({ field }) => (
                  <FieldRow label="판정결과" optional>
                    <FormItem>
                      <Select
                        onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                        value={field.value ?? "__none__"}
                      >
                        <SelectTrigger className="h-11 rounded-xl bg-[#F8F9FA] border-0 text-[14px] text-[#191F28] focus:ring-0">
                          <SelectValue placeholder="판정결과 선택" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="__none__">선택 안 함</SelectItem>
                          <SelectItem value="폐기">폐기</SelectItem>
                          <SelectItem value="특채">특채</SelectItem>
                          <SelectItem value="수리후특채">수리후특채</SelectItem>
                          <SelectItem value="적합품판정(부적합X)">적합품판정(부적합X)</SelectItem>
                          <SelectItem value="신품교환">신품교환</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 클레임유무 */}
              <FormField
                control={form.control}
                name="claimStatus"
                render={({ field }) => (
                  <FieldRow label="클레임유무" optional>
                    <FormItem>
                      <div className="flex gap-3">
                        {(["예", "아니오"] as const).map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => field.onChange(field.value === val ? null : val)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-[14px] font-semibold transition-all ${
                              field.value === val ? CHIP_SEL : CHIP_UNSEL
                            }`}
                          >
                            <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              field.value === val ? "border-[#1A1A1A]" : "border-[#BEC5CC]"
                            }`}>
                              {field.value === val && <span className="h-2 w-2 rounded-full bg-[#1A1A1A]" />}
                            </span>
                            {val}
                          </button>
                        ))}
                      </div>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 유관부서여부 */}
              <FormField
                control={form.control}
                name="relatedDeptStatus"
                render={({ field }) => (
                  <FieldRow label="유관부서여부" optional>
                    <FormItem>
                      <div className="flex gap-3">
                        {(["예", "아니오"] as const).map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => field.onChange(field.value === val ? null : val)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-[14px] font-semibold transition-all ${
                              field.value === val ? CHIP_SEL : CHIP_UNSEL
                            }`}
                          >
                            <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              field.value === val ? "border-[#1A1A1A]" : "border-[#BEC5CC]"
                            }`}>
                              {field.value === val && <span className="h-2 w-2 rounded-full bg-[#1A1A1A]" />}
                            </span>
                            {val}
                          </button>
                        ))}
                      </div>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 시정및예방조치여부 */}
              <FormField
                control={form.control}
                name="correctiveActionStatus"
                render={({ field }) => (
                  <FieldRow label="시정및예방조치여부" optional>
                    <FormItem>
                      <div className="flex gap-3">
                        {(["예", "아니오"] as const).map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => field.onChange(field.value === val ? null : val)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-[14px] font-semibold transition-all ${
                              field.value === val ? CHIP_SEL : CHIP_UNSEL
                            }`}
                          >
                            <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              field.value === val ? "border-[#1A1A1A]" : "border-[#BEC5CC]"
                            }`}>
                              {field.value === val && <span className="h-2 w-2 rounded-full bg-[#1A1A1A]" />}
                            </span>
                            {val}
                          </button>
                        ))}
                      </div>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 부품비 / 공임비 */}
              <FieldRow label="비용" optional>
                <div className="grid grid-cols-2 gap-2">
                  <FormField
                    control={form.control}
                    name="partsCost"
                    render={({ field }) => (
                      <FormItem>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[12px] text-[#8B95A1]">부품비</span>
                          <input
                            type="number"
                            min="0"
                            className="w-full h-11 rounded-xl bg-[#F8F9FA] pl-14 pr-3.5 text-[14px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 text-right"
                            value={field.value ?? 0}
                            onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                          />
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="laborCost"
                    render={({ field }) => (
                      <FormItem>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[12px] text-[#8B95A1]">공임비</span>
                          <input
                            type="number"
                            min="0"
                            className="w-full h-11 rounded-xl bg-[#F8F9FA] pl-14 pr-3.5 text-[14px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 text-right"
                            value={field.value ?? 0}
                            onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
                          />
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </FieldRow>

              {/* 조치결과 */}
              <FormField
                control={form.control}
                name="qcCorrectiveResult"
                render={({ field }) => (
                  <FieldRow label="조치결과" optional>
                    <FormItem>
                      <FormControl>
                        <textarea
                          className="w-full rounded-xl bg-[#F8F9FA] px-3.5 py-3 text-[14px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 resize-none"
                          rows={4}
                          placeholder="조치 내용을 상세하게 입력해주세요"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                        />
                      </FormControl>
                      <FormMessage className="text-[12px]" />
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 품질의견 */}
              <FormField
                control={form.control}
                name="qualityOpinion"
                render={({ field }) => (
                  <FieldRow label="품질의견" optional>
                    <FormItem>
                      <FormControl>
                        <textarea
                          className="w-full rounded-xl bg-[#F8F9FA] px-3.5 py-3 text-[14px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 resize-none"
                          rows={4}
                          placeholder="품질 의견을 입력해주세요"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                        />
                      </FormControl>
                      <FormMessage className="text-[12px]" />
                    </FormItem>
                  </FieldRow>
                )}
              />

              </div>{/* ── QC 입력 inner px-4 끝 ── */}
            </div>{/* ── 오른쪽 카드 끝 ── */}
            </div>{/* ── 그리드 끝 ── */}
          </form>
        </Form>

        {/* ── 협업 의견 + 변경 이력 (전체 너비, 2열) ── */}
        <div className="mt-5 pb-8 grid grid-cols-1 xl:grid-cols-2 gap-5">
          <CommentThread reportId={id} />
          <AuditTimeline reportId={id} />
        </div>
      </div>

      {/* PENDING_COLLAB 협업 담당자 지정 모달 */}
      {collabModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#F2F4F6] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-600" />
                <h3 className="text-[16px] font-bold text-[#191F28]">협업 담당자 지정</h3>
              </div>
              <button
                type="button"
                onClick={() => setCollabModalOpen(false)}
                className="h-8 w-8 rounded-xl bg-[#F2F4F6] flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 max-h-[50vh] overflow-y-auto">
              <p className="text-[12px] text-[#8B95A1] mb-3">검토를 요청할 담당자를 선택하세요. 선택한 담당자에게 알림이 발송됩니다.</p>
              <div className="space-y-1.5">
                {collaborators.map((u) => {
                  const checked = selectedCollabIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        setSelectedCollabIds((prev) =>
                          checked ? prev.filter((uid) => uid !== u.id) : [...prev, u.id]
                        )
                      }
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                        checked
                          ? "border-purple-300 bg-purple-50"
                          : "border-[#E5E8EB] bg-white hover:border-[#D0D5DD]"
                      }`}
                    >
                      <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-purple-600 border-purple-600" : "border-[#D0D5DD]"}`}>
                        {checked && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <div className="h-7 w-7 rounded-full bg-[#E5E8EB] flex items-center justify-center shrink-0">
                        <span className="text-[11px] font-bold text-[#4E5968]">{u.displayName.slice(0, 1)}</span>
                      </div>
                      <div className="text-left min-w-0">
                        <p className="text-[13px] font-semibold text-[#191F28] truncate">{u.displayName}</p>
                        <p className="text-[10px] text-[#8B95A1]">{u.role}</p>
                      </div>
                    </button>
                  );
                })}
                {collaborators.length === 0 && (
                  <p className="text-center text-[12px] text-[#BEC5CC] py-4">등록된 사용자가 없습니다.</p>
                )}
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-semibold text-[#8B95A1] mb-1.5">협업 요청 메모 <span className="font-normal text-[#BEC5CC]">(선택)</span></p>
                <textarea
                  className="w-full rounded-xl bg-[#F8F9FA] px-3 py-2.5 text-[13px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 resize-none"
                  rows={2}
                  placeholder="검토 요청 내용을 입력하세요"
                  value={collabNote}
                  onChange={(e) => setCollabNote(e.target.value)}
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#F2F4F6] flex gap-2">
              <button
                type="button"
                onClick={() => setCollabModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-[#F2F4F6] text-[#191F28] font-semibold text-[13px]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleCollabConfirm}
                disabled={updateStatus.isPending || createComment.isPending}
                className="flex-1 py-2.5 rounded-xl bg-purple-600 text-white font-semibold text-[13px] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {(updateStatus.isPending || createComment.isPending) && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                협업 요청
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 이미지 라이트박스 ── */}
      {lightboxOpen && (() => {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const allPhotos: string[] =
          report.imageUrls && report.imageUrls.length > 0
            ? report.imageUrls
            : report.imageUrl
            ? [report.imageUrl]
            : [];
        if (allPhotos.length === 0) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setLightboxOpen(false)}
          >
            <button
              type="button"
              className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
              onClick={() => setLightboxOpen(false)}
            >
              <XIcon className="h-6 w-6" />
            </button>
            {allPhotos.length > 1 && (
              <>
                <button
                  type="button"
                  className="absolute left-4 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
                  onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => (i - 1 + allPhotos.length) % allPhotos.length); }}
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  className="absolute right-16 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
                  onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => (i + 1) % allPhotos.length); }}
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
                <div className="absolute bottom-4 text-white text-sm font-medium bg-black/40 px-3 py-1 rounded-full">
                  {lightboxIdx + 1} / {allPhotos.length}
                </div>
              </>
            )}
            <img
              src={`${base}${allPhotos[lightboxIdx]}`}
              alt={`첨부 사진 ${lightboxIdx + 1}`}
              className="max-w-[90vw] max-h-[85vh] rounded-2xl shadow-2xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        );
      })()}
    </Layout>
  );
}
