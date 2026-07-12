// Handgezeichnete Share-Karte (1080×1920, 9:16) als PNG. Muster aus EVSpend
// (_drawSingle9x16): reines Canvas 2D, KEINE Bibliothek, KEIN SVG-Serialisieren.
// Alles wird von Hand gezeichnet → es kommt nie eine cross-origin-Quelle ins
// Canvas, also kann es nicht "tainten" und toBlob bleibt erlaubt.
//
// Schrift: self-hosted "Inter" + "Instrument Serif" (italic). Beide MÜSSEN vor
// dem Zeichnen geladen sein, sonst rendert das Canvas mit System-Fallback —
// daher document.fonts.load(...) + await document.fonts.ready ganz am Anfang.
import type { Forecast } from "./weather";
import { getWmo, pickIcon } from "./wmo";
import { weatherLabel } from "../i18n/weather-labels";
import { t, type Lang } from "../i18n/ui";
import {
  formatTemp,
  formatPercent,
  formatWind,
  formatWeekday,
  formatWeekdayLong,
  formatDayMonth,
  formatTimeInZone,
} from "./format";
import {
  Sun, Moon, Cloud, CloudSun, CloudMoon, CloudFog, CloudDrizzle, CloudRain,
  CloudRainWind, CloudSnow, CloudSunRain, CloudMoonRain, CloudLightning,
  CloudHail, Snowflake, Wind, type IconNode,
} from "lucide";

// Lucide-Icon = Liste von [tag, attrs]-Tupeln im 24×24-Viewport. Genau die
// Wettersymbole, die wmo.ts/pickIcon zurückgeben (kebab-Name → Pfaddaten).
const ICONS: Record<string, IconNode> = {
  "sun": Sun, "moon": Moon, "cloud": Cloud, "cloud-sun": CloudSun,
  "cloud-moon": CloudMoon, "cloud-fog": CloudFog, "cloud-drizzle": CloudDrizzle,
  "cloud-rain": CloudRain, "cloud-rain-wind": CloudRainWind, "cloud-snow": CloudSnow,
  "cloud-sun-rain": CloudSunRain, "cloud-moon-rain": CloudMoonRain,
  "cloud-lightning": CloudLightning, "cloud-hail": CloudHail, "snowflake": Snowflake,
  "wind": Wind,
};

// Fester Karbon-Look (theme-unabhängig). Canvas kann keine CSS-Variablen lesen,
// daher die Markentokens als Konstanten (Werte aus styles-app.css Dunkelstufe).
const BG = "#15171A";              // Karbon
const FG = "#FFFFFF";              // Pur
const MUTED = "#9AA3AC";           // Stahl (Dunkelstufe)
const LINE = "#2A2E33";            // Linie (Dunkelstufe)
const ACCENT = "#7FB1F0";          // Zenit (Dunkelstufe, AA auf Karbon)
const FONT = '"Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';

const W = 1080;
const H = 1920;
const M = 96; // Seitenrand

interface TextOpts {
  size: number;
  weight?: number;
  color?: string;
  align?: CanvasTextAlign;
  font?: string;
  italic?: boolean;
  maxWidth?: number; // schrumpft die Schrift, bis der Text passt
}

function fontStr(o: TextOpts, size: number): string {
  return `${o.italic ? "italic " : ""}${o.weight ?? 400} ${size}px ${o.font ?? FONT}`;
}

function drawText(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, o: TextOpts): void {
  ctx.save();
  ctx.fillStyle = o.color ?? FG;
  ctx.textAlign = o.align ?? "center";
  ctx.textBaseline = "alphabetic";
  let size = o.size;
  ctx.font = fontStr(o, size);
  if (o.maxWidth) {
    while (size > 14 && ctx.measureText(str).width > o.maxWidth) {
      size -= 2;
      ctx.font = fontStr(o, size);
    }
  }
  ctx.fillText(str, x, y);
  ctx.restore();
}

