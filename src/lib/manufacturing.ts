import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  DEFAULT_FINISH,
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  FINISHES,
  MACHINE_TYPES,
  PRIORITIES,
  STATUSES,
} from "./constants";
import type {
  Category,
  Finish,
  MachineType,
  ManufacturingStatus,
  Priority,
} from "./types";

export function normalizeString(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function normalizeQuantity(value: unknown) {
  const numberValue =
    typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(numberValue) || numberValue < 1) {
    return 1;
  }

  return Math.floor(numberValue);
}

export function coerceStatus(value: unknown): ManufacturingStatus {
  return STATUSES.includes(value as ManufacturingStatus)
    ? (value as ManufacturingStatus)
    : DEFAULT_STATUS;
}

export function coerceCategory(value: unknown): Category {
  return CATEGORIES.includes(value as Category)
    ? (value as Category)
    : DEFAULT_CATEGORY;
}

export function coerceFinish(value: unknown): Finish {
  return FINISHES.includes(value as Finish) ? (value as Finish) : DEFAULT_FINISH;
}

export function coerceMachineType(value: unknown): MachineType | undefined {
  return MACHINE_TYPES.includes(value as MachineType)
    ? (value as MachineType)
    : undefined;
}

export function coercePriority(value: unknown): Priority {
  return PRIORITIES.includes(value as Priority)
    ? (value as Priority)
    : DEFAULT_PRIORITY;
}

export function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }

  return false;
}

export function deriveMachineType(input: {
  material?: string;
  thickness?: string;
  partName?: string;
  hasDrawing?: boolean;
}): MachineType {
  const material = normalizeString(input.material).toLowerCase();
  const partName = normalizeString(input.partName).toLowerCase();
  const thicknessNumber = Number.parseFloat(
    normalizeString(input.thickness).replace(/[^\d.]/g, ""),
  );
  const sheetLike =
    /(sheet|plate|panel|gusset|flat|bellypan|bracket|side rail|rail plate)/.test(
      partName,
    );

  if (
    /(3dp|3d print|printed|print)/.test(partName) ||
    /(pla|petg|abs|asa|tpu|nylon|onyx|carbon fiber nylon)/.test(material)
  ) {
    return "3DP";
  }

  if (/(shaft|spacer|standoff|round stock|roller|pin)/.test(partName)) {
    return "Lathe";
  }

  if (/(tube|extrusion|rail)/.test(partName) && !sheetLike) {
    return "Mill";
  }

  if (/(acrylic|polycarbonate|polycarb|wood|plywood)/.test(material)) {
    return Number.isFinite(thicknessNumber) && thicknessNumber <= 0.25
      ? "Laser"
      : "CNC Router";
  }

  if (/(steel|stainless|chromoly)/.test(material)) {
    return "Waterjet";
  }

  if (sheetLike && /(aluminum|6061|7075|5052)/.test(material)) {
    return "CNC Router";
  }

  if (sheetLike) {
    return "CNC Router";
  }

  return "Mill";
}

export function inferSubsystemFromTitle(title?: string) {
  const normalized = normalizeString(title);
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/\s*[-|]\s*(part studio|assembly|drawing).*$/i, "")
    .trim();
}

export function is3DPrint(machineType: MachineType) {
  return machineType === "3DP";
}

export function inferInitialStatus(input: {
  machineType: MachineType;
  attachments?: { kind: string }[];
  explicitStatus?: string;
}) {
  const explicit = STATUSES.find((status) => status === input.explicitStatus);
  if (explicit) {
    return explicit;
  }

  const attachments = input.attachments ?? [];
  const hasDrawing = attachments.some((attachment) => attachment.kind === "drawing");

  if (!hasDrawing) {
    return "Needs Drawing";
  }

  if (input.machineType === "Mill" || input.machineType === "Lathe") {
    return "Needs CAM";
  }

  return "Ready for Manufacture";
}
