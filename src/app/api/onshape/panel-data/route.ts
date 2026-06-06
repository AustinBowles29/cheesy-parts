import { loadOnshapePanelData } from "@/lib/onshape-panel-defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function searchParamsToRecord(searchParams: URLSearchParams) {
  const params: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    const current = params[key];
    if (Array.isArray(current)) {
      current.push(value);
    } else if (current !== undefined) {
      params[key] = [current, value];
    } else {
      params[key] = value;
    }
  }

  return params;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const data = await loadOnshapePanelData(
      searchParamsToRecord(url.searchParams),
    );

    return Response.json(data);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Onshape panel data could not be loaded.",
      },
      { status: 500 },
    );
  }
}
