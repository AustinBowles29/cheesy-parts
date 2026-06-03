export const STATUSES = [
  "Needs CAM",
  "Needs Drawing",
  "Ready for Manufacture",
  "Manufacturing In Progress",
  "Ready for Assembly",
  "Ready for Anodize/Powdercoat",
  "Done for Spares",
] as const;

export const FINISHES = ["Powder Coat", "Anodize", "Raw", "Other"] as const;

export const CATEGORIES = [
  "Robot",
  "Spares",
  "Lab General",
  "Offseason",
  "Other",
] as const;

export const MACHINE_TYPES = [
  "CNC Router",
  "Mill",
  "Lathe",
  "Laser",
  "Waterjet",
  "3DP",
  "Manual",
  "Vendor",
  "Other",
] as const;

export const ATTACHMENT_KINDS = ["drawing", "dxf", "other"] as const;
export const PRIORITIES = ["Critical", "High", "Normal", "Low"] as const;

export const DEFAULT_STATUS = "Needs CAM";
export const DEFAULT_CATEGORY = "Robot";
export const DEFAULT_FINISH = "Raw";
export const DEFAULT_PRIORITY = "Normal";
