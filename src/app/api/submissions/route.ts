import { after } from "next/server";
import { saveUploadedFiles } from "@/lib/files";
import { drawingLinkAttachment, isDrawingPdfAttachment } from "@/lib/attachments";
import { createOnshapeDrawingPdfAttachment } from "@/lib/integrations/onshape";
import {
  attachManufacturingRequestDrawing,
  createManufacturingRequest,
  notifyManufacturingRequestCreated,
  ValidationError,
} from "@/lib/service";
import type { ManufacturingRequest, SubmissionInput } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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

function drawingPdfWarning(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Onshape drawing PDF export failed.";

  if (message.includes("failed (403)")) {
    return [
      "Onshape drawing link was saved, but the PDF could not be exported.",
      `Onshape returned 403 during export. Details: ${message}`,
    ].join(" ");
  }

  return `Onshape drawing PDF could not be attached: ${message}`;
}

function ensureDrawingLinkAttachment(input: SubmissionInput) {
  if (input.attachments?.some((attachment) => attachment.kind === "drawing")) {
    return input;
  }

  const fallbackDrawingLink = drawingLinkAttachment(input.onshapeDrawingUrl ?? "");
  if (!fallbackDrawingLink) {
    return input;
  }

  return {
    ...input,
    attachments: [...(input.attachments ?? []), fallbackDrawingLink],
  };
}

async function finishSubmissionAfterResponse(input: {
  submissionInput: SubmissionInput;
  request: ManufacturingRequest;
  requestUrl: string;
  bearerToken: string;
}) {
  let request = input.request;
  const warnings: string[] = [];
  const hasDrawingPdf = request.attachments.some(isDrawingPdfAttachment);

  if (!hasDrawingPdf) {
    try {
      const drawingAttachment = await createOnshapeDrawingPdfAttachment(
        input.submissionInput,
        input.requestUrl,
        input.bearerToken,
      );
      if (drawingAttachment) {
        const attachments = [
          ...request.attachments.filter(
            (attachment) => attachment.id && !attachment.id.startsWith("onshape-drawing-link-"),
          ),
          drawingAttachment,
        ];
        const result = await attachManufacturingRequestDrawing(request, attachments);
        request = result.data;
        warnings.push(...result.warnings);
      }
    } catch (error) {
      warnings.push(`${drawingPdfWarning(error)} Saved the Onshape drawing link instead.`);
      console.error("Onshape drawing PDF export failed after submission", error);
    }
  }

  const notificationResult = await notifyManufacturingRequestCreated(request);
  warnings.push(...notificationResult.warnings);

  if (warnings.length > 0) {
    console.warn("Submission background work completed with warnings", warnings);
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let input: SubmissionInput;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const attachments = await saveUploadedFiles(formData, req.url);
      input = formDataToInput(formData, attachments);
    } else {
      input = await req.json();
    }

    input = ensureDrawingLinkAttachment(input);

    const authToken = bearerToken(req);
    const result = await createManufacturingRequest(input, { notify: false });
    after(() =>
      finishSubmissionAfterResponse({
        submissionInput: input,
        request: result.data,
        requestUrl: req.url,
        bearerToken: authToken,
      }),
    );

    return Response.json(result, { status: 201 });
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
