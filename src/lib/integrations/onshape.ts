import { cookies } from "next/headers";
import { normalizeString } from "../manufacturing";
import type { SubmissionInput } from "../types";

const defaultAuthUrl = "https://oauth.onshape.com/oauth/authorize";
const defaultTokenUrl = "https://oauth.onshape.com/oauth/token";
const defaultApiBaseUrl = "https://cad.onshape.com/api";
const accessTokenCookie = "onshape_access_token";
const refreshTokenCookie = "onshape_refresh_token";
const expiresAtCookie = "onshape_token_expires_at";
const oauthStateCookie = "onshape_oauth_state";
const oauthReturnToCookie = "onshape_oauth_return_to";
const oauthCookieMaxAge = 10 * 60;
const tokenCookieMaxAge = 30 * 24 * 60 * 60;

interface OnshapeTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface OnshapePart {
  name?: string;
  partNumber?: string | null;
  description?: string | null;
  elementId?: string;
  partId?: string;
  bodyType?: string;
  material?: unknown;
  materialName?: string | null;
  customProperties?: Record<string, unknown>;
}

interface OnshapeMetadataProperty {
  name?: string;
  displayName?: string;
  propertyId?: string;
  value?: unknown;
}

interface OnshapeMetadata {
  name?: string;
  properties?: OnshapeMetadataProperty[];
}

export interface OnshapeContext {
  documentId: string;
  wvm: "w" | "v" | "m";
  wvmId: string;
  elementId: string;
  partId: string;
}

export interface OnshapeMetadataResult {
  defaults: SubmissionInput;
  warning?: string;
  authUrl?: string;
}

function clientId() {
  return process.env.ONSHAPE_CLIENT_ID;
}

function clientSecret() {
  return process.env.ONSHAPE_CLIENT_SECRET;
}

function redirectUri() {
  return process.env.ONSHAPE_REDIRECT_URI;
}

function authorizationUrl() {
  return process.env.ONSHAPE_AUTHORIZATION_URL ?? defaultAuthUrl;
}

function tokenUrl() {
  return process.env.ONSHAPE_TOKEN_URL ?? defaultTokenUrl;
}

function apiBaseUrl() {
  return (process.env.ONSHAPE_API_BASE_URL ?? defaultApiBaseUrl).replace(/\/$/, "");
}

export function isOnshapeOAuthConfigured() {
  return Boolean(clientId() && clientSecret() && redirectUri());
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "none" as const,
    secure: true,
  };
}

export function isSafeReturnTo(returnTo: string | null) {
  return Boolean(returnTo?.startsWith("/") && !returnTo.startsWith("//"));
}

export function onshapeOAuthStartUrl(returnTo: string) {
  const url = new URL("/api/onshape/oauth/start", "https://cheesy-parts.local");
  url.searchParams.set("returnTo", returnTo);
  return `${url.pathname}${url.search}`;
}

export function buildOnshapeAuthorizationUrl(state: string) {
  const id = clientId();
  const callback = redirectUri();

  if (!id || !callback) {
    throw new Error("Onshape OAuth is not configured.");
  }

  const url = new URL(authorizationUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("state", state);
  return url;
}

export async function setOnshapeOAuthState(state: string, returnTo: string) {
  const cookieStore = await cookies();
  cookieStore.set(oauthStateCookie, state, cookieOptions(oauthCookieMaxAge));
  cookieStore.set(oauthReturnToCookie, returnTo, cookieOptions(oauthCookieMaxAge));
}

export async function consumeOnshapeOAuthState(state: string | null) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(oauthStateCookie)?.value;
  const returnTo = cookieStore.get(oauthReturnToCookie)?.value;

  cookieStore.delete(oauthStateCookie);
  cookieStore.delete(oauthReturnToCookie);

  if (!state || !expectedState || state !== expectedState) {
    throw new Error("Invalid Onshape OAuth state.");
  }

  return isSafeReturnTo(returnTo ?? null) ? (returnTo as string) : "/onshape";
}

export async function exchangeOnshapeCode(code: string) {
  const id = clientId();
  const secret = clientSecret();
  const callback = redirectUri();

  if (!id || !secret || !callback) {
    throw new Error("Onshape OAuth is not configured.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: callback,
  });

  const response = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Onshape OAuth token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as OnshapeTokenResponse;
}

export async function setOnshapeTokens(tokens: OnshapeTokenResponse) {
  const cookieStore = await cookies();
  const expiresAt = Date.now() + Math.max((tokens.expires_in ?? 3600) - 60, 60) * 1000;

  cookieStore.set(accessTokenCookie, tokens.access_token, cookieOptions(tokenCookieMaxAge));
  cookieStore.set(expiresAtCookie, String(expiresAt), cookieOptions(tokenCookieMaxAge));

  if (tokens.refresh_token) {
    cookieStore.set(
      refreshTokenCookie,
      tokens.refresh_token,
      cookieOptions(tokenCookieMaxAge),
    );
  }
}

async function getAccessToken() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(accessTokenCookie)?.value;
  const expiresAt = Number(cookieStore.get(expiresAtCookie)?.value ?? 0);

  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return "";
  }

  return accessToken;
}

