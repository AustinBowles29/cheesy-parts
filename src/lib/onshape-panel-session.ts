import type { SubmissionFieldOptions, SubmissionInput } from "@/lib/types";

export interface CachedOnshapePanelData {
  defaults: SubmissionInput;
  fieldOptions: SubmissionFieldOptions;
}

const lastOnshapeSubmitHrefStorageKey = "cheesy-parts:last-onshape-submit-href";
const panelDataCachePrefix = "cheesy-parts:onshape-panel-data:";
const panelDataCacheMaxAgeMs = 30 * 60 * 1000;

interface StoredPanelData extends CachedOnshapePanelData {
  savedAt: number;
}

function canUseSessionStorage() {
  return typeof window !== "undefined" && Boolean(window.sessionStorage);
}

function normalizedPanelDataKey(panelDataUrl: string) {
  if (!canUseSessionStorage()) {
    return "";
  }

  const url = new URL(panelDataUrl, window.location.origin);
  url.searchParams.delete("__mode");
  url.searchParams.delete("onshapeAccessToken");
  url.searchParams.delete("onshapeTokenExpiresAt");
  const entries = Array.from(url.searchParams.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const normalizedParams = new URLSearchParams(entries);
  const query = normalizedParams.toString();

  return `${url.pathname}${query ? `?${query}` : ""}`;
}

function cacheStorageKey(panelDataUrl: string) {
  const key = normalizedPanelDataKey(panelDataUrl);
  return key ? `${panelDataCachePrefix}${key}` : "";
}

export function currentOnshapeSubmitHref() {
  if (!canUseSessionStorage()) {
    return "";
  }

  return window.sessionStorage.getItem(lastOnshapeSubmitHrefStorageKey) ?? "";
}

export function rememberCurrentOnshapeSubmitHref() {
  if (!canUseSessionStorage() || window.location.pathname !== "/onshape") {
    return;
  }

  const href = `${window.location.pathname}${window.location.search}`;
  if (window.location.search) {
    window.sessionStorage.setItem(lastOnshapeSubmitHrefStorageKey, href);
  }
}

export function readCachedOnshapePanelData(
  panelDataUrl: string,
): CachedOnshapePanelData | null {
  if (!canUseSessionStorage()) {
    return null;
  }

  const key = cacheStorageKey(panelDataUrl);
  if (!key) {
    return null;
  }

  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(key) ?? "null",
    ) as StoredPanelData | null;

    if (!stored || Date.now() - stored.savedAt > panelDataCacheMaxAgeMs) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return {
      defaults: stored.defaults,
      fieldOptions: stored.fieldOptions,
    };
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

export function rememberOnshapePanelData(
  panelDataUrl: string,
  panelData: CachedOnshapePanelData,
) {
  if (!canUseSessionStorage()) {
    return;
  }

  const key = cacheStorageKey(panelDataUrl);
  if (!key) {
    return;
  }

  window.sessionStorage.setItem(
    key,
    JSON.stringify({
      ...panelData,
      savedAt: Date.now(),
    } satisfies StoredPanelData),
  );
}
