import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface TourStep {
  id: string;
  target: string;
  title: string;
  content: string;
  route?: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
  padding?: number;
}

interface TourContextValue {
  active: boolean;
  steps: TourStep[];
  stepIndex: number;
  start: (steps: TourStep[]) => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
  currentStep: TourStep | null;
}

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);

  const start = useCallback((newSteps: TourStep[]) => {
    setSteps(newSteps);
    setStepIndex(0);
    setActive(true);
  }, []);

  const next = useCallback(() => {
    setStepIndex(i => {
      if (i + 1 >= steps.length) {
        setActive(false);
        return 0;
      }
      return i + 1;
    });
  }, [steps.length]);

  const prev = useCallback(() => {
    setStepIndex(i => Math.max(0, i - 1));
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setStepIndex(0);
  }, []);

  const currentStep = active && steps.length > 0 ? steps[stepIndex] : null;

  return (
    <TourContext.Provider value={{ active, steps, stepIndex, start, next, prev, stop, currentStep }}>
      {children}
    </TourContext.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside TourProvider");
  return ctx;
}
