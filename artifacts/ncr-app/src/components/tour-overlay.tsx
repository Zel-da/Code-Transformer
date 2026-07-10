import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useTour, type TourStep } from "@/contexts/tour";
import { X, ChevronLeft, ChevronRight, Map } from "lucide-react";

interface Rect { x: number; y: number; width: number; height: number }

const PAD = 12;

function getRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function scrollToElement(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function TooltipCard({
  step,
  rect,
  stepIndex,
  totalSteps,
  onNext,
  onPrev,
  onStop,
}: {
  step: TourStep;
  rect: Rect | null;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onStop: () => void;
}) {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const tooltipW = Math.min(320, vw - 32);
  const tooltipH = 160;
  const gap = 16;

  let top = 0;
  let left = 0;

  if (!rect || step.position === "center") {
    top = (vh - tooltipH) / 2;
    left = (vw - tooltipW) / 2;
  } else {
    const spaceBelow = vh - (rect.y + rect.height + PAD);
    const spaceAbove = rect.y - PAD;

    if (spaceBelow >= tooltipH + gap || spaceBelow >= spaceAbove) {
      top = rect.y + rect.height + PAD + gap;
    } else {
      top = rect.y - PAD - tooltipH - gap;
    }

    left = rect.x + rect.width / 2 - tooltipW / 2;
    left = Math.max(16, Math.min(left, vw - tooltipW - 16));
    top = Math.max(16, Math.min(top, vh - tooltipH - 16));
  }

  return (
    <div
      className="fixed z-[10001] bg-white rounded-2xl shadow-2xl border border-[#E5E8EB] p-4 transition-all duration-300"
      style={{ top, left, width: tooltipW }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold bg-[#1A1A1A] text-white rounded-full px-2 py-0.5 tabular-nums">
            {stepIndex + 1} / {totalSteps}
          </span>
          <span className="text-[14px] font-bold text-[#191F28]">{step.title}</span>
        </div>
        <button
          onClick={onStop}
          className="text-[#BEC5CC] hover:text-[#191F28] transition-colors flex-shrink-0 p-0.5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[13px] text-[#4E5968] leading-relaxed mb-4">{step.content}</p>
      <div className="flex items-center justify-between">
        <button
          onClick={onStop}
          className="text-[12px] text-[#8B95A1] hover:text-[#191F28] transition-colors"
        >
          투어 종료
        </button>
        <div className="flex gap-2">
          {stepIndex > 0 && (
            <button
              onClick={onPrev}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E5E8EB] text-[13px] font-medium text-[#4E5968] hover:bg-[#F2F4F6] transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              이전
            </button>
          )}
          <button
            onClick={onNext}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1A1A1A] text-white text-[13px] font-medium hover:bg-[#333] transition-colors"
          >
            {stepIndex + 1 === totalSteps ? "완료" : "다음"}
            {stepIndex + 1 < totalSteps && <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TourOverlay() {
  const { active, steps, stepIndex, currentStep, next, prev, stop } = useTour();
  const [, navigate] = useLocation();
  const [rect, setRect] = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);

  const updateRect = useCallback(() => {
    if (!currentStep || currentStep.position === "center") {
      setRect(null);
      return;
    }
    const r = getRect(`[data-tour="${currentStep.id}"]`);
    setRect(r);
  }, [currentStep]);

  useEffect(() => {
    if (!active || !currentStep) return;

    if (currentStep.route) {
      navigate(currentStep.route);
    }

    const attempt = (tries: number) => {
      scrollToElement(`[data-tour="${currentStep.id}"]`);
      const r = getRect(`[data-tour="${currentStep.id}"]`);
      if (r) {
        setRect(r);
      } else if (tries > 0) {
        rafRef.current = requestAnimationFrame(() => {
          setTimeout(() => attempt(tries - 1), 200);
        });
      } else {
        setRect(null);
      }
    };

    const timer = setTimeout(() => attempt(8), 300);

    const handleResize = () => updateRect();
    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(timer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, [active, currentStep, navigate, updateRect]);

  useEffect(() => {
    if (!active) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, next, prev, stop]);

  if (!active || !currentStep) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hasSpotlight = rect && currentStep.position !== "center";
  const px = hasSpotlight ? rect.x - PAD : 0;
  const py = hasSpotlight ? rect.y - PAD : 0;
  const pw = hasSpotlight ? rect.width + PAD * 2 : 0;
  const ph = hasSpotlight ? rect.height + PAD * 2 : 0;
  const pr = 10;

  return (
    <>
      {/* Dark overlay with spotlight cutout */}
      <svg
        className="fixed inset-0 z-[9998] w-full h-full"
        style={{ pointerEvents: "none" }}
        width={vw}
        height={vh}
      >
        <defs>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {hasSpotlight && (
              <rect x={px} y={py} width={pw} height={ph} rx={pr} fill="black" />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.62)"
          mask="url(#tour-spotlight-mask)"
        />
        {hasSpotlight && (
          <rect
            x={px}
            y={py}
            width={pw}
            height={ph}
            rx={pr}
            fill="none"
            stroke="white"
            strokeWidth="2"
            opacity="0.6"
          />
        )}
      </svg>

      {/* Intercept click on backdrop to advance */}
      <div
        className="fixed inset-0 z-[9999]"
        onClick={next}
      />

      {/* Tooltip — above click intercept */}
      <div className="fixed inset-0 z-[10000] pointer-events-none">
        <div className="pointer-events-auto">
          <TooltipCard
            step={currentStep}
            rect={rect}
            stepIndex={stepIndex}
            totalSteps={steps.length}
            onNext={next}
            onPrev={prev}
            onStop={stop}
          />
        </div>
      </div>
    </>
  );
}

export function TourStartButton({ onStart }: { onStart: () => void }) {
  return (
    <button
      onClick={onStart}
      className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E8EB] text-[13px] font-medium text-[#4E5968] hover:bg-[#F2F4F6] hover:text-[#191F28] transition-colors"
    >
      <Map className="h-3.5 w-3.5" />
      투어 시작
    </button>
  );
}
