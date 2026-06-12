import { listAirtablePartNumbers } from "@/lib/integrations/airtable";
import {
  listOnshapeDocumentPartNumbers,
  onshapeContextFromSubmissionInput,
  updateOnshapeSelectedPartMetadata,
} from "@/lib/integrations/onshape";
import { normalizeString } from "@/lib/manufacturing";
import { nextPartNumberForSubsystem } from "@/lib/part-numbering";
import type { SubmissionInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SubmissionInput;
    const accessToken = bearerToken(req);
    const subsystem = normalizeString(body.subsystem);
    const description = normalizeString(body.description ?? body.notes);
    const material = normalizeString(body.material);
    const context = onshapeContextFromSubmissionInput(body);

    if (!accessToken) {
      return Response.json(
        { error: "Connect Onshape before assigning a part number." },
        { status: 401 },
      );
    }

    if (!context) {
      return Response.json(
        { error: "Select a part before assigning a part number." },
        { status: 400 },
      );
    }

    const warnings: string[] = [];
    const [airtablePartNumbers, onshapePartNumbers] = await Promise.all([
      listAirtablePartNumbers(),
      listOnshapeDocumentPartNumbers(context, accessToken).catch((error) => {
        warnings.push(
          error instanceof Error
            ? `Current Onshape document part numbers could not be checked: ${error.message}`
            : "Current Onshape document part numbers could not be checked.",
        );
        return [];
      }),
    ]);
    const generated = nextPartNumberForSubsystem({
      subsystem,
      existingPartNumbers: [...airtablePartNumbers, ...onshapePartNumbers],
    });
    const updateResult = await updateOnshapeSelectedPartMetadata({
      context,
      accessToken,
      partNumber: generated.partNumber,
      description,
      material,
    });
    if (updateResult.warning) {
      warnings.push(updateResult.warning);
    }

    return Response.json({
      data: {
        partNumber: generated.partNumber,
        partNumberCore: generated.core,
        subsystem: generated.subsystem.label,
        subsystemPrefix: generated.subsystem.prefix,
        description,
        material,
        materialWritten: updateResult.materialWritten,
      },
      warnings,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Part number could not be assigned.",
      },
      { status: 500 },
    );
  }
}
