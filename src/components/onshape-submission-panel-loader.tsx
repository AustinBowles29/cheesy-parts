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

    async function loadPanelData() {
      try {
        const response = await fetch(panelDataUrl, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error ?? "Autofill data could not be loaded.");
        }

        setPanelData({
          defaults: body.defaults ?? initialDefaults,
          fieldOptions: body.fieldOptions ?? initialFieldOptions,
          onshapeAuthUrl: body.onshapeAuthUrl,
          onshapeWarning: body.onshapeWarning,
        });
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

    loadPanelData();

    return () => abortController.abort();
  }, [initialDefaults, initialFieldOptions, panelDataUrl]);

  return (
    <OnshapeSubmissionPanel
      defaults={panelData.defaults}
      fieldOptions={panelData.fieldOptions}
      onshapeAuthUrl={panelData.onshapeAuthUrl}
      onshapeWarning={panelData.onshapeWarning}
    />
  );
}
