import { Layout } from "@/components/layout";
import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { useListItems, useRequestUploadUrl, useCreateReport, getListReportsQueryKey, getGetReportStatsQueryKey } from "@workspace/api-client-react";
import { compressImage } from "@/lib/image-compression";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Camera, UploadCloud, Loader2, CheckCircle } from "lucide-react";
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
    defaultValues: {
      itemCode: "",
      processName: "",
      defectType: "",
      description: "",
    },
  });

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const compressed = await compressImage(file, 500);
      setPhoto(compressed);
      setPhotoPreview(URL.createObjectURL(compressed));
    } catch (error) {
      console.error("Image compression error", error);
      toast({
        title: "이미지 처리 오류",
        description: "이미지 크기를 줄이는 중 문제가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const uploadPhoto = async (file: File): Promise<string | null> => {
    try {
      // 1. Get presigned URL
      const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
        data: {
          name: file.name || "photo.jpg",
          size: file.size,
          contentType: file.type || "image/jpeg",
        }
      });

      // 2. Direct PUT to GCS
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "image/jpeg",
        },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload to storage");
      }

      return objectPath;
    } catch (error) {
      console.error("Upload error", error);
      throw error;
    }
  };

  const onSubmit = async (values: FormValues) => {
    setIsUploading(true);
    try {
      let objectPath = null;
      if (photo) {
        objectPath = await uploadPhoto(photo);
      }

      await createReport.mutateAsync({
        data: {
          ...values,
          reportDate: new Date().toISOString(),
          imageUrl: objectPath ? `/api/storage${objectPath}` : null,
        }
      });

      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetReportStatsQueryKey() });

      setIsSuccess(true);
      form.reset();
      setPhoto(null);
      setPhotoPreview(null);
      
      toast({
        title: "보고 완료",
        description: "부적합 보고가 성공적으로 등록되었습니다.",
      });

    } catch (error) {
      toast({
        title: "오류",
        description: "보고서를 제출하는 중 문제가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  if (isSuccess) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center space-y-6">
          <div className="h-24 w-24 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="h-12 w-12 text-green-600" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight">보고 완료</h2>
          <p className="text-muted-foreground text-lg max-w-md">
            부적합 내용이 시스템에 안전하게 기록되었습니다. 관리자가 곧 검토할 예정입니다.
          </p>
          <Button 
            size="lg" 
            className="h-14 px-8 text-lg mt-8 w-full max-w-sm font-bold"
            onClick={() => setIsSuccess(false)}
          >
            새 보고서 작성
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6 pb-24">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">부적합 보고 (NCR)</h2>
          <p className="text-muted-foreground mt-1">현장 부적합 사항을 즉시 보고하세요.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            <FormField
              control={form.control}
              name="itemCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-semibold">품목코드 (Item Code)</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-14 text-lg bg-white">
                        <SelectValue placeholder="품목 선택" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {items?.map(item => (
                        <SelectItem key={item.code} value={item.code} className="text-base py-3">
                          <span className="font-mono font-medium">{item.code}</span> - {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="processName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-semibold">공정명 (Process)</FormLabel>
                  <FormControl>
                    <Input placeholder="예: 조립 2라인" className="h-14 text-lg bg-white" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defectType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-semibold">불량유형 (Defect Type)</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-14 text-lg bg-white">
                        <SelectValue placeholder="불량유형 선택" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DEFECT_TYPES.map(type => (
                        <SelectItem key={type} value={type} className="text-base py-3">
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-semibold">상세 내용 (Description)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="불량 상태를 상세히 설명해주세요." 
                      className="min-h-[120px] text-base bg-white resize-none" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-3">
              <Label className="text-base font-semibold">사진 증빙 (Evidence)</Label>
              
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                ref={fileInputRef}
                onChange={handlePhotoSelect}
              />
              
              {!photoPreview ? (
                <div 
                  className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors h-48"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium text-foreground">카메라 촬영 / 갤러리</p>
                  <p className="text-sm text-muted-foreground mt-1">터치하여 사진 첨부</p>
                </div>
              ) : (
                <div className="relative rounded-lg overflow-hidden border bg-black/5">
                  <img src={photoPreview} alt="Preview" className="w-full h-auto max-h-[300px] object-contain" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button 
                      type="button" 
                      variant="secondary" 
                      size="lg"
                      className="font-bold"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      사진 변경
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <Button 
              type="submit" 
              size="lg" 
              className="w-full h-16 text-xl font-bold mt-8 shadow-sm"
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                  처리 중...
                </>
              ) : (
                <>
                  <UploadCloud className="mr-3 h-6 w-6" />
                  부적합 보고 제출
                </>
              )}
            </Button>

          </form>
        </Form>
      </div>
    </Layout>
  );
}
