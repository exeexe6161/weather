// App-Erkennung OHNE Capacitor-Import: Der Web-Build bleibt Capacitor-frei.
// Capacitor injiziert zur Laufzeit ein globales window.Capacitor in den nativen
// WKWebView. Im normalen Browser fehlt es → isNativeApp() liefert dort immer
// false, die Website verhält sich exakt wie bisher. Bewusst nur ein optionaler
// Global-Lookup, kein `import "@capacitor/core"`, damit nichts in das Web-Bundle
// gezogen wird (saubere Trennung Web ↔ App).

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  isNative?: boolean;
}

export function isNativeApp(): boolean {
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap) return false;
  return typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : cap.isNative === true;
}
