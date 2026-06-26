// RainChart.ts — Niederschlagsmenge der naechsten 24 Stunden als ruhiges
// Balkendiagramm. Schwester der TempCurve: gleiche Kartenbreite, gleiche
// x-Geometrie (padL/padR/hoursSpan identisch), damit beide Diagramme zeitlich
// DECKUNGSGLEICH untereinander sitzen. Regen ist stueckweise (mm je Stunde),
// daher Balken statt Linie.
//
// Designentscheidungen:
//  - ROLLENDE 24-Stunden-Ansicht ab jetzt, exakt dasselbe Fenster wie die
//    TempCurve (25 Werte, jetzt..+24h). Der jetzt-Balken sitzt ganz LINKS.
//  - Y-Achse auf das Maximum im Fenster normiert: der hoechste Balken nutzt die
//    volle Hoehe. So bleiben Niesel und Starkregen beide sichtbar.
//  - MIN_BAR: ein von 0 verschiedener, aber winziger Wert (Spur-Regen) wuerde
//    sonst <1px hoch und unsichtbar — daher mind. 2px, sobald v > 0.
//  - Balken einfarbig (CSS .rc-bar -> var(--rc-bar)), leicht abgerundete obere
//    Ecken. Farbe zentral in EINER CSS-Variable gekapselt.
//  - Maxwert oben rechts als leise Orientierung (fmtMm, locale-aware, identisch
//    zum Stundenpanel), darunter wenige Zeitmarken — sonst nichts: kein Gitter,
//    kein Rahmen, keine Legende.
//  - jetzt-Anker: ein kleiner ruhiger Punkt unter Index 0 (Echo des TempCurve-
//    jetzt-Punkts, aber leise).
//
// INTERAKTION: Pro Stunde eine transparente Hitbox ueber die VOLLE Spaltenhoehe
// (Balkenbreite + Gap), damit auf dem Handy nicht der schmale Balken getroffen
// werden muss. Hover (Desktop) und Tap (Touch) zeigen einen ruhigen Tooltip mit
// "Uhrzeit · Menge" (formatHour + fmtMm, gleiche Quelle wie Strip/Panel). Touch
// und Hover feuern nie doppelt (pointerType-Gate). Tastatur: Tab zwischen
// Stunden, Enter/Space zeigt, Escape schliesst; Fokus zeigt den Tooltip.
//
// SICHTBARKEIT: Das Diagramm zeigt sich NUR, wenn im Fenster nennenswerter Regen
// vorkommt (peak >= VISIBLE_MIN_MM). Sonst versteckt es sich selbst
// (container.hidden = true) — VOR jeder SVG-/Hitbox-Erzeugung, also kein Tooltip
// moeglich. Ein dauerhaft leeres Regen-Diagramm waere schlechter als keins.

import { fmtMm, formatHour } from "../lib/format";
import { t } from "../i18n/ui";

export interface RainChartInput {
  // Niederschlag (mm) fuer jetzt..+24h, dieselbe Fensterlaenge wie die TempCurve.
  // Fehlende Werte (alte Caches ohne precipitation) sind als 0 zu uebergeben.
  precip: number[];
  // ISO-Stationszeit je Stunde (forecast.hourly[].time), Quelle fuer die Tooltip-
  // Uhrzeit ueber formatHour — identisch zum Stundenstreifen.
  times: string[];
  // Ganzzahlige aktuelle Stunde in STATIONSZEIT (0..23) fuer die Achsenmarken.
  // Ausserhalb 0..23 -> Marken zeigen nur Offsets ab "jetzt" (+Nh).
  startHour: number;
  // BCP-47 Locale fuer mm- und Uhrzeit-Formatierung (de-DE / en / tr).
  locale: string;
  // Aria-Label fuers SVG, i18n t("rain_aria").
  ariaLabel: string;
}

const MARKS = 5;                // jetzt + 4 weitere, wie die TempCurve
const VISIBLE_MIN_MM = 0.1;     // Spitze darunter -> ganze Sektion versteckt
const MIN_BAR = 2;              // px Mindesthoehe fuer v > 0 (Spur-Regen sichtbar)

// Pro Container: die Daten der gerade angezeigten Stadt (der delegierte Listener
// loest die getippte Stunde hieraus auf) und der bereits gebundene Zustand. Die
// Listener werden nur EINMAL pro Container gebunden (#rainChart ist statisch und
// ueberlebt jeden Re-Render); WeakMap/Set: kein Leak, kein Doppel-Listener.
interface RcState {
  times: string[];
  vals: number[];
  locale: string;
}
const rcData = new WeakMap<HTMLElement, RcState>();
const rcBound = new WeakSet<HTMLElement>();
// Index der gerade offenen Spalte je Container (-1 = zu).
const rcActive = new WeakMap<HTMLElement, number>();
// pointerType des letzten pointerdown je Container — gegen Hover/Tap-Doppelfeuer.
const rcLastPointer = new WeakMap<HTMLElement, string>();