export function onshapeContextFromParams(
  params: Record<string, string | string[] | undefined>,
  firstParam: (value: string | string[] | undefined) => string | undefined,
): OnshapeContext | null {
  const documentId = firstParam(params.documentId) ?? firstParam(params.did);
  const workspaceOrVersion = firstParam(params.workspaceOrVersion)?.toLowerCase();
  const workspaceOrVersionId = firstParam(params.workspaceOrVersionId);
  const workspaceId =
    firstParam(params.workspaceId) ??
    firstParam(params.wid) ??
    (workspaceOrVersion?.startsWith("w") ? workspaceOrVersionId : undefined);
  const versionId =
    firstParam(params.versionId) ??
    firstParam(params.vid) ??
    (workspaceOrVersion?.startsWith("v") ? workspaceOrVersionId : undefined);
  const microversionId =
    firstParam(params.microversionId) ??
    firstParam(params.mid) ??
    (workspaceOrVersion?.startsWith("m") ? workspaceOrVersionId : undefined);
  const elementId = firstParam(params.elementId) ?? firstParam(params.eid);
  const partId = firstParam(params.partId) ?? firstParam(params.pid);
  const wvmId = workspaceId ?? versionId ?? microversionId;

  if (!documentId || !wvmId || !elementId) {
    return null;
  }

  return {
    documentId,
    elementId,
    partId: partId ?? "",
    wvm: versionId ? "v" : microversionId ? "m" : "w",
    wvmId,
  };
}

async function onshapeFetchJson<T>(path: string, accessToken: string) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    headers: {
      Accept: "application/json;charset=UTF-8; qs=0.09",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Onshape API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

function materialName(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return normalizeString(
      record.displayName ?? record.name ?? record.materialName ?? record.id,
    );
  }

  return "";
}

function customPropertyValue(
  properties: Record<string, unknown> | undefined,
  names: string[],
) {
  if (!properties) {
    return "";
  }

  const normalizedNames = names.map((name) => name.toLowerCase());
  for (const [key, value] of Object.entries(properties)) {
    if (normalizedNames.includes(key.toLowerCase())) {
      return normalizeString(value);
    }
  }

  return "";
}

function metadataPropertyValue(metadata: OnshapeMetadata | null, names: string[]) {
  const normalizedNames = names.map((name) => name.toLowerCase());

  for (const property of metadata?.properties ?? []) {
    const propertyNames = [property.name, property.displayName, property.propertyId]
      .map((name) => normalizeString(name).toLowerCase())
      .filter(Boolean);

    if (propertyNames.some((name) => normalizedNames.includes(name))) {
      return normalizeString(property.value);
    }
  }

  return "";
}

function partToDefaults(
  part: OnshapePart | null,
  metadata: OnshapeMetadata | null,
): SubmissionInput {
  if (!part && !metadata) {
    return {};
  }

  const material =
    materialName(part?.material) ||
    normalizeString(part?.materialName) ||
    metadataPropertyValue(metadata, ["Material", "material"]) ||
    customPropertyValue(part?.customProperties, ["Material", "material"]);

  return {
    material,
    partName:
      metadataPropertyValue(metadata, ["Name", "name"]) ||
      normalizeString(metadata?.name) ||
      normalizeString(part?.name),
    partNumber:
      metadataPropertyValue(metadata, ["Part number", "Part Number", "partNumber"]) ||
      normalizeString(part?.partNumber),
    thickness:
      metadataPropertyValue(metadata, ["Thickness", "thickness"]) ||
      customPropertyValue(part?.customProperties, ["Thickness", "thickness"]),
  };
}

export async function fetchOnshapePartMetadata(
  context: OnshapeContext | null,
  returnTo: string,
): Promise<OnshapeMetadataResult> {
  if (!context) {
    return { defaults: {} };
  }

  if (!isOnshapeOAuthConfigured()) {
    return {
      defaults: {},
      warning: "Onshape OAuth is not configured. Metadata fields remain editable.",
    };
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    return {
      defaults: {},
      authUrl: onshapeOAuthStartUrl(returnTo),
      warning: "Connect Onshape to auto-fill part name, part number, material, and thickness.",
    };
  }

  try {
    const query = new URLSearchParams({
      elementId: context.elementId,
      includePropertyDefaults: "false",
      withThumbnails: "false",
    });
    const parts = await onshapeFetchJson<OnshapePart[]>(
      `/v6/parts/d/${context.documentId}/${context.wvm}/${context.wvmId}?${query}`,
      accessToken,
    );
    const part =
      parts.find((item) => item.partId === context.partId) ??
      (parts.length === 1 ? parts[0] : null);
    let metadata: OnshapeMetadata | null = null;

    if (part?.partId) {
      try {
        metadata = await onshapeFetchJson<OnshapeMetadata>(
          `/v10/metadata/d/${context.documentId}/${context.wvm}/${context.wvmId}/e/${context.elementId}/p/${part.partId}`,
          accessToken,
        );
      } catch {
        metadata = null;
      }
    }

    return { defaults: partToDefaults(part, metadata) };
  } catch (error) {
    return {
      defaults: {},
      warning:
        error instanceof Error
          ? error.message
          : "Onshape metadata could not be loaded.",
    };
  }
}
