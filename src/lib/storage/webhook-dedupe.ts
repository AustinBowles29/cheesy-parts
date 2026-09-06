import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { head, put } from "@vercel/blob";

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

const processedMessagesPath = path.join(
  defaultDataDir(),
  "processed-webhook-messages",
);
const blobProcessedMessagesPath = "state/processed-webhook-messages";
const inMemoryDedupeTtlMs = 10 * 60 * 1000;
const inMemoryProcessedMessages = new Map<string, number>();

function blobStorageEnabled() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN)),
  );
}

function blobAccess(): "private" | "public" {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

function markerNameForId(id: string) {
  return `${createHash("sha256").update(id).digest("hex")}.json`;
}

function blobMarkerPath(id: string) {
  return `${blobProcessedMessagesPath}/${markerNameForId(id)}`;
}

function localMarkerPath(id: string) {
  return path.join(processedMessagesPath, markerNameForId(id));
}

function markerBody(id: string) {
  return JSON.stringify(
    {
      id,
      processedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

function cleanupInMemoryProcessedMessages(now = Date.now()) {
  for (const [id, timestamp] of inMemoryProcessedMessages) {
    if (now - timestamp > inMemoryDedupeTtlMs) {
      inMemoryProcessedMessages.delete(id);
    }
  }
}

function claimInMemory(id: string) {
  const now = Date.now();
  cleanupInMemoryProcessedMessages(now);
  if (inMemoryProcessedMessages.has(id)) {
    return false;
  }

  inMemoryProcessedMessages.set(id, now);
  return true;
}

function releaseInMemory(id: string) {
  inMemoryProcessedMessages.delete(id);
}

function isAlreadyProcessedError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const status =
    Number(record.status) ||
    Number(record.statusCode) ||
    Number(record.code);
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(record.message ?? "").toLowerCase();

  return (
    status === 409 ||
    status === 412 ||
    message.includes("already exists") ||
    message.includes("precondition")
  );
}

async function markBlobMessageProcessed(id: string) {
  try {
    await put(blobMarkerPath(id), markerBody(id), {
      access: blobAccess(),
      allowOverwrite: false,
      contentType: "application/json",
    });
    return true;
  } catch (error) {
    if (isAlreadyProcessedError(error)) {
      return false;
    }

    throw error;
  }
}

async function markLocalMessageProcessed(id: string) {
  const pathname = localMarkerPath(id);
  try {
    await fs.mkdir(path.dirname(pathname), { recursive: true });
    await fs.writeFile(pathname, markerBody(id), {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return false;
    }

    throw error;
  }
}

async function blobMessageExists(id: string) {
  try {
    await head(blobMarkerPath(id));
    return true;
  } catch {
    return false;
  }
}

async function localMessageExists(id: string) {
  try {
    await fs.access(localMarkerPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function markWebhookMessageProcessed(id: string) {
  if (!id) {
    return true;
  }

  if (!claimInMemory(id)) {
    return false;
  }

  try {
    return blobStorageEnabled()
      ? markBlobMessageProcessed(id)
      : markLocalMessageProcessed(id);
  } catch (error) {
    releaseInMemory(id);
    throw error;
  }
}

// Read-only check that never claims the id. A lookup failure reads as "not
// processed" so a storage hiccup can only cause a retry, never a dropped event.
export async function hasWebhookMessageBeenProcessed(id: string) {
  if (!id) {
    return false;
  }

  cleanupInMemoryProcessedMessages();
  if (inMemoryProcessedMessages.has(id)) {
    return true;
  }

  return blobStorageEnabled() ? blobMessageExists(id) : localMessageExists(id);
}
