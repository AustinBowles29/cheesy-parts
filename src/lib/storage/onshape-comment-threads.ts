import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, put } from "@vercel/blob";
import type { OnshapeCommentNotification } from "../integrations/onshape-comments";

export interface OnshapeCommentThreadRecord {
  commentId: string;
  rootCommentId: string;
  slackChannelId: string;
  slackMessageTs: string;
  authorName: string;
  authorEmail: string;
  rootAuthorName: string;
  rootAuthorEmail: string;
  documentUrl: string;
  documentName: string;
  // The text we last posted, so unchanged update events can be skipped.
  // Absent on records written before text tracking (unknown); "" is a known
  // empty comment.
  commentText?: string;
  // Set on a root record synthesized from a reply that arrived before the root
  // itself was posted. It carries the Slack anchor for threading but must not
  // be taken as proof the root comment was posted.
  placeholder?: boolean;
  updatedAt: string;
}

function defaultDataDir() {
  if (process.env.LOCAL_DATA_DIR) {
    return path.isAbsolute(process.env.LOCAL_DATA_DIR)
      ? process.env.LOCAL_DATA_DIR
      : path.join(
          /* turbopackIgnore: true */ process.cwd(),
          process.env.LOCAL_DATA_DIR,
        );
  }

  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), "cheesy-parts-tracker");
  }

  return path.join(process.cwd(), ".data");
}

const dataDir = defaultDataDir();
const localThreadStorePath = path.join(dataDir, "onshape-comment-threads.json");
const blobThreadStorePath = "state/onshape-comment-threads.json";

function blobStorageEnabled() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN)),
  );
}

function blobAccess(): "private" | "public" {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

async function readBlobThreadStore(): Promise<Record<string, OnshapeCommentThreadRecord>> {
  const blob = await get(blobThreadStorePath, {
    access: blobAccess(),
    useCache: false,
  });

  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return {};
  }

  const text = await new Response(blob.stream).text();
  return text.trim()
    ? (JSON.parse(text) as Record<string, OnshapeCommentThreadRecord>)
    : {};
}

async function writeBlobThreadStore(
  store: Record<string, OnshapeCommentThreadRecord>,
) {
  await put(blobThreadStorePath, JSON.stringify(store, null, 2), {
    access: blobAccess(),
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function readLocalThreadStore(): Promise<
  Record<string, OnshapeCommentThreadRecord>
> {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    const raw = await fs.readFile(localThreadStorePath, "utf8");
    return raw.trim()
      ? (JSON.parse(raw) as Record<string, OnshapeCommentThreadRecord>)
      : {};
  } catch {
    return {};
  }
}

async function writeLocalThreadStore(
  store: Record<string, OnshapeCommentThreadRecord>,
) {
  await fs.mkdir(dataDir, { recursive: true });
  const tmpPath = `${localThreadStorePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmpPath, localThreadStorePath);
}

async function readThreadStore() {
  return blobStorageEnabled() ? readBlobThreadStore() : readLocalThreadStore();
}

async function writeThreadStore(
  store: Record<string, OnshapeCommentThreadRecord>,
) {
  return blobStorageEnabled()
    ? writeBlobThreadStore(store)
    : writeLocalThreadStore(store);
}

// Fetch several records with a single store read.
export async function loadOnshapeCommentThreads(...commentIds: string[]) {
  const ids = commentIds.filter(Boolean);
  const found: Record<string, OnshapeCommentThreadRecord> = {};
  if (ids.length === 0) {
    return found;
  }

  const store = await readThreadStore();
  for (const id of ids) {
    const record = store[id];
    if (record) {
      found[id] = record;
    }
  }

  return found;
}

export async function saveOnshapeCommentThread(input: {
  notification: OnshapeCommentNotification;
  slackChannelId: string;
  slackMessageTs: string;
  rootThread?: OnshapeCommentThreadRecord | null;
}) {
  const commentId = input.notification.commentId;
  if (!commentId || !input.slackChannelId || !input.slackMessageTs) {
    return null;
  }

  const now = new Date().toISOString();
  const rootThread = input.rootThread ?? null;
  const rootCommentId =
    rootThread?.rootCommentId ||
    input.notification.rootCommentId ||
    input.notification.parentCommentId ||
    commentId;
  const isRootComment = commentId === rootCommentId;

  // Re-read right before writing to keep the lost-update window as small as
  // the whole-store overwrite allows.
  const store = await readThreadStore();
  const existingOwn = store[commentId];
  const existingRoot = store[rootCommentId];

  const record: OnshapeCommentThreadRecord = {
    commentId,
    rootCommentId,
    slackChannelId: rootThread?.slackChannelId || input.slackChannelId,
    slackMessageTs: rootThread?.slackMessageTs || input.slackMessageTs,
    authorName: input.notification.authorName,
    authorEmail: input.notification.authorEmail,
    rootAuthorName: rootThread?.rootAuthorName || input.notification.authorName,
    rootAuthorEmail: rootThread?.rootAuthorEmail || input.notification.authorEmail,
    documentUrl: input.notification.documentUrl || rootThread?.documentUrl || "",
    documentName:
      input.notification.documentName ||
      existingOwn?.documentName ||
      rootThread?.documentName ||
      existingRoot?.documentName ||
      "",
    // Never let an empty incoming text erase text we already know.
    commentText:
      input.notification.commentText || existingOwn?.commentText || "",
    updatedAt: now,
  };

  store[commentId] = record;

  if (isRootComment) {
    store[rootCommentId] = record;
  } else if (existingRoot) {
    // A reply refreshes the root's bookkeeping but must not touch its text or
    // its placeholder status; only the root's own save does that.
    store[rootCommentId] = {
      ...existingRoot,
      documentName: existingRoot.documentName || record.documentName,
      updatedAt: now,
    };
  } else {
    // The root has not been seen yet: synthesize a placeholder that carries the
    // Slack anchor so later replies can thread, without claiming the root was
    // posted and without copying this reply's text onto it.
    store[rootCommentId] = {
      commentId: rootCommentId,
      rootCommentId,
      slackChannelId: record.slackChannelId,
      slackMessageTs: record.slackMessageTs,
      authorName: record.rootAuthorName,
      authorEmail: record.rootAuthorEmail,
      rootAuthorName: record.rootAuthorName,
      rootAuthorEmail: record.rootAuthorEmail,
      documentUrl: record.documentUrl,
      documentName: record.documentName,
      placeholder: true,
      updatedAt: now,
    };
  }

  await writeThreadStore(store);
  return record;
}
