"use client";

import {
  Boxes,
  ClipboardCheck,
  FileUp,
  Link as LinkIcon,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  CATEGORIES,
  FINISHES,
  MACHINE_TYPES,
  PRIORITIES,
} from "@/lib/constants";
import { deriveMachineType } from "@/lib/manufacturing";
import type {
  MachineType,
  SlackUser,
  SubmissionFieldOptions,
  SubmissionInput,
} from "@/lib/types";
import { ToastViewport, useToasts } from "./toast";

interface OnshapeSubmissionPanelProps {
  defaults: SubmissionInput;
  fieldOptions: SubmissionFieldOptions;
  manufacturingUsers: SlackUser[];
  onshapeAuthUrl?: string;
  onshapeWarning?: string;
  userWarning?: string;
}

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message: string; requestId: string }
  | { status: "error"; message: string };

const requiredFields = [
  { name: "partName", label: "Part name" },
  { name: "partNumber", label: "Part number" },
  { name: "material", label: "Material" },
  { name: "quantity", label: "Quantity" },
  { name: "machineType", label: "Machine type" },
  { name: "submitter", label: "Submitter" },
  { name: "category", label: "Category" },
  { name: "finish", label: "Finish" },
  { name: "priority", label: "Priority" },
] as const;

function toastForWarning(warning: string) {
  if (warning.toLowerCase().includes("slack")) {
    return {
      variant: "info" as const,
      title: "Slack not configured",
      message:
        "Submissions will still be saved, but Slack notifications will not be sent.",
    };
  }

  if (warning.toLowerCase().includes("onshape")) {
    return {
      variant: "info" as const,
      title: "Onshape metadata",
      message: warning,
    };
  }

  return {
    variant: "info" as const,
    title: "Integration notice",
    message: warning,
  };
}

function initialToasts(...warnings: Array<string | undefined>) {
  return warnings
    .filter((warning): warning is string => Boolean(warning))
    .map((warning) => toastForWarning(warning));
}

function dropdownInitialValue(value: string | undefined, options: string[]) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || options.length === 0) {
    return trimmed;
  }

  return options.includes(trimmed) ? trimmed : "";
}

