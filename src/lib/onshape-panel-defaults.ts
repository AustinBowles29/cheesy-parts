import { getAirtableSubmissionFieldOptions } from "@/lib/integrations/airtable";
import {
  fetchOnshapeCurrentUser,
  fetchOnshapePartMetadata,
  normalizeOnshapeServer,
  onshapeContextFromParams,
} from "@/lib/integrations/onshape";
import {
  inferSubsystemFromTitle,
  normalizeQuantity,
  normalizeString,
} from "@/lib/manufacturing";
import type { SubmissionFieldOptions, SubmissionInput } from "@/lib/types";
import type { OnshapeMetadataResult } from "@/lib/integrations/onshape";

export function emptySubmissionFieldOptions(): SubmissionFieldOptions {
  return {
    subsystems: [],
    vendors: [],
    statuses: [],
    machineTypes: [],
    postProcesses: [],
    airtableTables: [],
  };
}

export function firstPanelParam(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!rawValue) {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (/^\{\$[^}]+\}$/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

export function panelParamsToQueryString(
  params: Record<string, string | string[] | undefined>,
) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, item);
      }
    } else if (value !== undefined) {
      searchParams.set(key, value);
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

function buildOnshapeUrl(
  params: Record<string, string | string[] | undefined>,
  elementIdOverride?: string,
) {
  const documentId =
    firstPanelParam(params.documentId) ?? firstPanelParam(params.did);
  const workspaceOrVersion =
    firstPanelParam(params.workspaceOrVersion)?.toLowerCase();
  const workspaceOrVersionId = firstPanelParam(params.workspaceOrVersionId);
  const workspaceId =
    firstPanelParam(params.workspaceId) ??
    firstPanelParam(params.wid) ??
    (workspaceOrVersion?.startsWith("w") ? workspaceOrVersionId : undefined);
  const versionId =
    firstPanelParam(params.versionId) ??
    firstPanelParam(params.vid) ??
    (workspaceOrVersion?.startsWith("v") ? workspaceOrVersionId : undefined);
  const workspaceOrVersionTarget = workspaceId ?? versionId;
  const elementId =
    elementIdOverride ??
    firstPanelParam(params.elementId) ??
    firstPanelParam(params.eid);
  const partId = firstPanelParam(params.partId) ?? firstPanelParam(params.pid);

  if (!documentId || !workspaceOrVersionTarget || !elementId) {
    return "";
  }

  const workspaceSegment = versionId ? "v" : "w";
  const server =
    normalizeOnshapeServer(firstPanelParam(params.server)) ||
    "https://cad.onshape.com";
  const url = new URL(
    `${server}/documents/${documentId}/${workspaceSegment}/${workspaceOrVersionTarget}/e/${elementId}`,
  );

  if (partId) {
    url.searchParams.set("partId", partId);
  }

  return url.toString();
}

function buildElementUrlFromParam(
  params: Record<string, string | string[] | undefined>,
  elementId?: string,
) {
  return elementId ? buildOnshapeUrl(params, elementId) : "";
}

export function defaultsFromPanelParams(
  params: Record<string, string | string[] | undefined>,
): SubmissionInput {
  const context = onshapeContextFromParams(params, firstPanelParam);
  const onshapeServer =
    normalizeOnshapeServer(firstPanelParam(params.server)) || undefined;
  const partName =
    firstPanelParam(params.partName) ??
    firstPanelParam(params.name) ??
    firstPanelParam(params.part) ??
    "";
  const material = firstPanelParam(params.material) ?? "";
  const thickness = firstPanelParam(params.thickness) ?? "";
  const onshapePartUrl =
    firstPanelParam(params.onshapePartUrl) ?? buildOnshapeUrl(params);
  const drawingElementId =
    firstPanelParam(params.drawingElementId) ?? firstPanelParam(params.deid);
  const assemblyElementId =
    firstPanelParam(params.assemblyElementId) ?? firstPanelParam(params.aeid);
  const onshapeDrawingUrl =
    firstPanelParam(params.onshapeDrawingUrl) ??
    buildElementUrlFromParam(params, drawingElementId);
  const assemblyUrl =
    firstPanelParam(params.assemblyUrl) ??
    buildElementUrlFromParam(params, assemblyElementId);

  return {
    airtableTableId:
      firstPanelParam(params.airtableTableId) ??
      firstPanelParam(params.tableId) ??
      "",
    airtableTableName:
      firstPanelParam(params.airtableTableName) ??
      firstPanelParam(params.tableName) ??
      "",
    partName,
    partNumber:
      firstPanelParam(params.partNumber) ??
      firstPanelParam(params.number) ??
      firstPanelParam(params.partNo) ??
      "",
    notes:
      firstPanelParam(params.notes) ??
      firstPanelParam(params.description) ??
      "",
    material,
    thickness,
    quantity: normalizeQuantity(firstPanelParam(params.quantity) ?? 1),
    subsystem:
      firstPanelParam(params.subsystem) ??
      inferSubsystemFromTitle(firstPanelParam(params.documentTitle)),
    machineType: firstPanelParam(params.machineType),
    onshapePartUrl,
    onshapeDrawingUrl,
    onshapeDrawingElementId: drawingElementId,
    onshapeDocumentId: context?.documentId,
    onshapeServer: context?.server ?? onshapeServer,
    onshapeWvm: context?.wvm,
    onshapeWvmId: context?.wvmId,
    assemblyUrl,
    branchVersionReference:
      firstPanelParam(params.branchVersionReference) ??
      firstPanelParam(params.branch) ??
      firstPanelParam(params.version) ??
      normalizeString(
        firstPanelParam(params.workspaceId) ??
          firstPanelParam(params.versionId) ??
          firstPanelParam(params.workspaceOrVersionId),
      ),
    finish: firstPanelParam(params.finish) ?? "Raw",
    submitter:
      firstPanelParam(params.submitter) ??
      firstPanelParam(params.owner) ??
      firstPanelParam(params.userName) ??
      firstPanelParam(params.username) ??
      firstPanelParam(params.displayName) ??
      "",
    manufacturingNotes:
      firstPanelParam(params.manufacturingNotes) ??
      firstPanelParam(params.fabricationNotes) ??
      "",
    priority: firstPanelParam(params.priority) ?? "",
    printMaterial: firstPanelParam(params.printMaterial) ?? "",
    printColor: firstPanelParam(params.printColor) ?? "",
    infill: firstPanelParam(params.infill) ?? "",
    layerHeight: firstPanelParam(params.layerHeight) ?? "",
    printerNotes: firstPanelParam(params.printerNotes) ?? "",
    vendorName: firstPanelParam(params.vendorName) ?? "",
    quoteRequired: firstPanelParam(params.quoteRequired) ?? "",
    leadTime: firstPanelParam(params.leadTime) ?? "",
    vendorNotes: firstPanelParam(params.vendorNotes) ?? "",
    sourceDocument: firstPanelParam(params.documentTitle) ?? "",
  };
}

export function mergeAutofillDefaults(
  defaults: SubmissionInput,
  autofill: SubmissionInput,
) {
  return {
    ...defaults,
    airtableTableId: defaults.airtableTableId || autofill.airtableTableId,
    airtableTableName: defaults.airtableTableName || autofill.airtableTableName,
    partName: defaults.partName || autofill.partName,
    partNumber: defaults.partNumber || autofill.partNumber,
    notes: defaults.notes || autofill.notes || autofill.description,
    material: defaults.material || autofill.material,
    thickness: defaults.thickness || autofill.thickness,
    quantity: defaults.quantity || autofill.quantity,
    subsystem: defaults.subsystem || autofill.subsystem,
    machineType: defaults.machineType || autofill.machineType,
    submitter: defaults.submitter || autofill.submitter,
    onshapePartUrl: defaults.onshapePartUrl || autofill.onshapePartUrl,
    onshapeDrawingUrl:
      defaults.onshapeDrawingUrl || autofill.onshapeDrawingUrl,
    onshapeDrawingElementId:
      defaults.onshapeDrawingElementId || autofill.onshapeDrawingElementId,
    onshapeDocumentId:
      defaults.onshapeDocumentId || autofill.onshapeDocumentId,
    onshapeServer: defaults.onshapeServer || autofill.onshapeServer,
    onshapeWvm: defaults.onshapeWvm || autofill.onshapeWvm,
    onshapeWvmId: defaults.onshapeWvmId || autofill.onshapeWvmId,
    assemblyUrl: defaults.assemblyUrl || autofill.assemblyUrl,
    branchVersionReference:
      defaults.branchVersionReference || autofill.branchVersionReference,
    finish: defaults.finish || autofill.finish,
    priority: defaults.priority || autofill.priority,
    printMaterial: defaults.printMaterial || autofill.printMaterial,
    printColor: defaults.printColor || autofill.printColor,
    infill: defaults.infill || autofill.infill,
    layerHeight: defaults.layerHeight || autofill.layerHeight,
    printerNotes: defaults.printerNotes || autofill.printerNotes,
    vendorName: defaults.vendorName || autofill.vendorName,
    quoteRequired: defaults.quoteRequired || autofill.quoteRequired,
    leadTime: defaults.leadTime || autofill.leadTime,
    vendorNotes: defaults.vendorNotes || autofill.vendorNotes,
    sourceDocument: defaults.sourceDocument || autofill.sourceDocument,
  };
}

interface LoadOnshapePanelDataOptions {
  includeFieldOptions?: boolean;
  includeMetadata?: boolean;
  includeUser?: boolean;
  includeBom?: boolean;
  includeDrawing?: boolean;
  accessToken?: string;
}

export async function loadOnshapePanelData(
  params: Record<string, string | string[] | undefined>,
  options: LoadOnshapePanelDataOptions = {},
) {
  const includeFieldOptions = options.includeFieldOptions ?? true;
  const includeMetadata = options.includeMetadata ?? true;
  const includeUser = options.includeUser ?? true;
  const panelDefaults = defaultsFromPanelParams(params);
  const onshapeServer =
    normalizeOnshapeServer(firstPanelParam(params.server)) || undefined;
  const [onshapeUser, onshapeMetadata, fieldOptions] = await Promise.all([
    includeUser
      ? fetchOnshapeCurrentUser({
          accessToken: options.accessToken,
          server: onshapeServer,
        })
      : Promise.resolve({ defaults: {} }),
    includeMetadata
      ? fetchOnshapePartMetadata(
          onshapeContextFromParams(params, firstPanelParam),
          `/onshape${panelParamsToQueryString(params)}`,
          {
            accessToken: options.accessToken,
            includeBom: options.includeBom,
            includeDrawing: options.includeDrawing,
            fallbackPartName: panelDefaults.partName,
            fallbackPartNumber: panelDefaults.partNumber,
          },
        )
      : Promise.resolve<OnshapeMetadataResult>({ defaults: {} }),
    includeFieldOptions
      ? getAirtableSubmissionFieldOptions()
      : Promise.resolve(emptySubmissionFieldOptions()),
  ]);

  return {
    defaults: mergeAutofillDefaults(
      mergeAutofillDefaults(panelDefaults, onshapeUser.defaults),
      onshapeMetadata.defaults,
    ),
    fieldOptions,
    onshapeAuthUrl: onshapeMetadata.authUrl,
    onshapeWarning: onshapeMetadata.warning,
  };
}
