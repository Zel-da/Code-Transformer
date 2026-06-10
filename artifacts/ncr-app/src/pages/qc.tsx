import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useState } from "react";
import {
  useGetReport,
  useUpdateReportQc,
  useListFlawTypes,
  useListItems,
  useListDepartments,
  useListPlants,
  useListProcesses,
  useListVendors,
  getListReportsQueryKey,
  getGetReportQueryKey,
  getListVendorsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ChevronLeft, RefreshCw, Save } from "lucide-react";

const QC_STATUSES = ["접수", "분석 중", "조치 완료", "종결"] as const;
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
  qcStatus: z.enum(QC_STATUSES),
  vendorCd: z.string().nullable().optional(),
  vendorNm: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  shipmentDateFrom: z.string().nullable().optional(),
  shipmentDateTo: z.string().nullable().optional(),
  managerCd: z.string().nullable().optional(),
  managerNm: z.string().nullable().optional(),
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
    <div className="py-3.5 border-b border-[#F2F4F6]">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[12px] font-semibold text-[#8B95A1]">{label}</span>
        {optional && <span className="text-[10px] text-[#BEC5CC]">선택</span>}
      </div>
      {children}
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

const QC_STATUS_COLORS: Record<string, string> = {
  "접수": "bg-blue-50 text-blue-700 border-blue-200",
  "분석 중": "bg-amber-50 text-amber-700 border-amber-200",
  "조치 완료": "bg-green-50 text-green-700 border-green-200",
  "종결": "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]",
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

  const { data: report, isLoading } = useGetReport(id);
  const { data: flawTypes = [] } = useListFlawTypes();
  const { data: itemsData = [] } = useListItems({ limit: 100 });
  const { data: departments = [] } = useListDepartments();
  const { data: plants = [] } = useListPlants();
  const updateQc = useUpdateReportQc();

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
      qcStatus: "접수",
      vendorCd: null,
      vendorNm: null,
      remarks: null,
      shipmentDateFrom: null,
      shipmentDateTo: null,
      managerCd: null,
      managerNm: null,
    },
  });

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
        qcStatus: (report.qcStatus as (typeof QC_STATUSES)[number]) ?? "접수",
        vendorCd: report.vendorCd ?? null,
        vendorNm: report.vendorNm ?? null,
        remarks: report.remarks ?? null,
        shipmentDateFrom: report.shipmentDateFrom
          ? format(new Date(report.shipmentDateFrom), "yyyy-MM-dd")
          : null,
        shipmentDateTo: report.shipmentDateTo
          ? format(new Date(report.shipmentDateTo), "yyyy-MM-dd")
          : null,
        managerCd: report.managerCd ?? null,
        managerNm: report.managerNm ?? null,
      });
    }
  }, [report]);

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
          qcStatus: values.qcStatus,
          vendorCd: values.vendorCd || null,
          vendorNm: values.vendorNm || null,
          remarks: values.remarks || null,
          shipmentDateFrom: values.shipmentDateFrom
            ? new Date(values.shipmentDateFrom).toISOString()
            : null,
          shipmentDateTo: values.shipmentDateTo
            ? new Date(values.shipmentDateTo).toISOString()
            : null,
          managerCd: values.managerCd || null,
          managerNm: values.managerNm || null,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(id) }),
      ]);
      toast({ title: "QC 분석 저장 완료", description: "분석 결과가 저장되었습니다." });
      navigate("/ledger");
    } catch {
      toast({ title: "오류", description: "저장에 실패했습니다.", variant: "destructive" });
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

  const currentStatus = form.watch("qcStatus");
  const currentAction = form.watch("actionDirection");

  return (
    <Layout>
      <div className="max-w-lg mx-auto px-5 py-5 pb-32">
        {/* 헤더 */}
        <div className="flex items-center gap-2 mb-5">
          <button
            onClick={() => navigate("/ledger")}
            className="h-8 w-8 rounded-xl bg-[#F2F4F6] flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-[18px] font-bold text-[#191F28]">QC 분석 입력</h1>
            <p className="text-[12px] text-[#8B95A1]">보고서 #{String(report.id).padStart(4, "0")} · 접수 {format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#F2F4F6] px-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>

              {/* ── 접수 기본 정보 ── */}
              <GroupDivider title="접수 기본 정보" />

              {/* 등록자 */}
              <FormField
                control={form.control}
                name="registrantName"
                render={({ field }) => (
                  <FieldRow label="등록자" optional>
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
                  <FieldRow label="공장" optional>
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
              <GroupDivider title="부적합 내용" />

              {/* 부품코드 */}
              <FormField
                control={form.control}
                name="itemCode"
                render={({ field }) => (
                  <FieldRow label="부품코드" error={form.formState.errors.itemCode?.message}>
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
                  <FieldRow label="모델명" optional>
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
                  <FieldRow label="공정" error={form.formState.errors.processName?.message}>
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
                  <FieldRow label="불량 수량" optional>
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

              {/* 출하 단위 */}
              <FormField
                control={form.control}
                name="shipmentUnit"
                render={({ field }) => (
                  <FieldRow label="출하 단위" optional>
                    <FormItem>
                      <FormControl>
                        <input
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          className={INPUT_CLS}
                          placeholder="출하 단위 (선택)"
                        />
                      </FormControl>
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 거래처 */}
              <VendorPicker form={form} />

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

              {/* ── QC 분석 내용 ── */}
              <GroupDivider title="QC 분석 내용" />

              {/* 처리 상태 */}
              <FieldRow label="처리 상태">
                <div className="flex flex-wrap gap-2">
                  {QC_STATUSES.map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => form.setValue("qcStatus", status)}
                      className={`px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-all ${
                        currentStatus === status
                          ? QC_STATUS_COLORS[status]
                          : "bg-[#F8F9FA] text-[#8B95A1] border-transparent"
                      }`}
                    >
                      {status}
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

              <div className="py-5">
                <button
                  type="submit"
                  disabled={updateQc.isPending}
                  className="w-full py-3.5 bg-[#1A1A1A] text-white font-bold text-[15px] rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
                >
                  {updateQc.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  저장
                </button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </Layout>
  );
}
