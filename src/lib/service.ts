import {
  createAirtableRecord,
  deleteAirtableRecord,
  getAirtableRequest,
  isAirtableConfigured,
  listAirtableRequests,
  resolveAirtableTableTarget,
  statusForAirtableTarget,
  updateAirtableSlackMessageInfo,
  updateAirtableStatus,
} from "./integrations/airtable";
import {
  notify3DPrintSubmission,
  notifyNewSubmission,
  notifyStatusChange,
} from "./integrations/slack";
import type { SlackNotificationResult } from "./integrations/slack";
import {
  coerceCategory,
  coerceFinish,
  coerceMachineType,
  coercePriority,
  coerceStatus,
  deriveMachineType,
  inferInitialStatus,
  is3DPrint,
  normalizeBoolean,
  normalizeQuantity,
  normalizeString,
} from "./manufacturing";
import {
  deleteLocalRequest,
  findLocalRequest,
  readLocalRequests,
  upsertLocalRequest,
} from "./storage/local-store";
import type {
  AuditEntry,
  ManufacturingRequest,
  ManufacturingStatus,
  ServiceResult,
  SubmissionInput,
} from "./types";

export class ValidationError extends Error {}

function auditEntry(input: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
  return {
    ...input,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

function validateRequest(request: ManufacturingRequest) {
  const missing = [
    ["Part name", request.partName],
    ["Quantity", String(request.quantity)],
    ["Submitter", request.submitter],
  ].filter(([, value]) => !normalizeString(value));

  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missing.map(([label]) => label).join(", ")}`,
    );
  }
}

export function buildManufacturingRequest(
  input: SubmissionInput,
): ManufacturingRequest {
  const now = new Date().toISOString();
  const partName = normalizeString(input.partName);
  const machineType =
    coerceMachineType(input.machineType) ??
    deriveMachineType({
      material: input.material,
      thickness: input.thickness,
      partName,
      hasDrawing: input.attachments?.some((attachment) => attachment.kind === "drawing"),
    });
  const submitter = normalizeString(input.submitter);
  const airtableTarget = resolveAirtableTableTarget(input);

  const request: ManufacturingRequest = {
    id: `mfg_${crypto.randomUUID()}`,
    airtableTableId:
      normalizeString(input.airtableTableId) ||
      airtableTarget?.airtableTableId,
    airtableTableName:
      normalizeString(input.airtableTableName) ||
      airtableTarget?.airtableTableName,
    partName,
    partNumber: normalizeString(input.partNumber),
    notes: normalizeString(input.notes) || normalizeString(input.description),
    quantity: normalizeQuantity(input.quantity),
    subsystem: normalizeString(input.subsystem),
    category: coerceCategory(input.category),
    material: normalizeString(input.material),
    thickness: normalizeString(input.thickness),
    finish: coerceFinish(input.finish),
    machineType,
    onshapePartUrl: normalizeString(input.onshapePartUrl),
    onshapeDrawingUrl: normalizeString(input.onshapeDrawingUrl),
    assemblyUrl: normalizeString(input.assemblyUrl),
    branchVersionReference: normalizeString(input.branchVersionReference),
    submitter,
    submitterSlackId: normalizeString(input.submitterSlackId) || undefined,
    submittedAt: now,
    status: inferInitialStatus({
      machineType,
      attachments: input.attachments,
      explicitStatus: input.status,
    }),
    attachments: input.attachments ?? [],
    manufacturingNotes: normalizeString(input.manufacturingNotes),
    sourceRequestId: normalizeString(input.sourceRequestId) || undefined,
    priority: coercePriority(input.priority),
    printMaterial: normalizeString(input.printMaterial) || undefined,
    printColor: normalizeString(input.printColor) || undefined,
    infill: normalizeString(input.infill) || undefined,
    layerHeight: normalizeString(input.layerHeight) || undefined,
    printerNotes: normalizeString(input.printerNotes) || undefined,
    vendorName: normalizeString(input.vendorName) || undefined,
    quoteRequired: normalizeBoolean(input.quoteRequired),
    leadTime: normalizeString(input.leadTime) || undefined,
    vendorNotes: normalizeString(input.vendorNotes) || undefined,
    auditHistory: [
      auditEntry({
        action: "submitted",
        actor: submitter,
        actorSlackId: normalizeString(input.submitterSlackId) || undefined,
        note: "Manufacturing request submitted from Onshape panel.",
      }),
    ],
  };

  validateRequest(request);
  return request;
}

async function runNotification<T>(
  warnings: string[],
  notifier: () => Promise<T | string | null>,
): Promise<T | null> {
  try {
    const result = await notifier();
    if (typeof result === "string") {
      warnings.push(result);
      return null;
    }

    return result;
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Notification failed.");
    return null;
  }
}

export async function listManufacturingRequests() {
  if (isAirtableConfigured()) {
    return listAirtableRequests();
  }

  return readLocalRequests();
}

export async function findManufacturingRequest(
  id: string,
  tableHint: {
    airtableTableId?: string;
    airtableTableName?: string;
  } = {},
) {
  const local = await findLocalRequest(id);
  if (local) {
    return local;
  }

  if (isAirtableConfigured()) {
    return getAirtableRequest(id, tableHint);
  }

  return null;
}

export async function createManufacturingRequest(
  input: SubmissionInput,
): Promise<ServiceResult<ManufacturingRequest>> {
  const warnings: string[] = [];
  let request = buildManufacturingRequest(input);

  if (isAirtableConfigured()) {
    request = await createAirtableRecord(request);
    request.auditHistory.push(
      auditEntry({
        action: "airtable_synced",
        actor: "system",
        note: `Airtable record ${request.airtableId} created.`,
      }),
    );
  }

  await upsertLocalRequest(request);
  const submissionNotification = await runNotification<SlackNotificationResult>(
    warnings,
    () => notifyNewSubmission(request),
  );

  if (submissionNotification?.channelId || submissionNotification?.messageTs) {
    request = {
      ...request,
      slackChannelId:
        submissionNotification.channelId ?? request.slackChannelId,
      slackMessageTs:
        submissionNotification.messageTs ?? request.slackMessageTs,
    };

    if (isAirtableConfigured() && request.airtableId) {
      try {
        const persisted = await updateAirtableSlackMessageInfo(
          request.airtableId,
          {
            channelId: request.slackChannelId,
            messageTs: request.slackMessageTs,
          },
          {
            airtableTableId: request.airtableTableId,
            airtableTableName: request.airtableTableName,
            category: request.category,
          },
        );
        if (persisted) {
          request = {
            ...request,
            slackChannelId: persisted.slackChannelId ?? request.slackChannelId,
            slackMessageTs: persisted.slackMessageTs ?? request.slackMessageTs,
          };
        } else {
          warnings.push(
            "Slack status updates cannot thread until Airtable has text fields named Slack Channel ID and Slack Message TS.",
          );
        }
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message
            : "Slack thread metadata could not be saved to Airtable.",
        );
      }
    }

    await upsertLocalRequest(request);
  }
  if (!submissionNotification?.messageTs) {
    warnings.push(
      "Slack did not return a message timestamp, so status updates cannot thread under the original request.",
    );
  }

  if (is3DPrint(request.machineType)) {
    await runNotification(warnings, () => notify3DPrintSubmission(request));
  }

  return { data: request, warnings };
}

export async function changeManufacturingStatus(input: {
  id: string;
  status: ManufacturingStatus;
  changedBy?: string;
  changedBySlackId?: string;
  airtableTableId?: string;
  airtableTableName?: string;
}): Promise<ServiceResult<ManufacturingRequest>> {
  const warnings: string[] = [];
  const existing = await findManufacturingRequest(input.id, input);

  if (!existing) {
    throw new ValidationError("Manufacturing request not found.");
  }

  const changedBy = normalizeString(input.changedBy, "Manufacturing");
  const changedBySlackId = normalizeString(input.changedBySlackId);
  const oldStatus = existing.status;
  const newStatus = coerceStatus(input.status);
  let updated: ManufacturingRequest = {
    ...existing,
    status: newStatus,
    auditHistory: [
      ...existing.auditHistory,
      auditEntry({
        action: "status_changed",
        actor: changedBy,
        actorSlackId: changedBySlackId || undefined,
        fromStatus: oldStatus,
        toStatus: newStatus,
      }),
    ],
  };

  if (isAirtableConfigured()) {
    const airtableRecordId = existing.airtableId ?? existing.id;
    const airtableUpdated = await updateAirtableStatus(
      airtableRecordId,
      newStatus,
      {
        changedBy,
        changedBySlackId,
        changedAt: updated.auditHistory.at(-1)?.timestamp ?? new Date().toISOString(),
        auditHistory: updated.auditHistory,
      },
      {
        airtableTableId: existing.airtableTableId ?? input.airtableTableId,
        airtableTableName: existing.airtableTableName ?? input.airtableTableName,
        category: existing.category,
      },
    );
    updated = {
      ...updated,
      ...airtableUpdated,
      slackChannelId: airtableUpdated.slackChannelId ?? updated.slackChannelId,
      slackMessageTs: airtableUpdated.slackMessageTs ?? updated.slackMessageTs,
      auditHistory: updated.auditHistory,
    };
  }

  const actualNewStatus = coerceStatus(updated.status);
  if (actualNewStatus !== newStatus) {
    updated = {
      ...updated,
      auditHistory: updated.auditHistory.map((entry, index) =>
        index === updated.auditHistory.length - 1 &&
        entry.action === "status_changed"
          ? { ...entry, toStatus: actualNewStatus }
          : entry,
      ),
    };
  }

  await upsertLocalRequest(updated);
  if (oldStatus !== actualNewStatus) {
    await runNotification(warnings, () =>
      notifyStatusChange({
        request: updated,
        oldStatus,
        newStatus: actualNewStatus,
        changedBy,
        changedBySlackId: changedBySlackId || undefined,
      }),
    );
  }

  return { data: updated, warnings };
}

export async function syncAirtableStatusChange(input: {
  recordId: string;
  oldStatus?: string;
  newStatus?: string;
  changedBy?: string;
  changedBySlackId?: string;
  airtableTableId?: string;
  airtableTableName?: string;
  tableId?: string;
  tableName?: string;
}): Promise<ServiceResult<ManufacturingRequest> & { notified: boolean }> {
  const warnings: string[] = [];
  const previous = await findLocalRequest(input.recordId);
  const latest = await getAirtableRequest(input.recordId, input);
  const changedBy = normalizeString(input.changedBy, "Airtable");
  const changedBySlackId = normalizeString(input.changedBySlackId);
  const newStatus = input.newStatus
    ? coerceStatus(input.newStatus)
    : latest.status;
  const previousStatus = previous?.status
    ? await statusForAirtableTarget(previous.status, input)
    : undefined;
  const oldStatus = input.oldStatus
    ? coerceStatus(input.oldStatus)
    : previousStatus;
  const shouldNotify = oldStatus
    ? oldStatus !== newStatus
    : Boolean(input.newStatus);
  const auditHistory = [
    ...(previous?.auditHistory ?? latest.auditHistory),
    ...(shouldNotify
      ? [
          auditEntry({
            action: "status_changed",
            actor: changedBy,
            actorSlackId: changedBySlackId || undefined,
            fromStatus: oldStatus,
            toStatus: newStatus,
            note: "Status changed in Airtable.",
          }),
        ]
      : []),
  ];
  const updated: ManufacturingRequest = {
    ...latest,
    slackChannelId: latest.slackChannelId ?? previous?.slackChannelId,
    slackMessageTs: latest.slackMessageTs ?? previous?.slackMessageTs,
    status: newStatus,
    auditHistory,
  };

  await upsertLocalRequest(updated);

  if (shouldNotify) {
    const oldStatusLabel = oldStatus ?? "Unknown";
    await runNotification(warnings, () =>
      notifyStatusChange({
        request: updated,
        oldStatus: oldStatusLabel,
        newStatus,
        changedBy,
        changedBySlackId: changedBySlackId || undefined,
      }),
    );
  }

  return { data: updated, warnings, notified: shouldNotify };
}

export async function deleteManufacturingRequest(input: {
  id: string;
  airtableTableId?: string;
  airtableTableName?: string;
}): Promise<ServiceResult<ManufacturingRequest>> {
  const existing = await findManufacturingRequest(input.id, input);

  if (!existing) {
    throw new ValidationError("Manufacturing request not found.");
  }

  if (isAirtableConfigured()) {
    await deleteAirtableRecord(existing.airtableId ?? existing.id, {
      airtableTableId: existing.airtableTableId ?? input.airtableTableId,
      airtableTableName: existing.airtableTableName ?? input.airtableTableName,
      category: existing.category,
    });
  }

  await deleteLocalRequest(existing.id);
  return { data: existing, warnings: [] };
}

export async function createSpareRequest(input: {
  id: string;
  spareQuantity: number | string;
  submitter?: string;
  submitterSlackId?: string;
  airtableTableId?: string;
  airtableTableName?: string;
}): Promise<ServiceResult<ManufacturingRequest>> {
  const source = await findManufacturingRequest(input.id, input);
  if (!source) {
    throw new ValidationError("Source manufacturing request not found.");
  }

  const spareQuantity = normalizeQuantity(input.spareQuantity);
  const submitter = normalizeString(input.submitter, source.submitter);
  const submitterSlackId = normalizeString(
    input.submitterSlackId,
    source.submitterSlackId,
  );
  const status = is3DPrint(source.machineType)
    ? "Ready for Manufacture"
    : "Needs CAM";

  const result = await createManufacturingRequest({
    partName: source.partName,
    partNumber: source.partNumber,
    notes: source.notes,
    quantity: spareQuantity,
    subsystem: source.subsystem,
    category: "Spares",
    material: source.material,
    thickness: source.thickness,
    finish: source.finish,
    machineType: source.machineType,
    onshapePartUrl: source.onshapePartUrl,
    onshapeDrawingUrl: source.onshapeDrawingUrl,
    assemblyUrl: source.assemblyUrl,
    branchVersionReference: source.branchVersionReference,
    submitter,
    submitterSlackId,
    status,
    attachments: source.attachments,
    sourceRequestId: source.id,
    priority: source.priority,
    printMaterial: source.printMaterial,
    printColor: source.printColor,
    infill: source.infill,
    layerHeight: source.layerHeight,
    printerNotes: source.printerNotes,
    vendorName: source.vendorName,
    quoteRequired: source.quoteRequired,
    leadTime: source.leadTime,
    vendorNotes: source.vendorNotes,
    manufacturingNotes: [
      source.manufacturingNotes,
      `Spare request generated from ${source.partNumber || source.partName}.`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  result.data.auditHistory.push(
    auditEntry({
      action: "spares_created",
      actor: submitter,
      actorSlackId: submitterSlackId || undefined,
      note: `${spareQuantity} spare part(s) requested from ${source.id}.`,
    }),
  );
  await upsertLocalRequest(result.data);

  return result;
}
