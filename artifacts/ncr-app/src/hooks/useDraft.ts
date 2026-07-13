import { useState, useEffect, useRef, useCallback } from "react";

export interface DraftPayload<T> {
  values: T;
  savedAt: number;
}

export function useDraft<T>(key: string) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    try {
      setHasDraft(!!localStorage.getItem(key));
    } catch {
      setHasDraft(false);
    }
  }, [key]);

  const saveDraft = useCallback(
    (values: T) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        try {
          const payload: DraftPayload<T> = { values, savedAt: Date.now() };
          localStorage.setItem(key, JSON.stringify(payload));
          setHasDraft(true);
        } catch {}
      }, 1500);
    },
    [key],
  );

  const loadDraft = useCallback((): DraftPayload<T> | null => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as DraftPayload<T>;
    } catch {
      return null;
    }
  }, [key]);

  const clearDraft = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      localStorage.removeItem(key);
      setHasDraft(false);
    } catch {}
  }, [key]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { saveDraft, loadDraft, clearDraft, hasDraft };
}
