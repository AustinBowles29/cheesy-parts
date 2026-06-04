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

interface OnshapeElement {
  id?: string;
  name?: string;
  type?: string;
  elementType?: string;
}

export interface OnshapeContext {
  documentId: string;
  wvm: "w" | "v" | "m";
  wvmId: string;
  elementId: string;
  assemblyElementId?: string;
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
  const assemblyElementId =
    firstParam(params.assemblyElementId) ?? firstParam(params.aeid);
  const partId = firstParam(params.partId) ?? firstParam(params.pid);
  const wvmId = workspaceId ?? versionId ?? microversionId;

  if (!documentId || !wvmId || !elementId) {
    return null;
  }

  return {
    documentId,
    assemblyElementId,
    elementId,
    partId: partId ?? "",
    wvm: versionId ? "v" : microversionId ? "m" : "w",
    wvmId,
  };
}

function normalizedComparable(value: string): string {
  return value
    .replace(/\s*<\d+>\s*$/g, "")
    .trim()
    .toLowerCase();
}

function propertyLabel(property: Record<string, unknown>): string {
  return normalizeString(
    property.name ??
      property.displayName ??
      property.propertyName ??
      property.columnName ??
      property.header ??
      property.label ??
      property.propertyId,
  )
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function propertyValue(property: Record<string, unknown>): string {
  return normalizeString(
    property.value ??
      property.displayValue ??
      property.computedValue ??
      property.cellValue ??
      property.text,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function objectValues(value: unknown): unknown[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  return Object.values(value);
}

function normalizedPropertyKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isPartNumberLabel(value: string): boolean {
  const normalized = normalizedPropertyKey(value);
  return (
    normalized === "partnumber" ||
    normalized === "partno" ||
    normalized === "partnum"
  );
}

function includesString(value: unknown, expected: string): boolean {
  if (!expected) {
    return false;
  }

  if (typeof value === "string") {
    return value === expected;
  }

  return objectValues(value).some((item) => includesString(item, expected));
}

function includesName(value: unknown, expectedName: string): boolean {
  if (!expectedName) {
    return false;
  }

  if (typeof value === "string") {
    return normalizedComparable(value) === normalizedComparable(expectedName);
  }

  return objectValues(value).some((item) => includesName(item, expectedName));
}

function cellString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return normalizeString(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = cellString(item);
      if (found) {
        return found;
      }
    }

    return "";
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  return normalizeString(
    record.value ??
      record.displayValue ??
      record.computedValue ??
      record.cellValue ??
      record.text,
  );
}

function directPartNumber(value: unknown): string {
  const record = asRecord(value);
  if (!record) {
    return "";
  }

  for (const [key, item] of Object.entries(record)) {
    if (isPartNumberLabel(key)) {
      const found = cellString(item);
      if (found && !isPartNumberLabel(found)) {
        return found;
      }
    }
  }

  return "";
}

function propertyPartNumber(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = propertyPartNumber(item);
      if (found) {
        return found;
      }
    }

    return "";
  }

  const record = value as Record<string, unknown>;
  const label = propertyLabel(record);
  if (isPartNumberLabel(label)) {
    const found = propertyValue(record);
    return found && !isPartNumberLabel(found) ? found : "";
  }

  for (const item of Object.values(record)) {
    const found = propertyPartNumber(item);
    if (found) {
      return found;
    }
  }

  return "";
}

function partNumberFromNode(value: unknown): string {
  return directPartNumber(value) || propertyPartNumber(value);
}

function bomTableFromResponse(bom: unknown): Record<string, unknown> | null {
  const record = asRecord(bom);
  return asRecord(record?.bomTable) ?? record;
}

function partNumberHeaderKeys(bom: unknown): string[] {
  const table = bomTableFromResponse(bom);
  const keys = new Set(["partNumber", "Part Number", "partNo", "Part No"]);
  const headers = Array.isArray(table?.headers) ? table.headers : [];

  for (const header of headers) {
    const record = asRecord(header);
    if (!record) {
      continue;
    }

    const labels = [
      normalizeString(record.propertyName),
      normalizeString(record.name),
      normalizeString(record.propertyId),
    ].filter(Boolean);

    if (!labels.some(isPartNumberLabel)) {
      continue;
    }

    for (const label of labels) {
      keys.add(label);
    }
  }

  return Array.from(keys);
}

function valueFromRecordKeys(
  record: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value =
      record[key] ??
      asRecord(record.otherProperties)?.[key] ??
      asRecord(record.values)?.[key] ??
      asRecord(record.columnValues)?.[key];
    const found = cellString(value);
    if (found && !isPartNumberLabel(found)) {
      return found;
    }
  }

  return "";
}

function rowPartId(row: Record<string, unknown>): string {
  const itemSource = asRecord(row.itemSource);
  const partIdentity = asRecord(row.partIdentity);
  const source = asRecord(row.source);

  return normalizeString(
    row.partId ?? itemSource?.partId ?? partIdentity?.partId ?? source?.partId,
  );
}

