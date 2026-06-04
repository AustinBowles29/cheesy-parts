import {
  coerceCategory,
  coerceFinish,
  coerceMachineType,
  coerceStatus,
  normalizeQuantity,
  normalizeString,
} from "../manufacturing";
import { CATEGORIES } from "../constants";
import type {
  AttachmentRef,
  AuditEntry,
  ManufacturingRequest,
  SubmissionFieldOptions,
} from "../types";

interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

interface AirtableListResponse {
  records: AirtableRecord[];
  offset?: string;
}

interface AirtableSchemaChoice {
  name?: string;
}

interface AirtableFieldSchema {
  id: string;
  name: string;
  type: string;
  options?: {
    choices?: AirtableSchemaChoice[];
  };
}

interface AirtableTableSchema {
  id: string;
  name: string;
  fields: AirtableFieldSchema[];
}

interface AirtableBaseSchemaResponse {
  tables: AirtableTableSchema[];
}

interface AirtableWebhookPayloadsResponse {
  payloads?: unknown[];
  cursor?: string | number;
  mightHaveMore?: boolean;
}

interface AirtableTableTarget {
  value: string;
  airtableTableId?: string;
  airtableTableName?: string;
}

interface AirtableTableHint {
  airtableTableId?: string;
  airtableTableName?: string;
  tableId?: string;
  tableName?: string;
  category?: unknown;
}

const apiBase = "https://api.airtable.com/v0";

function token() {
  return (
    process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN ?? process.env.AIRTABLE_API_KEY
  );
}

function baseId() {
  return process.env.AIRTABLE_BASE_ID;
}

function tableIdOrName() {
  return process.env.AIRTABLE_TABLE_ID ?? process.env.AIRTABLE_TABLE_NAME;
}

function splitEnvList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function categoryEnvKey(category: string) {
  return `AIRTABLE_TABLE_${category.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

function envKeySuffix(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

function categoryTableMap() {
  const map = new Map<string, string>();
  const rawJson = process.env.AIRTABLE_CATEGORY_TABLE_MAP;

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      for (const [category, table] of Object.entries(parsed)) {
        const tableValue = normalizeString(table);
        if (tableValue) {
          map.set(category, tableValue);
        }
      }
    } catch {
      // Invalid JSON should not block the default table fallback.
    }
  }

  for (const category of CATEGORIES) {
    const table = normalizeString(process.env[categoryEnvKey(category)]);
    if (table) {
      map.set(category, table);
    }
  }

  return map;
}

function tableTargetFromValue(value?: string): AirtableTableTarget | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  if (/^tbl[A-Za-z0-9]+$/.test(normalized)) {
    return { value: normalized, airtableTableId: normalized };
  }

  return { value: normalized, airtableTableName: normalized };
}

export function resolveAirtableTableTarget(
  hint: AirtableTableHint = {},
): AirtableTableTarget | undefined {
  return (
    tableTargetFromValue(hint.airtableTableId ?? hint.tableId) ??
    tableTargetFromValue(hint.airtableTableName ?? hint.tableName) ??
    tableTargetFromValue(
      hint.category ? categoryTableMap().get(coerceCategory(hint.category)) : "",
    ) ??
    tableTargetFromValue(tableIdOrName())
  );
}

function configuredTableTargets() {
  const values = [
    tableIdOrName(),
    ...splitEnvList(process.env.AIRTABLE_TABLES),
    ...splitEnvList(process.env.AIRTABLE_TABLE_NAMES),
    ...Array.from(categoryTableMap().values()),
  ];
  const seen = new Set<string>();
  const targets: AirtableTableTarget[] = [];

  for (const value of values) {
    const target = tableTargetFromValue(value);
    if (!target || seen.has(target.value)) {
      continue;
    }

    seen.add(target.value);
    targets.push(target);
  }

  return targets;
}

function queueViewForTarget(target: AirtableTableTarget) {
  return (
    normalizeString(process.env[`AIRTABLE_QUEUE_VIEW_${envKeySuffix(target.value)}`]) ||
    normalizeString(process.env.AIRTABLE_QUEUE_VIEW) ||
    normalizeString(process.env.AIRTABLE_VIEW) ||
    ""
  );
}

export function isAirtableConfigured() {
  return Boolean(token() && baseId() && configuredTableTargets().length > 0);
}

function isAirtableSchemaConfigured() {
  return Boolean(token() && baseId() && configuredTableTargets().length > 0);
}

function tableUrl(target = resolveAirtableTableTarget()) {
  const base = baseId();
  const table = target?.value;

  if (!base || !table) {
    throw new Error("Airtable is not configured.");
  }

  return `${apiBase}/${base}/${encodeURIComponent(table)}`;
}

function airtableRecordUrl(recordId: string, target?: AirtableTableTarget) {
  const explicitBaseUrl = process.env.AIRTABLE_BASE_URL;
  const defaultTarget = resolveAirtableTableTarget();
  if (explicitBaseUrl && (!target || target.value === defaultTarget?.value)) {
    return `${explicitBaseUrl.replace(/\/$/, "")}/${recordId}`;
  }

  const base = baseId();
  const table = target?.value ?? defaultTarget?.value;
  if (base && table) {
    return `https://airtable.com/${base}/${encodeURIComponent(table)}/${recordId}`;
  }

  return "";
}

