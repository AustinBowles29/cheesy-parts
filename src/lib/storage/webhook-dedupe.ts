import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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

async function readProcessedMessages(): Promise<string[]> {
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

  await fs.mkdir(path.dirname(processedMessagesPath), { recursive: true });
  const processedMessages = await readProcessedMessages();
  if (processedMessages.includes(id)) {
    return false;
  }

  const nextMessages = [id, ...processedMessages].slice(0, processedMessageLimit);
  await fs.writeFile(
    processedMessagesPath,
    JSON.stringify(nextMessages, null, 2),
    "utf8",
  );

  return true;
}
