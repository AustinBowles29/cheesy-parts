import { deleteManufacturingRequest, ValidationError } from "@/lib/service";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      airtableTableId?: string;
      airtableTableName?: string;
    };

    const result = await deleteManufacturingRequest({
      id,
      airtableTableId: body.airtableTableId,
      airtableTableName: body.airtableTableName,
    });

    return Response.json(result);
  } catch (error) {
    const status = error instanceof ValidationError ? 400 : 500;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Delete failed.",
      },
      { status },
    );
  }
}
