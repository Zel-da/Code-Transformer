import { Layout } from "@/components/layout";
import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/auth";
import {
  useListProcesses,
  useRequestUploadUrl,
  useCreateReport,
  useListVendors,
  getListReportsQueryKey,
  getGetReportStatsQueryKey,
  getListProcessesQueryKey,
  getListVendorsQueryKey,
} from "@workspace/api-client-react";
import { compressImage } from "@/lib/image-compression";
import {
  Form,
  FormField,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Camera,
  Loader2,
  CheckCircle2,
  X,
  Plus,
  Search,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const FACTORY_OPTIONS = [
  { label: "아산공장", value: "아산", plantCd: "SA00" },
  { label: "화성공장", value: "화성", plantCd: "SH00" },
] as const;

const FACTORY_TO_PLANT_CD: Record<string, string> = {
  아산: "SA00",
  화성: "SH00",
};

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

const todayStr = () => new Date().toISOString().split("T")[0];

const PRODUCT_TYPES = [
  { label: "양산", value: "양산" },
  { label: "개발", value: "개발" },
] as const;

const ACTION_DIRECTIONS = [
  "업체 방문 수정",
  "생산팀 자체 수정",
  "업체 반출 및 수정 입고",
] as const;

const formSchema = z.object({
  productType: z.enum(["양산", "개발"]).default("양산"),
  registrantName: z.string().min(1, "등록자명을 입력해주세요"),
  factory: z.string().min(1, "공장을 선택해주세요"),
  processName: z.string().min(1, "공정을 선택해주세요"),
  itemCode: z.string().min(1, "제품코드를 선택해주세요"),
  modelName: z.string().optional(),
  shipmentUnit: z.string().optional(),
  occurrenceDate: z.string().optional(),
  defectQty: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(0).optional(),
  ),
  description: z.string().min(1, "부적합 현상을 입력해주세요"),
  vendorCd: z.string().optional(),
  vendorNm: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

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
    <div className="px-5 py-4 border-b border-[#F2F4F6]">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[13px] font-semibold text-[#191F28]">{label}</span>
        {optional && <span className="text-[11px] text-[#BEC5CC]">선택</span>}
      </div>
      {children}
      {error && <p className="text-[11px] text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}

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
    form.setValue("vendorCd", "", { shouldValidate: true });
    form.setValue("vendorNm", "", { shouldValidate: true });
    setQuery("");
  };

  return (
    <div className="px-5 py-4 border-b border-[#F2F4F6]">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[13px] font-semibold text-[#191F28]">거래처</span>
        <span className="text-[11px] text-[#BEC5CC]">선택</span>
      </div>
      {vendorCd ? (
        <div className="flex items-center justify-between bg-[#F8F9FA] rounded-xl px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[14px] text-[#191F28] truncate">{vendorCd}</p>
            <p className="text-[12px] text-[#4E5968] mt-0.5 truncate">{vendorNm || ""}</p>
          </div>
          <button
            type="button"
            onClick={clear}
            className="ml-2 text-[12px] text-[#4E5968] underline"
          >
            변경
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="거래처명/코드/사업자번호로 검색 (2자 이상)"
            className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
          />
          {query.trim().length >= 2 && vendors.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-2 z-10 bg-white border border-[#E5E8EB] rounded-xl shadow-md max-h-64 overflow-y-auto">
              {vendors.map((v) => (
                <button
                  key={v.vendorCd}
                  type="button"
                  onClick={() => select(v.vendorCd, v.vendorNm)}
                  className="w-full text-left px-3 py-2 hover:bg-[#F8F9FA] border-b border-[#F2F4F6] last:border-0"
                >
                  <p className="font-bold text-[13px] text-[#191F28] truncate">
                    {v.vendorCd} · {v.vendorNm}
                  </p>
                  {v.taxNo && (
                    <p className="text-[11px] text-[#8B95A1] mt-0.5">사업자: {v.taxNo}</p>
                  )}
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && vendors.length === 0 && (
            <p className="text-[11px] text-[#8B95A1] mt-2">검색 결과 없음</p>
          )}
        </div>
      )}
    </div>
  );
}

function GroupDivider({ title }: { title: string }) {
  return (
    <div className="bg-[#F8F9FA] border-y border-[#F2F4F6] px-5 py-3">
      <span className="font-bold text-[#8B95A1] tracking-widest uppercase text-[20px]">{title}</span>
    </div>
  );
}

export default function SubmitReport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const skipFactoryClearRef = useRef(false);

  const [erpSearchProduct, setErpSearchProduct] = useState("");
  const [erpSearchHogi, setErpSearchHogi] = useState("");
  const [erpSearchResult, setErpSearchResult] = useState<ErpLookup | null>(null);
  const [erpSearchLoading, setErpSearchLoading] = useState(false);

  const requestUploadUrl = useRequestUploadUrl();
  const createReport = useCreateReport();

  const profileDefaults = () => ({
    productType: "양산" as "양산" | "개발",
    registrantName: user?.displayName ?? "",
    factory: user?.factory ?? "",
    processName: user?.processName ?? "",
    itemCode: "",
    modelName: "",
    shipmentUnit: "",
    occurrenceDate: todayStr(),
    defectQty: undefined as number | undefined,
    description: "",
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: profileDefaults(),
  });

  const selectedProductType = form.watch("productType");
  const selectedFactory = form.watch("factory");
  const selectedPlantCd = FACTORY_TO_PLANT_CD[selectedFactory] ?? "";


  const { data: processes = [] } = useListProcesses(
    selectedPlantCd ? { plantCd: selectedPlantCd } : undefined,
    { query: { enabled: !!selectedPlantCd, queryKey: getListProcessesQueryKey(selectedPlantCd ? { plantCd: selectedPlantCd } : undefined) } },
  );

  useEffect(() => {
    if (user) {
      skipFactoryClearRef.current = true;
      form.reset(profileDefaults());
      setTimeout(() => { skipFactoryClearRef.current = false; }, 0);
    }
  }, [user?.id]);

  useEffect(() => {
    if (skipFactoryClearRef.current) return;
    if (selectedFactory) {
      form.setValue("processName", "");
    }
  }, [selectedFactory]);


  // 부품코드/제품/품목그룹/거래처/호기 — 아무거나 입력 → 단건이면 자동 입력, 다건이면 후보 표시
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
        // 단건 매칭 → 폼에 즉시 자동 입력
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

  // ERP 결과(또는 후보)로 폼 필드 자동 입력
  const fillFromErp = (result: ErpLookup | ErpCandidate) => {
    const isCandidate = "code" in result;
    const itemCode = isCandidate ? result.code : result.itemCode;
    const modelName = isCandidate ? result.name : result.modelName;
    const factory = isCandidate ? undefined : result.factory;
    const shipmentUnit = isCandidate ? undefined : result.shipmentUnit;
    const vendorCd = isCandidate ? undefined : result.vendorCd;
    const vendorNm = isCandidate ? undefined : result.vendorNm;

    if (itemCode) form.setValue("itemCode", itemCode, { shouldValidate: true });
    if (modelName) form.setValue("modelName", modelName, { shouldValidate: true });
    if (factory) {
      skipFactoryClearRef.current = true;
      form.setValue("factory", factory, { shouldValidate: true });
      setTimeout(() => { skipFactoryClearRef.current = false; }, 0);
    }
    if (shipmentUnit) form.setValue("shipmentUnit", shipmentUnit, { shouldValidate: true });
    if (vendorCd) form.setValue("vendorCd", vendorCd, { shouldValidate: true });
    if (vendorNm) form.setValue("vendorNm", vendorNm, { shouldValidate: true });
    setErpSearchResult(null);
    setErpSearchProduct("");
    setErpSearchHogi("");
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file, 500);
      setPhoto(compressed);
      setPhotoPreview(URL.createObjectURL(compressed));
    } catch {
      toast({
        title: "오류",
        description: "이미지 처리 중 문제가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const uploadPhoto = async (file: File): Promise<string | null> => {
    const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
      data: {
        name: file.name || "photo.jpg",
        size: file.size,
        contentType: file.type || "image/jpeg",
      },
    });
    const uploadRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": file.type || "image/jpeg" },
      body: file,
    });
    if (!uploadRes.ok) throw new Error("업로드 실패");
    return objectPath;
  };

  const deriveIssuingTeam = (processName: string): string => {
    if (processName.includes("1라인")) return "1라인";
    if (processName.includes("2라인")) return "2라인";
    return processName;
  };

  const onSubmit = async (values: FormValues) => {
    setIsUploading(true);
    try {
      let objectPath = null;
      if (photo) objectPath = await uploadPhoto(photo);

      const selectedProcess = processes.find((p) => p.processNm === values.processName);

      await createReport.mutateAsync({
        data: {
          itemCode: values.itemCode,
          modelName: values.modelName || null,
          processName: values.processName,
          defectType: "",
          description: values.description,
          reportDate: new Date().toISOString(),
          imageUrl: objectPath ? `/api/storage${objectPath}` : null,
          registrantName: values.registrantName || null,
          ncrType: "공정",
          ncrGbnCd: "QC",
          factory: values.factory || null,
          plantCd: selectedPlantCd || null,
          processCd: selectedProcess?.processCd ?? null,
          shipmentUnit: values.shipmentUnit || null,
          defectQty: values.defectQty != null ? Math.round(values.defectQty) : null,
          occurrenceDate: values.occurrenceDate
            ? new Date(values.occurrenceDate).toISOString()
            : null,
          issuingTeam: deriveIssuingTeam(values.processName),
          deptCd: null,
          flawTypeCd: null,
          productType: values.productType,
          vendorCd: values.vendorCd?.trim() || null,
          vendorNm: values.vendorNm?.trim() || null,
        },
      });

      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetReportStatsQueryKey() });

      setIsSuccess(true);
      form.reset(profileDefaults());
      setPhoto(null);
      setPhotoPreview(null);
    } catch {
      toast({
        title: "제출 실패",
        description: "보고서 전송에 실패했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  if (isSuccess) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[80vh] p-6 text-center">
          <div className="bg-white rounded-3xl border border-border shadow-sm p-10 w-full max-w-sm">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" strokeWidth={1.8} />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              보고서가 접수되었습니다
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              부적합 보고서가 성공적으로 등록되었습니다.
              <br />
              관리자 검토 후 ERP에 동기화됩니다.
            </p>
            <button
              className="w-full rounded-xl font-semibold bg-[#1A1A1A] text-white py-3 text-[15px] flex items-center justify-center gap-2 transition-all hover:bg-[#333]"
              onClick={() => setIsSuccess(false)}
            >
              <Plus className="h-4 w-4" />
              새 보고서 작성
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  const SEL = "bg-[#1A1A1A] text-white";
  const UNSEL = "bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]";
  const CHIP_SEL = "border-[#1A1A1A] bg-[#F2F4F6] text-[#1A1A1A] font-semibold";
  const CHIP_UNSEL = "border-[#E5E8EB] text-[#4E5968] hover:border-[#1A1A1A]/30";

  return (
    <Layout>
      <div className="bg-white min-h-screen max-w-lg md:max-w-2xl mx-auto" style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}>

        {/* 페이지 헤더 */}
        <div className="px-5 pt-5 pb-3 border-b border-[#F2F4F6]">
          <h1 className="text-[20px] font-bold text-[#191F28]">부적합 보고서 등록</h1>
          <p className="text-[13px] text-[#8B95A1] mt-0.5">현장 부적합 사항을 모바일로 등록합니다</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>

            {/* ── 제품 구분 ── */}
            <FormField
              control={form.control}
              name="productType"
              render={({ field }) => (
                <FieldRow label="제품 구분">
                  <div className="grid grid-cols-2 gap-2">
                    {PRODUCT_TYPES.map((pt) => (
                      <button
                        key={pt.value}
                        type="button"
                        onClick={() => field.onChange(pt.value)}
                        className={`py-3.5 rounded-2xl text-[14px] font-bold transition-all ${field.value === pt.value ? SEL : UNSEL}`}
                      >
                        {pt.label}
                      </button>
                    ))}
                  </div>
                </FieldRow>
              )}
            />

            {/* 개발품 안내 배너 */}
            {selectedProductType === "개발" && (
              <div className="mx-5 mb-1 mt-0 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2.5">
                <span className="text-amber-500 text-[16px] leading-none mt-0.5">⚠</span>
                <div>
                  <p className="text-[12px] font-semibold text-amber-700">개발품 부적합 보고</p>
                  <p className="text-[11px] text-amber-600 mt-0.5 leading-relaxed">
                    접수 후 연구소 담당자에게 자동으로 전파됩니다.
                  </p>
                </div>
              </div>
            )}

            {/* ── 등록자 정보 ── */}
            <FormField
              control={form.control}
              name="registrantName"
              render={({ field }) => (
                <FieldRow label="등록자 이름" error={form.formState.errors.registrantName?.message}>
                  <input
                    placeholder="성명을 입력하세요"
                    className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
                    {...field}
                  />
                </FieldRow>
              )}
            />

            <FormField
              control={form.control}
              name="factory"
              render={({ field }) => (
                <FieldRow label="공장 선택" error={form.formState.errors.factory?.message}>
                  <div className="grid grid-cols-2 gap-2">
                    {FACTORY_OPTIONS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => field.onChange(f.value)}
                        className={`py-3.5 rounded-2xl text-[14px] font-bold transition-all ${field.value === f.value ? SEL : UNSEL}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </FieldRow>
              )}
            />

            <FormField
              control={form.control}
              name="processName"
              render={({ field }) => (
                <FieldRow label="등록자 공정" error={form.formState.errors.processName?.message}>
                  {processes.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {processes.map((p) => (
                        <button
                          key={p.processCd}
                          type="button"
                          onClick={() => {
                            field.onChange(p.processNm);
                          }}
                          className={`px-3.5 py-2 min-h-[44px] rounded-full text-[13px] border-2 transition-all flex items-center ${field.value === p.processNm ? CHIP_SEL : CHIP_UNSEL}`}
                        >
                          {p.processNm}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[13px] text-[#BEC5CC]">
                      {selectedFactory ? "공정 로딩 중…" : "공장을 먼저 선택해주세요"}
                    </p>
                  )}
                </FieldRow>
              )}
            />


            {/* ── 부적합 기본 정보 ── */}
            <GroupDivider title="부적합 기본 정보" />

            {/* ERP 제품 검색 */}
            <div className="px-5 py-4 border-b border-[#F2F4F6]">
              <div className="mb-3">
                <p className="text-[13px] font-semibold text-[#191F28] mb-0.5">ERP 자동 조회</p>
                <p className="text-[11px] text-[#8B95A1]">부품코드·제품명·품목그룹·거래처 중 아무거나 + (선택) 호기 — 단건이면 자동 입력</p>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={erpSearchProduct}
                  onChange={e => setErpSearchProduct(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchErpByProduct()}
                  placeholder="부품코드/제품/품목그룹/거래처"
                  className="flex-1 h-11 rounded-xl bg-[#F8F9FA] px-3 text-[14px] outline-none text-[#191F28] placeholder-[#BEC5CC] border-2 border-transparent focus:border-[#1A1A1A]"
                />
                <input
                  type="text"
                  value={erpSearchHogi}
                  onChange={e => setErpSearchHogi(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchErpByProduct()}
                  placeholder="호기"
                  className="w-20 h-11 rounded-xl bg-[#F8F9FA] px-3 text-[14px] outline-none text-[#191F28] placeholder-[#BEC5CC] border-2 border-transparent focus:border-[#1A1A1A] text-center"
                />
                <button
                  type="button"
                  onClick={searchErpByProduct}
                  disabled={erpSearchLoading || (!erpSearchProduct.trim() && !erpSearchHogi.trim())}
                  className="h-11 px-4 rounded-xl bg-[#1A1A1A] text-white text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                >
                  {erpSearchLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Search className="h-4 w-4" />
                  }
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
                          {erpSearchResult.itemGroup && (
                            <span className="text-[11px] text-[#8B95A1]">품목그룹 {erpSearchResult.itemGroup}</span>
                          )}
                          {erpSearchResult.factory && (
                            <span className="text-[11px] text-[#8B95A1]">공장 {erpSearchResult.factory}</span>
                          )}
                          {erpSearchResult.shipmentUnit && (
                            <span className="text-[11px] text-[#8B95A1]">호기 {erpSearchResult.shipmentUnit}</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => fillFromErp(erpSearchResult!)}
                        className="shrink-0 px-3 py-2 bg-[#1A1A1A] text-white text-[12px] font-bold rounded-xl min-h-[44px]"
                      >
                        이대로<br/>입력
                      </button>
                    </div>
                  ) : erpSearchResult.candidates && erpSearchResult.candidates.length > 0 ? (
                    <div className="rounded-xl border border-[#E5E8EB] overflow-hidden">
                      <div className="px-3 py-2 bg-[#F8F9FA] flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-[#4E5968]">
                          {erpSearchResult.candidates.length}건 검색됨
                        </span>
                        <span className="text-[11px] text-[#8B95A1]">항목을 선택하면 자동 입력됩니다</span>
                      </div>
                      <div className="max-h-52 overflow-y-auto divide-y divide-[#F2F4F6]">
                        {erpSearchResult.candidates.map(c => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => fillFromErp(c)}
                            className="w-full px-3 py-3 text-left hover:bg-[#F8F9FA] active:bg-[#F2F4F6] transition-colors"
                          >
                            <span className="font-semibold text-[13px] text-[#191F28] block">{c.code}</span>
                            <span className="text-[12px] text-[#8B95A1] block truncate">{c.name}</span>
                            <span className="text-[11px] text-[#BEC5CC]">{c.category}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[12px] text-amber-700">
                      {erpSearchResult.reason ?? "검색 결과가 없습니다. 직접 입력해주세요."}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 제품코드 */}
            <FormField
              control={form.control}
              name="itemCode"
              render={({ field }) => (
                <FieldRow label="제품코드" error={form.formState.errors.itemCode?.message}>
                  <input
                    type="text"
                    placeholder="제품코드를 입력하세요"
                    className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
                    {...field}
                  />
                </FieldRow>
              )}
            />

            <FormField
              control={form.control}
              name="modelName"
              render={({ field }) => (
                <FieldRow label="제품명" optional>
                  <input
                    placeholder="제품명을 입력하세요"
                    className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
                    {...field}
                  />
                </FieldRow>
              )}
            />

            <FormField
              control={form.control}
              name="shipmentUnit"
              render={({ field }) => (
                <FieldRow label="출하호기" optional>
                  <input
                    placeholder="예: 1호기, 2호기, LOT-001"
                    className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
                    {...field}
                  />
                </FieldRow>
              )}
            />

            <VendorPicker form={form} />

            <div className="px-5 py-4 border-b border-[#F2F4F6] grid grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="occurrenceDate"
                render={({ field }) => (
                  <div>
                    <p className="text-[13px] font-semibold text-[#191F28] mb-2.5">발생일</p>
                    <input
                      type="date"
                      className="text-[14px] text-[#191F28] outline-none bg-transparent font-medium w-full"
                      {...field}
                    />
                  </div>
                )}
              />
              <div>
                <p className="text-[13px] font-semibold text-[#191F28] mb-2.5">입력일</p>
                <p className="text-[14px] text-[#8B95A1] font-medium">{todayStr()}</p>
              </div>
            </div>

            {/* ── 부적합 상세 ── */}
            <GroupDivider title="부적합 상세" />

            <div className="px-5 py-4 border-b border-[#F2F4F6] grid grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="defectQty"
                render={({ field }) => (
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[13px] font-semibold text-[#191F28]">부적합 수량</span>
                      <span className="text-[11px] text-[#BEC5CC]">선택</span>
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      placeholder="0"
                      className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </div>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FieldRow label="부적합 현상" error={form.formState.errors.description?.message}>
                  <textarea
                    placeholder="발생한 부적합 현상을 상세히 기술해주세요"
                    rows={4}
                    className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent resize-none font-medium leading-relaxed"
                    {...field}
                  />
                </FieldRow>
              )}
            />

            {/* ── 첨부파일 ── */}
            <GroupDivider title="첨부파일" />

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoSelect}
            />

            <FieldRow label="사진 첨부" optional>
              {photoPreview ? (
                <div className="relative rounded-2xl overflow-hidden">
                  <img src={photoPreview} alt="첨부 사진" className="w-full max-h-64 object-cover rounded-2xl" />
                  <button
                    type="button"
                    onClick={() => { setPhoto(null); setPhotoPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-3 bg-[#F2F4F6] rounded-2xl px-4 py-4 text-[#8B95A1] active:bg-[#E5E8EB] transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                    <Camera className="h-5 w-5 text-[#4E5968]" />
                  </div>
                  <div className="text-left">
                    <p className="text-[14px] font-semibold text-[#191F28]">사진 추가</p>
                    <p className="text-[12px] text-[#8B95A1]">카메라 또는 갤러리에서 선택</p>
                  </div>
                </button>
              )}
            </FieldRow>

            {/* 모바일: 고정 버튼 + nav 높이만큼 스페이서 */}
            <div className="h-36 md:hidden" />

            {/* 데스크탑 제출 버튼 */}
            <div className="hidden md:block px-5 py-5 border-t border-[#F2F4F6]">
              <button
                type="submit"
                disabled={isUploading || createReport.isPending}
                className="w-full bg-[#1A1A1A] text-white font-bold text-[16px] rounded-2xl py-4 disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                {isUploading || createReport.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    제출 중...
                  </>
                ) : (
                  "부적합 보고서 제출"
                )}
              </button>
            </div>

            {/* 모바일 고정 제출 버튼 (하단 nav 위) */}
            <div className="fixed md:hidden bottom-16 inset-x-0 z-[60] bg-white/95 backdrop-blur-sm border-t border-[#F2F4F6] px-5 py-3">
              <button
                type="submit"
                disabled={isUploading || createReport.isPending}
                className="w-full bg-[#1A1A1A] text-white font-bold text-[15px] rounded-2xl min-h-[44px] disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                {isUploading || createReport.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    제출 중...
                  </>
                ) : (
                  "부적합 보고서 제출"
                )}
              </button>
            </div>

          </form>
        </Form>
      </div>
    </Layout>
  );
}
