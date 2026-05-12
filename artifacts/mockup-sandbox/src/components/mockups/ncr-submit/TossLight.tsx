import { useState } from "react";

const FACTORIES = [
  { label: "아산공장", value: "아산" },
  { label: "화성공장", value: "화성" },
];

const PROCESSES: Record<string, string[]> = {
  아산: ["1라인", "2라인", "3라인", "전기라인", "제관라인", "가공라인", "사내외주"],
  화성: ["CR붐조립", "CR장착검사", "CR바디조립", "BR선삭", "BR연삭", "BR열처리"],
};

const NCR_TYPES = ["공정", "출하", "AS"];

const DEFECT_TYPES = [
  "가공", "용접/제관", "유/공압", "전기", "공압",
  "도장/도금", "외관", "동력장치", "BOM/REV", "조립", "설계불량", "기타",
];

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-[13px] font-semibold text-[#191F28]">{children}</span>
      {optional && <span className="text-[11px] text-[#8B95A1]">선택</span>}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl px-5 py-5 flex flex-col gap-5">
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-[#F2F4F6] -mx-5" />;
}

export function TossLight() {
  const [factory, setFactory] = useState("");
  const [process, setProcess] = useState("");
  const [ncrType, setNcrType] = useState("");
  const [defectType, setDefectType] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  return (
    <div className="min-h-screen bg-[#F2F4F6] flex flex-col" style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}>

      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-4 sticky top-0 z-10">
        <h1 className="text-[20px] font-bold text-[#191F28] tracking-tight">부적합 보고서 등록</h1>
        <p className="text-[13px] text-[#8B95A1] mt-0.5">현장 부적합 사항을 등록하세요</p>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-3 px-4 py-4 pb-32">

        {/* 등록 정보 */}
        <Section>
          {/* 등록자 */}
          <div>
            <FieldLabel>등록자</FieldLabel>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="성명을 입력하세요"
              className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] border-0 border-b-2 border-[#F2F4F6] focus:border-[#3182F6] outline-none pb-2 bg-transparent transition-colors"
            />
          </div>

          <Divider />

          {/* 공장 */}
          <div>
            <FieldLabel>공장</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {FACTORIES.map(f => (
                <button
                  key={f.value}
                  onClick={() => { setFactory(f.value); setProcess(""); }}
                  className={`py-3.5 rounded-xl text-[14px] font-semibold transition-all ${
                    factory === f.value
                      ? "bg-[#EBF2FF] text-[#3182F6] border-2 border-[#3182F6]"
                      : "bg-[#F2F4F6] text-[#4E5968] border-2 border-transparent"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* 공정 — 공장 선택 후 표시 */}
          {factory && (
            <>
              <Divider />
              <div>
                <FieldLabel>등록자 공정</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {PROCESSES[factory].map(p => (
                    <button
                      key={p}
                      onClick={() => setProcess(p)}
                      className={`px-3.5 py-2 rounded-full text-[13px] font-medium transition-all ${
                        process === p
                          ? "bg-[#3182F6] text-white"
                          : "bg-[#F2F4F6] text-[#4E5968]"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <Divider />

          {/* 발행팀 */}
          <div>
            <FieldLabel optional>발행팀</FieldLabel>
            <div className="flex items-center justify-between py-2.5 cursor-pointer">
              <span className="text-[15px] text-[#BEC5CC]">발행팀을 선택하세요</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#BEC5CC" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
            </div>
          </div>
        </Section>

        {/* 부적합 기본 정보 */}
        <Section>
          {/* 부적합 구분 */}
          <div>
            <FieldLabel>부적합 구분</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {NCR_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setNcrType(t)}
                  className={`py-3.5 rounded-xl text-[14px] font-semibold transition-all ${
                    ncrType === t
                      ? "bg-[#EBF2FF] text-[#3182F6] border-2 border-[#3182F6]"
                      : "bg-[#F2F4F6] text-[#4E5968] border-2 border-transparent"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <Divider />

          {/* 제품코드 */}
          <div>
            <FieldLabel>제품코드 (모델명)</FieldLabel>
            <div className="flex items-center justify-between py-2.5 cursor-pointer">
              <span className="text-[15px] text-[#BEC5CC]">제품코드를 선택하세요</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#BEC5CC" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
            </div>
          </div>

          <Divider />

          {/* 출하호기 */}
          <div>
            <FieldLabel optional>출하호기</FieldLabel>
            <input
              placeholder="예: 1호기, 2호기"
              className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] border-0 border-b-2 border-[#F2F4F6] focus:border-[#3182F6] outline-none pb-2 bg-transparent transition-colors"
            />
          </div>

          <Divider />

          {/* 발생일 */}
          <div>
            <FieldLabel>발생일</FieldLabel>
            <input
              type="date"
              defaultValue={new Date().toISOString().split("T")[0]}
              className="w-full text-[15px] text-[#191F28] border-0 border-b-2 border-[#F2F4F6] focus:border-[#3182F6] outline-none pb-2 bg-transparent transition-colors"
            />
          </div>
        </Section>

        {/* 불량 상세 */}
        <Section>
          {/* 불량유형 */}
          <div>
            <FieldLabel>불량유형</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {DEFECT_TYPES.map(d => (
                <button
                  key={d}
                  onClick={() => setDefectType(d)}
                  className={`px-3.5 py-2 rounded-full text-[13px] font-medium transition-all ${
                    defectType === d
                      ? "bg-[#3182F6] text-white"
                      : "bg-[#F2F4F6] text-[#4E5968]"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <Divider />

          {/* 불량수량 / 손실공수 */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <FieldLabel optional>불량수량</FieldLabel>
              <input
                type="number"
                placeholder="0"
                className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] border-0 border-b-2 border-[#F2F4F6] focus:border-[#3182F6] outline-none pb-2 bg-transparent transition-colors"
              />
            </div>
            <div>
              <FieldLabel optional>손실공수 (H)</FieldLabel>
              <input
                type="number"
                placeholder="0.0"
                className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] border-0 border-b-2 border-[#F2F4F6] focus:border-[#3182F6] outline-none pb-2 bg-transparent transition-colors"
              />
            </div>
          </div>

          <Divider />

          {/* 부적합 현상 */}
          <div>
            <FieldLabel>부적합 현상</FieldLabel>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="발생한 부적합 현상을 상세히 기술해주세요"
              rows={4}
              className="w-full text-[15px] text-[#191F28] placeholder-[#BEC5CC] border-0 border-b-2 border-[#F2F4F6] focus:border-[#3182F6] outline-none pb-2 bg-transparent resize-none transition-colors"
            />
          </div>
        </Section>

        {/* 사진 첨부 */}
        <Section>
          <div>
            <FieldLabel optional>사진 첨부</FieldLabel>
            <button className="w-full border-2 border-dashed border-[#E5E8EB] rounded-2xl py-8 flex flex-col items-center gap-2 text-[#8B95A1] hover:border-[#3182F6] hover:text-[#3182F6] transition-all">
              <div className="w-11 h-11 rounded-full bg-[#F2F4F6] flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
              </div>
              <div className="text-center">
                <p className="text-[14px] font-semibold">사진 추가</p>
                <p className="text-[12px] mt-0.5 text-[#BEC5CC]">카메라 또는 갤러리에서 선택</p>
              </div>
            </button>
          </div>
        </Section>
      </div>

      {/* 하단 고정 제출 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 px-4 py-4 bg-white/95 backdrop-blur-sm border-t border-[#F2F4F6]">
        <button className="w-full bg-[#3182F6] text-white font-bold text-[16px] rounded-2xl py-4 active:scale-[0.98] transition-transform shadow-lg shadow-[#3182F6]/25">
          부적합 보고서 제출
        </button>
      </div>
    </div>
  );
}