export function renderRainChart(container: HTMLElement, input: RainChartInput): void {
  const raw = Array.isArray(input.precip) ? input.precip : [];
  // Defensiv: jeder nicht-endliche Wert (undefined aus altem Cache, NaN) -> 0.
  const vals = raw.map((v) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0));
  if (vals.length === 0) { hide(container); return; }

  const peak = Math.max(...vals);
  if (!(peak >= VISIBLE_MIN_MM)) { hide(container); return; } // deckt 0 und NaN-Peak

  container.hidden = false;
  // Offenen Tooltip der alten Stadt/des alten Stands schliessen (Re-Render durch
  // Stadtwechsel, Refresh, Sprach-/Tageswechsel laeuft hier durch).
  rcActive.set(container, -1);
  rcData.set(container, { times: Array.isArray(input.times) ? input.times : [], vals, locale: input.locale });

  // Gleiche Maße/Padding wie die TempCurve, damit die x-Positionen der Balken
  // exakt unter den Kurvenpunkten liegen (W, padL, padR, hoursSpan identisch;
  // beide SVGs strecken via preserveAspectRatio="none" auf dieselbe Kartenbreite).
  const W = 340, H = 96;
  const padL = 16, padR = 16;
  const padT = 18;             // Maxwert-Zeile oben
  const padB = 22;             // Uhrzeit-Zeile unten
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;  // Nulllinie der Balken
  const hoursSpan = vals.length - 1;

  const xAt = (i: number) => padL + (hoursSpan <= 0 ? 0 : (plotW * i) / hoursSpan);
  // Balkenbreite: gut halber Schrittabstand, gedeckelt fuer ruhige Optik (breiter
  // und weicher als anfangs, damit Balken nicht wie duenne Striche wirken). Balken
  // um den Stundenpunkt zentriert; Sockel nutzen DIESELBE Breite -> pixelbuendig.
  const step = hoursSpan <= 0 ? plotW : plotW / hoursSpan;
  const barW = Math.max(2, Math.min(8, step * 0.55));
  const rx = Math.min(3, barW / 2);

  // Grundlinie: zarte durchgehende Linie bei baseY, auf der die Balken stehen —
  // gibt dem Diagramm Halt, statt die Balken frei schweben zu lassen. Farbe ueber
  // .rc-base (alpha-basierter Token, theme-aware). Nicht-skalierender Hairline.
  const base = `<line x1="${padL.toFixed(2)}" y1="${baseY.toFixed(2)}" x2="${(W - padR).toFixed(2)}" y2="${baseY.toFixed(2)}" class="rc-base" vector-effect="non-scaling-stroke"/>`;

  // Leer-Spur: an JEDER Stunde ein sehr leiser Sockel-Stummel auf der Grundlinie
  // (auch bei precip 0). Erzeugt gleichmaessiges Raster/Rhythmus, ohne laut zu
  // werden; echte Balken ueberdecken ihren Sockel.
  const SOCKET_H = 3;
  const sockets = vals.map((_v, i) => {
    const x = xAt(i) - barW / 2;
    const y = baseY - SOCKET_H;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${SOCKET_H.toFixed(2)}" rx="${rx.toFixed(2)}" class="rc-socket" data-rc-index="${i}"/>`;
  }).join("");

  const bars = vals.map((v, i) => {
    if (v <= 0) return "";
    const h = Math.max(MIN_BAR, (plotH * v) / peak);
    const x = xAt(i) - barW / 2;
    const y = baseY - h;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="${rx.toFixed(2)}" class="rc-bar" data-rc-index="${i}"/>`;
  }).join("");

  // jetzt-Anker: kleiner ruhiger Punkt unter Index 0, knapp unter der Grundlinie
  // im Achsen-Gap (immer sichtbar, kollidiert nie mit dem Balken). Leises Echo des
  // TempCurve-jetzt-Punkts.
  const now = `<circle cx="${xAt(0).toFixed(2)}" cy="${(baseY + 5).toFixed(2)}" r="1.6" class="rc-now"/>`;

  // Fuenf gleichmaessig verteilte Zeitmarken (x nach Index, nicht nach Uhrzeit),
  // exakt wie die TempCurve — "jetzt" plus vier Uhrzeiten bzw. +Nh ohne timezone.
  const startOk = Number.isFinite(input.startHour) && input.startHour >= 0 && input.startHour <= 23;
  const axis: string[] = [];
  for (let k = 0; k < MARKS; k++) {
    const idx = Math.round((k / (MARKS - 1)) * hoursSpan);
    const label = k === 0
      ? "jetzt"
      : startOk
        ? `${String((input.startHour + idx) % 24).padStart(2, "0")}:00`
        : `+${idx}h`;
    const anchor = idx === 0 ? "start" : idx === hoursSpan ? "end" : "middle";
    axis.push(`<text x="${xAt(idx).toFixed(2)}" y="${(H - 7).toFixed(2)}" class="rc-axis" text-anchor="${anchor}">${esc(label)}</text>`);
  }

  // Maxwert oben rechts als leise Orientierung, identisch zum Stundenpanel
  // formatiert (fmtMm, locale-aware, eine Nachkommastelle).
  const peakLabel = `<text x="${(W - padR).toFixed(2)}" y="11" class="rc-peak" text-anchor="end">${esc(fmtMm(peak, input.locale))}</text>`;

  // Hitboxes: transparente Spalten ueber die VOLLE Hoehe (Balken+Gap), zentriert
  // auf den Stundenpunkt und an die Plotbreite geklemmt. Fokussierbar (Tab),
  // role=button, aria-label "{Uhrzeit}, {Menge}". getBoundingClientRect der Hitbox
  // liefert echte Bildschirmkoordinaten -> umgeht die preserveAspectRatio="none"-
  // Verzerrung bei der Tooltip-Positionierung.
  const hitW = step;
  const hits = vals.map((v, i) => {
    const x = Math.max(0, xAt(i) - hitW / 2);
    const right = Math.min(W, xAt(i) + hitW / 2);
    const w = right - x;
    const aria = `${formatHour(input.times[i] ?? "", input.locale)}, ${amountText(v, input.locale)}`;
    return `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${baseY.toFixed(2)}" class="rc-hit" data-rc-index="${i}" tabindex="0" role="button" aria-label="${esc(aria)}"/>`;
  }).join("");

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" class="rc-svg" role="img" aria-label="${esc(input.ariaLabel)}" preserveAspectRatio="none">` +
    base + sockets + bars + now + peakLabel + axis.join("") + hits +
    `</svg>`;

  container.replaceChildren();
  container.insertAdjacentHTML("afterbegin", svg);
  // Tooltip-Element (zunaechst versteckt) als HTML-Overlay in der Karte.
  const tip = document.createElement("div");
  tip.className = "rc-tip";
  tip.hidden = true;
  container.appendChild(tip);

  if (!rcBound.has(container)) { bindRainChart(container); rcBound.add(container); }
}

