import { cookies } from "next/headers";
import { saveGeneratedFile } from "../files";
import { normalizeString } from "../manufacturing";
import type { AttachmentRef, OnshapeUser, SubmissionInput } from "../types";

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

interface OnshapeUserProfile {
  id?: string;
  name?: string;
  displayName?: string;
  display_name?: string;
  username?: string;
  userName?: string;
  user_name?: string;
  email?: string;
  emails?: Array<string | { value?: string; email?: string }>;
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
  nickname?: string;
  documentationName?: string;
  documentation_name?: string;
  user?: OnshapeUserProfile;
  profile?: OnshapeUserProfile;
  _json?: OnshapeUserProfile;
  json?: OnshapeUserProfile;
}

interface OnshapeElement {
  id?: string;
  name?: string;
  type?: string;
  elementType?: string;
  applicationElementType?: string;
  mimeType?: string;
}

interface OnshapeTranslationResponse {
  id: string;
  requestId?: string;
  requestState?: string;
  resultExternalDataIds?: unknown;
  resultElementIds?: unknown;
  documentId?: string;
  resultDocumentId?: string;
  resultWorkspaceId?: string;
  workspaceId?: string;
  failureReason?: string | null;
}

interface OnshapeTranslationFormat {
  name?: string;
  translatorName?: string;
  validDestinationFormat?: boolean;
}

export interface OnshapeContext {
  documentId: string;
  wvm: "w" | "v" | "m";
  wvmId: string;
  elementId: string;
  assemblyElementId?: string;
  partId: string;
  server?: string;
}

export interface OnshapeMetadataResult {
  defaults: SubmissionInput;
  warning?: string;
  authUrl?: string;
}

export interface OnshapeUserResult {
  defaults: SubmissionInput;
  user?: OnshapeUser;
}

interface OnshapeMetadataOptions {
  includeBom?: boolean;
  includeDrawing?: boolean;
  accessToken?: string;
  fallbackPartName?: string;
  fallbackPartNumber?: string;
}

function clientId() {
  const id = normalizeString(process.env.ONSHAPE_CLIENT_ID);
  // Onshape client identifiers use a base32-style alphabet. A copied
  // uppercase O can easily become a zero, which makes /oauth/authorize reject.
  return id.replace(/0/g, "O");
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

export function normalizeOnshapeServer(value: string | undefined) {
  const server = normalizeString(value);
  if (!server || /^\{\$[^}]+\}$/.test(server)) {
    return "";
  }

  try {
    const url = new URL(server.startsWith("http") ? server : `https://${server}`);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "onshape.com" && !hostname.endsWith(".onshape.com")) {
      return "";
    }

    return url.origin.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function apiBaseUrlForServer(server?: string) {
  const onshapeServer = normalizeOnshapeServer(server);
  return onshapeServer ? `${onshapeServer}/api` : apiBaseUrl();
}

function onshapeElementContextFromUrl(value: string | undefined) {
  const rawUrl = normalizeString(value);
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    const server = normalizeOnshapeServer(url.origin);
    const match = /^\/documents\/([^/]+)\/([wvm])\/([^/]+)\/e\/([^/]+)/i.exec(
      url.pathname,
    );

    if (!server || !match) {
      return null;
    }

    return {
      documentId: decodeURIComponent(match[1]),
      wvm: match[2].toLowerCase(),
      wvmId: decodeURIComponent(match[3]),
      elementId: decodeURIComponent(match[4]),
      server,
    };
  } catch {
    return null;
  }
}

function oauthScopes() {
  return normalizeString(
    process.env.ONSHAPE_SCOPES ?? "OAuth2ReadPII OAuth2Read OAuth2Write",
  );
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

function normalizeCompanyId(value: string | undefined) {
  const companyId = normalizeString(value);
  if (!companyId || companyId === "cad" || /^\{\$[^}]+\}$/.test(companyId)) {
    return "";
  }

  return companyId;
}

