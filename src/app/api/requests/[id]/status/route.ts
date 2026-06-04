import { coerceStatus } from "@/lib/manufacturing";
import { changeManufacturingStatus, ValidationError } from "@/lib/service";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      status?: string;
      changedBy?: string;
      changedBySlackId?: string;
      airtableTableId?: string;
      airtableTableName?: string;
    };

    const result = await changeManufacturingStatus({
      id,
      status: coerceStatus(body.status),
      changedBy: body.changedBy,
      changedBySlackId: body.changedBySlackId,
      airtableTableId: body.airtableTableId,
      airtableTableName: body.airtableTableName,
    });

    return Response.json(result);
  } catch (error) {
    const status = error instanceof ValidationError ? 400 : 500;
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Status update failed.",
      },
      { status },
    );
  }
}
