import {
  coerceCategory,
  coerceFinish,
  coerceMachineType,
  coerceStatus,
  normalizeQuantity,
  normalizeString,
} from "../manufacturing";
import type { AttachmentRef, AuditEntry, ManufacturingRequest } from "../types";

interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

interface AirtableListResponse {
  records: AirtableRecord[];
  offset?: string;
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

export function isAirtableConfigured() {
  return Boolean(token() && baseId() && tableIdOrName());
}

function tableUrl() {
  const base = baseId();
  const table = tableIdOrName();

  if (!base || !table) {
    throw new Error("Airtable is not configured.");
  }

  return `${apiBase}/${base}/${encodeURIComponent(table)}`;
}

function airtableRecordUrl(recordId: string) {
  const explicitBaseUrl = process.env.AIRTABLE_BASE_URL;
  if (explicitBaseUrl) {
    return `${explicitBaseUrl.replace(/\/$/, "")}/${recordId}`;
  }

  const base = baseId();
  const table = tableIdOrName();
  if (base && table) {
    return `https://airtable.com/${base}/${table}/${recordId}`;
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
    Timestamp: request.submittedAt,
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

function fieldNumber(fields: Record<string, unknown>, name: string) {
  return normalizeQuantity(fields[name]);
}

export function mapAirtableRecord(record: AirtableRecord): ManufacturingRequest {
  const fields = record.fields;
  const machineType =
    coerceMachineType(fields["Machine Type"]) ??
    coerceMachineType(fieldString(fields, "Machine Type")) ??
    "Other";

  return {
    id: record.id,
    airtableId: record.id,
    airtableUrl: airtableRecordUrl(record.id),
    partName: fieldString(fields, "Part Name"),
    partNumber: fieldString(fields, "Part Number"),
    quantity: fieldNumber(fields, "Quantity"),
    subsystem: fieldString(fields, "Subsystem"),
    category: coerceCategory(fields.Category),
    material: fieldString(fields, "Material"),
    thickness: fieldString(fields, "Thickness"),
    finish: coerceFinish(fields.Finish),
    machineType,
    onshapePartUrl: fieldString(fields, "Onshape Part URL"),
    onshapeDrawingUrl: fieldString(fields, "Onshape Drawing URL"),
    assemblyUrl: fieldString(fields, "Assembly URL"),
    branchVersionReference: fieldString(fields, "Branch/Version Reference"),
    submitter: fieldString(fields, "Submitter"),
    submitterSlackId: fieldString(fields, "Submitter Slack ID") || undefined,
    submittedAt:
      fieldString(fields, "Timestamp") ||
      record.createdTime ||
      new Date().toISOString(),
    status: coerceStatus(fields.Status),
    attachments: [],
    manufacturingNotes: fieldString(fields, "Manufacturing Notes"),
    priority: fieldString(fields, "Priority") as ManufacturingRequest["priority"],
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
  const payload = {
    records: [
      {
        fields: requestToFields(request),
      },
    ],
  };

  const response = await airtableFetch<{ records: AirtableRecord[] }>(
    tableUrl(),
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
    airtableUrl: airtableRecordUrl(record.id),
  };
}

export async function listAirtableRequests() {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(tableUrl());
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("sort[0][field]", "Timestamp");
    url.searchParams.set("sort[0][direction]", "desc");
    if (offset) {
      url.searchParams.set("offset", offset);
    }

    const response = await airtableFetch<AirtableListResponse>(url.toString());
    records.push(...response.records);
    offset = response.offset;
  } while (offset);

  return records.map(mapAirtableRecord);
}

export async function getAirtableRequest(recordId: string) {
  const record = await airtableFetch<AirtableRecord>(`${tableUrl()}/${recordId}`);
  return mapAirtableRecord(record);
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
) {
  const record = await airtableFetch<AirtableRecord>(`${tableUrl()}/${recordId}`, {
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
  });

  return mapAirtableRecord(record);
}