export function buildOnshapeAuthorizationUrl(
  state: string,
  options: { companyId?: string } = {},
) {
  const id = clientId();
  const callback = redirectUri();
  const companyId = normalizeCompanyId(
    options.companyId ?? process.env.ONSHAPE_COMPANY_ID,
  );

  if (!id || !callback) {
    throw new Error("Onshape OAuth is not configured.");
  }

  const url = new URL(authorizationUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("state", state);
  const scopes = oauthScopes();
  if (scopes) {
    url.searchParams.set("scope", scopes);
  }
  if (companyId && companyId !== "cad") {
    url.searchParams.set("company_id", companyId);
  }
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

  return expiresAt;
}

export async function getOnshapeAccessToken() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(accessTokenCookie)?.value;
  const expiresAt = Number(cookieStore.get(expiresAtCookie)?.value ?? 0);

  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return "";
  }

  return accessToken;
}

function onshapeUserDisplayName(profile: OnshapeUserProfile) {
  const firstName = profile.firstName ?? profile.first_name;
  const lastName = profile.lastName ?? profile.last_name;
  const fullName = [firstName, lastName]
    .map((name) => normalizeString(name))
    .filter(Boolean)
    .join(" ");

  return (
    normalizeString(profile.displayName ?? profile.display_name) ||
    normalizeString(profile.documentationName ?? profile.documentation_name) ||
    normalizeString(profile.name) ||
    fullName ||
    normalizeString(profile.username ?? profile.userName ?? profile.user_name) ||
    normalizeString(profile.nickname) ||
    normalizeString(profile.email)
  );
}

function onshapeUserEmail(profile: OnshapeUserProfile) {
  const directEmail = normalizeString(profile.email);
  if (directEmail) {
    return directEmail;
  }

  for (const email of profile.emails ?? []) {
    if (typeof email === "string") {
      const value = normalizeString(email);
      if (value) {
        return value;
      }
      continue;
    }

    const value = normalizeString(email.value ?? email.email);
    if (value) {
      return value;
    }
  }

  return "";
}

function uniqueProfileAliases(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const aliases: string[] = [];

  for (const value of values) {
    const alias = normalizeString(value);
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) {
      continue;
    }

    seen.add(key);
    aliases.push(alias);
  }

  return aliases;
}

function onshapeUserFromProfile(
  profile: OnshapeUserProfile,
): OnshapeUser | undefined {
  const email = onshapeUserEmail(profile);
  const displayName = onshapeUserDisplayName({ ...profile, email });
  if (!displayName) {
    return undefined;
  }

  const firstName = profile.firstName ?? profile.first_name;
  const lastName = profile.lastName ?? profile.last_name;
  const fullName = [firstName, lastName]
    .map((name) => normalizeString(name))
    .filter(Boolean)
    .join(" ");
  const emailLocalPart = email.split("@")[0];
  const aliases = uniqueProfileAliases([
    displayName,
    profile.displayName,
    profile.display_name,
    profile.documentationName,
    profile.documentation_name,
    profile.name,
    fullName,
    profile.username,
    profile.userName,
    profile.user_name,
    profile.nickname,
    email,
    emailLocalPart,
  ]);

  return {
    displayName,
    email: email || undefined,
    aliases,
  };
}

function nestedUserProfile(profile: OnshapeUserProfile): OnshapeUserProfile {
  return profile.user ?? profile.profile ?? profile._json ?? profile.json ?? profile;
}

