import {
  getAirtableRequest,
  isAirtableConfigured,
} from "@/lib/integrations/airtable";
import { isDrawingPdfAttachment } from "@/lib/attachments";
import { findManufacturingRequest } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function attachmentFilename(filename: string) {
  return filename.replace(/["\r\n]/g, "").trim() || "drawing.pdf";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const tableHint = {
      airtableTableId: url.searchParams.get("tableId") ?? undefined,
      airtableTableName: url.searchParams.get("tableName") ?? undefined,
    };
    let request = null;

    if (isAirtableConfigured()) {
      try {
        request = await getAirtableRequest(id, tableHint);
      } catch {
        request = null;
      }
    }

    request ??= await findManufacturingRequest(id, tableHint);

    const drawing = request?.attachments.find(isDrawingPdfAttachment);
    if (!drawing?.url) {
      return Response.json({ error: "Drawing PDF not found." }, { status: 404 });
    }

    const response = await fetch(drawing.url);
    if (!response.ok) {
      return Response.json({ error: "Drawing PDF not found." }, { status: 404 });
    }

    return new Response(response.body, {
      headers: {
        "Content-Disposition": `attachment; filename="${attachmentFilename(
          drawing.filename,
        )}"`,
        "Content-Type":
          response.headers.get("content-type") ||
          drawing.contentType ||
          "application/pdf",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Drawing PDF not found.",
      },
      { status: 500 },
    );
  }
}
