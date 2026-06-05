import type { Metadata } from "next";
import { QueueDashboard } from "@/components/queue-dashboard";
import { getAirtableSubmissionFieldOptions } from "@/lib/integrations/airtable";
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
  let statusOptions: string[] = [];
  let tableStatusOptions: Record<string, string[]> = {};
  let initialError: string | undefined;

  try {
    const [loadedRequests, slackUsers, fieldOptions] = await Promise.all([
      listManufacturingRequests(),
      getManufacturingSlackUsers(),
      getAirtableSubmissionFieldOptions(),
    ]);
    requests = loadedRequests;
    manufacturingUsers = slackUsers.users;
    statusOptions = fieldOptions.statuses;
    tableStatusOptions = Object.fromEntries(
      (fieldOptions.airtableTables ?? []).flatMap((table) => [
        [table.id, table.statuses ?? []],
        [table.name, table.statuses ?? []],
      ]),
    );
    initialError = slackUsers.warning || fieldOptions.warning || undefined;
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : "Could not load queue.";
  }

  return (
    <QueueDashboard
      initialRequests={requests}
      initialManufacturingUsers={manufacturingUsers}
      initialStatusOptions={statusOptions}
      initialTableStatusOptions={tableStatusOptions}
      initialError={initialError}
    />
  );
}
