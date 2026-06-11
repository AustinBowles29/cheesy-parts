import { createHmac, randomBytes } from "node:crypto";
import { normalizeString } from "../manufacturing";
import { normalizeOnshapeServer } from "./onshape";

export interface OnshapeCommentNotification {
  event: string;
  messageId: string;
  timestamp: string;
  documentId: string;
  workspaceId: string;
  versionId: string;
  elementId: string;
  commentId: string;
  parentCommentId: string;
  rootCommentId: string;
  commentText: string;
  authorName: string;
  authorEmail: string;
  documentUrl: string;
  mentionCandidates: string[];
}

type JsonRecord = Record<string, unknown>;

const commentEvents = new Set([
  "onshape.comment.create",
  "onshape.comment.update",
  "onshape.comment.delete",
]);

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function parseWebhookData(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function directString(record: JsonRecord | null, keys: string[]) {
  if (!record) {
    return "";
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const normalized = normalizeString(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  return "";
}

function deepString(value: unknown, keys: string[], depth = 0): string {
  if (depth > 6) {
    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepString(item, keys, depth + 1);
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

  const direct = directString(record, keys);
  if (direct) {
    return direct;
  }

  for (const item of Object.values(record)) {
    const found = deepString(item, keys, depth + 1);
    if (found) {
      return found;
    }
  }

  return "";
}

function collectIdentityStrings(value: unknown, results: Set<string>, depth = 0) {
  if (depth > 5) {
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
    const normalized = normalizeString(value);
    if (normalized) {
      results.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectIdentityStrings(item, results, depth + 1);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  for (const key of [
    "id",
    "userId",
    "uid",
    "email",
    "emailAddress",
    "name",
    "displayName",
    "userName",
    "username",
  ]) {
    const valueForKey = record[key];
    if (typeof valueForKey === "string" || typeof valueForKey === "number") {
      const normalized = normalizeString(valueForKey);
      if (normalized) {
        results.add(normalized);
      }
    }
  }

  for (const item of Object.values(record)) {
    collectIdentityStrings(item, results, depth + 1);
  }
}

function collectMentionCandidates(value: unknown, depth = 0, keyHint = ""): string[] {
  if (depth > 6) {
    return [];
  }

  const results = new Set<string>();
  const normalizedHint = keyHint.toLowerCase();
  const shouldCollect =
    normalizedHint.includes("mention") ||
    normalizedHint.includes("tag") ||
    normalizedHint.includes("assign");

  if (shouldCollect) {
    collectIdentityStrings(value, results);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      for (const candidate of collectMentionCandidates(item, depth + 1, keyHint)) {
        results.add(candidate);
      }
    }
    return Array.from(results);
  }

  const record = asRecord(value);
  if (!record) {
    return Array.from(results);
  }

  for (const [key, item] of Object.entries(record)) {
    for (const candidate of collectMentionCandidates(item, depth + 1, key)) {
      results.add(candidate);
    }
  }

  return Array.from(results);
}

function mentionTextCandidates(text: string) {
  const candidates = new Set<string>();

  for (const match of text.matchAll(/\[~([^:\]]+):([^\]]+)\]/g)) {
    candidates.add(match[1]);
    candidates.add(match[2]);
  }

  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    candidates.add(match[0]);
  }

  for (const match of text.matchAll(/@([A-Za-z0-9._-]+(?:\s+[A-Za-z0-9._-]+)?)/g)) {
    candidates.add(match[1]);
  }

  return Array.from(candidates);
}

function eventDisplayText(event: string) {
  if (event === "onshape.comment.update") {
    return "updated";
  }

  if (event === "onshape.comment.delete") {
    return "deleted";
  }

  return "created";
}

function documentUrl(input: {
  payload: JsonRecord;
  data: unknown;
  documentId: string;
  workspaceId: string;
  versionId: string;
  elementId: string;
}) {
  const dataRecord = asRecord(input.data);
  const explicitUrl =
    directString(dataRecord, ["href", "url", "documentUrl", "documentHref"]) ||
    deepString(input.data, ["documentUrl", "documentHref"]);

  if (explicitUrl) {
    return explicitUrl;
  }

  const server =
    normalizeOnshapeServer(
      directString(input.payload, ["server", "baseUrl", "onshapeServer"]),
    ) ||
    normalizeOnshapeServer(process.env.ONSHAPE_WEBHOOK_SERVER) ||
    normalizeOnshapeServer(process.env.ONSHAPE_ENTERPRISE_URL) ||
    normalizeOnshapeServer(process.env.ONSHAPE_API_BASE_URL) ||
    "https://cad.onshape.com";

  if (!input.documentId) {
    return server;
  }

  const wvm = input.workspaceId ? "w" : input.versionId ? "v" : "";
  const wvmId = input.workspaceId || input.versionId;
  if (!wvm || !wvmId) {
    return `${server}/documents/${encodeURIComponent(input.documentId)}`;
  }

  const url = `${server}/documents/${encodeURIComponent(input.documentId)}/${wvm}/${encodeURIComponent(
    wvmId,
  )}`;
  return input.elementId ? `${url}/e/${encodeURIComponent(input.elementId)}` : url;
}

function firstString(...values: string[]) {
  return values.find((value) => normalizeString(value)) ?? "";
}

function onshapeSignedAuthHeaders(input: {
  method: string;
  url: string;
  contentType: string;
}) {
  const accessKey = normalizeString(
    process.env.ONSHAPE_API_ACCESS_KEY ?? process.env.ONSHAPE_ACCESS_KEY,
  );
  const secretKey = normalizeString(
    process.env.ONSHAPE_API_SECRET_KEY ?? process.env.ONSHAPE_SECRET_KEY,
  );
  if (!accessKey || !secretKey) {
    return null;
  }

  const nonce = randomBytes(16).toString("hex");
  const date = new Date().toUTCString();
  const parsedUrl = new URL(input.url);
  const signingString = `${input.method}\n${nonce}\n${date}\n${input.contentType}\n${parsedUrl.pathname}\n${parsedUrl.search.slice(
    1,
  )}\n`.toLowerCase();
  const signature = createHmac("sha256", secretKey)
    .update(signingString)
    .digest("base64");

  return {
    Authorization: `On ${accessKey}:HmacSHA256:${signature}`,
    Date: date,
    "On-Nonce": nonce,
  };
}

function onshapeCommentAuthHeaders(input: {
  method: string;
  url: string;
  contentType: string;
}) {
  const bearerToken = normalizeString(
    process.env.ONSHAPE_WEBHOOK_ACCESS_TOKEN ??
      process.env.ONSHAPE_SERVICE_ACCESS_TOKEN ??
      process.env.ONSHAPE_ACCESS_TOKEN,
  );
  if (bearerToken) {
    return { Authorization: `Bearer ${bearerToken}` };
  }

  const signedHeaders = onshapeSignedAuthHeaders(input);
  if (signedHeaders) {
    return signedHeaders;
  }

  const basicAuth = normalizeString(
    process.env.ONSHAPE_API_BASIC_AUTH ?? process.env.ONSHAPE_BASIC_AUTH,
  );
  if (basicAuth) {
    return { Authorization: `Basic ${basicAuth}` };
  }

  return null;
}

function serverFromNotification(notification: OnshapeCommentNotification) {
  try {
    const url = new URL(notification.documentUrl);
    const server = normalizeOnshapeServer(url.origin);
    if (server) {
      return server;
    }
  } catch {
    // Fall through to configured defaults.
  }

  return (
    normalizeOnshapeServer(process.env.ONSHAPE_WEBHOOK_SERVER) ||
    normalizeOnshapeServer(process.env.ONSHAPE_ENTERPRISE_URL) ||
    normalizeOnshapeServer(process.env.ONSHAPE_API_BASE_URL) ||
    "https://cad.onshape.com"
  );
}

function commentDetailUrls(notification: OnshapeCommentNotification) {
  const server = serverFromNotification(notification);
  const commentId = encodeURIComponent(notification.commentId);

  return [
    `${server}/api/v16/comments/${commentId}`,
    `${server}/api/comments/${commentId}`,
  ];
}

async function fetchOnshapeCommentDetails(
  notification: OnshapeCommentNotification,
) {
  if (!notification.commentId) {
    return null;
  }

  let lastError = "";
  for (const url of commentDetailUrls(notification)) {
    const method = "GET";
    const contentType = "application/json;charset=UTF-8; qs=0.09";
    const authHeaders = onshapeCommentAuthHeaders({
      method,
      url,
      contentType,
    });
    if (!authHeaders) {
      return null;
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json;charset=UTF-8; qs=0.09",
        "Content-Type": contentType,
        ...authHeaders,
      },
      cache: "no-store",
    });

    if (response.ok) {
      return (await response.json()) as unknown;
    }

    const body = await response.text();
    lastError = `Onshape comment detail request failed (${response.status}) at ${url}: ${body}`;

    if (response.status !== 404) {
      break;
    }
  }

  throw new Error(lastError || "Onshape comment detail request failed.");
}

