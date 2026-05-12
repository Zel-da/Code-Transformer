import { Layout } from "@/components/layout";
import { useState, useRef, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListItems,
  useListFlawTypes,
  useListProcesses,
  useListDepartments,
  useRequestUploadUrl,
  useCreateReport,
  getListReportsQueryKey,
  getGetReportStatsQueryKey,
  getListProcessesQueryKey,
} from "@workspace/api-client-react";
import { compressImage } from "@/lib/image-compression";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Camera,
  Loader2,
  CheckCircle2,
  X,
  Plus,
  ImageIcon,
  User,
  Factory,
  Tag,
  CalendarDays,
  Hash,
  Clock3,
  FileWarning,
  Paperclip,
  Building2,
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

const NCR_TYPES = [
  { label: "공정", value: "QC" },
  { label: "출하", value: "QO" },
  { label: "AS", value: "AS" },
] as const;

const todayStr = () => new Date().toISOString().split("T")[0];

const formSchema = z.object({
  registrantName: z.string().min(1, "등록자명을 입력해주세요"),
  factory: z.string().min(1, "공장을 선택해주세요"),
  processName: z.string().min(1, "공정을 선택해주세요"),
  issuingTeam: z.string().optional(),
  deptCd: z.string().optional(),
  ncrType: z.string().min(1, "부적합 구분을 선택해주세요"),
  itemCode: z.string().min(1, "제품코드를 선택해주세요"),
  shipmentUnit: z.string().optional(),
  occurrenceDate: z.string().optional(),
  defectType: z.string().min(1, "불량유형을 선택해주세요"),
  flawTypeCd: z.string().optional(),
  defectQty: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(0).optional(),
  ),
  lostManHours: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().min(0).optional(),
  ),
  description: z.string().min(1, "부적합 현상을 입력해주세요"),
});

type FormValues = z.infer<typeof formSchema>;

function SectionHeader({
  icon,
  title,
  step,
}: {
  icon: React.ReactNode;
  title: string;
  step: number;
}) {
  return (
    <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border">
      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
        {icon}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-primary bg-primary/10 rounded-full px-2 py-0.5">
          {step}
        </span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
    </div>
  );
}

