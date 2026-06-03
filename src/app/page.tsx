import type { Metadata } from "next";
import { QueueDashboard } from "@/components/queue-dashboard";
import { getManufacturingSlackUsers } from "@/lib/integrations/slack-users";
import { listManufacturingRequests } from "@/lib/service";
import type { ManufacturingRequest, SlackUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Team 254 Manufacturing Queue",
};

export default async function Home() {
  let requests: ManufacturingRequest[] = [];
  let manufacturingUsers: SlackUser[] = [];
  let initialError: string | undefined;

  try {
    const [loadedRequests, slackUsers] = await Promise.all([
      listManufacturingRequests(),
      getManufacturingSlackUsers(),
    ]);
    requests = loadedRequests;
    manufacturingUsers = slackUsers.users;
    initialError = slackUsers.warning || undefined;
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : "Could not load queue.";
  }

  return (
    <QueueDashboard
      initialRequests={requests}
      initialManufacturingUsers={manufacturingUsers}
      initialError={initialError}
    />
  );
}
