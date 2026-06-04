import { NextResponse } from "next/server";
import {
  consumeOnshapeOAuthState,
  exchangeOnshapeCode,
  setOnshapeTokens,
} from "@/lib/integrations/onshape";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    return new Response(`Onshape OAuth failed: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response("Missing Onshape OAuth code.", { status: 400 });
  }

  try {
    const returnTo = await consumeOnshapeOAuthState(state);
    const tokens = await exchangeOnshapeCode(code);
    await setOnshapeTokens(tokens);
    return NextResponse.redirect(new URL(returnTo, url.origin));
  } catch (oauthError) {
    return new Response(
      oauthError instanceof Error
        ? oauthError.message
        : "Onshape OAuth callback failed.",
      { status: 400 },
    );
  }
}
