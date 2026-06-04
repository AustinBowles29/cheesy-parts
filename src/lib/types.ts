import type {
  ATTACHMENT_KINDS,
  CATEGORIES,
  FINISHES,
  MACHINE_TYPES,
  PRIORITIES,
  STATUSES,
} from "./constants";

export type ManufacturingStatus = (typeof STATUSES)[number];
export type Finish = (typeof FINISHES)[number];
export type Category = (typeof CATEGORIES)[number];
export type MachineType = (typeof MACHINE_TYPES)[number];
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];

export type AuditAction =
  | "submitted"
  | "status_changed"
  | "spares_created"
  | "airtable_synced";

export interface AttachmentRef {
  id: string;
  filename: string;
  contentType: string;
  kind: AttachmentKind;
  size: number;
  url?: string;
}

export interface AuditEntry {
  id: string;
  action: AuditAction;
  actor: string;
  actorSlackId?: string;
  timestamp: string;
  fromStatus?: ManufacturingStatus;
  toStatus?: ManufacturingStatus;
  note?: string;
}

export interface SlackUser {
  slackUserId: string;
  displayName: string;
}

export interface ManufacturingRequest {
  id: string;
  airtableId?: string;
  airtableUrl?: string;
  partName: string;
  partNumber: string;
  description: string;
  quantity: number;
  subsystem: string;
  category: Category;
  material: string;
  thickness: string;
  finish: Finish;
  machineType: MachineType;
  onshapePartUrl: string;
  onshapeDrawingUrl: string;
  assemblyUrl: string;
  branchVersionReference: string;
  submitter: string;
  submitterSlackId?: string;
  submittedAt: string;
  status: ManufacturingStatus;
  attachments: AttachmentRef[];
  manufacturingNotes: string;
  sourceRequestId?: string;
  priority?: Priority;
  printMaterial?: string;
  printColor?: string;
  infill?: string;
  layerHeight?: string;
  printerNotes?: string;
  vendorName?: string;
  quoteRequired?: boolean;
  leadTime?: string;
  vendorNotes?: string;
  auditHistory: AuditEntry[];
}

export interface SubmissionInput {
  partName?: string;
  partNumber?: string;
  description?: string;
  quantity?: number | string;
  subsystem?: string;
  category?: string;
  material?: string;
  thickness?: string;
  finish?: string;
  machineType?: string;
  onshapePartUrl?: string;
  onshapeDrawingUrl?: string;
  assemblyUrl?: string;
  branchVersionReference?: string;
  submitter?: string;
  submitterSlackId?: string;
  status?: string;
  attachments?: AttachmentRef[];
  manufacturingNotes?: string;
  sourceRequestId?: string;
  priority?: string;
  printMaterial?: string;
  printColor?: string;
  infill?: string;
  layerHeight?: string;
  printerNotes?: string;
  vendorName?: string;
  quoteRequired?: boolean | string;
  leadTime?: string;
  vendorNotes?: string;
  sourceDocument?: string;
}

export interface SubmissionFieldOptions {
  subsystems: string[];
  vendors: string[];
  warning?: string;
}

export interface ServiceResult<T> {
  data: T;
  warnings: string[];
}
