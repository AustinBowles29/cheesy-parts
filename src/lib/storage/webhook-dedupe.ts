import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, put } from "@vercel/blob";

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

const processedMessageLimit = 1000;
const processedMessagesPath = path.join(
  defaultDataDir(),
  "processed-webhook-messages.json",
);
const blobProcessedMessagesPath = "state/processed-webhook-messages.json";

function blobStorageEnabled() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN)),
  );
}

function blobAccess(): "private" | "public" {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

async function readProcessedMessages(): Promise<string[]> {
  if (blobStorageEnabled()) {
    try {
      const blob = await get(blobProcessedMessagesPath, {
        access: blobAccess(),
        useCache: false,
      });
      if (!blob || blob.statusCode !== 200 || !blob.stream) {
        return [];
      }

      const raw = await new Response(blob.stream).text();
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  try {
    const raw = await fs.readFile(processedMessagesPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export async function markWebhookMessageProcessed(id: string) {
  if (!id) {
    return true;
  }

  const processedMessages = await readProcessedMessages();
  if (processedMessages.includes(id)) {
    return false;
  }

  const nextMessages = [id, ...processedMessages].slice(0, processedMessageLimit);
  if (blobStorageEnabled()) {
    await put(blobProcessedMessagesPath, JSON.stringify(nextMessages, null, 2), {
      access: blobAccess(),
      allowOverwrite: true,
      contentType: "application/json",
    });
    return true;
  }

  await fs.mkdir(path.dirname(processedMessagesPath), { recursive: true });
  await fs.writeFile(
    processedMessagesPath,
    JSON.stringify(nextMessages, null, 2),
    "utf8",
  );

  return true;
}
