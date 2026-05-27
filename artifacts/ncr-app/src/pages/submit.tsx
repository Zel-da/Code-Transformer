import { Layout } from "@/components/layout";
import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/auth";
import {
  useListItems,
  useListProcesses,
  useRequestUploadUrl,
  useCreateReport,
  getListReportsQueryKey,
  getGetReportStatsQueryKey,
  getListProcessesQueryKey,
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
  actionDirection: z.enum(ACTION_DIRECTIONS, { errorMap: () => ({ message: "조치 방향을 선택해주세요" }) }),
  itemCode: z.string().min(1, "제품코드를 선택해주세요"),
  modelName: z.string().optional(),
  shipmentUnit: z.string().optional(),
  occurrenceDate: z.string().optional(),
  defectQty: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(0).optional(),
  ),
  description: z.string().min(1, "부적합 현상을 입력해주세요"),
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

  const [itemSearch, setItemSearch] = useState("");
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false);
  const [debouncedItemSearch, setDebouncedItemSearch] = useState("");
  const itemInputRef = useRef<HTMLInputElement>(null);
  const skipFactoryClearRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedItemSearch(itemSearch), 300);
    return () => clearTimeout(timer);
  }, [itemSearch]);

  const { data: items = [], isFetching: itemsFetching } = useListItems(
    debouncedItemSearch.length >= 1 ? { search: debouncedItemSearch, limit: 20 } : { limit: 20 },
  );

  const requestUploadUrl = useRequestUploadUrl();
  const createReport = useCreateReport();

  const profileDefaults = () => ({
    productType: "양산" as "양산" | "개발",
    registrantName: user?.displayName ?? "",
    factory: user?.factory ?? "",
    processName: user?.processName ?? "",
    actionDirection: undefined as (typeof ACTION_DIRECTIONS)[number] | undefined,
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
          actionDirection: values.actionDirection ?? null,
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
                          className={`px-3.5 py-2 rounded-full text-[13px] border-2 transition-all ${field.value === p.processNm ? CHIP_SEL : CHIP_UNSEL}`}
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

            {/* 조치 방향 */}
            <FormField
              control={form.control}
              name="actionDirection"
              render={({ field }) => (
                <FieldRow label="조치 방향" error={form.formState.errors.actionDirection?.message}>
                  <div className="flex flex-col gap-2">
                    {ACTION_DIRECTIONS.map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => field.onChange(dir)}
                        className={`w-full text-left px-4 py-3 rounded-xl text-[14px] font-semibold border-2 transition-all ${field.value === dir ? "border-[#1A1A1A] bg-[#F2F4F6] text-[#1A1A1A]" : "border-[#E5E8EB] text-[#4E5968] hover:border-[#1A1A1A]/30"}`}
                      >
                        {dir}
                      </button>
                    ))}
                  </div>
                </FieldRow>
              )}
            />

            {/* ── 부적합 기본 정보 ── */}
            <GroupDivider title="부적합 기본 정보" />

            {/* 제품코드 — 검색 자동완성 */}
            <FormField
              control={form.control}
              name="itemCode"
              render={({ field }) => (
                <FieldRow label="제품코드 (모델명)" error={form.formState.errors.itemCode?.message}>
                  <div className="relative">
                      <div className={`flex items-center h-11 rounded-xl bg-[#F8F9FA] px-3 gap-2 border-2 transition-colors ${itemDropdownOpen ? "border-[#1A1A1A]" : "border-transparent"}`}>
                        <Search className="h-4 w-4 text-[#BEC5CC] flex-shrink-0" />
                        <input
                          ref={itemInputRef}
                          type="text"
                          placeholder={field.value || "코드나 제품명으로 검색"}
                          value={itemSearch}
                          onChange={e => {
                            setItemSearch(e.target.value);
                            setItemDropdownOpen(true);
                            if (!e.target.value) field.onChange("");
                          }}
                          onFocus={() => setItemDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setItemDropdownOpen(false), 150)}
                          className="flex-1 text-[14px] bg-transparent outline-none text-[#191F28] placeholder-[#BEC5CC]"
                        />
                        {field.value && (
                          <button type="button" onClick={() => { field.onChange(""); setItemSearch(""); itemInputRef.current?.focus(); }}>
                            <X className="h-3.5 w-3.5 text-[#BEC5CC]" />
                          </button>
                        )}
                        {itemsFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#BEC5CC] flex-shrink-0" />}
                      </div>
                      {field.value && !itemDropdownOpen && (
                        <div className="mt-1.5">
                          <span className="text-[12px] font-semibold text-[#191F28]">{field.value}</span>
                          <span className="text-[12px] text-[#8B95A1] ml-1.5">{items.find(i => i.code === field.value)?.name ?? ""}</span>
                        </div>
                      )}
                      {itemDropdownOpen && items.length > 0 && (
                        <div className="absolute z-50 top-12 left-0 right-0 bg-white rounded-xl border border-[#E5E8EB] shadow-lg max-h-52 overflow-y-auto">
                          {items.map(item => (
                            <button
                              key={item.code}
                              type="button"
                              onMouseDown={() => { field.onChange(item.code); setItemSearch(""); setItemDropdownOpen(false); }}
                              className={`w-full px-3 py-2.5 text-left hover:bg-[#F8F9FA] transition-colors border-b border-[#F2F4F6] last:border-0 ${field.value === item.code ? "bg-[#F2F4F6]" : ""}`}
                            >
                              <span className="text-[13px] font-semibold text-[#191F28] block">{item.code}</span>
                              <span className="text-[12px] text-[#8B95A1] block truncate">{item.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {itemDropdownOpen && debouncedItemSearch.length >= 1 && items.length === 0 && !itemsFetching && (
                        <div className="absolute z-50 top-12 left-0 right-0 bg-white rounded-xl border border-[#E5E8EB] shadow-lg px-4 py-4 text-center text-[13px] text-[#8B95A1]">
                          검색 결과가 없습니다
                        </div>
                      )}
                    </div>
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

            {/* ── 불량 상세 ── */}
            <GroupDivider title="불량 상세" />

            <div className="px-5 py-4 border-b border-[#F2F4F6] grid grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="defectQty"
                render={({ field }) => (
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[13px] font-semibold text-[#191F28]">불량수량</span>
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

            {/* 제출 버튼 */}
            <div className="px-5 py-5 pb-28 md:pb-10">
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

          </form>
        </Form>
      </div>
    </Layout>
  );
}
