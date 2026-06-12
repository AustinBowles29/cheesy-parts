import type { Metadata } from "next";
import { QueueDashboard } from "@/components/queue-dashboard";
import { getAirtableSubmissionFieldOptions } from "@/lib/integrations/airtable";
import { fetchOnshapeCurrentUser } from "@/lib/integrations/onshape";
import { getManufacturingSlackUsers } from "@/lib/integrations/slack-users";
import { listManufacturingRequests } from "@/lib/service";
import type { ManufacturingRequest, OnshapeUser, SlackUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Team 254 Manufacturing Queue",
};

export default async function Home() {
  let requests: ManufacturingRequest[] = [];
  let manufacturingUsers: SlackUser[] = [];
  let onshapeUser: OnshapeUser | undefined;
  let statusOptions: string[] = [];
  let machineTypeOptions: string[] = [];
  let tableStatusOptions: Record<string, string[]> = {};
  let initialError: string | undefined;

  try {
    const [loadedRequests, slackUsers, fieldOptions, loadedOnshapeUser] =
      await Promise.all([
        listManufacturingRequests(),
        getManufacturingSlackUsers(),
        getAirtableSubmissionFieldOptions(),
        fetchOnshapeCurrentUser(),
      ]);
    requests = loadedRequests;
    manufacturingUsers = slackUsers.users;
    onshapeUser = loadedOnshapeUser.user;
    statusOptions = fieldOptions.statuses;
    machineTypeOptions = fieldOptions.machineTypes;
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
      initialOnshapeUser={onshapeUser}
      initialStatusOptions={statusOptions}
      initialMachineTypeOptions={machineTypeOptions}
      initialTableStatusOptions={tableStatusOptions}
      initialSyncedAt={new Date().toISOString()}
      initialError={initialError}
    />
  );
}
