// Auflösung eines geteilten Ortslinks (?stadt=…).
//
// Der geteilte Link ist ein Versprechen: der Empfänger soll das Wetter DES
// GETEILTEN Orts sehen. Wird der Ort nicht gefunden, darf die App deshalb
// niemals still den zuletzt gespeicherten Ort des Empfängers anzeigen — das
// wäre fremdes Wetter, ausgegeben als das geteilte, ohne jeden Hinweis.
//
// Reine Funktion ohne DOM und ohne Netz, damit die Entscheidung prüfbar ist.
import { GEO_PLACE_ID, type Place } from "./geocoding";

export const CITY_PARAM = "stadt";
export const PROVIDER_ID_PARAM = "placeId";

export type PlaceLink =
  | { kind: "none" }
  | { kind: "invalid"; name: string }
  | { kind: "legacy"; name: string }
  | { kind: "provider"; name: string; providerId: number };

export function placeLinkUrl(base: string, place: Place): URL {
  const url = new URL(base);
  if (place.id === GEO_PLACE_ID) {
    url.searchParams.delete(CITY_PARAM);
    url.searchParams.delete(PROVIDER_ID_PARAM);
    return url;
  }
  url.searchParams.set(CITY_PARAM, place.name);
  if (place.providerId !== undefined && Number.isSafeInteger(place.providerId) &&
      place.providerId > 0 && place.providerId === place.id) {
    url.searchParams.set(PROVIDER_ID_PARAM, String(place.providerId));
  } else {
    url.searchParams.delete(PROVIDER_ID_PARAM);
  }
  return url;
}

export function readPlaceLink(search: string): PlaceLink {
  const params = new URLSearchParams(search);
  const rawName = params.get(CITY_PARAM) ?? "";
  const name = rawName.trim();
  if (params.has(PROVIDER_ID_PARAM)) {
    const ids = params.getAll(PROVIDER_ID_PARAM);
    const rawId = ids[0];
    if (!name || ids.length !== 1 || !/^[1-9]\d*$/.test(rawId)) return { kind: "invalid", name };
    const providerId = Number(rawId);
    if (!Number.isSafeInteger(providerId)) return { kind: "invalid", name };
    return { kind: "provider", name: rawName, providerId };
  }
  return name ? { kind: "legacy", name } : { kind: "none" };
}

export type LinkResolution =
  | { kind: "none" }
  | { kind: "exact"; place: Place }
  | { kind: "ambiguous"; place: Place; count: number };

// Legacy Namenslinks vergleichen Namen wie bisher ohne Großschreibung.
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function decideLinkResolution(results: Place[], query: string): LinkResolution {
  if (results.length === 0) return { kind: "none" };
  if (results.length === 1) return { kind: "exact", place: results[0] };

  // Mehrere Treffer sind nur dann eindeutig, wenn GENAU EINER namentlich auf
  // die Anfrage passt (z. B. "Berlin" gegen "Berlin" und "Berlin Heights").
  // Passen mehrere oder keiner, ist die Wahl des ersten Treffers eine Annahme
  // und muss dem Empfänger sichtbar bestätigt werden.
  const wanted = normalize(query);
  const named = results.filter((place) => normalize(place.name) === wanted);
  if (named.length === 1) return { kind: "exact", place: named[0] };

  return { kind: "ambiguous", place: results[0], count: results.length };
}

export function decideProviderLinkResolution(results: Place[], providerId: number): LinkResolution {
  const matches = results.filter((place) => place.providerId === providerId && place.id === providerId);
  return matches.length === 1 ? { kind: "exact", place: matches[0] } : { kind: "none" };
}
