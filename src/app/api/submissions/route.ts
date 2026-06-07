import { saveUploadedFiles } from "@/lib/files";
import { createOnshapeDrawingPdfAttachment } from "@/lib/integrations/onshape";
import { createManufacturingRequest, ValidationError } from "@/lib/service";
import type { SubmissionInput } from "@/lib/types";

export const runtime = "nodejs";

function bearerToken(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

function formDataToInput(
  formData: FormData,
  attachments: SubmissionInput["attachments"],
) {
  const input: SubmissionInput = { attachments };

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      continue;
    }

    input[key as keyof SubmissionInput] = value as never;
  }

  return input;
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let input: SubmissionInput;
    const warnings: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const attachments = await saveUploadedFiles(formData, req.url);
      input = formDataToInput(formData, attachments);
    } else {
      input = await req.json();
    }

    if (!input.attachments?.some((attachment) => attachment.kind === "drawing")) {
      try {
        const drawingAttachment = await createOnshapeDrawingPdfAttachment(
          input,
          req.url,
          bearerToken(req),
        );
        if (drawingAttachment) {
          input.attachments = [...(input.attachments ?? []), drawingAttachment];
        }
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Onshape drawing PDF could not be attached: ${error.message}`
            : "Onshape drawing PDF could not be attached.",
        );
      }
    }

    const result = await createManufacturingRequest(input);
    return Response.json(
      { ...result, warnings: [...warnings, ...result.warnings] },
      { status: 201 },
    );
  } catch (error) {
    const status = error instanceof ValidationError ? 400 : 500;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Submission failed.",
      },
      { status },
    );
  }
}
