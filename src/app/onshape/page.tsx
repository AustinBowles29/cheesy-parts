import type { Metadata } from "next";
import { OnshapeSubmissionPanel } from "@/components/onshape-submission-panel";
import { getAirtableSubmissionFieldOptions } from "@/lib/integrations/airtable";
import {
  fetchOnshapePartMetadata,
  onshapeContextFromParams,
} from "@/lib/integrations/onshape";
import { getManufacturingSlackUsers } from "@/lib/integrations/slack-users";
import {
  inferSubsystemFromTitle,
  normalizeQuantity,
  normalizeString,
} from "@/lib/manufacturing";
import type { SubmissionInput } from "@/lib/types";

export const metadata: Metadata = {
  title: "Submit Part | Team 254 Manufacturing",
};

function firstParam(value: string | string[] | undefined) {
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

function paramsToQueryString(
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
  const documentId = firstParam(params.documentId) ?? firstParam(params.did);
  const workspaceOrVersion = firstParam(params.workspaceOrVersion)?.toLowerCase();
  const workspaceOrVersionId = firstParam(params.workspaceOrVersionId);
  const workspaceId =
    firstParam(params.workspaceId) ??
    firstParam(params.wid) ??
    (workspaceOrVersion?.startsWith("w") ? workspaceOrVersionId : undefined);
  const versionId =
    firstParam(params.versionId) ??
    firstParam(params.vid) ??
    (workspaceOrVersion?.startsWith("v") ? workspaceOrVersionId : undefined);
  const workspaceOrVersionTarget = workspaceId ?? versionId;
  const elementId =
    elementIdOverride ?? firstParam(params.elementId) ?? firstParam(params.eid);
  const partId = firstParam(params.partId) ?? firstParam(params.pid);

  if (!documentId || !workspaceOrVersionTarget || !elementId) {
    return "";
  }

  const workspaceSegment = versionId ? "v" : "w";
  const url = new URL(
    `https://cad.onshape.com/documents/${documentId}/${workspaceSegment}/${workspaceOrVersionTarget}/e/${elementId}`,
  );

  if (partId) {
    url.searchParams.set("partId", partId);
  }

  return url.toString();
}

function defaultsFromSearchParams(
  params: Record<string, string | string[] | undefined>,
): SubmissionInput {
  const context = onshapeContextFromParams(params, firstParam);
  const partName =
    firstParam(params.partName) ??
    firstParam(params.name) ??
    firstParam(params.part) ??
    "";
  const material = firstParam(params.material) ?? "";
  const thickness = firstParam(params.thickness) ?? "";
  const onshapePartUrl =
    firstParam(params.onshapePartUrl) ?? buildOnshapeUrl(params);
  const onshapeDrawingUrl =
    firstParam(params.onshapeDrawingUrl) ??
    buildOnshapeUrl(
      params,
      firstParam(params.drawingElementId) ?? firstParam(params.deid),
    );
  const assemblyUrl =
    firstParam(params.assemblyUrl) ??
    buildOnshapeUrl(
      params,
      firstParam(params.assemblyElementId) ?? firstParam(params.aeid),
    );

  return {
    partName,
    partNumber:
      firstParam(params.partNumber) ??
      firstParam(params.number) ??
      firstParam(params.partNo) ??
      "",
    notes: firstParam(params.notes) ?? firstParam(params.description) ?? "",
    material,
    thickness,
    quantity: normalizeQuantity(firstParam(params.quantity) ?? 1),
    subsystem:
      firstParam(params.subsystem) ??
      inferSubsystemFromTitle(firstParam(params.documentTitle)),
    machineType: firstParam(params.machineType),
    onshapePartUrl,
    onshapeDrawingUrl,
    onshapeDocumentId: context?.documentId,
    onshapeWvm: context?.wvm,
    onshapeWvmId: context?.wvmId,
    assemblyUrl,
    branchVersionReference:
      firstParam(params.branchVersionReference) ??
      firstParam(params.branch) ??
      firstParam(params.version) ??
      normalizeString(
        firstParam(params.workspaceId) ??
          firstParam(params.versionId) ??
          firstParam(params.workspaceOrVersionId),
      ),
    category: firstParam(params.category) ?? "Robot",
    finish: firstParam(params.finish) ?? "Raw",
    submitter: firstParam(params.submitter) ?? "",
    manufacturingNotes:
      firstParam(params.manufacturingNotes) ??
      firstParam(params.fabricationNotes) ??
      "",
    priority: firstParam(params.priority) ?? "",
    printMaterial: firstParam(params.printMaterial) ?? "",
    printColor: firstParam(params.printColor) ?? "",
    infill: firstParam(params.infill) ?? "",
    layerHeight: firstParam(params.layerHeight) ?? "",
    printerNotes: firstParam(params.printerNotes) ?? "",
    vendorName: firstParam(params.vendorName) ?? "",
    quoteRequired: firstParam(params.quoteRequired) ?? "",
    leadTime: firstParam(params.leadTime) ?? "",
    vendorNotes: firstParam(params.vendorNotes) ?? "",
    sourceDocument: firstParam(params.documentTitle) ?? "",
  };
}

function mergeAutofillDefaults(
  defaults: SubmissionInput,
  autofill: SubmissionInput,
) {
  return {
    ...defaults,
    partName: defaults.partName || autofill.partName,
    partNumber: defaults.partNumber || autofill.partNumber,
    notes: defaults.notes || autofill.notes || autofill.description,
    material: defaults.material || autofill.material,
    thickness: defaults.thickness || autofill.thickness,
    onshapeDrawingUrl:
      defaults.onshapeDrawingUrl || autofill.onshapeDrawingUrl,
    onshapeDrawingElementId:
      defaults.onshapeDrawingElementId || autofill.onshapeDrawingElementId,
  };
}

export default async function OnshapePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [manufacturingUsers, onshapeMetadata, fieldOptions] = await Promise.all([
    getManufacturingSlackUsers(),
    fetchOnshapePartMetadata(
      onshapeContextFromParams(params, firstParam),
      `/onshape${paramsToQueryString(params)}`,
    ),
    getAirtableSubmissionFieldOptions(),
  ]);

  return (
    <OnshapeSubmissionPanel
      defaults={mergeAutofillDefaults(
        defaultsFromSearchParams(params),
        onshapeMetadata.defaults,
      )}
      fieldOptions={fieldOptions}
      manufacturingUsers={manufacturingUsers.users}
      onshapeAuthUrl={onshapeMetadata.authUrl}
      onshapeWarning={onshapeMetadata.warning}
      userWarning={manufacturingUsers.warning}
    />
  );
}