// Lucide-Icon vektoriell ins Canvas. cx/cy = Mittelpunkt, size = Kantenlänge.
// strokeWidth ist im 24er-Raum (wie Lucide), wird also mit skaliert — so bleibt
// das Symbol proportional identisch zur App-Darstellung, nur größer und scharf.
function drawIcon(ctx: CanvasRenderingContext2D, node: IconNode | undefined, cx: number, cy: number, size: number, color: string, strokeWidth = 2): void {
  if (!node) return;
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = "transparent";
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [tag, a] of node) {
    if (tag === "path" && a.d) {
      ctx.stroke(new Path2D(String(a.d)));
    } else if (tag === "circle") {
      ctx.beginPath();
      ctx.arc(+a.cx, +a.cy, +a.r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tag === "line") {
      ctx.beginPath();
      ctx.moveTo(+a.x1, +a.y1);
      ctx.lineTo(+a.x2, +a.y2);
      ctx.stroke();
    } else if ((tag === "polyline" || tag === "polygon") && a.points) {
      const p = String(a.points).trim().split(/[\s,]+/).map(Number);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      if (tag === "polygon") ctx.closePath();
      ctx.stroke();
    } else if (tag === "rect") {
      const r = +(a.rx ?? 0);
      ctx.beginPath();
      if (r && ctx.roundRect) ctx.roundRect(+a.x, +a.y, +a.width, +a.height, r);
      else ctx.rect(+a.x, +a.y, +a.width, +a.height);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export interface WeatherCardInput {
  name: string;        // bereits aufgelöst (Geo-Ort = "Mein Standort", keine Koordinaten)
  forecast: Forecast;
  locale: string;
  lang: Lang;
}

// Zeichnet die Karte und gibt ein PNG-Blob zurück. null bei einem Fehler
// (z. B. kein 2D-Kontext, toBlob scheitert) → Aufrufer fällt auf Text-Teilen.
export async function renderWeatherCard(input: WeatherCardInput): Promise<Blob | null> {
  const { name, forecast, locale, lang } = input;

  // Fonts sicher laden, bevor gezeichnet wird (sonst System-Fallback im Canvas).
  try {
    await Promise.all([
      document.fonts.load('800 200px "Inter"'),
      document.fonts.load('700 60px "Inter"'),
      document.fonts.load('500 48px "Inter"'),
      document.fonts.load('400 30px "Inter"'),
      document.fonts.load('italic 400 80px "Instrument Serif"'),
    ]);
    await document.fonts.ready;
  } catch {
    /* notfalls mit Fallback-Font weiterzeichnen statt abzubrechen */
  }

  const cvs = document.createElement("canvas");
  cvs.width = W;
  cvs.height = H;
  const ctx = cvs.getContext("2d");
  if (!ctx) return null;

  const c = forecast.current;
  const inner = W - 2 * M;

  // Hintergrund
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // ── Kopf: Ort + Datum/Uhrzeit (Ortszeit) ───────────────────────────────
  drawText(ctx, name, W / 2, 230, { size: 76, weight: 800, color: FG, maxWidth: inner });
  const localTime = formatTimeInZone(forecast.timezone, locale);
  const dateStr =
    `${formatWeekdayLong(c.time, locale)}, ${formatDayMonth(c.time, locale)}` +
    (localTime ? ` · ${localTime}` : "");
  drawText(ctx, dateStr, W / 2, 296, { size: 34, weight: 500, color: MUTED, maxWidth: inner });

  // ── Hero: Icon + Temperatur + Wetterlage ────────────────────────────────
  drawIcon(ctx, ICONS[pickIcon(c.weatherCode, c.isDay)], W / 2, 560, 300, FG, 2);
  drawText(ctx, formatTemp(c.temperature), W / 2, 930, { size: 230, weight: 800, color: FG });
  drawText(ctx, weatherLabel(getWmo(c.weatherCode).labelKey, lang), W / 2, 1035, {
    size: 48, weight: 500, color: MUTED, maxWidth: inner,
  });

  // ── Kennwerte (nur vorhandene) ──────────────────────────────────────────
  const finite = (v: number): boolean => typeof v === "number" && Number.isFinite(v);
  const metrics = [
    finite(c.apparentTemperature) ? { label: t("feelsLike"), value: formatTemp(c.apparentTemperature) } : null,
    finite(c.humidity) ? { label: t("humidity"), value: formatPercent(c.humidity) } : null,
    finite(c.windSpeed) ? { label: t("wind"), value: formatWind(c.windSpeed) } : null,
  ].filter((m): m is { label: string; value: string } => m !== null);
  metrics.forEach((m, i) => {
    const cx = M + ((i + 0.5) * inner) / metrics.length;
    drawText(ctx, m.value, cx, 1240, { size: 46, weight: 700, color: FG });
    drawText(ctx, m.label, cx, 1292, { size: 28, weight: 400, color: MUTED });
  });

  // ── Trennlinie ──────────────────────────────────────────────────────────
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, 1380);
  ctx.lineTo(W - M, 1380);
  ctx.stroke();

  // ── Nächste Tage (ab morgen, bis zu 3, nur vollständige) ────────────────
  const days = forecast.daily
    .slice(1)
    .filter((d) => finite(d.tempMax) && finite(d.tempMin) && typeof d.weatherCode === "number")
    .slice(0, 3);
  const rowH = 110;
  const xRight = W - M - 16;
  days.forEach((d, i) => {
    const cy = 1470 + i * rowH;
    ctx.save();
    ctx.textBaseline = "middle";
    // Wochentag links
    drawTextBaseline(ctx, formatWeekday(d.date, locale), M + 16, cy, { size: 38, weight: 600, color: FG, align: "left" });
    // kleines Icon
    drawIcon(ctx, ICONS[pickIcon(d.weatherCode, true)], W * 0.46, cy, 52, MUTED, 2);
    // Max/Min rechts, zweifarbig (Max kräftig, Min gedämpft)
    const maxS = formatTemp(d.tempMax);
    const minS = formatTemp(d.tempMin);
    const sep = "  /  ";
    ctx.font = `700 40px ${FONT}`;
    ctx.textAlign = "left";
    const wMax = ctx.measureText(maxS).width;
    const wSep = ctx.measureText(sep).width;
    const wMin = ctx.measureText(minS).width;
    const x0 = xRight - (wMax + wSep + wMin);
    ctx.fillStyle = FG; ctx.fillText(maxS, x0, cy);
    ctx.fillStyle = MUTED; ctx.fillText(sep, x0 + wMax, cy);
    ctx.fillStyle = MUTED; ctx.fillText(minS, x0 + wMax + wSep, cy);
    ctx.restore();
  });

  // ── Fuß: Wortmarke (weather + serifenbetontes "pure") + Domain ──────────
  drawWordmark(ctx, W / 2, 1812);
  drawText(ctx, "weatherpure.com", W / 2, 1864, { size: 30, weight: 400, color: MUTED });

  return await new Promise<Blob | null>((resolve) => cvs.toBlob((b) => resolve(b), "image/png"));
}

// Wie drawText, aber respektiert eine zuvor gesetzte textBaseline ("middle" in
// den Tageszeilen) — drawText erzwingt "alphabetic".
function drawTextBaseline(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, o: TextOpts): void {
  ctx.save();
  ctx.fillStyle = o.color ?? FG;
  ctx.textAlign = o.align ?? "center";
  ctx.font = fontStr(o, o.size);
  ctx.fillText(str, x, y);
  ctx.restore();
}

// "weather" (Inter) + "pure" (Instrument Serif italic, Zenit) als zentrierte
// Einheit — die Signaturschrift wie im App-Header, nur als Canvas-Text.
function drawWordmark(ctx: CanvasRenderingContext2D, cx: number, y: number): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const a = "weather";
  const b = "pure";
  ctx.font = `700 56px ${FONT}`;
  const wa = ctx.measureText(a).width;
  ctx.font = `italic 400 64px ${SERIF}`;
  const wb = ctx.measureText(b).width;
  const x0 = cx - (wa + wb) / 2;
  ctx.font = `700 56px ${FONT}`;
  ctx.fillStyle = FG;
  ctx.fillText(a, x0, y);
  ctx.font = `italic 400 64px ${SERIF}`;
  ctx.fillStyle = ACCENT;
  ctx.fillText(b, x0 + wa, y);
  ctx.restore();
}
