import type { Metadata } from "next";
import { OnshapeSubmissionPanel } from "@/components/onshape-submission-panel";
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
  return Array.isArray(value) ? value[0] : value;
}

function buildOnshapeUrl(
  params: Record<string, string | string[] | undefined>,
  elementIdOverride?: string,
) {
  const documentId = firstParam(params.documentId) ?? firstParam(params.did);
  const workspaceId =
    firstParam(params.workspaceId) ??
    firstParam(params.wid) ??
    firstParam(params.versionId) ??
    firstParam(params.vid);
  const elementId =
    elementIdOverride ?? firstParam(params.elementId) ?? firstParam(params.eid);
  const partId = firstParam(params.partId) ?? firstParam(params.pid);

  if (!documentId || !workspaceId || !elementId) {
    return "";
  }

  const workspaceSegment = params.versionId || params.vid ? "v" : "w";
  const url = new URL(
    `https://cad.onshape.com/documents/${documentId}/${workspaceSegment}/${workspaceId}/e/${elementId}`,
  );

  if (partId) {
    url.searchParams.set("partId", partId);
  }

  return url.toString();
}

function defaultsFromSearchParams(
  params: Record<string, string | string[] | undefined>,
): SubmissionInput {
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
    material,
    thickness,
    quantity: normalizeQuantity(firstParam(params.quantity) ?? 1),
    subsystem:
      firstParam(params.subsystem) ??
      inferSubsystemFromTitle(firstParam(params.documentTitle)),
    machineType: firstParam(params.machineType),
    onshapePartUrl,
    onshapeDrawingUrl,
    assemblyUrl,
    branchVersionReference:
      firstParam(params.branchVersionReference) ??
      firstParam(params.branch) ??
      firstParam(params.version) ??
      normalizeString(
        firstParam(params.workspaceId) ?? firstParam(params.versionId),
      ),
    category: firstParam(params.category) ?? "Robot",
    finish: firstParam(params.finish) ?? "Raw",
    submitter: firstParam(params.submitter) ?? "",
    manufacturingNotes: firstParam(params.notes) ?? "",
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

export default async function OnshapePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const manufacturingUsers = await getManufacturingSlackUsers();

  return (
    <OnshapeSubmissionPanel
      defaults={defaultsFromSearchParams(params)}
      manufacturingUsers={manufacturingUsers.users}
      userWarning={manufacturingUsers.warning}
    />
  );
}
