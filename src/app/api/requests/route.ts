import {
  createManufacturingRequest,
  listManufacturingRequests,
  ValidationError,
} from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const requests = await listManufacturingRequests();
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
