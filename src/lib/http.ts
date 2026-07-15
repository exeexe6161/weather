import { isNativeApp } from "./platform.js";

// Basis für eigene API Routen in der nativen App: Capacitor lädt dist/ nur als
// statische Dateien über sein eigenes URL Schema (capacitor://localhost), dort
// läuft keine Vercel Function. Ein relativer Pfad wie "/api/weather" würde in
// der App ins Leere laufen. Im normalen Web bleibt es relativ (gleicher
// Origin, siehe CSP connect-src 'self').
const NATIVE_API_BASE = "https://weatherpure.com";

export function apiUrl(path: string): string {
  return isNativeApp() ? `${NATIVE_API_BASE}${path}` : path;
}

// Gemeinsamer fetch mit Timeout: bricht die Anfrage nach ms Millisekunden ab,
// damit eine hängende Verbindung nicht ewig blockiert (sonst liefe der Spinner
// bis zum Browser-Netz-Timeout, ~30–120 s). Der Abbruch lehnt das fetch-Promise
// ab (Timeout-/AbortError) und landet damit in denselben catch-Pfaden wie jeder
// andere Netzfehler — keine unbehandelte Exception, keine Sonderbehandlung beim
// Aufrufer nötig.
export function fetchWithTimeout(url: string, ms = 12000, init: RequestInit = {}): Promise<Response> {
  // Bevorzugt AbortSignal.timeout (verwaltet seinen Timer selbst, kein Leak).
  const Sig = AbortSignal as typeof AbortSignal & { timeout?(ms: number): AbortSignal };
  if (typeof Sig.timeout === "function") {
    return fetch(url, { ...init, signal: Sig.timeout(ms) });
  }
  // Fallback: AbortController + setTimeout, Timer im finally clearen, damit
  // bei rechtzeitiger Antwort kein verspäteter abort() mehr feuert.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
