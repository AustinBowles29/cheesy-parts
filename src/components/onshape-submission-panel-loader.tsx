"use client";

import { useEffect, useRef, useState } from "react";
import {
  readCachedOnshapePanelData,
  rememberCurrentOnshapeSubmitHref,
  rememberOnshapePanelData,
} from "@/lib/onshape-panel-session";
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
  options: { preferIncoming?: boolean } = {},
) {
  if (!incoming) {
    return current;
  }

  const mergeValue = <T,>(currentValue: T | undefined, incomingValue: T | undefined) =>
    options.preferIncoming
      ? incomingValue || currentValue
      : currentValue || incomingValue;

  return {
    ...current,
    airtableTableId: mergeValue(current.airtableTableId, incoming.airtableTableId),
    airtableTableName: mergeValue(
      current.airtableTableName,
      incoming.airtableTableName,
    ),
    partName: mergeValue(current.partName, incoming.partName),
    partNumber: mergeValue(current.partNumber, incoming.partNumber),
    notes: mergeValue(current.notes, incoming.notes || incoming.description),
    material: mergeValue(current.material, incoming.material),
    thickness: mergeValue(current.thickness, incoming.thickness),
    quantity: mergeValue(current.quantity, incoming.quantity),
    subsystem: mergeValue(current.subsystem, incoming.subsystem),
    machineType: mergeValue(current.machineType, incoming.machineType),
    submitter: mergeValue(current.submitter, incoming.submitter),
    onshapePartUrl: mergeValue(current.onshapePartUrl, incoming.onshapePartUrl),
    onshapeDrawingUrl: mergeValue(
      current.onshapeDrawingUrl,
      incoming.onshapeDrawingUrl,
    ),
    onshapeDrawingElementId:
      mergeValue(
        current.onshapeDrawingElementId,
        incoming.onshapeDrawingElementId,
      ),
    onshapeDocumentId: mergeValue(
      current.onshapeDocumentId,
      incoming.onshapeDocumentId,
    ),
    onshapeElementId: mergeValue(
      current.onshapeElementId,
      incoming.onshapeElementId,
    ),
    onshapePartId: mergeValue(current.onshapePartId, incoming.onshapePartId),
    onshapeServer: mergeValue(current.onshapeServer, incoming.onshapeServer),
    onshapeWvm: mergeValue(current.onshapeWvm, incoming.onshapeWvm),
    onshapeWvmId: mergeValue(current.onshapeWvmId, incoming.onshapeWvmId),
    assemblyUrl: mergeValue(current.assemblyUrl, incoming.assemblyUrl),
    branchVersionReference: mergeValue(
      current.branchVersionReference,
      incoming.branchVersionReference,
    ),
    finish: mergeValue(current.finish, incoming.finish),
    priority: mergeValue(current.priority, incoming.priority),
    printMaterial: mergeValue(current.printMaterial, incoming.printMaterial),
    printColor: mergeValue(current.printColor, incoming.printColor),
    infill: mergeValue(current.infill, incoming.infill),
    layerHeight: mergeValue(current.layerHeight, incoming.layerHeight),
    printerNotes: mergeValue(current.printerNotes, incoming.printerNotes),
    vendorName: mergeValue(current.vendorName, incoming.vendorName),
    quoteRequired: mergeValue(current.quoteRequired, incoming.quoteRequired),
    leadTime: mergeValue(current.leadTime, incoming.leadTime),
    vendorNotes: mergeValue(current.vendorNotes, incoming.vendorNotes),
    sourceDocument: mergeValue(current.sourceDocument, incoming.sourceDocument),
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

function hasOnshapeDefaults(defaults: SubmissionInput | undefined) {
  return Boolean(
    defaults?.partName ||
      defaults?.material ||
      defaults?.notes ||
      defaults?.onshapeDrawingUrl ||
      defaults?.submitter,
  );
}

// ---------------------------------------------------------------------------
// Onshape right-panel selection handshake
//
// The Element Right Panel never puts {$partId} in the iframe URL. Onshape
// delivers the user's selection over postMessage instead, but only after the
// extension announces itself with applicationInit. Knowing the real part lets
// the panel autofill with one or two targeted Onshape calls instead of
// scanning the whole document.
// ---------------------------------------------------------------------------

const onshapeInitMessageName = "applicationInit";
// The drawing lookup is the expensive part of a load, so wait for the user to
// settle on a part before spending it; clicking through parts costs only the
// cheap metadata fetch each time.
const detailsAfterSelectionDelayMs = 5000;

interface SelectedOnshapePart {
  partId: string;
  elementId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Onshape's field casing differs between its docs and real messages (a sample
// extension types the part id as `selectionID`), so match keys
// case-insensitively while keeping the caller's priority order.
function stringField(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) {
    return "";
  }

  const entries = Object.entries(record);
  for (const key of keys) {
    const wanted = key.toLowerCase();
    const value = entries.find(([entryKey]) => entryKey.toLowerCase() === wanted)?.[1];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

// Onshape leaves unsupported {$…} tokens in the URL verbatim; treat them as absent.
function queryParam(url: URL, ...keys: string[]) {
  for (const key of keys) {
    const value = url.searchParams.get(key)?.trim() ?? "";
    if (value && !/^\{\$[^}]+\}$/.test(value)) {
      return value;
    }
  }

  return "";
}

function onshapeContextFromPanelDataUrl(panelDataUrl: string) {
  const url = new URL(panelDataUrl, window.location.origin);
  const workspaceOrVersion = queryParam(url, "workspaceOrVersion").toLowerCase();
  const workspaceOrVersionId = queryParam(url, "workspaceOrVersionId");

  return {
    documentId: queryParam(url, "documentId", "did"),
    workspaceId:
      queryParam(url, "workspaceId", "wid") ||
      (workspaceOrVersion.startsWith("w") ? workspaceOrVersionId : ""),
    elementId: queryParam(url, "elementId", "eid"),
    partId: queryParam(url, "partId", "pid"),
    server: queryParam(url, "server"),
  };
}

// The parent frame is the Onshape client. Prefer what the browser reports
// about the embedding page, then the documented `server` parameter. With no
// evidence at all the default is only a guess, and the init message (which
// carries nothing sensitive) is posted to any origin so an enterprise domain
// still receives it; incoming messages are origin-checked regardless.
function onshapeParentOrigin(server: string) {
  const evidence = [
    window.location.ancestorOrigins?.item(0) ?? "",
    document.referrer,
    server,
  ];

  for (const candidate of evidence) {
    if (!candidate) {
      continue;
    }

    try {
      return { origin: new URL(candidate).origin, confident: true };
    } catch {
      // Try the next candidate.
    }
  }

  return { origin: "https://cad.onshape.com", confident: false };
}

function isTrustedOnshapeOrigin(origin: string, expectedOrigin: string) {
  if (origin === expectedOrigin) {
    return true;
  }

  try {
    return new URL(origin).hostname.endsWith(".onshape.com");
  } catch {
    return false;
  }
}

// Onshape's SELECTION payload is not fully documented, so read it tolerantly:
// a part is any entry carrying a partId, or a selectionId whose type says PART.
function selectedPartFromMessage(data: unknown): SelectedOnshapePart | null {
  const record = asRecord(data);
  if (!record) {
    return null;
  }

  if (stringField(record, "messageName").toUpperCase() !== "SELECTION") {
    return null;
  }

  const listed = [record.selections, record.selection, record.items, record.entities]
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []));
  const candidates = listed.length > 0 ? listed : [record];

  for (const candidate of candidates) {
    const item = asRecord(candidate);
    if (!item) {
      continue;
    }

    const type = stringField(
      item,
      "selectionType",
      "entityType",
      "type",
      "bodyType",
    ).toUpperCase();
    const partId =
      stringField(item, "partId") ||
      (type.includes("PART") ? stringField(item, "selectionId", "id") : "");
    if (!partId) {
      continue;
    }

    return {
      partId,
      elementId: stringField(item, "elementId") || stringField(record, "elementId"),
    };
  }

  return null;
}

function panelDataUrlForPart(panelDataUrl: string, part: SelectedOnshapePart) {
  const url = new URL(panelDataUrl, window.location.origin);
  url.searchParams.set("partId", part.partId);
  if (part.elementId) {
    url.searchParams.set("elementId", part.elementId);
  }
  url.searchParams.delete("__mode");
  return `${url.pathname}${url.search}`;
}

// Start the newly selected part from the URL-derived base so nothing autofilled
// for the previous part carries over.
function defaultsForPart(
  base: SubmissionInput,
  part: SelectedOnshapePart,
): SubmissionInput {
  let onshapePartUrl = base.onshapePartUrl ?? "";
  if (onshapePartUrl) {
    try {
      const url = new URL(onshapePartUrl);
      url.searchParams.set("partId", part.partId);
      if (part.elementId) {
        url.pathname = url.pathname.replace(/\/e\/[^/]+$/, `/e/${part.elementId}`);
      }
      onshapePartUrl = url.toString();
    } catch {
      // Keep the original link if it cannot be parsed.
    }
  }

  return {
    ...base,
    onshapePartId: part.partId,
    onshapeElementId: part.elementId || base.onshapeElementId,
    onshapePartUrl,
    partName: "",
    partNumber: "",
    notes: "",
    material: "",
    thickness: "",
  };
}

export function OnshapeSubmissionPanelLoader({
  initialDefaults,
  initialFieldOptions,
  panelDataUrl,
}: OnshapeSubmissionPanelLoaderProps) {
  const [panelAccessToken, setPanelAccessToken] = useState(storedAccessToken);
  // The URL the panel is currently loading data for. It starts as the iframe
  // URL and gains a partId once Onshape reports a selection.
  const [activePanelDataUrl, setActivePanelDataUrl] = useState(panelDataUrl);
  const activePanelDataUrlRef = useRef(panelDataUrl);
  const fieldOptionsLoadedRef = useRef(hasFieldOptions(initialFieldOptions));
  const loggedSelectionShapeRef = useRef(false);
  const [panelData, setPanelData] = useState<PanelData>(() => {
    const cachedPanelData = readCachedOnshapePanelData(panelDataUrl);

    return {
      defaults: mergeDefaults(
        initialDefaults,
        cachedPanelData?.defaults,
      ),
      fieldOptions: cachedPanelData?.fieldOptions ?? initialFieldOptions,
    };
  });

  useEffect(() => {
    rememberCurrentOnshapeSubmitHref();
  }, []);

  useEffect(() => {
    activePanelDataUrlRef.current = panelDataUrl;
    setActivePanelDataUrl(panelDataUrl);
  }, [panelDataUrl]);

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

  // Announce to Onshape and follow the user's selection while embedded.
  useEffect(() => {
    if (window.parent === window) {
      return;
    }

    const context = onshapeContextFromPanelDataUrl(panelDataUrl);
    const parent = onshapeParentOrigin(context.server);

    function receiveSelection(event: MessageEvent) {
      if (!isTrustedOnshapeOrigin(event.origin, parent.origin)) {
        return;
      }

      const messageName = stringField(asRecord(event.data), "messageName");
      if (messageName.toUpperCase() !== "SELECTION") {
        return;
      }

      // Log the first payload once so the real shape can be confirmed in
      // the browser console if autofill ever fails to pick up a part.
      if (!loggedSelectionShapeRef.current) {
        loggedSelectionShapeRef.current = true;
        console.info("[cheesy-parts] Onshape selection message", event.data);
      }

      const part = selectedPartFromMessage(event.data);
      if (!part) {
        return;
      }

      const currentPartId = onshapeContextFromPanelDataUrl(
        activePanelDataUrlRef.current,
      ).partId;
      if (currentPartId === part.partId) {
        return;
      }

      const nextUrl = panelDataUrlForPart(activePanelDataUrlRef.current, part);
      activePanelDataUrlRef.current = nextUrl;
      setPanelData((current) => ({
        ...current,
        defaults: defaultsForPart(initialDefaults, part),
        onshapeWarning: undefined,
      }));
      setActivePanelDataUrl(nextUrl);
    }

    window.addEventListener("message", receiveSelection);
    window.parent.postMessage(
      {
        documentId: context.documentId,
        workspaceId: context.workspaceId,
        elementId: context.elementId,
        messageName: onshapeInitMessageName,
      },
      parent.confident ? parent.origin : "*",
    );

    return () => window.removeEventListener("message", receiveSelection);
  }, [panelDataUrl, initialDefaults]);

  useEffect(() => {
    const abortController = new AbortController();

    function applyPanelData(body: PanelData, mode: string) {
      const includesOnshapeAuthState = mode !== "options";
      const bodyHasOnshapeDefaults = hasOnshapeDefaults(body.defaults);
      if (hasFieldOptions(body.fieldOptions)) {
        fieldOptionsLoadedRef.current = true;
      }

      setPanelData((current) => {
        const nextPanelData = {
          defaults: mergeDefaults(current.defaults, body.defaults, {
            preferIncoming: true,
          }),
          fieldOptions: hasFieldOptions(body.fieldOptions)
            ? body.fieldOptions
            : current.fieldOptions,
          onshapeAuthUrl: includesOnshapeAuthState
            ? body.onshapeAuthUrl ??
              (bodyHasOnshapeDefaults ? undefined : current.onshapeAuthUrl)
            : current.onshapeAuthUrl,
          onshapeWarning: includesOnshapeAuthState
            ? body.onshapeWarning ??
              (bodyHasOnshapeDefaults ? undefined : current.onshapeWarning)
            : current.onshapeWarning,
        };

        rememberOnshapePanelData(activePanelDataUrl, {
          defaults: nextPanelData.defaults,
          fieldOptions: nextPanelData.fieldOptions,
          detailsLoaded: mode === "details" ? true : undefined,
        });

        return nextPanelData;
      });
    }

    async function loadPanelData(mode: string) {
      try {
        const response = await fetch(
          panelDataUrlWithMode(activePanelDataUrl, mode),
          {
            cache: "no-store",
            credentials: "include",
            headers: headersForAccessToken(panelAccessToken),
            signal: abortController.signal,
          },
        );
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error ?? "Autofill data could not be loaded.");
        }

        applyPanelData(body, mode);
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

    // A fresh cached result for this exact context already has everything the
    // form needs. Re-fetching would only re-spend Onshape API calls (which are
    // capped per year), so skip the network entirely.
    const cachedPanelData = readCachedOnshapePanelData(activePanelDataUrl);
    if (
      cachedPanelData &&
      hasFieldOptions(cachedPanelData.fieldOptions) &&
      hasOnshapeDefaults(cachedPanelData.defaults)
    ) {
      // Metadata is cached, but the drawing lookup may never have run for this
      // part if the user clicked away before it fired. Schedule just that.
      const cachedPartId = onshapeContextFromPanelDataUrl(activePanelDataUrl).partId;
      if (cachedPartId && !cachedPanelData.detailsLoaded) {
        const timer = window.setTimeout(
          () => loadPanelData("details"),
          detailsAfterSelectionDelayMs,
        );
        return () => {
          window.clearTimeout(timer);
          abortController.abort();
        };
      }

      return () => abortController.abort();
    }

    // Field options come from Airtable and do not depend on the part, so they
    // are loaded once per panel, not once per selection.
    if (!fieldOptionsLoadedRef.current) {
      loadPanelData("options");
    }

    const { partId } = onshapeContextFromPanelDataUrl(activePanelDataUrl);
    let detailsTimer: number | undefined;
    if (partId) {
      // A known part: fetch its metadata now (cheap), and look for its drawing
      // only once the user has settled on it.
      loadPanelData("fast");
      detailsTimer = window.setTimeout(
        () => loadPanelData("details"),
        detailsAfterSelectionDelayMs,
      );
    } else {
      // No part yet: "details" is cheap here because the document scans are
      // skipped without a part to match, and it still brings in the user.
      loadPanelData("details");
    }

    return () => {
      if (detailsTimer !== undefined) {
        window.clearTimeout(detailsTimer);
      }
      abortController.abort();
    };
  }, [panelAccessToken, activePanelDataUrl]);

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
