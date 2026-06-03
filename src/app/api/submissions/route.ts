import { saveUploadedFiles } from "@/lib/files";
import { createManufacturingRequest, ValidationError } from "@/lib/service";
import type { SubmissionInput } from "@/lib/types";

export const runtime = "nodejs";

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

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const attachments = await saveUploadedFiles(formData, req.url);
      input = formDataToInput(formData, attachments);
    } else {
      input = await req.json();
    }

    const result = await createManufacturingRequest(input);
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