function rowPartName(row: Record<string, unknown>): string {
  const itemSource = asRecord(row.itemSource);
  const partIdentity = asRecord(row.partIdentity);
  const source = asRecord(row.source);

  return normalizeString(
    row.partName ??
      row.name ??
      itemSource?.partName ??
      itemSource?.name ??
      partIdentity?.partName ??
      partIdentity?.name ??
      source?.partName ??
      source?.name,
  );
}

function rowMatchesPartId(row: Record<string, unknown>, partId: string): boolean {
  const rowId = rowPartId(row);
  return rowId ? rowId === partId : includesString(row, partId);
}

function rowMatchesPartName(
  row: Record<string, unknown>,
  partName: string,
): boolean {
  const rowName = rowPartName(row);
  if (rowName) {
    return normalizedComparable(rowName) === normalizedComparable(partName);
  }

  return includesName(row, partName);
}

function partNumberFromRow(
  row: Record<string, unknown>,
  headerKeys: string[],
): string {
  return valueFromRecordKeys(row, headerKeys) || partNumberFromNode(row);
}

function collectBomItemRows(
  value: unknown,
  rows: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectBomItemRows(item, rows);
    }

    return rows;
  }

  const record = asRecord(value);
  if (!record) {
    return rows;
  }

  if (record.itemSource || record.partIdentity || rowPartId(record)) {
    rows.push(record);
  }

  for (const item of Object.values(record)) {
    collectBomItemRows(item, rows);
  }

  return rows;
}

function bomItemRows(bom: unknown): Record<string, unknown>[] {
  const table = bomTableFromResponse(bom);
  const items = table?.items;

  if (Array.isArray(items)) {
    return items.flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
  }

  return collectBomItemRows(bom);
}

function findBomPartNumber(input: {
  bom: unknown;
  partId: string;
  partName: string;
}): string {
  const rows = bomItemRows(input.bom);
  const headerKeys = partNumberHeaderKeys(input.bom);

  if (input.partId) {
    for (const row of rows) {
      if (!rowMatchesPartId(row, input.partId)) {
        continue;
      }

      const partNumber = partNumberFromRow(row, headerKeys);
      if (partNumber) {
        return partNumber;
      }
    }
  }

  if (input.partName) {
    for (const row of rows) {
      if (!rowMatchesPartName(row, input.partName)) {
        continue;
      }

      const partNumber = partNumberFromRow(row, headerKeys);
      if (partNumber) {
        return partNumber;
      }
    }
  }

  return "";
}

async function fetchAssemblyElements(
  context: OnshapeContext,
  accessToken: string,
): Promise<OnshapeElement[]> {
  if (context.assemblyElementId) {
    return [{ id: context.assemblyElementId }];
  }

  const elements = await onshapeFetchJson<OnshapeElement[]>(
    `/v10/documents/d/${context.documentId}/${context.wvm}/${context.wvmId}/elements`,
    accessToken,
  );

  return elements.filter((element) => {
    const elementType = normalizeString(element.elementType).toUpperCase();
    const type = normalizeString(element.type).toUpperCase();
    return elementType === "ASSEMBLY" || type === "ASSEMBLY";
  });
}

async function fetchBom(
  accessToken: string,
  context: OnshapeContext,
  elementId: string,
): Promise<unknown> {
  const endpoint = `/v10/assemblies/d/${context.documentId}/${context.wvm}/${context.wvmId}/e/${elementId}/bom`;
  return onshapeFetchJson<unknown>(endpoint, accessToken);
}

async function fetchBomPartNumber(input: {
  accessToken: string;
  context: OnshapeContext;
  part: OnshapePart | null;
  partName: string;
}): Promise<string> {
  const partId = input.context.partId || normalizeString(input.part?.partId);
  const partName = input.partName || normalizeString(input.part?.name);
  if (!partId && !partName) {
    return "";
  }

  let assemblies: OnshapeElement[] = [];
  try {
    assemblies = await fetchAssemblyElements(input.context, input.accessToken);
  } catch {
    return "";
  }

  for (const assembly of assemblies) {
    const assemblyElementId = normalizeString(assembly.id);
    if (!assemblyElementId) {
      continue;
    }

    try {
      const bom = await fetchBom(input.accessToken, input.context, assemblyElementId);
      const partNumber = findBomPartNumber({ bom, partId, partName });
      if (partNumber) {
        return partNumber;
      }
    } catch {
      continue;
    }
  }

  return "";
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
    description:
      metadataPropertyValue(metadata, ["Description", "description"]) ||
      normalizeString(part?.description),
    partName:
      metadataPropertyValue(metadata, ["Name", "name"]) ||
      normalizeString(metadata?.name) ||
      normalizeString(part?.name),
    partNumber:
      metadataPropertyValue(metadata, ["Part number", "Part Number", "partNumber"]) ||
      normalizeString(part?.partNumber),
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
      warning: "Connect Onshape to auto-fill part name, part number, material, and description.",
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

    const defaults = partToDefaults(part, metadata);
    if (!defaults.partNumber) {
      const bomPartNumber = await fetchBomPartNumber({
        accessToken,
        context,
        part,
        partName: defaults.partName ?? "",
      });

      if (bomPartNumber) {
        defaults.partNumber = bomPartNumber;
      }
    }

    return { defaults };
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
