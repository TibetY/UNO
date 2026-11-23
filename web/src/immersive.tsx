import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * "Immersive" mode for phones: while a game is on, the table fills the whole
 * screen and the page can't scroll or zoom, like a native app. A Menu button
 * returns to the normal page (settings, log, tabs).
 */
interface Immersive {
  /** True on phone-sized screens. */
  mobile: boolean;
  /** The table currently fills the screen. */
  on: boolean;
  /** Call from a tap that starts or resumes a game. No-op on larger screens. */
  enter: () => void;
  exit: () => void;
}

const Ctx = createContext<Immersive>({ mobile: false, on: false, enter: () => {}, exit: () => {} });
export const useImmersive = () => useContext(Ctx);

const QUERY = "(max-width: 700px), (max-height: 500px) and (pointer: coarse)";

function useMediaQuery(q: string) {
  const [match, setMatch] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return match;
}

function requestFullscreen() {
  // Must run inside the tap's handler. Phones that don't allow it (iPhone
  // Safari, embedded views) still get the fixed full-screen layout.
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (document.fullscreenElement) return;
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    /* not allowed here */
  }
}

function exitFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch {
    /* ignore */
  }
}

export function ImmersiveProvider({ children }: { children: ReactNode }) {
  const mobile = useMediaQuery(QUERY);
  const [wanted, setWanted] = useState(false);
  const on = wanted && mobile;

  useEffect(() => {
    document.documentElement.classList.toggle("immersive", on);
    if (!on) return;
    // Belt and braces against rubber-band scrolling on iOS.
    const stop = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest(".log, .dialog")) e.preventDefault();
    };
    document.addEventListener("touchmove", stop, { passive: false });
    return () => document.removeEventListener("touchmove", stop);
  }, [on]);

  const enter = useCallback(() => {
    if (!mobile) return;
    setWanted(true);
    requestFullscreen();
  }, [mobile]);
  const exit = useCallback(() => {
    setWanted(false);
    exitFullscreen();
  }, []);

  return <Ctx.Provider value={{ mobile, on, enter, exit }}>{children}</Ctx.Provider>;
}

/** Wraps a game table. On phones, it fills the screen while immersive mode is on. */
export function Stage({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const { mobile, on, enter, exit } = useImmersive();
  const full = on && active;
  return (
    <div className={"stage" + (full ? " immersive" : "")}>
      {children}
      {mobile && active && (full
        ? <button className="stage-btn stage-exit" onClick={exit} aria-label="Menu: settings and log">☰ Menu</button>
        : <button className="stage-btn stage-enter" onClick={enter}>⛶ Full screen</button>)}
    </div>
  );
}
