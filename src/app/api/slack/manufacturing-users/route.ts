import { getManufacturingSlackUsers } from "@/lib/integrations/slack-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getManufacturingSlackUsers();
  return Response.json(result);
}
