"use client";

import { useEffect, useState } from "react";
import type { SubmissionFieldOptions, SubmissionInput } from "@/lib/types";
import { OnshapeSubmissionPanel } from "./onshape-submission-panel";

interface PanelData {
  defaults: SubmissionInput;
  fieldOptions: SubmissionFieldOptions;
  onshapeAuthUrl?: string;
  onshapeWarning?: string;
}

interface OnshapeSubmissionPanelLoaderProps {
  initialDefaults: SubmissionInput;
  initialFieldOptions: SubmissionFieldOptions;
  panelDataUrl: string;
}

function panelDataUrlWithMode(panelDataUrl: string, mode: string) {
  const url = new URL(panelDataUrl, window.location.origin);
  url.searchParams.set("__mode", mode);
  return `${url.pathname}${url.search}`;
}

function mergeDefaults(
  current: SubmissionInput,
  incoming: SubmissionInput | undefined,
) {
  if (!incoming) {
    return current;
  }

  return {
    ...current,
    airtableTableId: current.airtableTableId || incoming.airtableTableId,
    airtableTableName: current.airtableTableName || incoming.airtableTableName,
    partName: current.partName || incoming.partName,
    partNumber: current.partNumber || incoming.partNumber,
    notes: current.notes || incoming.notes || incoming.description,
    material: current.material || incoming.material,
    thickness: current.thickness || incoming.thickness,
    quantity: current.quantity || incoming.quantity,
    subsystem: current.subsystem || incoming.subsystem,
    machineType: current.machineType || incoming.machineType,
    submitter: current.submitter || incoming.submitter,
    onshapePartUrl: current.onshapePartUrl || incoming.onshapePartUrl,
    onshapeDrawingUrl: current.onshapeDrawingUrl || incoming.onshapeDrawingUrl,
    onshapeDrawingElementId:
      current.onshapeDrawingElementId || incoming.onshapeDrawingElementId,
    onshapeDocumentId: current.onshapeDocumentId || incoming.onshapeDocumentId,
    onshapeServer: current.onshapeServer || incoming.onshapeServer,
    onshapeWvm: current.onshapeWvm || incoming.onshapeWvm,
    onshapeWvmId: current.onshapeWvmId || incoming.onshapeWvmId,
    assemblyUrl: current.assemblyUrl || incoming.assemblyUrl,
    branchVersionReference:
      current.branchVersionReference || incoming.branchVersionReference,
    finish: current.finish || incoming.finish,
    priority: current.priority || incoming.priority,
    printMaterial: current.printMaterial || incoming.printMaterial,
    printColor: current.printColor || incoming.printColor,
    infill: current.infill || incoming.infill,
    layerHeight: current.layerHeight || incoming.layerHeight,
    printerNotes: current.printerNotes || incoming.printerNotes,
    vendorName: current.vendorName || incoming.vendorName,
    quoteRequired: current.quoteRequired || incoming.quoteRequired,
    leadTime: current.leadTime || incoming.leadTime,
    vendorNotes: current.vendorNotes || incoming.vendorNotes,
    sourceDocument: current.sourceDocument || incoming.sourceDocument,
  };
}

function hasFieldOptions(fieldOptions: SubmissionFieldOptions | undefined) {
  return Boolean(
    fieldOptions &&
      (fieldOptions.subsystems.length > 0 ||
        fieldOptions.vendors.length > 0 ||
        fieldOptions.statuses.length > 0 ||
        fieldOptions.machineTypes.length > 0 ||
        fieldOptions.postProcesses.length > 0 ||
        (fieldOptions.airtableTables?.length ?? 0) > 0 ||
        fieldOptions.warning),
  );
}

export function OnshapeSubmissionPanelLoader({
  initialDefaults,
  initialFieldOptions,
  panelDataUrl,
}: OnshapeSubmissionPanelLoaderProps) {
  const [panelData, setPanelData] = useState<PanelData>({
    defaults: initialDefaults,
    fieldOptions: initialFieldOptions,
  });

  useEffect(() => {
    const abortController = new AbortController();

    function applyPanelData(body: PanelData) {
      setPanelData((current) => ({
        defaults: mergeDefaults(current.defaults, body.defaults),
        fieldOptions: hasFieldOptions(body.fieldOptions)
          ? body.fieldOptions
          : current.fieldOptions,
        onshapeAuthUrl: body.onshapeAuthUrl ?? current.onshapeAuthUrl,
        onshapeWarning: body.onshapeWarning ?? current.onshapeWarning,
      }));
    }

    async function loadPanelData(mode: string) {
      try {
        const response = await fetch(panelDataUrlWithMode(panelDataUrl, mode), {
          cache: "no-store",
          credentials: "include",
          signal: abortController.signal,
        });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error ?? "Autofill data could not be loaded.");
        }

        applyPanelData(body);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setPanelData((current) => ({
          ...current,
          onshapeWarning:
            error instanceof Error
              ? `Autofill data could not be loaded: ${error.message}`
              : "Autofill data could not be loaded.",
        }));
      }
    }

    loadPanelData("fast");
    loadPanelData("options");
    loadPanelData("details");

    return () => abortController.abort();
  }, [panelDataUrl]);

  return (
    <OnshapeSubmissionPanel
      defaults={panelData.defaults}
      fieldOptions={panelData.fieldOptions}
      onshapeAuthUrl={panelData.onshapeAuthUrl}
      onshapeWarning={panelData.onshapeWarning}
    />
  );
}
