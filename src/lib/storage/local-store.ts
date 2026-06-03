import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ManufacturingRequest } from "../types";

function defaultDataDir() {
  if (process.env.LOCAL_DATA_DIR) {
    return path.isAbsolute(process.env.LOCAL_DATA_DIR)
      ? process.env.LOCAL_DATA_DIR
      : path.join(/* turbopackIgnore: true */ process.cwd(), process.env.LOCAL_DATA_DIR);
  }

  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), "cheesy-parts-tracker");
  }

  return path.join(process.cwd(), ".data");
}

const dataDir = defaultDataDir();
const storePath = path.join(dataDir, "requests.json");

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, "[]", "utf8");
  }
}

export async function readLocalRequests(): Promise<ManufacturingRequest[]> {
  await ensureStore();

  const raw = await fs.readFile(storePath, "utf8");
  if (!raw.trim()) {
    return [];
  }

  return JSON.parse(raw) as ManufacturingRequest[];
}

export async function writeLocalRequests(requests: ManufacturingRequest[]) {
  await ensureStore();
  const tmpPath = `${storePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(requests, null, 2), "utf8");
  await fs.rename(tmpPath, storePath);
}

export async function upsertLocalRequest(request: ManufacturingRequest) {
  const requests = await readLocalRequests();
  const index = requests.findIndex(
    (item) =>
      item.id === request.id ||
      Boolean(request.airtableId && item.airtableId === request.airtableId),
  );

  if (index >= 0) {
    requests[index] = request;
  } else {
    requests.unshift(request);
  }

  await writeLocalRequests(requests);
  return request;
}

export async function findLocalRequest(id: string) {
  const requests = await readLocalRequests();
  return (
    requests.find((request) => request.id === id || request.airtableId === id) ??
    null
  );
}