async function fetchOnshapeUserProfile(accessToken: string, server?: string) {
  for (const path of [
    "/users/sessioninfo",
    "/users/current",
    "/users/session",
  ]) {
    try {
      const profile = await onshapeFetchJson<OnshapeUserProfile>(
        path,
        accessToken,
        server,
      );
      const user = onshapeUserFromProfile(nestedUserProfile(profile));
      if (user) {
        return user;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function fetchOnshapeCurrentUser(
  options: { server?: string; accessToken?: string } = {},
): Promise<OnshapeUserResult> {
  if (!isOnshapeOAuthConfigured()) {
    return { defaults: {} };
  }

  const accessToken =
    normalizeString(options.accessToken) || (await getOnshapeAccessToken());
  if (!accessToken) {
    return { defaults: {} };
  }

  try {
    const user = await fetchOnshapeUserProfile(accessToken, options.server);
    return {
      defaults: {
        submitter: user?.displayName,
      },
      user,
    };
  } catch {
    return { defaults: {} };
  }
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
  const server = normalizeOnshapeServer(
    firstParam(params.server) ?? firstParam(params.onshapeServer),
  );
  const wvmId = workspaceId ?? versionId ?? microversionId;

  if (!documentId || !wvmId || !elementId) {
    return null;
  }

  return {
    documentId,
    assemblyElementId,
    elementId,
    partId: partId ?? "",
    server: server || undefined,
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

function materialHeaderKeys(bom: unknown): string[] {
  const table = bomTableFromResponse(bom);
  const keys = new Set([
    "material",
    "Material",
    "materialName",
    "Material Name",
    "rawMaterial",
    "Raw material",
    "Raw Material",
  ]);
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

    if (
      !labels.some((label) =>
        /^(raw\s*)?material(\s*name)?$/i.test(label.trim()),
      )
    ) {
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

function materialFromRow(
  row: Record<string, unknown>,
  headerKeys: string[],
): string {
  return valueFromRecordKeys(row, headerKeys);
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

function findBomMaterial(input: {
  bom: unknown;
  partId: string;
  partName: string;
}): string {
  const rows = bomItemRows(input.bom);
  const headerKeys = materialHeaderKeys(input.bom);

  if (input.partId) {
    for (const row of rows) {
      if (!rowMatchesPartId(row, input.partId)) {
        continue;
      }

      const material = materialFromRow(row, headerKeys);
      if (material) {
        return material;
      }
    }
  }

  if (input.partName) {
    for (const row of rows) {
      if (!rowMatchesPartName(row, input.partName)) {
        continue;
      }

      const material = materialFromRow(row, headerKeys);
      if (material) {
        return material;
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

  const elements = await fetchDocumentElements(context, accessToken);

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
  return onshapeFetchJson<unknown>(endpoint, accessToken, context.server);
}

async function fetchBomDefaults(input: {
  accessToken: string;
  context: OnshapeContext;
  part: OnshapePart | null;
  partName: string;
}): Promise<Pick<SubmissionInput, "material" | "partNumber">> {
  const partId = input.context.partId || normalizeString(input.part?.partId);
  const partName = input.partName || normalizeString(input.part?.name);
  if (!partId && !partName) {
    return {};
  }

  let assemblies: OnshapeElement[] = [];
  try {
    assemblies = await fetchAssemblyElements(input.context, input.accessToken);
  } catch {
    return {};
  }

  const defaults: Pick<SubmissionInput, "material" | "partNumber"> = {};
  for (const assembly of assemblies) {
    const assemblyElementId = normalizeString(assembly.id);
    if (!assemblyElementId) {
      continue;
    }

    try {
      const bom = await fetchBom(input.accessToken, input.context, assemblyElementId);
      defaults.material ||= findBomMaterial({ bom, partId, partName });
      defaults.partNumber ||= findBomPartNumber({ bom, partId, partName });
      if (defaults.material && defaults.partNumber) {
        return defaults;
      }
    } catch {
      continue;
    }
  }

  return defaults;
}

async function fetchDocumentElements(
  context: OnshapeContext,
  accessToken: string,
): Promise<OnshapeElement[]> {
  return onshapeFetchJson<OnshapeElement[]>(
    `/v10/documents/d/${context.documentId}/${context.wvm}/${context.wvmId}/elements`,
    accessToken,
    context.server,
  );
}

async function onshapeFetchJson<T>(
  path: string,
  accessToken: string,
  server?: string,
) {
  const response = await fetch(`${apiBaseUrlForServer(server)}${path}`, {
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

async function onshapePostJson<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
  server?: string,
) {
  const response = await fetch(`${apiBaseUrlForServer(server)}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json;charset=UTF-8; qs=0.09",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json;charset=UTF-8; qs=0.09",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Onshape API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

async function onshapeFetchBytes(
  path: string,
  accessToken: string,
  server?: string,
) {
  const response = await fetch(`${apiBaseUrlForServer(server)}${path}`, {
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Onshape API request failed (${response.status}): ${text}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function isDrawingElement(element: OnshapeElement) {
  const markers = [
    element.elementType,
    element.type,
    element.applicationElementType,
    element.mimeType,
  ]
    .map((value) => normalizeString(value).toUpperCase())
    .filter(Boolean);

  return markers.some(
    (value) => value.includes("DRAWING") || value.includes("APPLICATION"),
  );
}

function onshapeElementUrl(context: OnshapeContext, elementId: string) {
  const server = context.server || "https://cad.onshape.com";
  return `${server}/documents/${context.documentId}/${context.wvm}/${context.wvmId}/e/${elementId}`;
}

function collectStringValues(value: unknown, results = new Set<string>()) {
  if (typeof value === "string") {
    const text = normalizeString(value);
    if (text) {
      results.add(text);
    }

    return results;
  }

  if (typeof value === "number") {
    results.add(String(value));
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, results);
    }

    return results;
  }

  const record = asRecord(value);
  if (!record) {
    return results;
  }

  for (const item of Object.values(record)) {
    collectStringValues(item, results);
  }

  return results;
}

function collectStringValuesByKeys(
  value: unknown,
  keys: Set<string>,
  results = new Set<string>(),
) {
  if (typeof value === "string") {
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValuesByKeys(item, keys, results);
    }

    return results;
  }

  const record = asRecord(value);
  if (!record) {
    return results;
  }

  for (const [key, item] of Object.entries(record)) {
    const normalizedKey = normalizedPropertyKey(key);
    if (keys.has(normalizedKey)) {
      collectStringValues(item, results);
    }

    collectStringValuesByKeys(item, keys, results);
  }

  return results;
}

function stringReferencesPartId(value: string, partId: string) {
  const normalizedValue = normalizeString(value);
  const normalizedPartId = normalizeString(partId);
  if (!normalizedValue || !normalizedPartId) {
    return false;
  }

  return (
    normalizedValue === normalizedPartId ||
    normalizedValue.includes(`/p/${normalizedPartId}`) ||
    normalizedValue.includes(`partId=${normalizedPartId}`) ||
    normalizedValue.includes(`partid=${normalizedPartId}`) ||
    normalizedValue.includes(encodeURIComponent(normalizedPartId))
  );
}

function decodedReferenceStrings(value: string) {
  const normalizedValue = normalizeString(value);
  if (!normalizedValue) {
    return [];
  }

  try {
    const decodedValue = decodeURIComponent(normalizedValue);
    return decodedValue === normalizedValue
      ? [normalizedValue]
      : [normalizedValue, decodedValue];
  } catch {
    return [normalizedValue];
  }
}

function collectPartIdsFromReference(
  value: string | number,
  results: Set<string>,
  allowPlainPartId: boolean,
) {
  const strings = decodedReferenceStrings(String(value));
  let foundStructuredReference = false;

  for (const item of strings) {
    for (const match of item.matchAll(/\/p\/([^/?&#]+)/gi)) {
      const partId = normalizeString(match[1]);
      if (partId) {
        foundStructuredReference = true;
        results.add(partId);
      }
    }

    for (const match of item.matchAll(/(?:^|[?&#])partid=([^&#]+)/gi)) {
      const partId = normalizeString(match[1]);
      if (partId) {
        foundStructuredReference = true;
        results.add(partId);
      }
    }
  }

  if (allowPlainPartId && !foundStructuredReference) {
    const plainValue = normalizeString(String(value));
    if (plainValue) {
      results.add(plainValue);
    }
  }
}

const directDrawingPartIdKeys = new Set([
  "idtag",
  "idtags",
  "modelpartid",
  "partid",
  "partids",
  "referencepartid",
  "sourcepartid",
  "sourcepartids",
  "targetpartid",
  "targetpartids",
]);

const modelReferenceKeys = new Set([
  "modelreference",
  "modelreferenceid",
  "modelreferenceids",
  "modelreferences",
  "modelurl",
  "modelurls",
  "reference",
  "referenceid",
  "referenceids",
  "references",
  "source",
  "sourceid",
  "sourceids",
  "sourceurl",
  "sourceurls",
]);

function collectDrawingReferencedPartIds(
  value: unknown,
  results = new Set<string>(),
  mode: "generic" | "directPartId" | "modelReference" = "generic",
) {
  if (typeof value === "string" || typeof value === "number") {
    collectPartIdsFromReference(value, results, mode === "directPartId");
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectDrawingReferencedPartIds(item, results, mode);
    }

    return results;
  }

  const record = asRecord(value);
  if (!record) {
    return results;
  }

  for (const [key, item] of Object.entries(record)) {
    const normalizedKey = normalizedPropertyKey(key);
    const childMode =
      mode === "directPartId"
        ? mode
        : directDrawingPartIdKeys.has(normalizedKey)
          ? "directPartId"
          : modelReferenceKeys.has(normalizedKey)
            ? "modelReference"
            : "generic";
    collectDrawingReferencedPartIds(item, results, childMode);
  }

  return results;
}

function collectDrawingModelReferenceIds(value: unknown) {
  return collectStringValuesByKeys(
    value,
    new Set(["modelreferenceid", "modelreferenceids"]),
  );
}

async function fetchAppElementReference(input: {
  accessToken: string;
  context: OnshapeContext;
  drawingElementId: string;
  referenceId: string;
}) {
  return onshapeFetchJson<unknown>(
    `/v6/appelements/d/${input.context.documentId}/${input.context.wvm}/${input.context.wvmId}/e/${input.drawingElementId}/references/${encodeURIComponent(input.referenceId)}`,
    input.accessToken,
    input.context.server,
  );
}

async function collectDrawingReferencedPartIdsWithResolvedReferences(input: {
  accessToken: string;
  context: OnshapeContext;
  drawingElementId: string;
  views: unknown;
}) {
  const partIds = collectDrawingReferencedPartIds(input.views);
  const referenceIds = collectDrawingModelReferenceIds(input.views);

  await Promise.all(
    Array.from(referenceIds).map(async (referenceId) => {
      try {
        const reference = await fetchAppElementReference({
          accessToken: input.accessToken,
          context: input.context,
          drawingElementId: input.drawingElementId,
          referenceId,
        });
        collectDrawingReferencedPartIds(reference, partIds);
      } catch {
        // Unresolvable references are treated as unknown, not as a match.
      }
    }),
  );

  return {
    modelReferenceCount: referenceIds.size,
    partIds,
  };
}

function drawingViewsReferenceMatch(input: {
  referencedPartIds: Set<string>;
  partId: string;
}) {
  const partIds = input.referencedPartIds;
  if (input.partId && partIds.size > 0) {
    const referencesSelectedPart = Array.from(partIds).some((value) =>
      stringReferencesPartId(value, input.partId),
    );

    return {
      onlySelectedPart: partIds.size === 1 && referencesSelectedPart,
      referencesSelectedPart,
    };
  }

  return {
    onlySelectedPart: false,
    referencesSelectedPart: false,
  };
}

function drawingViewsNameReferenceMatch(input: {
  views: unknown;
  partName: string;
  partNumber: string;
}) {
  const selectedNames = [input.partName, input.partNumber]
    .map((value) => normalizedComparable(value))
    .filter(Boolean);
  const partNames = collectStringValuesByKeys(
    input.views,
    new Set([
      "partname",
      "partnames",
      "modelname",
      "modelnames",
      "referencename",
      "referencenames",
      "sourcepartname",
    ]),
  );
  const normalizedPartNames = new Set(
    Array.from(partNames).map((name) => normalizedComparable(name)),
  );
  if (selectedNames.length === 0 || normalizedPartNames.size === 0) {
    return {
      onlySelectedPart: false,
      referencesSelectedPart: false,
    };
  }

  const referencesSelectedPart = selectedNames.some((name) =>
    normalizedPartNames.has(name),
  );

  return {
    onlySelectedPart:
      normalizedPartNames.size === 1 && referencesSelectedPart,
    referencesSelectedPart,
  };
}

async function fetchDrawingViews(
  context: OnshapeContext,
  accessToken: string,
  drawingElementId: string,
) {
  return onshapeFetchJson<unknown>(
    `/v8/drawings/d/${context.documentId}/${context.wvm}/${context.wvmId}/e/${drawingElementId}/views`,
    accessToken,
    context.server,
  );
}

async function findSinglePartDrawing(input: {
  accessToken: string;
  context: OnshapeContext;
  partId: string;
  partName: string;
  partNumber: string;
}) {
  let elements: OnshapeElement[];
  try {
    elements = await fetchDocumentElements(input.context, input.accessToken);
  } catch {
    return null;
  }

  const drawings = elements.filter(isDrawingElement);
  for (const drawing of drawings) {
    const drawingElementId = normalizeString(drawing.id);
    if (!drawingElementId) {
      continue;
    }

    try {
      const views = await fetchDrawingViews(
        input.context,
        input.accessToken,
        drawingElementId,
      );
      const referencedParts =
        await collectDrawingReferencedPartIdsWithResolvedReferences({
          accessToken: input.accessToken,
          context: input.context,
          drawingElementId,
          views,
        });
      const viewMatch = drawingViewsReferenceMatch({
        referencedPartIds: referencedParts.partIds,
        partId: input.partId,
      });
      const nameMatch = drawingViewsNameReferenceMatch({
        views,
        partName: input.partName,
        partNumber: input.partNumber,
      });
      if (
        viewMatch.onlySelectedPart ||
        (referencedParts.partIds.size === 0 &&
          referencedParts.modelReferenceCount === 0 &&
          nameMatch.onlySelectedPart)
      ) {
        return drawing;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function firstTranslationResultId(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstTranslationResultId(item);
      if (found) {
        return found;
      }
    }
  }

  const record = asRecord(value);
  if (record) {
    for (const item of Object.values(record)) {
      const found = firstTranslationResultId(item);
      if (found) {
        return found;
      }
    }
  }

  return "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTranslation(
  translationId: string,
  accessToken: string,
  server?: string,
  label = "Onshape drawing export",
): Promise<OnshapeTranslationResponse> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const translation = await onshapeFetchJson<OnshapeTranslationResponse>(
      `/v9/translations/${translationId}`,
      accessToken,
      server,
    );
    const state = normalizeString(translation.requestState).toUpperCase();

    if (state === "DONE") {
      return translation;
    }

    if (state === "FAILED") {
      throw new Error(
        translation.failureReason || `${label} failed.`,
      );
    }

    await sleep(400 * (attempt + 1));
  }

  throw new Error(`${label} did not finish in time.`);
}

async function exportDrawingFile(input: {
  accessToken: string;
  documentId: string;
  wvm: string;
  wvmId: string;
  drawingElementId: string;
  formatName: "PDF" | "DXF";
  label: string;
  server?: string;
}) {
  const translationPath = `/v6/drawings/d/${input.documentId}/${input.wvm}/${input.wvmId}/e/${input.drawingElementId}/translations`;
  const translationUrl = `${apiBaseUrlForServer(input.server)}${translationPath}`;
  const formatName = await drawingTranslationFormatName(input);
  let translation: OnshapeTranslationResponse;
  try {
    translation = await onshapePostJson<OnshapeTranslationResponse>(
      translationPath,
      input.accessToken,
      {
        formatName,
        storeInDocument: false,
        translate: true,
      },
      input.server,
    );
  } catch (error) {
    throw new Error(
      `${input.label} could not start at ${translationUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const translationId = normalizeString(translation.id || translation.requestId);
  if (!translationId) {
    throw new Error(`${input.label} did not return a translation id.`);
  }

  let finished: OnshapeTranslationResponse;
  try {
    finished = await waitForTranslation(
      translationId,
      input.accessToken,
      input.server,
      input.label,
    );
  } catch (error) {
    throw new Error(
      `${input.label} translation ${translationId} could not finish: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const resultDocumentId =
    normalizeString(finished.resultDocumentId) ||
    normalizeString(finished.documentId) ||
    input.documentId;
  const resultWorkspaceId =
    normalizeString(finished.resultWorkspaceId) ||
    normalizeString(finished.workspaceId) ||
    (input.wvm === "w" ? input.wvmId : "");
  const blobWvm = resultWorkspaceId ? "w" : input.wvm;
  const blobWvmId = resultWorkspaceId || input.wvmId;
  const resultIds = [
    firstTranslationResultId(translation.resultElementIds),
    firstTranslationResultId(translation.resultExternalDataIds),
    firstTranslationResultId(finished.resultElementIds),
    firstTranslationResultId(finished.resultExternalDataIds),
  ].filter(Boolean);
  const errors: string[] = [];

  if (resultIds.length === 0) {
    throw new Error(
      `${input.label} translation ${translationId} finished but returned no result file IDs.`,
    );
  }

  for (const resultId of resultIds) {
    const candidatePaths = [
      `/v6/blobelements/d/${resultDocumentId}/${blobWvm}/${blobWvmId}/e/${resultId}`,
      `/v6/blobelements/d/${input.documentId}/${input.wvm}/${input.wvmId}/e/${resultId}`,
      `/v6/drawings/d/${input.documentId}/externaldata/${resultId}`,
      `/v6/documents/d/${resultDocumentId}/externaldata/${resultId}`,
      `/v6/documents/d/${input.documentId}/externaldata/${resultId}`,
    ];

    for (const path of Array.from(new Set(candidatePaths))) {
      try {
        return await onshapeFetchBytes(path, input.accessToken, input.server);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  throw new Error(
    `${input.label} result could not be downloaded. First error: ${
      errors[0] || "No download response was attempted."
    }`,
  );
}

async function drawingTranslationFormatName(input: {
  accessToken: string;
  documentId: string;
  wvm: string;
  wvmId: string;
  drawingElementId: string;
  formatName: "PDF" | "DXF";
  server?: string;
}) {
  const desiredFormat = input.formatName.toLowerCase();

  try {
    const formats = await onshapeFetchJson<OnshapeTranslationFormat[]>(
      `/v6/drawings/d/${input.documentId}/${input.wvm}/${input.wvmId}/e/${input.drawingElementId}/translationformats`,
      input.accessToken,
      input.server,
    );
    const validFormats = formats.filter(
      (format) => format.validDestinationFormat !== false,
    );
    const exactName = validFormats.find(
      (format) => normalizeString(format.name).toLowerCase() === desiredFormat,
    );
    if (exactName?.name) {
      return exactName.name;
    }

    const exactTranslator = validFormats.find(
      (format) =>
        normalizeString(format.translatorName).toLowerCase() === desiredFormat,
    );
    if (exactTranslator?.name) {
      return exactTranslator.name;
    }

    const containingName = validFormats.find((format) =>
      normalizeString(format.name).toLowerCase().includes(desiredFormat),
    );
    if (containingName?.name) {
      return containingName.name;
    }
  } catch {
    return input.formatName;
  }

  return input.formatName;
}

async function exportDrawingPdf(input: {
  accessToken: string;
  documentId: string;
  wvm: string;
  wvmId: string;
  drawingElementId: string;
  server?: string;
}) {
  return exportDrawingFile({
    ...input,
    formatName: "PDF",
    label: "Onshape drawing PDF export",
  });
}

async function exportDrawingDxf(input: {
  accessToken: string;
  documentId: string;
  wvm: string;
  wvmId: string;
  drawingElementId: string;
  server?: string;
}) {
  return exportDrawingFile({
    ...input,
    formatName: "DXF",
    label: "Onshape drawing DXF export",
  });
}

export async function createOnshapeDrawingPdfAttachment(
  input: SubmissionInput,
  requestUrl: string,
  accessTokenOverride = "",
): Promise<AttachmentRef | null> {
  const drawingUrlContext = onshapeElementContextFromUrl(input.onshapeDrawingUrl);
  const drawingElementId =
    normalizeString(drawingUrlContext?.elementId) ||
    normalizeString(input.onshapeDrawingElementId);
  const documentId =
    normalizeString(drawingUrlContext?.documentId) ||
    normalizeString(input.onshapeDocumentId);
  const wvm =
    normalizeString(drawingUrlContext?.wvm) || normalizeString(input.onshapeWvm);
  const wvmId =
    normalizeString(drawingUrlContext?.wvmId) || normalizeString(input.onshapeWvmId);
  const server =
    normalizeOnshapeServer(drawingUrlContext?.server) ||
    normalizeOnshapeServer(input.onshapeServer);

  if (!drawingElementId || !documentId || !wvm || !wvmId) {
    return null;
  }

  const accessToken =
    normalizeString(accessTokenOverride) || (await getOnshapeAccessToken());
  if (!accessToken) {
    return null;
  }

  const bytes = await exportDrawingPdf({
    accessToken,
    documentId,
    wvm,
    wvmId,
    drawingElementId,
    server: server || undefined,
  });
  const filenameBase =
    normalizeString(input.partNumber) ||
    normalizeString(input.partName) ||
    "onshape-drawing";

  return saveGeneratedFile({
    bytes,
    contentType: "application/pdf",
    filename: `${filenameBase}.pdf`,
    kind: "drawing",
    requestUrl,
  });
}

export async function createOnshapeDrawingDxfAttachment(
  input: SubmissionInput,
  requestUrl: string,
  accessTokenOverride = "",
): Promise<AttachmentRef | null> {
  const drawingUrlContext = onshapeElementContextFromUrl(input.onshapeDrawingUrl);
  const drawingElementId =
    normalizeString(drawingUrlContext?.elementId) ||
    normalizeString(input.onshapeDrawingElementId);
  const documentId =
    normalizeString(drawingUrlContext?.documentId) ||
    normalizeString(input.onshapeDocumentId);
  const wvm =
    normalizeString(drawingUrlContext?.wvm) || normalizeString(input.onshapeWvm);
  const wvmId =
    normalizeString(drawingUrlContext?.wvmId) || normalizeString(input.onshapeWvmId);
  const server =
    normalizeOnshapeServer(drawingUrlContext?.server) ||
    normalizeOnshapeServer(input.onshapeServer);

  if (!drawingElementId || !documentId || !wvm || !wvmId) {
    return null;
  }

  const accessToken =
    normalizeString(accessTokenOverride) || (await getOnshapeAccessToken());
  if (!accessToken) {
    return null;
  }

  const bytes = await exportDrawingDxf({
    accessToken,
    documentId,
    wvm,
    wvmId,
    drawingElementId,
    server: server || undefined,
  });
  const filenameBase =
    normalizeString(input.partNumber) ||
    normalizeString(input.partName) ||
    "onshape-drawing";

  return saveGeneratedFile({
    bytes,
    contentType: "application/dxf",
    filename: `${filenameBase}.dxf`,
    kind: "dxf",
    requestUrl,
  });
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
    notes:
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
  options: OnshapeMetadataOptions = {},
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

  const accessToken =
    normalizeString(options.accessToken) || (await getOnshapeAccessToken());
  if (!accessToken) {
    return {
      defaults: {},
      authUrl: onshapeOAuthStartUrl(returnTo),
      warning: "Connect Onshape to auto-fill part name, part number, material, notes, and drawings.",
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
      context.server,
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
          context.server,
        );
      } catch {
        metadata = null;
      }
    }

    const defaults = partToDefaults(part, metadata);
    defaults.partName ||= normalizeString(options.fallbackPartName);
    defaults.partNumber ||= normalizeString(options.fallbackPartNumber);

    const includeBom = options.includeBom ?? true;
    const includeDrawing = options.includeDrawing ?? true;
    const needsBom = includeBom && (!defaults.partNumber || !defaults.material);
    const drawingHasPartNumber = Boolean(defaults.partNumber);
    const bomDefaultsPromise: Promise<
      Pick<SubmissionInput, "material" | "partNumber">
    > = needsBom
      ? fetchBomDefaults({
          accessToken,
          context,
          part,
          partName: defaults.partName ?? "",
        })
      : Promise.resolve({});
    const drawingPromise: Promise<OnshapeElement | null> | null =
      includeDrawing && drawingHasPartNumber
        ? findSinglePartDrawing({
            accessToken,
            context,
            partId: context.partId || normalizeString(part?.partId),
            partName: defaults.partName ?? "",
            partNumber: defaults.partNumber ?? "",
          })
        : null;
    const bomDefaults = await bomDefaultsPromise;

    if (!defaults.partNumber && bomDefaults.partNumber) {
      defaults.partNumber = bomDefaults.partNumber;
    }

    if (!defaults.material && bomDefaults.material) {
      defaults.material = bomDefaults.material;
    }

    const drawing = drawingPromise
      ? await drawingPromise
      : includeDrawing
        ? await findSinglePartDrawing({
            accessToken,
            context,
            partId: context.partId || normalizeString(part?.partId),
            partName: defaults.partName ?? "",
            partNumber: defaults.partNumber ?? "",
          })
        : null;

    const drawingElementId = normalizeString(drawing?.id);
    if (drawingElementId) {
      defaults.onshapeDrawingElementId = drawingElementId;
      defaults.onshapeDrawingUrl = onshapeElementUrl(context, drawingElementId);
      defaults.onshapeDocumentId = context.documentId;
      defaults.onshapeServer = context.server;
      defaults.onshapeWvm = context.wvm;
      defaults.onshapeWvmId = context.wvmId;
    }

    return { defaults };
  } catch (error) {
    const warning =
      error instanceof Error ? error.message : "Onshape metadata could not be loaded.";
    const authFailed =
      warning.includes("failed (401)") ||
      warning.includes("failed (403)") ||
      warning.toLowerCase().includes("invalid") ||
      warning.toLowerCase().includes("permission");

    return {
      defaults: {},
      authUrl: authFailed ? onshapeOAuthStartUrl(returnTo) : undefined,
      warning: authFailed
        ? "Reconnect Onshape to refresh permissions for part metadata and drawing PDF export."
        : warning,
    };
  }
}
