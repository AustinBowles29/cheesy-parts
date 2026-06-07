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

function bearerToken(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("__mode");
    url.searchParams.delete("__mode");
    const accessToken = bearerToken(req);
    const data = await loadOnshapePanelData(
      searchParamsToRecord(url.searchParams),
      mode === "fast"
        ? {
            accessToken,
            includeFieldOptions: false,
            includeBom: false,
            includeDrawing: false,
          }
        : mode === "details"
          ? {
              accessToken,
              includeFieldOptions: false,
              includeUser: false,
            }
          : mode === "options"
            ? {
                accessToken,
                includeMetadata: false,
                includeUser: false,
              }
            : { accessToken },
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
