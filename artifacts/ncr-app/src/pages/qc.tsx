import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import {
  useGetReport,
  useUpdateReportQc,
  useListFlawTypes,
  useListItems,
  useListDepartments,
  getListReportsQueryKey,
  getGetReportQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/layout";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ChevronLeft, RefreshCw, Save } from "lucide-react";

const QC_STATUSES = ["접수", "분석 중", "조치 완료", "종결"] as const;

const formSchema = z.object({
  itemCode: z.string().min(1, "부품코드를 입력해주세요"),
  processName: z.string().min(1, "공정을 입력해주세요"),
  deptCd: z.string().nullable().optional(),
  issuingTeam: z.string().nullable().optional(),
  flawTypeCd: z.string().nullable().optional(),
  lostManHours: z.coerce.number().min(0).nullable().optional(),
  qcCorrectiveResult: z.string().nullable().optional(),
  qcStatus: z.enum(QC_STATUSES),
});

type FormValues = z.infer<typeof formSchema>;

function GroupDivider({ title }: { title: string }) {
  return (
    <div className="py-3 border-b border-[#F2F4F6]">
      <p className="text-[11px] font-bold text-[#8B95A1] uppercase tracking-wide">{title}</p>
    </div>
  );
}

function FieldRow({ label, children, optional }: { label: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="py-3.5 border-b border-[#F2F4F6]">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[12px] font-semibold text-[#8B95A1]">{label}</span>
        {optional && <span className="text-[10px] text-[#BEC5CC]">선택</span>}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2.5 border-b border-[#F2F4F6]">
      <span className="text-[12px] text-[#8B95A1] font-medium shrink-0">{label}</span>
      <span className="text-[13px] font-medium text-[#191F28] text-right">{value || "—"}</span>
    </div>
  );
}

const QC_STATUS_COLORS: Record<string, string> = {
  "접수": "bg-blue-50 text-blue-700 border-blue-200",
  "분석 중": "bg-amber-50 text-amber-700 border-amber-200",
  "조치 완료": "bg-green-50 text-green-700 border-green-200",
  "종결": "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]",
};

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
  const updateQc = useUpdateReportQc();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      itemCode: "",
      processName: "",
      deptCd: null,
      issuingTeam: null,
      flawTypeCd: null,
      lostManHours: null,
      qcCorrectiveResult: null,
      qcStatus: "접수",
    },
  });

  useEffect(() => {
    if (report) {
      form.reset({
        itemCode: report.itemCode ?? "",
        processName: report.processName ?? "",
        deptCd: report.deptCd ?? null,
        issuingTeam: report.issuingTeam ?? null,
        flawTypeCd: report.flawTypeCd ?? null,
        lostManHours: report.lostManHours ?? null,
        qcCorrectiveResult: report.qcCorrectiveResult ?? null,
        qcStatus: (report.qcStatus as (typeof QC_STATUSES)[number]) ?? "접수",
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
          processName: values.processName || null,
          deptCd: values.deptCd || null,
          issuingTeam: selectedDept?.deptName ?? values.issuingTeam ?? null,
          flawTypeCd: values.flawTypeCd || null,
          lostManHours: values.lostManHours ?? null,
          qcCorrectiveResult: values.qcCorrectiveResult || null,
          qcStatus: values.qcStatus,
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

  return (
    <Layout>
      <div className="max-w-lg mx-auto px-5 py-5 pb-32">
        <div className="flex items-center gap-2 mb-5">
          <button
            onClick={() => navigate("/ledger")}
            className="h-8 w-8 rounded-xl bg-[#F2F4F6] flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-[18px] font-bold text-[#191F28]">QC 분석 입력</h1>
            <p className="text-[12px] text-[#8B95A1]">보고서 #{String(report.id).padStart(4, "0")}</p>
          </div>
        </div>

        {/* 원본 보고서 요약 (읽기전용) */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] p-4 mb-4">
          <p className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide mb-2">접수 정보 (읽기전용)</p>
          <InfoRow label="등록자" value={report.registrantName} />
          <InfoRow label="공장" value={report.factory} />
          <InfoRow label="발생일" value={report.occurrenceDate ? format(new Date(report.occurrenceDate), "yyyy.MM.dd") : null} />
          <InfoRow label="불량 수량" value={report.defectQty != null ? `${report.defectQty}개` : null} />
          <InfoRow label="상세 내용" value={
            <span className="text-left block text-[13px] leading-relaxed text-[#191F28] whitespace-pre-wrap max-w-[220px]">
              {report.description}
            </span>
          } />
        </div>

        {/* QC 입력 폼 */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] px-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>

              {/* ── 원본 보고서 수정 가능 필드 ── */}
              <GroupDivider title="원본 정보 수정" />

              {/* 부품코드 */}
              <FormField
                control={form.control}
                name="itemCode"
                render={({ field }) => (
                  <FieldRow label="부품코드">
                    <FormItem>
                      <FormControl>
                        <input
                          {...field}
                          className="w-full h-11 rounded-xl bg-[#F8F9FA] px-3.5 text-[14px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10"
                          placeholder="부품코드 입력"
                          list="item-codes"
                        />
                      </FormControl>
                      <datalist id="item-codes">
                        {itemsData.map((item) => (
                          <option key={item.code} value={item.code}>{item.name}</option>
                        ))}
                      </datalist>
                      <FormMessage className="text-[12px]" />
                    </FormItem>
                  </FieldRow>
                )}
              />

              {/* 공정 */}
              <FormField
                control={form.control}
                name="processName"
                render={({ field }) => (
                  <FieldRow label="공정">
                    <FormItem>
                      <FormControl>
                        <input
                          {...field}
                          className="w-full h-11 rounded-xl bg-[#F8F9FA] px-3.5 text-[14px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10"
                          placeholder="공정명 입력"
                        />
                      </FormControl>
                      <FormMessage className="text-[12px]" />
                    </FormItem>
                  </FieldRow>
                )}
              />

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
                          className="w-full h-11 rounded-xl bg-[#F8F9FA] px-3.5 text-[14px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10"
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
