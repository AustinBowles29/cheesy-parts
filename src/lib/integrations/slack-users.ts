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
      email?: string;
    };
  };
}

const slackApiBase = "https://slack.com/api";
const defaultUsergroupHandles = ["design", "design-rooks"];

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

function configuredUsergroupValues(envValue: string | undefined, defaults: string[]) {
  const values = envValue
    ? envValue
        .split(",")
        .map((value) => value.trim().replace(/^@/, ""))
        .filter(Boolean)
    : defaults;

  return Array.from(new Set(values));
}

async function resolveManufacturingUsergroupIds() {
  const explicitId = process.env.SLACK_MANUFACTURING_USERGROUP_ID;
  if (explicitId) {
    return configuredUsergroupValues(explicitId, []);
  }

  const handles = configuredUsergroupValues(
    process.env.SLACK_MANUFACTURING_USERGROUP_HANDLE,
    defaultUsergroupHandles,
  );
  const response = await slackFetch<SlackUsergroupListResponse>("usergroups.list");
  const usergroups = handles.map((handle) => {
    const usergroup = response.usergroups?.find(
      (item) => item.handle === handle || item.name === handle,
    );

    if (!usergroup) {
      throw new Error(`Slack user group @${handle} was not found.`);
    }

    return usergroup.id;
  });

  if (usergroups.length === 0) {
    throw new Error("No Slack user groups were configured.");
  }

  return Array.from(new Set(usergroups));
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
    email: user.profile?.email,
    handle: user.name,
  };
}

export async function getManufacturingSlackUsers() {
  try {
    const usergroupIds = await resolveManufacturingUsergroupIds();
    const userIds = new Set<string>();

    for (const usergroup of usergroupIds) {
      const response = await slackFetch<SlackUsergroupUsersResponse>(
        "usergroups.users.list",
        {
          usergroup,
          include_disabled: false,
        },
      );

      for (const userId of response.users ?? []) {
        userIds.add(userId);
      }
    }

    const users = await Promise.all(
      Array.from(userIds).map((userId) => getSlackUser(userId)),
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