// Tooltip-Text einer Stunde: Uhrzeit (formatHour) · Menge (fmtMm) bzw. "kein
// Regen" bei 0. Gleiche Formatierung wie Strip/Panel.
function amountText(v: number, locale: string): string {
  return v > 0 ? fmtMm(v, locale) : t("rc_dry");
}
function tipText(i: number, st: RcState): string {
  const time = formatHour(st.times[i] ?? "", st.locale);
  return `${time} · ${amountText(st.vals[i] ?? 0, st.locale)}`;
}

// Bindet Hover/Tap/Tastatur EINMAL pro Container (Delegation auf #rainChart, der
// statisch ist und jeden Re-Render ueberlebt). Liest die aktuellen Daten aus
// rcData -> nach Stadtwechsel/Refresh loest jeder Treffer die gerade angezeigte
// Stunde auf.
function bindRainChart(container: HTMLElement): void {
  const indexFrom = (e: Event): number => {
    const node = e.target instanceof Element ? e.target.closest<SVGElement>(".rc-hit[data-rc-index]") : null;
    if (!node || !container.contains(node)) return -1;
    const i = Number(node.getAttribute("data-rc-index"));
    return Number.isInteger(i) ? i : -1;
  };

  // pointerType des letzten pointerdown merken — Touch soll NICHT zusaetzlich die
  // Hover- und Fokus-Pfade ausloesen.
  container.addEventListener("pointerdown", (e) => {
    rcLastPointer.set(container, e.pointerType);
  });

  // Desktop-Hover: Tooltip folgt dem ueberfahrenen Balken; nur fuer die Maus.
  container.addEventListener("pointerover", (e) => {
    if ((e as PointerEvent).pointerType !== "mouse") return;
    const i = indexFrom(e);
    if (i >= 0) showTip(container, i);
  });
  container.addEventListener("pointerout", (e) => {
    if ((e as PointerEvent).pointerType !== "mouse") return;
    // Verlassen der Karte (related target ausserhalb) -> schliessen.
    const to = (e as PointerEvent).relatedTarget as Node | null;
    if (!to || !container.contains(to)) hideTip(container);
  });

  // Tap (Touch/Pen): toggelt die Spalte. Bei Maus NICHT (Hover steuert schon) —
  // verhindert das Doppelfeuer.
  container.addEventListener("click", (e) => {
    if (rcLastPointer.get(container) === "mouse") return;
    const i = indexFrom(e);
    if (i < 0) return;
    if (rcActive.get(container) === i) hideTip(container);
    else showTip(container, i);
  });

  // Tastatur: Enter/Space toggelt die fokussierte Spalte, Escape schliesst.
  container.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const i = indexFrom(e);
      if (i < 0) return;
      e.preventDefault();
      if (rcActive.get(container) === i) hideTip(container);
      else showTip(container, i);
    } else if (e.key === "Escape") {
      const i = rcActive.get(container) ?? -1;
      if (i >= 0) {
        hideTip(container);
        const node = container.querySelector<SVGElement>(`.rc-hit[data-rc-index="${i}"]`);
        node?.focus();
      }
    }
  });

  // Tastatur-Fokus zeigt den Tooltip als sichtbares Feedback — aber NICHT nach
  // einem Touch-pointerdown (dort steuert der Tap), gegen Doppel.
  container.addEventListener("focusin", (e) => {
    if (rcLastPointer.get(container) === "touch") return;
    const i = indexFrom(e);
    if (i >= 0) showTip(container, i);
  });
  container.addEventListener("focusout", (e) => {
    // Fokus verlaesst die Karte ganz -> schliessen (Wechsel zwischen Spalten zeigt
    // ueber focusin die neue).
    const to = (e as FocusEvent).relatedTarget as Node | null;
    if (!to || !container.contains(to)) hideTip(container);
  });

  // Outside-Tap schliesst (nur scharf, wenn offen). Document-Listener dauerhaft,
  // aber guard auf offenen Zustand + Treffer ausserhalb der Karte.
  document.addEventListener("pointerdown", (e) => {
    if ((rcActive.get(container) ?? -1) < 0) return;
    const target = e.target as Node | null;
    if (target && container.contains(target)) return;
    hideTip(container);
  });
}

