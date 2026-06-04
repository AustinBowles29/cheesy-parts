import type { SlackUser } from "../types";

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

interface SlackUsergroupListResponse extends SlackApiResponse {
  usergroups?: Array<{
    id: string;
    handle?: string;
    name?: string;
  }>;
}

interface SlackUsergroupUsersResponse extends SlackApiResponse {
  users?: string[];
}

interface SlackUserInfoResponse extends SlackApiResponse {
  user?: {
    id: string;
    name?: string;
    real_name?: string;
    deleted?: boolean;
    profile?: {
      display_name?: string;
      real_name?: string;
    };
  };
}

const slackApiBase = "https://slack.com/api";

function slackToken() {
  return process.env.SLACK_BOT_TOKEN;
}

function fallbackUsers(): SlackUser[] {
  const configured = process.env.SLACK_MANUFACTURING_FALLBACK_USERS;
  if (!configured) {
    return [{ slackUserId: "local-manufacturing", displayName: "Manufacturing" }];
  }

  return configured
    .split(",")
    .map((entry) => {
      const [slackUserId, displayName] = entry.split(":");
      return {
        slackUserId: slackUserId?.trim(),
        displayName: displayName?.trim(),
      };
    })
    .filter(
      (user): user is SlackUser =>
        Boolean(user.slackUserId) && Boolean(user.displayName),
    );
}

async function slackFetch<T extends SlackApiResponse>(
  method: string,
  params: Record<string, string | boolean | undefined> = {},
) {
  const token = slackToken();
  if (!token) {
    throw new Error("Slack bot token is not configured.");
  }

  const url = new URL(`${slackApiBase}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack API request failed (${response.status}): ${body}`);
  }

  const body = (await response.json()) as T;
  if (!body.ok) {
    throw new Error(`Slack API ${method} failed: ${body.error ?? "unknown_error"}`);
  }

  return body;
}

async function resolveManufacturingUsergroupId() {
  const explicitId = process.env.SLACK_MANUFACTURING_USERGROUP_ID;
  if (explicitId) {
    return explicitId;
  }

  const handle = (
    process.env.SLACK_MANUFACTURING_USERGROUP_HANDLE ?? "design"
  ).replace(/^@/, "");
  const response = await slackFetch<SlackUsergroupListResponse>("usergroups.list");
  const usergroup = response.usergroups?.find(
    (item) => item.handle === handle || item.name === handle,
  );

  if (!usergroup) {
    throw new Error(`Slack user group @${handle} was not found.`);
  }

  return usergroup.id;
}

async function getSlackUser(userId: string): Promise<SlackUser | null> {
  const response = await slackFetch<SlackUserInfoResponse>("users.info", {
    user: userId,
  });
  const user = response.user;

  if (!user || user.deleted) {
    return null;
  }

  return {
    slackUserId: user.id,
    displayName:
      user.profile?.display_name ||
      user.profile?.real_name ||
      user.real_name ||
      user.name ||
      user.id,
  };
}

export async function getManufacturingSlackUsers() {
  try {
    const usergroup = await resolveManufacturingUsergroupId();
    const response = await slackFetch<SlackUsergroupUsersResponse>(
      "usergroups.users.list",
      {
        usergroup,
        include_disabled: false,
      },
    );

    const users = await Promise.all(
      (response.users ?? []).map((userId) => getSlackUser(userId)),
    );
    const activeUsers = users
      .filter((user): user is SlackUser => Boolean(user))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    if (activeUsers.length > 0) {
      return { users: activeUsers, warning: "" };
    }

    return {
      users: fallbackUsers(),
      warning: "Slack manufacturing user group has no active users.",
    };
  } catch (error) {
    return {
      users: fallbackUsers(),
      warning:
        error instanceof Error
          ? error.message
          : "Slack manufacturing users could not be loaded.",
    };
  }
}
