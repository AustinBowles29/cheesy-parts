import { readUploadedFile } from "@/lib/files";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    const file = await readUploadedFile(fileId);

    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Content-Type": file.contentType,
      },
    });
  } catch {
    return Response.json({ error: "File not found." }, { status: 404 });
  }
}
