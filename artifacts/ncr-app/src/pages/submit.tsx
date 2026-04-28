import { Layout } from "@/components/layout";
import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useListItems, useRequestUploadUrl, useCreateReport, getListReportsQueryKey, getGetReportStatsQueryKey } from "@workspace/api-client-react";
import { compressImage } from "@/lib/image-compression";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Camera, Loader2, CheckCircle2, X, Plus, ImageIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const DEFECT_TYPES = ["치수불량", "외관불량", "기능불량", "재료불량", "포장불량", "기타"];

const formSchema = z.object({
  itemCode: z.string().min(1, "품목코드를 선택해주세요"),
  processName: z.string().min(1, "공정명을 입력해주세요"),
  defectType: z.string().min(1, "불량유형을 선택해주세요"),
  description: z.string().min(1, "상세 내용을 입력해주세요"),
});

type FormValues = z.infer<typeof formSchema>;

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
    defaultValues: { itemCode: "", processName: "", defectType: "", description: "" },
  });

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file, 500);
      setPhoto(compressed);
      setPhotoPreview(URL.createObjectURL(compressed));
    } catch {
      toast({ title: "오류", description: "이미지 처리 중 문제가 발생했습니다.", variant: "destructive" });
    }
  };

  const uploadPhoto = async (file: File): Promise<string | null> => {
    const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
      data: { name: file.name || "photo.jpg", size: file.size, contentType: file.type || "image/jpeg" },
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
          ...values,
          reportDate: new Date().toISOString(),
          imageUrl: objectPath ? `/api/storage${objectPath}` : null,
        },
      });

      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetReportStatsQueryKey() });

      setIsSuccess(true);
      form.reset();
      setPhoto(null);
      setPhotoPreview(null);
    } catch {
      toast({ title: "제출 실패", description: "보고서 전송에 실패했습니다. 다시 시도해주세요.", variant: "destructive" });
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
            <h2 className="text-xl font-bold text-foreground mb-2">보고서가 접수되었습니다</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              부적합 보고서가 성공적으로 등록되었습니다.<br />관리자 검토 후 동기화됩니다.
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
      <div className="max-w-2xl mx-auto p-4 md:p-6 pb-28">

        <div className="mb-6 pt-1">
          <h1 className="text-2xl font-bold text-foreground">보고서 등록</h1>
          <p className="text-sm text-muted-foreground mt-0.5">현장 부적합 사항을 기록합니다</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

            <div className="bg-white rounded-2xl border border-border shadow-sm p-5 space-y-5">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="itemCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">품목코드</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-11 rounded-xl bg-background">
                            <SelectValue placeholder="품목을 선택하세요" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="rounded-xl">
                          {items?.map((item) => (
                            <SelectItem key={item.code} value={item.code}>
                              <span className="font-medium text-primary">{item.code}</span>
                              <span className="text-muted-foreground ml-2 text-xs">{item.name}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="processName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">공정명</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="예: 조립 2라인"
                          className="h-11 rounded-xl bg-background"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="defectType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">불량 유형</FormLabel>
                    <div className="grid grid-cols-3 gap-2 pt-1">
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

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">상세 내용</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="불량 발생 상황, 수량, 특이사항 등을 기재해주세요"
                        className="min-h-[120px] rounded-xl bg-background resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            </div>

            {/* Photo Upload */}
            <div className="bg-white rounded-2xl border border-border shadow-sm p-5 space-y-3">
              <Label className="text-sm font-medium">사진 첨부 <span className="text-muted-foreground font-normal">(선택)</span></Label>
              <input
                type="file"
                accept="image/*"
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
                    <p className="text-sm font-medium">사진 촬영 또는 선택</p>
                    <p className="text-xs mt-0.5 opacity-70">탭하여 첨부하세요</p>
                  </div>
                </button>
              ) : (
                <div className="relative rounded-xl overflow-hidden border border-border">
                  <img src={photoPreview} alt="미리보기" className="w-full h-auto max-h-72 object-contain bg-gray-50" />
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
                      onClick={() => { setPhoto(null); setPhotoPreview(null); }}
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
                <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 업로드 중...</>
              ) : (
                "보고서 제출"
              )}
            </Button>

          </form>
        </Form>
      </div>
    </Layout>
  );
}
