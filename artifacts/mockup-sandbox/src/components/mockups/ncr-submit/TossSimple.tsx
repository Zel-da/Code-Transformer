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

function Row({ label, children, optional }: { label: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="py-4 border-b border-[#F2F4F6] last:border-0">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[13px] font-bold text-[#191F28]">{label}</span>
        {optional && <span className="text-[11px] text-[#BEC5CC]">선택</span>}
      </div>
      {children}
    </div>
  );
}

export function TossSimple() {
  const [factory, setFactory] = useState("");
  const [process, setProcess] = useState("");
  const [ncrType, setNcrType] = useState("");
  const [defectType, setDefectType] = useState("");

  return (
    <div className="min-h-screen bg-white flex flex-col" style={{ fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif" }}>

      {/* 상단 네비 */}
      <div className="flex items-center px-5 pt-14 pb-3">
        <button className="p-2 -ml-2 mr-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#191F28" strokeWidth="2.5" strokeLinecap="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <span className="text-[17px] font-bold text-[#191F28]">부적합 보고서</span>
      </div>

      {/* 진행 바 */}
      <div className="h-1 bg-[#F2F4F6] mx-5 rounded-full">
        <div className="h-full bg-[#3182F6] rounded-full" style={{ width: "30%" }} />
      </div>

      {/* 스크롤 콘텐츠 */}
      <div className="flex-1 overflow-auto px-5 pb-36 pt-2">

        {/* 등록자 */}
        <Row label="등록자 이름">
          <input
            placeholder="성명을 입력하세요"
            className="w-full text-[16px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
          />
        </Row>

        {/* 공장 */}
        <Row label="공장 선택">
          <div className="grid grid-cols-2 gap-2">
            {FACTORIES.map(f => (
              <button
                key={f.value}
                onClick={() => { setFactory(f.value); setProcess(""); }}
                className={`py-4 rounded-2xl text-[14px] font-bold transition-all ${
                  factory === f.value
                    ? "bg-[#3182F6] text-white"
                    : "bg-[#F2F4F6] text-[#4E5968]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </Row>

        {/* 공정 */}
        {factory && (
          <Row label="등록자 공정">
            <div className="flex flex-wrap gap-2">
              {PROCESSES[factory].map(p => (
                <button
                  key={p}
                  onClick={() => setProcess(p)}
                  className={`px-4 py-2.5 rounded-full text-[13px] font-semibold border-2 transition-all ${
                    process === p
                      ? "border-[#3182F6] bg-[#EBF2FF] text-[#3182F6]"
                      : "border-[#E5E8EB] bg-white text-[#4E5968]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </Row>
        )}

        {/* 발행팀 */}
        <Row label="발행팀" optional>
          <div className="flex items-center justify-between cursor-pointer bg-[#F8F9FA] rounded-xl px-4 py-3">
            <span className="text-[14px] text-[#BEC5CC]">팀을 선택하세요</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#BEC5CC" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
          </div>
        </Row>

        {/* 부적합 구분 */}
        <Row label="부적합 구분">
          <div className="grid grid-cols-3 gap-2">
            {NCR_TYPES.map(t => (
              <button
                key={t}
                onClick={() => setNcrType(t)}
                className={`py-3.5 rounded-xl text-[14px] font-bold transition-all ${
                  ncrType === t
                    ? "bg-[#3182F6] text-white"
                    : "bg-[#F2F4F6] text-[#4E5968]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Row>

        {/* 제품코드 */}
        <Row label="제품코드 (모델명)">
          <div className="flex items-center justify-between cursor-pointer bg-[#F8F9FA] rounded-xl px-4 py-3">
            <span className="text-[14px] text-[#BEC5CC]">제품코드를 선택하세요</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#BEC5CC" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
          </div>
        </Row>

        {/* 출하호기 */}
        <Row label="출하호기" optional>
          <input
            placeholder="예: 1호기, 2호기"
            className="w-full text-[16px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
          />
        </Row>

        {/* 발생일 */}
        <Row label="발생일">
          <input
            type="date"
            defaultValue={new Date().toISOString().split("T")[0]}
            className="text-[15px] text-[#191F28] outline-none bg-transparent font-medium"
          />
        </Row>

        {/* 불량유형 */}
        <Row label="불량유형">
          <div className="flex flex-wrap gap-2">
            {DEFECT_TYPES.map(d => (
              <button
                key={d}
                onClick={() => setDefectType(d)}
                className={`px-3.5 py-2 rounded-full text-[13px] font-semibold border-2 transition-all ${
                  defectType === d
                    ? "border-[#3182F6] bg-[#EBF2FF] text-[#3182F6]"
                    : "border-[#E5E8EB] text-[#4E5968]"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </Row>

        {/* 불량수량 / 손실공수 */}
        <div className="py-4 border-b border-[#F2F4F6] grid grid-cols-2 gap-6">
          <div>
            <div className="flex justify-between mb-3">
              <span className="text-[13px] font-bold text-[#191F28]">불량수량</span>
              <span className="text-[11px] text-[#BEC5CC]">선택</span>
            </div>
            <input
              type="number"
              placeholder="0"
              className="w-full text-[16px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
            />
          </div>
          <div>
            <div className="flex justify-between mb-3">
              <span className="text-[13px] font-bold text-[#191F28]">손실공수 (H)</span>
              <span className="text-[11px] text-[#BEC5CC]">선택</span>
            </div>
            <input
              type="number"
              placeholder="0.0"
              className="w-full text-[16px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent font-medium"
            />
          </div>
        </div>

        {/* 부적합 현상 */}
        <Row label="부적합 현상">
          <textarea
            placeholder="발생한 부적합 현상을 상세히 기술해주세요"
            rows={4}
            className="w-full text-[16px] text-[#191F28] placeholder-[#BEC5CC] outline-none bg-transparent resize-none font-medium leading-relaxed"
          />
        </Row>

        {/* 사진 */}
        <Row label="사진 첨부" optional>
          <button className="w-full flex items-center gap-3 bg-[#F2F4F6] rounded-2xl px-4 py-4 text-[#8B95A1]">
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3182F6" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            </div>
            <div className="text-left">
              <p className="text-[14px] font-semibold text-[#191F28]">사진 추가</p>
              <p className="text-[12px] text-[#8B95A1]">카메라 또는 갤러리에서 선택</p>
            </div>
          </button>
        </Row>
      </div>

      {/* 하단 제출 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white px-5 py-5 border-t border-[#F2F4F6]">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-1 bg-[#F2F4F6] rounded-full overflow-hidden">
            <div className="h-full bg-[#3182F6] rounded-full" style={{ width: "30%" }} />
          </div>
          <span className="text-[12px] text-[#8B95A1] font-medium">30%</span>
        </div>
        <button className="w-full bg-[#3182F6] text-white font-bold text-[16px] rounded-2xl py-4 active:scale-[0.98] transition-transform">
          제출하기
        </button>
      </div>
    </div>
  );
}