async function airtableFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const apiToken = token();
  if (!apiToken) {
    throw new Error("Missing Airtable token.");
  }

  const response = await fetch(url, {
    ...init,
    cache: init?.cache ?? "no-store",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Airtable request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function configuredTables(schema: AirtableBaseSchemaResponse) {
  const targets = configuredTableTargets();
  return targets
    .map((target) =>
      schema.tables.find(
        (item) => item.id === target.value || item.name === target.value,
      ),
    )
    .filter((table): table is AirtableTableSchema => Boolean(table));
}

function fieldByName(
  table: AirtableTableSchema | undefined,
  names: string[],
): AirtableFieldSchema | undefined {
  const normalizedNames = names.map((name) => name.toLowerCase());
  return table?.fields.find((field) =>
    normalizedNames.includes(field.name.toLowerCase()),
  );
}

function fieldChoices(field: AirtableFieldSchema | undefined) {
  if (
    field?.type !== "singleSelect" &&
    field?.type !== "multipleSelects" &&
    field?.type !== "singleSelects"
  ) {
    return [];
  }

  return uniqueSorted(
    (field.options?.choices ?? []).map((choice) => normalizeString(choice.name)),
  );
}

export async function getAirtableSubmissionFieldOptions(): Promise<SubmissionFieldOptions> {
  if (!isAirtableSchemaConfigured()) {
    return { subsystems: [], vendors: [], airtableTables: [] };
  }

  try {
    const base = baseId();
    const schema = await airtableFetch<AirtableBaseSchemaResponse>(
      `${apiBase}/meta/bases/${base}/tables`,
    );
    const tables = configuredTables(schema);

    if (tables.length === 0) {
      return {
        subsystems: [],
        vendors: [],
        airtableTables: [],
        warning: "Airtable tables were not found, so dropdown options were not loaded.",
      };
    }

    return {
      subsystems: uniqueSorted(
        tables.flatMap((table) =>
          fieldChoices(fieldByName(table, ["Subsystem", "Subsystems"])),
        ),
      ),
      vendors: uniqueSorted(
        tables.flatMap((table) =>
          fieldChoices(
            fieldByName(table, ["Vendor Name", "Vendor", "COTS Vendor"]),
          ),
        ),
      ),
      airtableTables: tables.map((table) => ({
        id: table.id,
        name: table.name,
      })),
    };
  } catch (error) {
    return {
      subsystems: [],
      vendors: [],
      airtableTables: [],
      warning:
        error instanceof Error
          ? `Airtable dropdown options could not be loaded: ${error.message}`
          : "Airtable dropdown options could not be loaded.",
    };
  }
}

export async function listAirtableWebhookPayloads(
  webhookId: string,
  cursor?: string,
) {
  const base = baseId();
  if (!base) {
    throw new Error("Missing Airtable base ID.");
  }

  const url = new URL(`${apiBase}/bases/${base}/webhooks/${webhookId}/payloads`);
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  return airtableFetch<AirtableWebhookPayloadsResponse>(url.toString());
}

function attachmentFields(
  attachments: AttachmentRef[],
  kind: AttachmentRef["kind"],
) {
  const items = attachments.filter((attachment) => attachment.kind === kind);
  if (items.length === 0) {
    return undefined;
  }

  return items
    .filter((attachment) => attachment.url)
    .map((attachment) => ({
      url: attachment.url,
      filename: attachment.filename,
    }));
}

function requestToFields(request: ManufacturingRequest) {
  return {
    "Part Name": request.partName,
    "Part Number": request.partNumber,
    Notes: request.notes || undefined,
    Quantity: request.quantity,
    Subsystem: request.subsystem,
    Category: request.category,
    Material: request.material,
    Thickness: request.thickness,
    Finish: request.finish,
    "Machine Type": request.machineType,
    Status: request.status,
    "Onshape Part URL": request.onshapePartUrl,
    "Onshape Drawing URL": request.onshapeDrawingUrl,
    "Assembly URL": request.assemblyUrl,
    "Branch/Version Reference": request.branchVersionReference,
    Submitter: request.submitter,
    "Submitter Slack ID": request.submitterSlackId,
    "Time Created": request.submittedAt,
    Drawing: attachmentFields(request.attachments, "drawing"),
    DXF: attachmentFields(request.attachments, "dxf"),
    "Other files": attachmentFields(request.attachments, "other"),
    "Manufacturing Notes": request.manufacturingNotes,
    Priority: request.priority,
    "Print Material": request.printMaterial,
    "Print Color": request.printColor,
    Infill: request.infill,
    "Layer Height": request.layerHeight,
    "Printer Notes": request.printerNotes,
    "Vendor Name": request.vendorName,
    "Quote Required": request.quoteRequired,
    "Lead Time": request.leadTime,
    "Vendor Notes": request.vendorNotes,
    "Audit History": JSON.stringify(request.auditHistory),
  };
}

function fieldString(fields: Record<string, unknown>, name: string) {
  const value = fields[name];

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return normalizeString(value);
}

function fieldStringFrom(fields: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = fieldString(fields, name);
    if (value) {
      return value;
    }
  }

  return "";
}

function firstTextField(
  fields: Record<string, unknown>,
  excludedNames: string[],
) {
  const excluded = new Set(excludedNames.map((name) => name.toLowerCase()));
  for (const [name, value] of Object.entries(fields)) {
    if (excluded.has(name.toLowerCase())) {
      continue;
    }

    const text = fieldString({ [name]: value }, name);
    if (text) {
      return text;
    }
  }

  return "";
}

function fieldNumberFrom(fields: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = normalizeString(fields[name]);
    if (value) {
      return normalizeQuantity(value);
    }

    if (typeof fields[name] === "number") {
      return normalizeQuantity(fields[name]);
    }
  }

  return 1;
}

