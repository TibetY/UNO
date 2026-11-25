import { useEffect, useRef, useState } from "react";

/** A running turn clock, as the table draws it. */
export interface TurnClock {
  /** Seat whose clock is running. */
  seat: number;
  /** When it runs out (Date.now() ms). */
  deadline: number;
  /** Full length of a turn (ms). */
  total: number;
}

export const TIMER_CHOICES = [0, 15, 30, 45, 60, 90];

/**
 * Starts a fresh clock whenever `key` changes (a new turn); calls onExpire when
 * it runs out. key null = no clock. Returns the deadline, or null.
 */
export function useTurnTimer(key: string | null, seconds: number, onExpire: () => void): number | null {
  const [deadline, setDeadline] = useState<number | null>(null);
  const cb = useRef(onExpire);
  cb.current = onExpire;
  useEffect(() => {
    if (!key || seconds <= 0) {
      setDeadline(null);
      return;
    }
    setDeadline(Date.now() + seconds * 1000);
    const t = window.setTimeout(() => cb.current(), seconds * 1000);
    return () => window.clearTimeout(t);
  }, [key, seconds]);
  return deadline;
}
