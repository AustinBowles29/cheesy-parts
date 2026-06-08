import { normalizeString } from "./manufacturing";
import type { AttachmentRef } from "./types";

export function isPdfAttachment(attachment: AttachmentRef) {
  const contentType = normalizeString(attachment.contentType).toLowerCase();
  const filename = normalizeString(attachment.filename).toLowerCase();

  return contentType === "application/pdf" || filename.endsWith(".pdf");
}

export function isDrawingPdfAttachment(attachment: AttachmentRef) {
  return (
    attachment.kind === "drawing" &&
    Boolean(attachment.url) &&
    isPdfAttachment(attachment)
  );
}

export function drawingLinkAttachment(url: string): AttachmentRef | null {
  const normalizedUrl = normalizeString(url);
  if (!normalizedUrl) {
    return null;
  }

  return {
    id: `onshape-drawing-link-${crypto.randomUUID()}`,
    filename: "Onshape drawing link",
    contentType: "text/uri-list",
    kind: "drawing",
    size: 0,
    url: normalizedUrl,
  };
}
