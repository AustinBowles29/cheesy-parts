import {
  createManufacturingRequest,
  listManufacturingRequests,
  ValidationError,
} from "@/lib/service";
import type { QueueScope } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scope: QueueScope =
      searchParams.get("usage") === "comp" ? "comp" : "clone";
    const requests = await listManufacturingRequests(scope);
    return Response.json({ data: requests });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not load queue.",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const result = await createManufacturingRequest(await req.json());
    return Response.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof ValidationError ? 400 : 500;
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Request creation failed.",
      },
      { status },
    );
  }
}
