import { Layout } from "@/components/layout";
import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListItems,
  useRequestUploadUrl,
  useCreateReport,
  getListReportsQueryKey,
  getGetReportStatsQueryKey,
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
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const PROCESS_BY_FACTORY: Record<string, string[]> = {
  아산: ["1라인", "2라인", "3라인", "전기", "제관", "가공라인", "사내외주"],
  화성: [
    "CR붐조립",
    "CR장착검사",
    "CR바디조립",
    "BR선삭",
    "BR연삭",
    "BR열처리",
    "BR-M/B조립",
    "BR-BKT조립",
  ],
};

const ISSUING_TEAM_BY_FACTORY: Record<string, string> = {
  아산: "아산 품질팀",
  화성: "화성 품질팀",
};

const NCR_TYPES = ["공정", "AS", "입고", "품질"] as const;
const DEFECT_TYPES = ["치수불량", "외관불량", "기능불량", "재료불량", "포장불량", "기타"];

const todayStr = () => new Date().toISOString().split("T")[0];

const formSchema = z.object({
  registrantName: z.string().min(1, "등록자명을 입력해주세요"),
  factory: z.string().min(1, "공장을 선택해주세요"),
  processName: z.string().min(1, "공정을 선택해주세요"),
  issuingTeam: z.string().optional(),
  ncrType: z.string().min(1, "부적합 구분을 선택해주세요"),
  itemCode: z.string().min(1, "제품코드를 선택해주세요"),
  shipmentUnit: z.string().optional(),
  occurrenceDate: z.string().optional(),
  defectType: z.string().min(1, "불량유형을 선택해주세요"),
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

  const { data: items } = useListItems();
  const requestUploadUrl = useRequestUploadUrl();
  const createReport = useCreateReport();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      registrantName: "",
      factory: "",
      processName: "",
      issuingTeam: "",
      ncrType: "",
      itemCode: "",
      shipmentUnit: "",
      occurrenceDate: todayStr(),
      defectType: "",
      defectQty: undefined,
      lostManHours: undefined,
      description: "",
    },
  });

  const selectedFactory = form.watch("factory");
  const processOptions = PROCESS_BY_FACTORY[selectedFactory] ?? [];

  useEffect(() => {
    if (selectedFactory) {
      form.setValue("processName", "");
      form.setValue("issuingTeam", ISSUING_TEAM_BY_FACTORY[selectedFactory] ?? "");
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

      await createReport.mutateAsync({
        data: {
          itemCode: values.itemCode,
          processName: values.processName,
          defectType: values.defectType,
          description: values.description,
          reportDate: new Date().toISOString(),
          imageUrl: objectPath ? `/api/storage${objectPath}` : null,
          registrantName: values.registrantName || null,
          ncrType: values.ncrType || null,
          factory: values.factory || null,
          shipmentUnit: values.shipmentUnit || null,
          lostManHours: values.lostManHours ?? null,
          defectQty: values.defectQty != null ? Math.round(values.defectQty) : null,
          occurrenceDate: values.occurrenceDate
            ? new Date(values.occurrenceDate).toISOString()
            : null,
          issuingTeam: values.issuingTeam || null,
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
        ncrType: "",
        itemCode: "",
        shipmentUnit: "",
        occurrenceDate: todayStr(),
        defectType: "",
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
                        {["아산", "화성"].map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => field.onChange(f)}
                            className={`py-3 text-sm font-semibold rounded-xl border-2 transition-all ${
                              field.value === f
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            }`}
                          >
                            {f}공장
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
                      {processOptions.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 pt-0.5">
                          {processOptions.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => field.onChange(p)}
                              className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 text-left transition-all ${
                                field.value === p
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              }`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="h-11 rounded-xl border border-dashed border-border bg-muted/40 flex items-center justify-center">
                          <span className="text-xs text-muted-foreground">
                            공장을 먼저 선택해주세요
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
                  name="issuingTeam"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-muted-foreground">
                        발행팀{" "}
                        <span className="text-xs font-normal">(공장 선택 시 자동 입력)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="발행팀명"
                          className="h-11 rounded-xl bg-background"
                          {...field}
                        />
                      </FormControl>
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
                      <div className="grid grid-cols-4 gap-2 pt-0.5">
                        {NCR_TYPES.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => field.onChange(t)}
                            className={`py-3 text-sm font-semibold rounded-xl border-2 transition-all ${
                              field.value === t
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                {/* 제품코드(모델명) */}
                <FormField
                  control={form.control}
                  name="itemCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">제품코드 (모델명)</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-11 rounded-xl bg-background">
                            <SelectValue placeholder="제품코드를 선택하세요" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-xl">
                          {items?.map((item) => (
                            <SelectItem key={item.code} value={item.code}>
                              <span className="font-medium text-primary">{item.code}</span>
                              <span className="text-muted-foreground ml-2 text-xs">
                                {item.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                {/* 불량유형 */}
                <FormField
                  control={form.control}
                  name="defectType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">불량유형</FormLabel>
                      <div className="grid grid-cols-3 gap-2 pt-0.5">
                        {DEFECT_TYPES.map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => field.onChange(type)}
                            className={`py-3 px-2 text-sm font-medium rounded-xl border-2 transition-all ${
                              field.value === type
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            }`}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
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
                          손실공수
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

                {/* 부적합현상 */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">부적합 현상</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="불량 발생 상황, 특이사항 등 상세 내용을 기재해주세요"
                          className="min-h-[120px] rounded-xl bg-background resize-none"
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
                type="file"
                accept="image/*,video/*"
                capture="environment"
                className="hidden"
                ref={fileInputRef}
                onChange={handlePhotoSelect}
              />

              {!photoPreview ? (
                <button
                  type="button"
                  className="w-full border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-all"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-7 w-7" strokeWidth={1.5} />
                  <div className="text-center">
                    <p className="text-sm font-medium">불량 사진 / 동영상 첨부</p>
                    <p className="text-xs mt-0.5 opacity-70">
                      탭하여 촬영하거나 파일을 선택하세요
                    </p>
                  </div>
                </button>
              ) : (
                <div className="relative rounded-xl overflow-hidden border border-border">
                  <img
                    src={photoPreview}
                    alt="미리보기"
                    className="w-full h-auto max-h-72 object-contain bg-gray-50"
                  />
                  <div className="absolute top-2 right-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-white/90 backdrop-blur-sm text-foreground text-xs font-medium px-3 py-1.5 rounded-lg border border-border shadow-sm flex items-center gap-1.5 hover:bg-white transition-colors"
                    >
                      <Camera className="h-3.5 w-3.5" /> 재촬영
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPhoto(null);
                        setPhotoPreview(null);
                      }}
                      className="bg-white/90 backdrop-blur-sm text-destructive p-1.5 rounded-lg border border-border shadow-sm hover:bg-white transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="absolute bottom-2 left-2 bg-black/50 text-white text-[11px] px-2 py-1 rounded-md flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" />
                    {photo?.size ? `${Math.round(photo.size / 1024)}KB` : ""}
                  </div>
                </div>
              )}
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full h-14 text-base font-semibold rounded-2xl shadow-sm"
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 업로드 중...
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