function partNumberFromTitle(title: string) {
  return title.match(/\b\d{2}-[A-Z]-\d{3,5}\b/i)?.[0] ?? "";
}

export function mapAirtableRecord(
  record: AirtableRecord,
  target = resolveAirtableTableTarget(),
): ManufacturingRequest {
  const fields = record.fields;
  const partTitle =
    fieldStringFrom(fields, [
      "Part Name",
      "Description",
      "Pivot Spacer Standof",
      "Name",
    ]) ||
    firstTextField(fields, [
      "Status",
      "Subsystem",
      "Machine",
      "Raw material",
      "Material",
      "Owner",
      "Notes",
      "Post-process",
    ]) ||
    record.id;
  const partNumber =
    fieldStringFrom(fields, ["Part Number", "Part number", "Part No", "Part #"]) ||
    partNumberFromTitle(partTitle);
  const machineType =
    coerceMachineType(fields["Machine Type"]) ??
    coerceMachineType(fieldString(fields, "Machine Type")) ??
    coerceMachineType(fields.Machine) ??
    coerceMachineType(fieldString(fields, "Machine")) ??
    "Other";

  return {
    id: record.id,
    airtableId: record.id,
    airtableUrl: airtableRecordUrl(record.id, target),
    airtableTableId: target?.airtableTableId,
    airtableTableName: target?.airtableTableName,
    partName: partTitle,
    partNumber,
    notes: fieldString(fields, "Notes") || fieldString(fields, "Description"),
    quantity: fieldNumberFrom(fields, [
      "Quantity",
      "Mfg. / Order Qty",
      "Mfg./Order Qty",
      "Mfg. / Order",
      "Quantity per robot",
    ]),
    subsystem: fieldString(fields, "Subsystem"),
    category: coerceCategory(fields.Category),
    material: fieldStringFrom(fields, ["Material", "Raw material"]),
    thickness: fieldString(fields, "Thickness"),
    finish: coerceFinish(fieldStringFrom(fields, ["Finish", "Post-process"])),
    machineType,
    onshapePartUrl: fieldString(fields, "Onshape Part URL"),
    onshapeDrawingUrl: fieldString(fields, "Onshape Drawing URL"),
    assemblyUrl: fieldString(fields, "Assembly URL"),
    branchVersionReference: fieldString(fields, "Branch/Version Reference"),
    submitter: fieldStringFrom(fields, ["Submitter", "Owner"]),
    submitterSlackId: fieldString(fields, "Submitter Slack ID") || undefined,
    submittedAt:
      fieldString(fields, "Time Created") ||
      fieldString(fields, "Timestamp") ||
      record.createdTime ||
      new Date().toISOString(),
    status: coerceStatus(fields.Status),
    attachments: [],
    manufacturingNotes: fieldString(fields, "Manufacturing Notes"),
    priority: fieldStringFrom(fields, [
      "Priority",
      "Mfg. priority",
    ]) as ManufacturingRequest["priority"],
    printMaterial: fieldString(fields, "Print Material") || undefined,
    printColor: fieldString(fields, "Print Color") || undefined,
    infill: fieldString(fields, "Infill") || undefined,
    layerHeight: fieldString(fields, "Layer Height") || undefined,
    printerNotes: fieldString(fields, "Printer Notes") || undefined,
    vendorName: fieldString(fields, "Vendor Name") || undefined,
    quoteRequired: Boolean(fields["Quote Required"]),
    leadTime: fieldString(fields, "Lead Time") || undefined,
    vendorNotes: fieldString(fields, "Vendor Notes") || undefined,
    auditHistory: [],
  };
}

