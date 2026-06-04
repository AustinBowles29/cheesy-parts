import { listAirtableWebhookPayloads } from "@/lib/integrations/airtable";
import { normalizeString } from "@/lib/manufacturing";
import { syncAirtableStatusChange } from "@/lib/service";
import {
  readAirtableWebhookCursor,
  writeAirtableWebhookCursor,
} from "@/lib/storage/local-store";

export const runtime = "nodejs";

interface AirtableStatusChange {
  recordId: string;
  oldStatus?: string;
  newStatus?: string;
  changedBy?: string;
  changedBySlackId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function stringField(
  value: unknown,
  names: string[],
  fallback = "",
): string {
  const record = asRecord(value);
  if (!record) {
    return fallback;
  }

  for (const name of names) {
    const found = normalizeString(record[name]);
    if (found) {
      return found;
    }
  }

  return fallback;
}

function nestedString(value: unknown, path: string[]): string {
  let current = value;
  for (const key of path) {
    current = asRecord(current)?.[key];
  }

  return normalizeString(current);
}

function collectRecordIds(value: unknown, recordIds = new Set<string>()) {
  if (typeof value === "string" && /^rec[A-Za-z0-9]+$/.test(value)) {
    recordIds.add(value);
    return recordIds;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRecordIds(item, recordIds);
    }

    return recordIds;
  }

  const record = asRecord(value);
  if (!record) {
    return recordIds;
  }

  for (const item of Object.values(record)) {
    collectRecordIds(item, recordIds);
  }

  return recordIds;
}

function statusChangeFromRecord(value: unknown): AirtableStatusChange | null {
  const rawRecordId =
    stringField(value, ["recordId", "airtableId", "id"]) ||
    nestedString(value, ["record", "id"]);
  const recordId = /^rec[A-Za-z0-9]+$/.test(rawRecordId) ? rawRecordId : "";

  if (!recordId) {
    return null;
  }

  return {
    recordId,
    oldStatus: stringField(value, [
      "oldStatus",
      "previousStatus",
      "fromStatus",
      "old_status",
    ]),
    newStatus: stringField(value, [
      "newStatus",
      "status",
      "toStatus",
      "new_status",
    ]),
    changedBy: stringField(value, [
      "changedBy",
      "changedByName",
      "actor",
      "user",
    ]),
    changedBySlackId: stringField(value, [
      "changedBySlackId",
      "slackUserId",
      "actorSlackId",
    ]),
  };
}

function directStatusChanges(body: unknown): AirtableStatusChange[] {
  const record = asRecord(body);
  const direct = statusChangeFromRecord(body);
  const changes = direct ? [direct] : [];
  const records = record?.records;

  if (Array.isArray(records)) {
    for (const item of records) {
      const change = statusChangeFromRecord(item);
      if (change) {
        changes.push(change);
      }
    }
  }

  const seen = new Set<string>();
  return changes.filter((change) => {
    if (seen.has(change.recordId)) {
      return false;
    }

    seen.add(change.recordId);
    return true;
  });
}

function webhookIdFromBody(body: unknown): string {
  return (
    stringField(body, ["webhookId", "webhook_id"]) ||
    nestedString(body, ["webhook", "id"]) ||
    process.env.AIRTABLE_WEBHOOK_ID ||
    ""
  );
}

function cursorFromBody(body: unknown): string {
  return (
    stringField(body, ["cursor"]) ||
    nestedString(body, ["payload", "cursor"]) ||
    ""
  );
}

async function recordIdsFromAirtableWebhook(body: unknown) {
  const webhookId = webhookIdFromBody(body);
  if (!webhookId) {
    return new Set<string>();
  }

  let cursor = cursorFromBody(body) || (await readAirtableWebhookCursor(webhookId));
  const recordIds = new Set<string>();

  for (let page = 0; page < 5; page += 1) {
    const response = await listAirtableWebhookPayloads(webhookId, cursor);
    for (const payload of response.payloads ?? []) {
      collectRecordIds(payload, recordIds);
    }

    if (response.cursor !== undefined) {
      cursor = String(response.cursor);
      await writeAirtableWebhookCursor(webhookId, cursor);
    }

    if (!response.mightHaveMore) {
      break;
    }
  }

  return recordIds;
}

function webhookSecretMatches(req: Request) {
  const expected = process.env.AIRTABLE_WEBHOOK_SECRET;
  if (!expected) {
    return true;
  }

  const url = new URL(req.url);
  const provided =
    url.searchParams.get("secret") ??
    req.headers.get("x-airtable-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return provided === expected;
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "/api/airtable/webhook" });
}

export async function POST(req: Request) {
  if (!webhookSecretMatches(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const warnings: string[] = [];
  const directChanges = directStatusChanges(body);
  const changes =
    directChanges.length > 0
      ? directChanges
      : Array.from(await recordIdsFromAirtableWebhook(body)).map((recordId) => ({
          recordId,
        }));
  const results = [];

  for (const change of changes) {
    try {
      const result = await syncAirtableStatusChange(change);
      results.push({
        recordId: change.recordId,
        status: result.data.status,
        notified: result.notified,
      });
      warnings.push(...result.warnings);
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Airtable webhook record ${change.recordId} failed: ${error.message}`
          : `Airtable webhook record ${change.recordId} failed.`,
      );
    }
  }

  return Response.json({
    ok: true,
    processed: results.length,
    notified: results.filter((result) => result.notified).length,
    results,
    warnings,
  });
}