function commentTextFromDetails(details: unknown) {
  return deepString(details, [
    "commentText",
    "plainText",
    "body",
    "text",
    "message",
    "content",
    "description",
  ]);
}

function authorBranchFromDetails(details: unknown) {
  const record = asRecord(details);
  return (
    asRecord(record?.createdBy) ??
    asRecord(record?.creator) ??
    asRecord(record?.author) ??
    asRecord(record?.user) ??
    asRecord(record?.owner)
  );
}

function authorNameFromDetails(details: unknown) {
  const authorBranch = authorBranchFromDetails(details);
  return (
    directString(authorBranch, [
      "displayName",
      "name",
      "userName",
      "username",
      "email",
    ]) ||
    deepString(details, [
      "createdByName",
      "authorName",
      "creatorName",
      "userName",
      "username",
    ])
  );
}

function authorEmailFromDetails(details: unknown) {
  const authorBranch = authorBranchFromDetails(details);
  return (
    directString(authorBranch, ["email", "emailAddress"]) ||
    deepString(details, ["createdByEmail", "authorEmail", "creatorEmail", "email"])
  );
}

function documentUrlFromDetails(
  details: unknown,
  fallback: OnshapeCommentNotification,
) {
  const explicitUrl =
    directString(asRecord(details), ["documentUrl", "documentHref"]) ||
    deepString(details, ["documentUrl", "documentHref"]);
  if (explicitUrl) {
    return explicitUrl;
  }

  return fallback.documentUrl;
}

