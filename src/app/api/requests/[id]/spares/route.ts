import { createSpareRequest, ValidationError } from "@/lib/service";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      spareQuantity?: number | string;
      submitter?: string;
      submitterSlackId?: string;
      airtableTableId?: string;
      airtableTableName?: string;
    };

    const result = await createSpareRequest({
      id,
      spareQuantity: body.spareQuantity ?? 1,
      submitter: body.submitter,
      submitterSlackId: body.submitterSlackId,
      airtableTableId: body.airtableTableId,
      airtableTableName: body.airtableTableName,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof ValidationError ? 400 : 500;
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Spare request failed.",
      },
      { status },
    );
  }
}
