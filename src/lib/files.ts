import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AttachmentKind, AttachmentRef } from "./types";

function defaultUploadDir() {
  if (process.env.UPLOADS_DIR) {
    return path.isAbsolute(process.env.UPLOADS_DIR)
      ? process.env.UPLOADS_DIR
      : path.join(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOADS_DIR);
  }

  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), "cheesy-parts-tracker", "uploads");
  }

  return path.join(process.cwd(), ".data", "uploads");
}

const uploadDir = defaultUploadDir();

function safeFilename(filename: string) {
  return filename
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function attachmentKindForField(field: string): AttachmentKind {
  if (field === "drawing") {
    return "drawing";
  }

  if (field === "dxf") {
    return "dxf";
  }

  return "other";
}

export async function saveUploadedFiles(formData: FormData, requestUrl: string) {
  await fs.mkdir(uploadDir, { recursive: true });
  const baseUrl = new URL(requestUrl).origin;
  const attachments: AttachmentRef[] = [];

  for (const field of ["drawing", "dxf", "otherFiles"]) {
    const values = formData.getAll(field);

    for (const value of values) {
      if (!(value instanceof File) || value.size === 0) {
        continue;
      }

      const id = `${crypto.randomUUID()}-${safeFilename(value.name)}`;
      const bytes = Buffer.from(await value.arrayBuffer());
      await fs.writeFile(path.join(uploadDir, id), bytes);

      attachments.push({
        id,
        filename: value.name,
        contentType: value.type || "application/octet-stream",
        kind: attachmentKindForField(field),
        size: value.size,
        url: `${baseUrl}/api/files/${encodeURIComponent(id)}`,
      });
    }
  }

  return attachments;
}

export async function saveGeneratedFile(input: {
  bytes: Buffer;
  contentType: string;
  filename: string;
  kind: AttachmentKind;
  requestUrl: string;
}): Promise<AttachmentRef> {
  await fs.mkdir(uploadDir, { recursive: true });
  const baseUrl = new URL(input.requestUrl).origin;
  const id = `${crypto.randomUUID()}-${safeFilename(input.filename)}`;
  await fs.writeFile(path.join(uploadDir, id), input.bytes);

  return {
    id,
    filename: input.filename,
    contentType: input.contentType,
    kind: input.kind,
    size: input.bytes.length,
    url: `${baseUrl}/api/files/${encodeURIComponent(id)}`,
  };
}

export async function readUploadedFile(fileId: string) {
  const safeId = path.basename(fileId);
  const filePath = path.join(uploadDir, safeId);
  const data = await fs.readFile(filePath);

  return {
    data,
    filename: safeId,
  };
}