function showTip(container: HTMLElement, i: number): void {
  const st = rcData.get(container);
  const tip = container.querySelector<HTMLElement>(".rc-tip");
  if (!st || !tip) return;
  if (i < 0 || i >= st.vals.length) return;
  tip.textContent = tipText(i, st);
  tip.hidden = false;
  rcActive.set(container, i);
  positionTip(container, i, tip);
}

function hideTip(container: HTMLElement): void {
  const tip = container.querySelector<HTMLElement>(".rc-tip");
  if (tip) { tip.hidden = true; tip.textContent = ""; }
  rcActive.set(container, -1);
}

// Tooltip ueber dem getippten Balken, in BILDSCHIRM-Koordinaten gerechnet: die
// Hitbox (und der sichtbare Balken/Sockel) liefern per getBoundingClientRect die
// echte Position trotz preserveAspectRatio="none". left an die Kartenraender
// geklemmt, top knapp ueber dem Balken (bei Ueberlauf nach oben auf 2px geklemmt).
function positionTip(container: HTMLElement, i: number, tip: HTMLElement): void {
  const cardRect = container.getBoundingClientRect();
  const bar = container.querySelector<SVGElement>(`.rc-bar[data-rc-index="${i}"]`)
    || container.querySelector<SVGElement>(`.rc-socket[data-rc-index="${i}"]`);
  const hit = container.querySelector<SVGElement>(`.rc-hit[data-rc-index="${i}"]`);
  if (!hit) return;
  const hr = hit.getBoundingClientRect();
  const cx = hr.left + hr.width / 2 - cardRect.left;     // Spaltenmitte relativ zur Karte
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  let left = cx - tipW / 2;
  left = Math.max(4, Math.min(left, cardRect.width - tipW - 4));
  const barTop = (bar ? bar.getBoundingClientRect().top : hr.top) - cardRect.top;
  let top = barTop - tipH - 6;
  if (top < 2) top = 2;
  tip.style.left = `${left.toFixed(1)}px`;
  tip.style.top = `${top.toFixed(1)}px`;
}

function hide(container: HTMLElement): void {
  container.hidden = true;
  container.replaceChildren();
  rcActive.set(container, -1);
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
