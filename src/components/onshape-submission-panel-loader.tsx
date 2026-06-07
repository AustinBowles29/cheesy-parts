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

const accessTokenStorageKey = "cheesy-parts:onshape-access-token";
const tokenExpiresAtStorageKey = "cheesy-parts:onshape-token-expires-at";
const tokenMessageType = "cheesy-parts:onshape-token";

interface OnshapeTokenMessage {
  type?: string;
  accessToken?: string;
  expiresAt?: string;
}

function panelDataUrlWithMode(panelDataUrl: string, mode: string) {
  const url = new URL(panelDataUrl, window.location.origin);
  url.searchParams.set("__mode", mode);
  return `${url.pathname}${url.search}`;
}

function storedAccessToken() {
  if (typeof window === "undefined") {
    return "";
  }

  const accessToken = window.sessionStorage.getItem(accessTokenStorageKey) ?? "";
  const expiresAt = Number(
    window.sessionStorage.getItem(tokenExpiresAtStorageKey) ?? 0,
  );

  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    window.sessionStorage.removeItem(accessTokenStorageKey);
    window.sessionStorage.removeItem(tokenExpiresAtStorageKey);
    return "";
  }

  return accessToken;
}

function persistAccessToken(accessToken: string, expiresAt: string) {
  if (!accessToken || !expiresAt) {
    return "";
  }

  const expiresAtMs = Number(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return "";
  }

  window.sessionStorage.setItem(accessTokenStorageKey, accessToken);
  window.sessionStorage.setItem(tokenExpiresAtStorageKey, String(expiresAtMs));
  return accessToken;
}

function headersForAccessToken(accessToken: string) {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
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
  const [panelAccessToken, setPanelAccessToken] = useState(storedAccessToken);
  const [panelData, setPanelData] = useState<PanelData>({
    defaults: initialDefaults,
    fieldOptions: initialFieldOptions,
  });

  useEffect(() => {
    function applyAccessToken(accessToken: string, expiresAt: string) {
      const persistedToken = persistAccessToken(accessToken, expiresAt);
      if (persistedToken) {
        setPanelAccessToken(persistedToken);
      }
    }

    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hashParams.get("onshapeAccessToken") ?? "";
    const expiresAt = hashParams.get("onshapeTokenExpiresAt") ?? "";
    if (accessToken && expiresAt) {
      applyAccessToken(accessToken, expiresAt);
      hashParams.delete("onshapeAccessToken");
      hashParams.delete("onshapeTokenExpiresAt");
      const nextHash = hashParams.toString();
      const nextUrl = `${window.location.pathname}${window.location.search}${
        nextHash ? `#${nextHash}` : ""
      }`;
      window.history.replaceState(null, "", nextUrl);

      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: tokenMessageType, accessToken, expiresAt },
          window.location.origin,
        );
        window.setTimeout(() => window.close(), 150);
      }
    }

    function receiveTokenMessage(event: MessageEvent<OnshapeTokenMessage>) {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type !== tokenMessageType) {
        return;
      }

      applyAccessToken(event.data.accessToken ?? "", event.data.expiresAt ?? "");
    }

    window.addEventListener("message", receiveTokenMessage);
    return () => window.removeEventListener("message", receiveTokenMessage);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    function applyPanelData(body: PanelData) {
      const hasOnshapeDefaults = Boolean(
        body.defaults?.partName ||
          body.defaults?.partNumber ||
          body.defaults?.material ||
          body.defaults?.notes ||
          body.defaults?.onshapeDrawingUrl ||
          body.defaults?.submitter,
      );
      setPanelData((current) => ({
        defaults: mergeDefaults(current.defaults, body.defaults),
        fieldOptions: hasFieldOptions(body.fieldOptions)
          ? body.fieldOptions
          : current.fieldOptions,
        onshapeAuthUrl: hasOnshapeDefaults
          ? undefined
          : body.onshapeAuthUrl ?? current.onshapeAuthUrl,
        onshapeWarning: hasOnshapeDefaults
          ? undefined
          : body.onshapeWarning ?? current.onshapeWarning,
      }));
    }

    async function loadPanelData(mode: string) {
      try {
        const response = await fetch(panelDataUrlWithMode(panelDataUrl, mode), {
          cache: "no-store",
          credentials: "include",
          headers: headersForAccessToken(panelAccessToken),
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
  }, [panelAccessToken, panelDataUrl]);

  return (
    <OnshapeSubmissionPanel
      defaults={panelData.defaults}
      fieldOptions={panelData.fieldOptions}
      onshapeAccessToken={panelAccessToken}
      onshapeAuthUrl={panelData.onshapeAuthUrl}
      onshapeWarning={panelData.onshapeWarning}
    />
  );
}