function linkedCommentIdFromValue(
  value: unknown,
  directKeys: string[],
  branchKeys: string[],
) {
  const record = asRecord(value);
  const direct = directString(record, directKeys);
  if (direct) {
    return direct;
  }

  for (const branchKey of branchKeys) {
    const branch = asRecord(record?.[branchKey]);
    const id = directString(branch, ["commentId", "id", "cid"]);
    if (id) {
      return id;
    }
  }

  return deepString(value, directKeys);
}

function parentCommentIdFromValue(value: unknown) {
  return linkedCommentIdFromValue(
    value,
    [
      "parentCommentId",
      "parentId",
      "replyToCommentId",
      "inReplyToCommentId",
      "inReplyToId",
    ],
    ["parentComment", "parent", "replyTo", "inReplyTo"],
  );
}

function rootCommentIdFromValue(value: unknown) {
  return linkedCommentIdFromValue(
    value,
    ["rootCommentId", "threadRootCommentId", "rootId"],
    ["rootComment", "threadRoot", "root"],
  );
}

export function isOnshapeCommentEvent(event: string) {
  return commentEvents.has(event);
}

export function onshapeCommentNotificationFromPayload(
  payload: unknown,
): OnshapeCommentNotification | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const event = directString(record, ["event", "eventType", "type"]);
  if (!isOnshapeCommentEvent(event)) {
    return null;
  }

  const data = parseWebhookData(record.data);
  const dataRecord = asRecord(data);
  const documentId =
    directString(record, ["documentId", "did"]) ||
    directString(dataRecord, ["documentId", "did"]);
  const workspaceId =
    directString(record, ["workspaceId", "workspace", "wid"]) ||
    directString(dataRecord, ["workspaceId", "workspace", "wid"]);
  const versionId =
    directString(record, ["versionId", "version", "vid"]) ||
    directString(dataRecord, ["versionId", "version", "vid"]);
  const elementId =
    directString(record, ["elementId", "eid"]) ||
    directString(dataRecord, ["elementId", "eid"]);
  const commentId =
    directString(dataRecord, ["commentId", "cid", "id"]) ||
    directString(record, ["commentId", "cid"]);
  const parentCommentId =
    parentCommentIdFromValue(data) || parentCommentIdFromValue(record);
  const rootCommentId =
    rootCommentIdFromValue(data) || rootCommentIdFromValue(record);
  const commentText =
    deepString(data, [
      "commentText",
      "plainText",
      "body",
      "text",
      "message",
      "content",
      "description",
    ]) || (typeof data === "string" ? data : "");
  const authorBranch =
    asRecord(dataRecord?.createdBy) ??
    asRecord(dataRecord?.creator) ??
    asRecord(dataRecord?.author) ??
    asRecord(dataRecord?.user);
  const authorName =
    directString(authorBranch, ["displayName", "name", "userName", "username"]) ||
    deepString(data, ["createdByName", "authorName", "userName"]);
  const authorEmail =
    directString(authorBranch, ["email", "emailAddress"]) ||
    deepString(data, ["createdByEmail", "authorEmail", "email"]);
  const mentionCandidates = Array.from(
    new Set([
      ...collectMentionCandidates(data),
      ...mentionTextCandidates(commentText),
    ]),
  );

  return {
    event,
    messageId: directString(record, ["messageId", "webhookMessageId", "id"]),
    timestamp: directString(record, ["timestamp", "createdAt", "createdTime"]),
    documentId,
    workspaceId,
    versionId,
    elementId,
    commentId,
    parentCommentId,
    rootCommentId,
    commentText,
    authorName,
    authorEmail,
    documentUrl: documentUrl({
      payload: record,
      data,
      documentId,
      workspaceId,
      versionId,
      elementId,
    }),
    mentionCandidates,
  };
}

export function onshapeCommentActionLabel(event: string) {
  return eventDisplayText(event);
}

export async function enrichOnshapeCommentNotification(
  notification: OnshapeCommentNotification,
): Promise<OnshapeCommentNotification> {
  const details = await fetchOnshapeCommentDetails(notification);
  if (!details) {
    return notification;
  }

  const commentText = firstString(
    notification.commentText,
    commentTextFromDetails(details),
  );
  const mentionCandidates = Array.from(
    new Set([
      ...notification.mentionCandidates,
      ...collectMentionCandidates(details),
      ...mentionTextCandidates(commentText),
    ]),
  );

  return {
    ...notification,
    commentText,
    parentCommentId: firstString(
      notification.parentCommentId,
      parentCommentIdFromValue(details),
    ),
    rootCommentId: firstString(
      notification.rootCommentId,
      rootCommentIdFromValue(details),
    ),
    authorName: firstString(notification.authorName, authorNameFromDetails(details)),
    authorEmail: firstString(
      notification.authorEmail,
      authorEmailFromDetails(details),
    ),
    documentUrl: documentUrlFromDetails(details, notification),
    mentionCandidates,
  };
}
