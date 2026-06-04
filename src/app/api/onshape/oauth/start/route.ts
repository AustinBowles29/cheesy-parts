import { NextResponse } from "next/server";
import {
  buildOnshapeAuthorizationUrl,
  isOnshapeOAuthConfigured,
  isSafeReturnTo,
  setOnshapeOAuthState,
} from "@/lib/integrations/onshape";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isOnshapeOAuthConfigured()) {
    return new Response("Onshape OAuth is not configured.", { status: 500 });
  }

  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo");
  const safeReturnTo = isSafeReturnTo(returnTo) ? (returnTo as string) : "/onshape";
  const state = crypto.randomUUID();

  await setOnshapeOAuthState(state, safeReturnTo);

  return NextResponse.redirect(buildOnshapeAuthorizationUrl(state));
}
