import { listAirtablePartNumbers } from "@/lib/integrations/airtable";
import { normalizeString } from "@/lib/manufacturing";
import { partNumberCore } from "@/lib/part-numbering";
import type { PartNumberUsage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const partNumber = normalizeString(searchParams.get("partNumber"));
  // Scope duplicates to the selected submit target: "clone" checks only the
  // Clone Bot table; "comp" checks every other configured queue table.
  const usage: PartNumberUsage =
    searchParams.get("usage") === "comp" ? "comp" : "clone";

  if (!partNumber) {
    return Response.json({
      data: { partNumber, valid: false, duplicate: false },
    });
  }

  // A recognizable number has a 4-digit subsystem core (e.g. 0601 in 26-P-0601).
  const valid = partNumberCore(partNumber) !== "";

  try {
    const existing = await listAirtablePartNumbers(usage);
    const target = partNumber.toLowerCase();
    const duplicate = existing.some((value) => value.toLowerCase() === target);

    return Response.json({ data: { partNumber, valid, duplicate } });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Part number could not be checked.",
      },
      { status: 500 },
    );
  }
}
