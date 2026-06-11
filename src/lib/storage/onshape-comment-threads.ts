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

export async function findOnshapeCommentThread(...commentIds: string[]) {
  const ids = commentIds.filter(Boolean);
  if (ids.length === 0) {
    return null;
  }

  const store = await readThreadStore();
  for (const id of ids) {
    const record = store[id];
    if (record) {
      return record;
    }
  }

  return null;
}

export async function saveOnshapeCommentThread(input: {
  notification: OnshapeCommentNotification;
  slackChannelId: string;
  slackMessageTs: string;
  rootThread?: OnshapeCommentThreadRecord | null;
}) {
  if (!input.notification.commentId || !input.slackChannelId || !input.slackMessageTs) {
    return null;
  }

  const now = new Date().toISOString();
  const rootThread = input.rootThread ?? null;
  const rootCommentId =
    rootThread?.rootCommentId ||
    input.notification.rootCommentId ||
    input.notification.parentCommentId ||
    input.notification.commentId;

  const record: OnshapeCommentThreadRecord = {
    commentId: input.notification.commentId,
    rootCommentId,
    slackChannelId: rootThread?.slackChannelId || input.slackChannelId,
    slackMessageTs: rootThread?.slackMessageTs || input.slackMessageTs,
    authorName: input.notification.authorName,
    authorEmail: input.notification.authorEmail,
    rootAuthorName: rootThread?.rootAuthorName || input.notification.authorName,
    rootAuthorEmail: rootThread?.rootAuthorEmail || input.notification.authorEmail,
    documentUrl: input.notification.documentUrl || rootThread?.documentUrl || "",
    updatedAt: now,
  };

  const store = await readThreadStore();
  store[input.notification.commentId] = record;
  store[rootCommentId] = {
    ...record,
    commentId: rootCommentId,
    authorName: rootThread?.rootAuthorName || record.rootAuthorName,
    authorEmail: rootThread?.rootAuthorEmail || record.rootAuthorEmail,
  };

  await writeThreadStore(store);
  return record;
}