export function OnshapeSubmissionPanel({
  defaults,
  fieldOptions,
  manufacturingUsers,
  onshapeAuthUrl,
  onshapeWarning,
  userWarning,
}: OnshapeSubmissionPanelProps) {
  const users =
    manufacturingUsers.length > 0
      ? manufacturingUsers
      : [{ slackUserId: "local-manufacturing", displayName: "Manufacturing" }];
  const [selectedSubmitterId, setSelectedSubmitterId] = useState(
    users[0].slackUserId,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [partName, setPartName] = useState(defaults.partName ?? "");
  const [partNumber, setPartNumber] = useState(defaults.partNumber ?? "");
  const [material, setMaterial] = useState(defaults.material ?? "");
  const [thickness, setThickness] = useState(defaults.thickness ?? "");
  const [subsystem, setSubsystem] = useState(() =>
    dropdownInitialValue(defaults.subsystem, fieldOptions.subsystems),
  );
  const [vendorName, setVendorName] = useState(() =>
    dropdownInitialValue(defaults.vendorName, fieldOptions.vendors),
  );
  const [hasDrawing, setHasDrawing] = useState(false);
  const [machineOverride, setMachineOverride] = useState(defaults.machineType ?? "");
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
  });
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const { toasts, addToast, dismissToast } = useToasts(
    initialToasts(
      userWarning,
      onshapeAuthUrl ? undefined : onshapeWarning,
      fieldOptions.warning,
    ),
  );

  const selectedSubmitter =
    users.find((user) => user.slackUserId === selectedSubmitterId) ?? users[0];
  const inferredMachineType = useMemo(
    () => deriveMachineType({ material, thickness, partName, hasDrawing }),
    [material, thickness, partName, hasDrawing],
  );
  const machineType = (machineOverride || inferredMachineType) as MachineType;
  const is3DP = machineType === "3DP";
  const isVendor = machineType === "Vendor";

  function clearInvalid(name: string) {
    setInvalidFields((current) => {
      if (!current.has(name)) {
        return current;
      }

      const next = new Set(current);
      next.delete(name);
      return next;
    });
  }

  function invalidProps(name: string) {
    return {
      "aria-invalid": invalidFields.has(name) ? true : undefined,
    };
  }

  function showIntegrationWarnings(warnings: string[] = []) {
    for (const warning of warnings) {
      if (warning.toLowerCase().includes("slack")) {
        addToast({
          variant: "info",
          title: "Slack not configured",
          message:
            "Submissions will still be saved, but Slack notifications will not be sent.",
        });
      } else {
        addToast({
          variant: "warning",
          title: "Integration warning",
          message: warning,
        });
      }
    }
  }

  function validateForm(formData: FormData) {
    const missing = requiredFields.filter((field) => {
      if (field.name === "machineType") {
        return machineType.trim().length === 0;
      }

      if (field.name === "submitter") {
        return selectedSubmitter.displayName.trim().length === 0;
      }

      const value = formData.get(field.name);
      return typeof value !== "string" || value.trim().length === 0;
    });

    if (missing.length === 0) {
      setInvalidFields(new Set());
      return true;
    }

    setInvalidFields(new Set(missing.map((field) => field.name)));
    addToast({
      variant: "warning",
      title: "Missing required fields",
      message:
        missing.length === 1
          ? `${missing[0].label} is required before submitting.`
          : `Please complete required fields: ${missing
              .map((field) => field.label)
              .join(", ")}.`,
    });

    const firstInvalid = formRef.current?.elements.namedItem(missing[0].name);
    if (firstInvalid instanceof HTMLElement) {
      firstInvalid.focus();
    }

    return false;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    if (!validateForm(formData)) {
      return;
    }

    setSubmitState({ status: "submitting" });

    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        body: formData,
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Submission failed.");
      }

      addToast({
        variant: "success",
        title: "Part submitted",
        message: `${partName} was added to the fabrication queue.`,
      });
      showIntegrationWarnings(body.warnings);
      setSubmitState({
        status: "success",
        message:
          body.warnings?.length > 0
            ? `Submitted with warnings: ${body.warnings.join(" ")}`
            : "Part submitted to the manufacturing queue.",
        requestId: body.data.id,
      });
    } catch (error) {
      addToast({
        variant: "danger",
        title: "Submission failed",
        message: error instanceof Error ? error.message : "Submission failed.",
      });
      setSubmitState({
        status: "error",
        message: error instanceof Error ? error.message : "Submission failed.",
      });
    }
  }

  return (
    <main className="min-h-screen bg-[#f7faff] text-[#141515]">
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      <form
        ref={formRef}
        noValidate
        onSubmit={submit}
        className="page-transition mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8"
      >
        <header className="flex flex-col gap-4 border-b border-[#d8e2f0] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-[#0b3d91]">
              Team 254 Manufacturing
            </p>
            <h1 className="mt-1 text-3xl font-semibold">
              Submit selected CAD part
            </h1>
          </div>
          <Link
            href="/"
            className="interactive inline-flex h-10 items-center gap-2 rounded-md border border-[#b8c9e3] bg-white px-3 text-sm font-medium hover:bg-[#edf4ff]"
          >
            <ClipboardCheck size={17} aria-hidden="true" />
            Queue
          </Link>
        </header>

        <section className="rounded-lg border border-[#b7cef2] bg-[#eef5ff] p-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0b3d91]">
                <Boxes size={17} aria-hidden="true" />
                Selected part
              </div>
              <div className="mt-2 text-lg font-semibold">
                {partName || "No part selected"}
              </div>
              <div className="text-sm text-[#586158]">
                {partNumber || "No part number"}
              </div>
            </div>
            <InfoItem label="Source document" value={defaults.sourceDocument || "-"} />
            <InfoItem
              label="Branch/version"
              value={defaults.branchVersionReference || "-"}
            />
            <div>
              <div className="text-xs font-semibold text-[#586158]">
                Assembly/version
              </div>
              {defaults.assemblyUrl ? (
                <a
                  href={defaults.assemblyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-[#0b3d91] hover:underline"
                >
                  Open assembly
                  <LinkIcon size={14} aria-hidden="true" />
                </a>
              ) : (
                <div className="mt-1 text-sm">-</div>
              )}
            </div>
          </div>
        </section>
        {onshapeAuthUrl && (
          <section className="rounded-lg border border-[#b7cef2] bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-[#0b3d91]">
                  Onshape metadata
                </div>
                <p className="mt-1 text-sm text-[#5c6f8a]">
                  {onshapeWarning ??
                    "Connect Onshape to auto-fill part metadata from CAD."}
                </p>
              </div>
              <a
                href={onshapeAuthUrl}
                target="_blank"
                rel="noreferrer"
                className="interactive inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#0b3d91] px-3 text-sm font-semibold text-white hover:bg-[#082f6f]"
              >
                <LinkIcon size={16} aria-hidden="true" />
                Connect Onshape
              </a>
            </div>
          </section>
        )}
        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-[#d8e2f0] bg-white p-4">
            <div className="mb-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0b3d91]">
                <Boxes size={17} aria-hidden="true" />
                Part information
              </div>
              <p className="mt-1 text-sm text-[#5c6f8a]">
                Auto-filled from Onshape when available. Review and edit before
                submitting.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                <span>Part name</span>
                <input
                  name="partName"
                  value={partName}
                  onChange={(event) => {
                    setPartName(event.target.value);
                    clearInvalid("partName");
                  }}
                  required
                  {...invalidProps("partName")}
                />
              </label>
              <label className="field">
                <span>Part number</span>
                <input
                  name="partNumber"
                  value={partNumber}
                  onChange={(event) => {
                    setPartNumber(event.target.value);
                    clearInvalid("partNumber");
                  }}
                  required
                  {...invalidProps("partNumber")}
                />
              </label>
              <label className="field sm:col-span-2">
                <span>Notes</span>
                <textarea
                  name="notes"
                  defaultValue={defaults.notes ?? defaults.description}
                  rows={3}
                  placeholder="Short design or manufacturing context"
                />
              </label>
              <label className="field">
                <span>Material</span>
                <input
                  name="material"
                  value={material}
                  onChange={(event) => {
                    setMaterial(event.target.value);
                    clearInvalid("material");
                  }}
                  required
                  {...invalidProps("material")}
                />
              </label>
              <label className="field">
                <span>Thickness</span>
                <input
                  name="thickness"
                  value={thickness}
                  onChange={(event) => setThickness(event.target.value)}
                  placeholder="0.125 in"
                />
              </label>
              <label className="field">
                <span>Quantity</span>
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  defaultValue={defaults.quantity ?? 1}
                  onChange={() => clearInvalid("quantity")}
                  required
                  {...invalidProps("quantity")}
                />
              </label>
              <label className="field">
                <span>Subsystem</span>
                {fieldOptions.subsystems.length > 0 ? (
                  <select
                    name="subsystem"
                    value={subsystem}
                    onChange={(event) => setSubsystem(event.target.value)}
                  >
                    <option value="">Select subsystem</option>
                    {fieldOptions.subsystems.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name="subsystem"
                    value={subsystem}
                    onChange={(event) => setSubsystem(event.target.value)}
                  />
                )}
              </label>
              <label className="field">
                <span>Machine type</span>
                <select
                  name="machineType"
                  value={machineType}
                  onChange={(event) => {
                    setMachineOverride(event.target.value as MachineType);
                    clearInvalid("machineType");
                  }}
                  required
                  {...invalidProps("machineType")}
                >
                  {MACHINE_TYPES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-[#d8e2f0] bg-white p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#0b3d91]">
              <FileUp size={17} aria-hidden="true" />
              Submission details
            </div>
            <div className="grid gap-3">
              <label className="field">
                <span>Submitter</span>
                <select
                  value={selectedSubmitterId}
                  onChange={(event) => {
                    setSelectedSubmitterId(event.target.value);
                    clearInvalid("submitter");
                  }}
                  required
                  {...invalidProps("submitter")}
                >
                  {users.map((user) => (
                    <option key={user.slackUserId} value={user.slackUserId}>
                      {user.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <input
                type="hidden"
                name="submitter"
                value={selectedSubmitter.displayName}
              />
              <input
                type="hidden"
                name="submitterSlackId"
                value={selectedSubmitter.slackUserId}
              />
              <label className="field">
                <span>Category</span>
                <select
                  name="category"
                  defaultValue={defaults.category ?? "Robot"}
                  onChange={() => clearInvalid("category")}
                  required
                  {...invalidProps("category")}
                >
                  {CATEGORIES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Finish</span>
                <select
                  name="finish"
                  defaultValue={defaults.finish ?? "Raw"}
                  onChange={() => clearInvalid("finish")}
                  required
                  {...invalidProps("finish")}
                >
                  {FINISHES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Priority</span>
                <select
                  name="priority"
                  defaultValue={defaults.priority || "Normal"}
                  onChange={() => clearInvalid("priority")}
                  required
                  {...invalidProps("priority")}
                >
                  {PRIORITIES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        {is3DP && (
          <section className="rounded-lg border border-[#d8e2f0] bg-white p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#0b3d91]">
              <Boxes size={17} aria-hidden="true" />
              3DP details
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="field">
                <span>Print material</span>
                <input
                  name="printMaterial"
                  defaultValue={defaults.printMaterial}
                  placeholder="PLA, PETG, Onyx"
                />
              </label>
              <label className="field">
                <span>Color</span>
                <input name="printColor" defaultValue={defaults.printColor} />
              </label>
              <label className="field">
                <span>Infill</span>
                <input name="infill" defaultValue={defaults.infill} />
              </label>
              <label className="field">
                <span>Layer height</span>
                <input name="layerHeight" defaultValue={defaults.layerHeight} />
              </label>
              <label className="field sm:col-span-2 lg:col-span-1">
                <span>Printer notes</span>
                <input name="printerNotes" defaultValue={defaults.printerNotes} />
              </label>
            </div>
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-[#d8e2f0] bg-white p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#0b3d91]">
              <LinkIcon size={17} aria-hidden="true" />
              CAD links
            </div>
            <div className="grid gap-3">
              <label className="field">
                <span>Onshape part URL</span>
                <input
                  name="onshapePartUrl"
                  defaultValue={defaults.onshapePartUrl}
                />
              </label>
              <label className="field">
                <span>Onshape drawing URL</span>
                <input
                  name="onshapeDrawingUrl"
                  defaultValue={defaults.onshapeDrawingUrl}
                />
                {defaults.onshapeDrawingElementId && (
                  <input
                    type="hidden"
                    name="onshapeDrawingElementId"
                    value={defaults.onshapeDrawingElementId}
                  />
                )}
                {defaults.onshapeDocumentId && (
                  <input
                    type="hidden"
                    name="onshapeDocumentId"
                    value={defaults.onshapeDocumentId}
                  />
                )}
                {defaults.onshapeWvm && (
                  <input
                    type="hidden"
                    name="onshapeWvm"
                    value={defaults.onshapeWvm}
                  />
                )}
                {defaults.onshapeWvmId && (
                  <input
                    type="hidden"
                    name="onshapeWvmId"
                    value={defaults.onshapeWvmId}
                  />
                )}
              </label>
              <label className="field">
                <span>Assembly URL</span>
                <input
                  name="assemblyUrl"
                  defaultValue={defaults.assemblyUrl}
                />
              </label>
              <label className="field">
                <span>Branch/version reference</span>
                <input
                  name="branchVersionReference"
                  defaultValue={defaults.branchVersionReference}
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-[#d8e2f0] bg-white p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#0b3d91]">
              <FileUp size={17} aria-hidden="true" />
              Drawing PDF
            </div>
            <div className="grid gap-3">
              <label className="field">
                <span>Drawing PDF</span>
                <input
                  name="drawing"
                  type="file"
                  accept="application/pdf"
                  onChange={(event) =>
                    setHasDrawing((event.currentTarget.files?.length ?? 0) > 0)
                  }
                />
              </label>
            </div>
          </div>
        </section>

        {isVendor && (
          <section className="rounded-lg border border-[#d8e2f0] bg-white p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#0b3d91]">
              <ClipboardCheck size={17} aria-hidden="true" />
              Vendor details
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="field">
                <span>Vendor name</span>
                {fieldOptions.vendors.length > 0 ? (
                  <select
                    name="vendorName"
                    value={vendorName}
                    onChange={(event) => setVendorName(event.target.value)}
                  >
                    <option value="">Select vendor</option>
                    {fieldOptions.vendors.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name="vendorName"
                    value={vendorName}
                    onChange={(event) => setVendorName(event.target.value)}
                  />
                )}
              </label>
              <label className="field">
                <span>Quote required?</span>
                <select
                  name="quoteRequired"
                  defaultValue={
                    defaults.quoteRequired === true ||
                    defaults.quoteRequired === "true"
                      ? "true"
                      : "false"
                  }
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>
              <label className="field">
                <span>Lead time</span>
                <input name="leadTime" defaultValue={defaults.leadTime} />
              </label>
              <label className="field">
                <span>Vendor notes</span>
                <input name="vendorNotes" defaultValue={defaults.vendorNotes} />
              </label>
            </div>
          </section>
        )}

        <div className="flex justify-end border-t border-[#d8e2f0] pt-4">
          <button
            type="submit"
            disabled={submitState.status === "submitting"}
            className="interactive inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#0b3d91] px-4 text-sm font-semibold text-white hover:bg-[#082f6f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send size={17} aria-hidden="true" />
            {submitState.status === "submitting" ? "Submitting" : "Submit part"}
          </button>
        </div>
      </form>
    </main>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-[#586158]">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