export async function createAirtableRecord(request: ManufacturingRequest) {
  const target = resolveAirtableTableTarget(request);
  const payload = {
    records: [
      {
        fields: requestToFields(request),
      },
    ],
  };

  const response = await airtableFetch<{ records: AirtableRecord[] }>(
    tableUrl(target),
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  const record = response.records[0];
  return {
    ...request,
    id: record.id,
    airtableId: record.id,
    airtableUrl: airtableRecordUrl(record.id, target),
    airtableTableId: target?.airtableTableId,
    airtableTableName: target?.airtableTableName,
  };
}

export async function listAirtableRequests() {
  const requests: ManufacturingRequest[] = [];

  for (const target of configuredTableTargets()) {
    const records: AirtableRecord[] = [];
    let offset: string | undefined;

    do {
      const url = new URL(tableUrl(target));
      url.searchParams.set("pageSize", "100");
      const view = queueViewForTarget(target);
      if (view) {
        url.searchParams.set("view", view);
      }
      if (offset) {
        url.searchParams.set("offset", offset);
      }

      const response = await airtableFetch<AirtableListResponse>(url.toString());
      records.push(...response.records);
      offset = response.offset;
    } while (offset);

    requests.push(...records.map((record) => mapAirtableRecord(record, target)));
  }

  return requests.sort(
    (a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );
}

export async function getAirtableRequest(
  recordId: string,
  tableHint: AirtableTableHint = {},
) {
  const target = resolveAirtableTableTarget(tableHint);
  const record = await airtableFetch<AirtableRecord>(
    `${tableUrl(target)}/${recordId}`,
  );
  return mapAirtableRecord(record, target);
}

export async function updateAirtableStatus(
  recordId: string,
  status: ManufacturingRequest["status"],
  audit: {
    changedBy: string;
    changedBySlackId?: string;
    changedAt: string;
    auditHistory: AuditEntry[];
  },
  tableHint: AirtableTableHint = {},
) {
  const target = resolveAirtableTableTarget(tableHint);
  const record = await airtableFetch<AirtableRecord>(
    `${tableUrl(target)}/${recordId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          Status: status,
          "Last Status Changed By": audit.changedBy,
          "Last Status Changed By Slack ID": audit.changedBySlackId,
          "Last Status Change At": audit.changedAt,
          "Audit History": JSON.stringify(audit.auditHistory),
        },
      }),
    },
  );

  return mapAirtableRecord(record, target);
}
