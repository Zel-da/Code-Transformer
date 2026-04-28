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
import { Camera, UploadCloud, Loader2, CheckSquare, AlertOctagon, XSquare, Plus } from "lucide-react";
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
        title: "SYS.ERR",
        description: "이미지 처리 오류 발생",
        variant: "destructive",
      });
    }
  };

  const uploadPhoto = async (file: File): Promise<string | null> => {
    try {
      const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
        data: {
          name: file.name || "photo.jpg",
          size: file.size,
          contentType: file.type || "image/jpeg",
        }
      });

      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("Failed to upload to storage");
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
      if (photo) objectPath = await uploadPhoto(photo);

      await createReport.mutateAsync({
        data: {
          ...values,
          reportDate: new Date().toISOString(),
          imageUrl: objectPath ? `/api/storage${objectPath}` : null,
        }
      });

      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetReportStatsQueryKey() });

      setIsSuccess(true);
      form.reset();
      setPhoto(null);
      setPhotoPreview(null);
    } catch (error) {
      toast({
        title: "SYS.ERR: SUBMIT_FAILED",
        description: "보고서 전송 실패. 네트워크 상태 확인.",
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
          <div className="border-[2px] border-[#10b981] bg-[#10b981]/10 p-8 w-full max-w-md shadow-[0_0_30px_rgba(16,185,129,0.2)]">
            <CheckSquare className="h-20 w-20 text-[#10b981] mx-auto mb-6" strokeWidth={1.5} />
            <h2 className="text-3xl font-mono font-bold tracking-tighter text-[#34d399] mb-2 uppercase">DATA_COMMITTED</h2>
            <div className="h-[1px] w-full bg-[#10b981]/30 my-4"></div>
            <p className="text-muted-foreground font-mono text-sm leading-relaxed mb-8">
              NCR 레코드가 시스템에 성공적으로 등록되었습니다.<br/>관리자 노드 동기화 대기 중.
            </p>
            <Button 
              size="lg" 
              className="w-full h-14 font-mono font-bold text-lg tracking-wider rounded-none bg-[#10b981] hover:bg-[#059669] text-black"
              onClick={() => setIsSuccess(false)}
            >
              <Plus className="mr-2 h-5 w-5" />
              [ NEW_REPORT ]
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto p-4 md:p-8 pb-28">
        
        {/* Header Block */}
        <div className="mb-6 border-b-[2px] border-border pb-4 flex items-end justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-2 text-destructive">
              <AlertOctagon className="h-5 w-5" />
              <span className="font-mono text-sm font-bold tracking-widest uppercase">Emergency Protocol</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-mono font-bold tracking-tighter uppercase">NCR_SUBMIT</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm uppercase">Field Operations Data Entry</p>
          </div>
          <div className="hidden sm:block text-right">
            <div className="text-xs font-mono text-muted-foreground">TERMINAL ID:</div>
            <div className="font-mono font-bold text-primary">MOB-82X</div>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="itemCode"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className="font-mono font-bold text-sm tracking-wider uppercase text-muted-foreground flex items-center">
                      <span className="w-2 h-2 bg-primary inline-block mr-2"></span>
                      품목코드 (Item Code)
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-16 text-lg bg-card border-[2px] border-border rounded-none focus:ring-0 focus:border-primary font-mono transition-colors rounded-none">
                          <SelectValue placeholder="SELECT_ITEM..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="border-[2px] border-border rounded-none bg-card">
                        {items?.map(item => (
                          <SelectItem key={item.code} value={item.code} className="text-base py-4 font-mono border-b border-border/50 last:border-0 rounded-none cursor-pointer focus:bg-primary/20">
                            <span className="font-bold text-primary">{item.code}</span>
                            <span className="mx-2 text-muted-foreground">|</span>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="font-mono text-xs text-destructive" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="processName"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className="font-mono font-bold text-sm tracking-wider uppercase text-muted-foreground flex items-center">
                      <span className="w-2 h-2 bg-primary inline-block mr-2"></span>
                      공정명 (Process)
                    </FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g., 조립 2라인" 
                        className="h-16 text-lg bg-card border-[2px] border-border rounded-none focus-visible:ring-0 focus-visible:border-primary font-mono transition-colors placeholder:text-muted-foreground/50" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage className="font-mono text-xs text-destructive" />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="defectType"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel className="font-mono font-bold text-sm tracking-wider uppercase text-muted-foreground flex items-center">
                    <span className="w-2 h-2 bg-destructive inline-block mr-2"></span>
                    불량유형 (Defect Type)
                  </FormLabel>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                    {DEFECT_TYPES.map(type => (
                      <div 
                        key={type}
                        onClick={() => field.onChange(type)}
                        className={`
                          cursor-pointer border-[2px] p-4 text-center font-bold text-lg transition-all flex items-center justify-center
                          ${field.value === type 
                            ? "border-destructive bg-destructive/10 text-destructive shadow-[0_0_10px_rgba(239,68,68,0.2)]" 
                            : "border-border bg-card text-muted-foreground hover:border-muted-foreground"
                          }
                        `}
                      >
                        {type}
                      </div>
                    ))}
                  </div>
                  {/* Hidden select to satisfy form control if needed, but we handle it via the grid above */}
                  <FormMessage className="font-mono text-xs text-destructive mt-2" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="space-y-2 mt-6">
                  <FormLabel className="font-mono font-bold text-sm tracking-wider uppercase text-muted-foreground flex items-center">
                    <span className="w-2 h-2 bg-primary inline-block mr-2"></span>
                    상세 내용 (Description)
                  </FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="ENTER_DEFECT_DETAILS..." 
                      className="min-h-[140px] text-base bg-card border-[2px] border-border rounded-none focus-visible:ring-0 focus-visible:border-primary font-mono transition-colors resize-none p-4 placeholder:text-muted-foreground/50" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage className="font-mono text-xs text-destructive" />
                </FormItem>
              )}
            />

            {/* Photo Upload - Industrial styling */}
            <div className="space-y-2 mt-6">
              <Label className="font-mono font-bold text-sm tracking-wider uppercase text-muted-foreground flex items-center">
                <span className="w-2 h-2 bg-primary inline-block mr-2"></span>
                사진 증빙 (Evidence)
              </Label>
              
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
                  className="border-[2px] border-dashed border-border p-8 flex flex-col items-center justify-center bg-card cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors h-48 group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-10 w-10 text-muted-foreground mb-4 group-hover:text-primary transition-colors" />
                  <p className="text-lg font-mono font-bold text-foreground tracking-widest uppercase">Capture / Select</p>
                  <p className="text-xs font-mono text-muted-foreground mt-2 uppercase opacity-70">[Touch to attach evidence]</p>
                </div>
              ) : (
                <div className="relative border-[2px] border-primary bg-black p-2">
                  <img src={photoPreview} alt="Preview" className="w-full h-auto max-h-[400px] object-contain opacity-90" />
                  
                  {/* Scanline overlay for photo */}
                  <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.2)_50%)] bg-[length:100%_4px] pointer-events-none"></div>
                  
                  <div className="absolute top-4 right-4 flex space-x-2">
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-black/80 border border-primary text-primary px-4 py-2 font-mono text-xs font-bold uppercase backdrop-blur-sm hover:bg-primary hover:text-black transition-colors"
                    >
                      Retake
                    </button>
                    <button 
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPhoto(null); setPhotoPreview(null); }}
                      className="bg-black/80 border border-destructive text-destructive p-2 backdrop-blur-sm hover:bg-destructive hover:text-white transition-colors"
                    >
                      <XSquare className="h-4 w-4" />
                    </button>
                  </div>
                  
                  <div className="absolute bottom-4 left-4 bg-black/80 border border-border px-3 py-1 font-mono text-[10px] text-white">
                    IMG_ATTACHED_{photo?.size ? Math.round(photo.size/1024) : '0'}KB
                  </div>
                </div>
              )}
            </div>

            <div className="pt-8">
              <Button 
                type="submit" 
                size="lg" 
                className="w-full h-20 text-xl font-mono font-bold tracking-widest uppercase rounded-none border-[2px] border-primary bg-primary/10 text-primary hover:bg-primary hover:text-black transition-all shadow-[0_0_15px_rgba(6,182,212,0.2)] hover:shadow-[0_0_25px_rgba(6,182,212,0.5)]"
                disabled={isUploading}
              >
                {isUploading ? (
                  <div className="flex items-center">
                    <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                    UPLOADING_DATA...
                  </div>
                ) : (
                  <div className="flex items-center">
                    <UploadCloud className="mr-3 h-6 w-6" />
                    [ TRANSMIT_REPORT ]
                  </div>
                )}
              </Button>
            </div>

          </form>
        </Form>
      </div>
    </Layout>
  );
}
