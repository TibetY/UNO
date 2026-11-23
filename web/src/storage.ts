/** Per-viewer conveniences only; every access may fail (private mode, previews). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem("card-duel:" + key);
    return raw === null ? fallback : { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
export function loadString(key: string, fallback: string): string {
  try {
    return localStorage.getItem("card-duel:" + key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem("card-duel:" + key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