export default function SubmitReport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const [itemSearch, setItemSearch] = useState("");
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false);
  const [debouncedItemSearch, setDebouncedItemSearch] = useState("");
  const itemInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedItemSearch(itemSearch), 300);
    return () => clearTimeout(timer);
  }, [itemSearch]);

  const { data: items = [], isFetching: itemsFetching } = useListItems(
    debouncedItemSearch.length >= 1 ? { search: debouncedItemSearch, limit: 20 } : { limit: 20 },
  );
  const { data: flawTypes = [] } = useListFlawTypes();
  const { data: departments = [] } = useListDepartments();

  const requestUploadUrl = useRequestUploadUrl();
  const createReport = useCreateReport();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      registrantName: "",
      factory: "",
      processName: "",
      issuingTeam: "",
      deptCd: "",
      ncrType: "",
      itemCode: "",
      shipmentUnit: "",
      occurrenceDate: todayStr(),
      defectType: "",
      flawTypeCd: "",
      defectQty: undefined,
      lostManHours: undefined,
      description: "",
    },
  });

  const selectedFactory = form.watch("factory");
  const selectedPlantCd = FACTORY_TO_PLANT_CD[selectedFactory] ?? "";

  const { data: processes = [] } = useListProcesses(
    selectedPlantCd ? { plantCd: selectedPlantCd } : undefined,
    { query: { enabled: !!selectedPlantCd, queryKey: getListProcessesQueryKey(selectedPlantCd ? { plantCd: selectedPlantCd } : undefined) } },
  );

  useEffect(() => {
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

  const onSubmit = async (values: FormValues) => {
    setIsUploading(true);
    try {
      let objectPath = null;
      if (photo) objectPath = await uploadPhoto(photo);

      const selectedProcess = processes.find((p) => p.processNm === values.processName);
      const selectedDept = departments.find((d) => d.deptCd === values.deptCd);
      const ncrLabel = NCR_TYPES.find((t) => t.value === values.ncrType)?.label ?? values.ncrType;

      await createReport.mutateAsync({
        data: {
          itemCode: values.itemCode,
          processName: values.processName,
          defectType: values.defectType,
          description: values.description,
          reportDate: new Date().toISOString(),
          imageUrl: objectPath ? `/api/storage${objectPath}` : null,
          registrantName: values.registrantName || null,
          ncrType: ncrLabel || null,
          ncrGbnCd: values.ncrType || null,
          factory: values.factory || null,
          plantCd: selectedPlantCd || null,
          processCd: selectedProcess?.processCd ?? null,
          shipmentUnit: values.shipmentUnit || null,
          lostManHours: values.lostManHours ?? null,
          defectQty: values.defectQty != null ? Math.round(values.defectQty) : null,
          occurrenceDate: values.occurrenceDate
            ? new Date(values.occurrenceDate).toISOString()
            : null,
          issuingTeam: selectedDept?.deptName ?? values.issuingTeam ?? null,
          deptCd: values.deptCd || null,
          flawTypeCd: values.flawTypeCd || null,
        },
      });

      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetReportStatsQueryKey() });

      setIsSuccess(true);
      form.reset({
        registrantName: "",
        factory: "",
        processName: "",
        issuingTeam: "",
        deptCd: "",
        ncrType: "",
        itemCode: "",
        shipmentUnit: "",
        occurrenceDate: todayStr(),
        defectType: "",
        flawTypeCd: "",
        defectQty: undefined,
        lostManHours: undefined,
        description: "",
      });
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
            <Button
              size="lg"
              className="w-full rounded-xl font-semibold"
              onClick={() => setIsSuccess(false)}
            >
              <Plus className="mr-2 h-4 w-4" />
              새 보고서 작성
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto p-4 md:p-6 pb-32">
        <div className="mb-6 pt-1">
          <h1 className="text-2xl font-bold text-foreground">부적합 보고서 등록</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            현장 부적합 사항을 모바일로 등록합니다
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* ── SECTION 1: 등록 정보 ── */}
            <div className="bg-white rounded-2xl border border-border shadow-sm p-5">
              <SectionHeader
                step={1}
                icon={<User className="h-4 w-4" />}
                title="등록 정보"
              />

              <div className="space-y-4">
                {/* 등록자 */}
                <FormField
                  control={form.control}
                  name="registrantName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">등록자</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="성명을 입력하세요"
                          className="h-11 rounded-xl bg-background"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                {/* 공장 */}
                <FormField
                  control={form.control}
                  name="factory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium flex items-center gap-1.5">
                        <Factory className="h-3.5 w-3.5 text-muted-foreground" />
                        공장
                      </FormLabel>
                      <div className="grid grid-cols-2 gap-2 pt-0.5">
                        {FACTORY_OPTIONS.map((f) => (
                          <button
                            key={f.value}
                            type="button"
                            onClick={() => field.onChange(f.value)}
                            className={`py-3 text-sm font-semibold rounded-xl border-2 transition-all ${
                              field.value === f.value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                {/* 등록자 공정 */}
                <FormField
                  control={form.control}
                  name="processName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">등록자 공정</FormLabel>
                      {processes.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 pt-0.5">
                          {processes.map((p) => (
                            <button
                              key={p.processCd}
                              type="button"
                              onClick={() => field.onChange(p.processNm)}
                              className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 text-left transition-all ${
                                field.value === p.processNm
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              }`}
                            >
                              <span className="block">{p.processNm}</span>
                              <span className="text-[10px] opacity-60">{p.processCd}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="h-11 rounded-xl border border-dashed border-border bg-muted/40 flex items-center justify-center">
                          <span className="text-xs text-muted-foreground">
                            {selectedFactory ? "공정 로딩 중..." : "공장을 먼저 선택해주세요"}
                          </span>
                        </div>
                      )}
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                {/* 발행팀 */}
                <FormField
                  control={form.control}
                  name="deptCd"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        발행팀
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger className="h-11 rounded-xl bg-background">
                            <SelectValue placeholder="발행팀을 선택하세요" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-xl max-h-60">
                          {departments.map((dept) => (
                            <SelectItem key={dept.deptCd} value={dept.deptCd}>
                              <span className={dept.isFrequent ? "font-semibold" : ""}>
                                {dept.deptName}
                              </span>
                              {dept.isFrequent && (
                                <span className="ml-1.5 text-[10px] text-primary bg-primary/10 rounded px-1">자주사용</span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* ── SECTION 2: 부적합 기본 정보 ── */}
            <div className="bg-white rounded-2xl border border-border shadow-sm p-5">
              <SectionHeader
                step={2}
                icon={<Tag className="h-4 w-4" />}
                title="부적합 기본 정보"
              />

              <div className="space-y-4">
                {/* 부적합 구분 */}
                <FormField
                  control={form.control}
                  name="ncrType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">부적합 구분</FormLabel>
                      <div className="grid grid-cols-3 gap-2 pt-0.5">
                        {NCR_TYPES.map((t) => (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() => field.onChange(t.value)}
                            className={`py-3 text-sm font-semibold rounded-xl border-2 transition-all ${
                              field.value === t.value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                {/* 제품코드(모델명) — 검색 자동완성 */}
                <FormField
                  control={form.control}
                  name="itemCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">제품코드 (모델명)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <div className={`flex items-center h-11 rounded-xl border-2 bg-background px-3 gap-2 transition-colors ${itemDropdownOpen ? "border-primary" : "border-border"}`}>
                            <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <input
                              ref={itemInputRef}
                              type="text"
                              placeholder={field.value || "코드나 제품명으로 검색하세요"}
                              value={itemSearch}
                              onChange={e => {
                                setItemSearch(e.target.value);
                                setItemDropdownOpen(true);
                                if (!e.target.value) field.onChange("");
                              }}
                              onFocus={() => setItemDropdownOpen(true)}
                              onBlur={() => setTimeout(() => setItemDropdownOpen(false), 150)}
                              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                            />
                            {field.value && (
                              <button
                                type="button"
                                onClick={() => { field.onChange(""); setItemSearch(""); itemInputRef.current?.focus(); }}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {itemsFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" />}
                          </div>
                          {field.value && !itemDropdownOpen && (
                            <div className="mt-1.5 px-1">
                              <span className="text-xs text-primary font-medium">{field.value}</span>
                              <span className="text-xs text-muted-foreground ml-1.5">
                                {items.find(i => i.code === field.value)?.name ?? ""}
                              </span>
                            </div>
                          )}
                          {itemDropdownOpen && items.length > 0 && (
                            <div className="absolute z-50 top-12 left-0 right-0 bg-white rounded-xl border border-border shadow-lg max-h-52 overflow-y-auto">
                              {items.map(item => (
                                <button
                                  key={item.code}
                                  type="button"
                                  onMouseDown={() => {
                                    field.onChange(item.code);
                                    setItemSearch("");
                                    setItemDropdownOpen(false);
                                  }}
                                  className={`w-full px-3 py-2.5 text-left hover:bg-muted/60 transition-colors border-b border-border/40 last:border-0 ${field.value === item.code ? "bg-primary/5" : ""}`}
                                >
                                  <span className="text-sm font-semibold text-primary block">{item.code}</span>
                                  <span className="text-xs text-muted-foreground block truncate">{item.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {itemDropdownOpen && debouncedItemSearch.length >= 1 && items.length === 0 && !itemsFetching && (
                            <div className="absolute z-50 top-12 left-0 right-0 bg-white rounded-xl border border-border shadow-lg px-4 py-4 text-center text-sm text-muted-foreground">
                              검색 결과가 없습니다
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                {/* 출하호기 */}
                <FormField
                  control={form.control}
                  name="shipmentUnit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        출하호기{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          (선택)
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="예: 1호기, 2호기, LOT-001"
                          className="h-11 rounded-xl bg-background"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-3">
                  {/* 발생일 */}
                  <FormField
                    control={form.control}
                    name="occurrenceDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                          발생일
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            className="h-11 rounded-xl bg-background"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />

                  {/* 입력일 (read-only, auto today) */}
                  <div>
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                      입력일
                    </Label>
                    <Input
                      value={todayStr()}
                      readOnly
                      className="h-11 rounded-xl bg-muted/50 text-muted-foreground mt-2"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── SECTION 3: 불량 상세 ── */}
            <div className="bg-white rounded-2xl border border-border shadow-sm p-5">
              <SectionHeader
                step={3}
                icon={<FileWarning className="h-4 w-4" />}
                title="불량 상세"
              />

              <div className="space-y-4">
                {/* 불량유형 — ERP 실데이터 */}
                <FormField
                  control={form.control}
                  name="defectType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">불량유형</FormLabel>
                      {flawTypes.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2 pt-0.5">
                          {flawTypes.map((ft) => (
                            <button
                              key={ft.typeCd}
                              type="button"
                              onClick={() => {
                                field.onChange(ft.typeNm);
                                form.setValue("flawTypeCd", ft.typeCd);
                              }}
                              className={`py-2.5 px-2 text-sm font-medium rounded-xl border-2 text-center transition-all ${
                                field.value === ft.typeNm
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              }`}
                            >
                              {ft.typeNm}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="h-11 rounded-xl border border-dashed border-border bg-muted/40 flex items-center justify-center">
                          <span className="text-xs text-muted-foreground">불량유형 로딩 중...</span>
                        </div>
                      )}
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-3">
                  {/* 불량수량 */}
                  <FormField
                    control={form.control}
                    name="defectQty"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium flex items-center gap-1">
                          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                          불량수량
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            placeholder="0"
                            className="h-11 rounded-xl bg-background"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value)}
                          />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />

                  {/* 손실공수 */}
                  <FormField
                    control={form.control}
                    name="lostManHours"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                          손실공수 (H)
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.5"
                            placeholder="0.0"
                            className="h-11 rounded-xl bg-background"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value)}
                          />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>

                {/* 부적합 현상 */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">부적합 현상</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="발생한 부적합 현상을 상세히 기술해주세요"
                          className="min-h-[100px] rounded-xl bg-background resize-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* ── SECTION 4: 첨부파일 ── */}
            <div className="bg-white rounded-2xl border border-border shadow-sm p-5">
              <SectionHeader
                step={4}
                icon={<Paperclip className="h-4 w-4" />}
                title="첨부파일"
              />

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoSelect}
              />

              {photoPreview ? (
                <div className="relative rounded-xl overflow-hidden border border-border">
                  <img
                    src={photoPreview}
                    alt="첨부 사진"
                    className="w-full max-h-64 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setPhoto(null);
                      setPhotoPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-3 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-primary/5 transition-all"
                >
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">사진 추가</p>
                    <p className="text-xs mt-0.5 opacity-70">카메라 또는 갤러리에서 선택</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs bg-muted rounded-lg px-3 py-1.5">
                    <Camera className="h-3.5 w-3.5" />
                    촬영하기
                  </div>
                </button>
              )}
            </div>

            {/* 제출 버튼 */}
            <Button
              type="submit"
              size="lg"
              className="w-full rounded-xl font-semibold h-14 text-base"
              disabled={isUploading || createReport.isPending}
            >
              {isUploading || createReport.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  제출 중...
                </>
              ) : (
                "부적합 보고서 제출"
              )}
            </Button>
          </form>
        </Form>
      </div>
    </Layout>
  );
}
