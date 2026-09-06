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

interface SlackUsersListResponse extends SlackApiResponse {
  members?: Array<{
    id: string;
    name?: string;
    real_name?: string;
    deleted?: boolean;
    is_bot?: boolean;
    profile?: {
      display_name?: string;
      real_name?: string;
      email?: string;
    };
  }>;
  response_metadata?: {
    next_cursor?: string;
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

function slackUserFromMember(
  member: NonNullable<SlackUsersListResponse["members"]>[number],
): SlackUser | null {
  if (!member.id || member.deleted || member.is_bot) {
    return null;
  }

  return {
    slackUserId: member.id,
    displayName:
      member.profile?.display_name ||
      member.profile?.real_name ||
      member.real_name ||
      member.name ||
      member.id,
    email: member.profile?.email,
    handle: member.name,
  };
}

function normalizeIdentity(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/^<@/, "")
    .replace(/>$/, "")
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function slackUserIdentityCandidates(user: SlackUser) {
  const emailLocalPart = user.email?.split("@")[0];

  return [
    user.slackUserId,
    user.displayName,
    user.handle,
    user.email,
    emailLocalPart,
  ]
    .map(normalizeIdentity)
    .filter(Boolean);
}

function configuredOnshapeSlackUserMap() {
  const raw =
    process.env.ONSHAPE_COMMENT_SLACK_USER_MAP ??
    process.env.ONSHAPE_SLACK_USER_MAP;
  const map = new Map<string, string>();

  if (!raw) {
    return map;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [identity, slackUserId] of Object.entries(parsed)) {
      const key = normalizeIdentity(identity);
      const value = normalizeIdentity(slackUserId);
      if (key && value) {
        map.set(key, value.toUpperCase());
      }
    }
  } catch {
    for (const entry of raw.split(/[;\n]/)) {
      const [identity, slackUserId] = entry.split(":");
      const key = normalizeIdentity(identity);
      const value = normalizeIdentity(slackUserId);
      if (key && value) {
        map.set(key, value.toUpperCase());
      }
    }
  }

  return map;
}

// users.list paginates the whole workspace, and a single comment notification
// resolves identities several times, so cache the directory per instance and
// coalesce concurrent calls into one fetch. When users.list fails, the group
// fallback is far more expensive (usergroups.list + users.info per member), so
// its result is held briefly too — otherwise one failure would run that fan-out
// once per identity lookup.
const workspaceUsersCacheTtlMs = 10 * 60 * 1000;
const workspaceUsersFallbackTtlMs = 60 * 1000;
let workspaceUsersCache: { users: SlackUser[]; expiresAt: number } | null = null;
let workspaceUsersInFlight: Promise<SlackUser[]> | null = null;

async function loadWorkspaceSlackUsers() {
  try {
    const users: SlackUser[] = [];
    let cursor = "";

    do {
      const response = await slackFetch<SlackUsersListResponse>("users.list", {
        cursor,
        limit: "200",
      });
      users.push(
        ...(response.members ?? [])
          .map(slackUserFromMember)
          .filter((user): user is SlackUser => Boolean(user)),
      );
      cursor = response.response_metadata?.next_cursor ?? "";
    } while (cursor);

    if (users.length > 0) {
      const sorted = users.sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      );
      workspaceUsersCache = {
        users: sorted,
        expiresAt: Date.now() + workspaceUsersCacheTtlMs,
      };
      return sorted;
    }
  } catch {
    // Fall back to configured design/manufacturing groups below.
  }

  const fallback = (await getManufacturingSlackUsers()).users;
  workspaceUsersCache = {
    users: fallback,
    expiresAt: Date.now() + workspaceUsersFallbackTtlMs,
  };
  return fallback;
}

export async function getWorkspaceSlackUsers(): Promise<SlackUser[]> {
  if (workspaceUsersCache && workspaceUsersCache.expiresAt > Date.now()) {
    // Hand out a copy so no caller can mutate the shared cached array.
    return [...workspaceUsersCache.users];
  }

  if (!workspaceUsersInFlight) {
    workspaceUsersInFlight = loadWorkspaceSlackUsers().finally(() => {
      workspaceUsersInFlight = null;
    });
  }

  return [...(await workspaceUsersInFlight)];
}

export async function findSlackUsersByIdentity(candidates: unknown[]) {
  const configuredMap = configuredOnshapeSlackUserMap();
  const candidateSet = new Set(
    candidates.map(normalizeIdentity).filter(Boolean),
  );
  const matchedIds = new Set<string>();
  const matchedUsers: SlackUser[] = [];

  for (const candidate of candidateSet) {
    const mappedUserId = configuredMap.get(candidate);
    if (mappedUserId) {
      matchedIds.add(mappedUserId);
    }
  }

  // Nothing to match (e.g. a top-level comment with no parent author): do not
  // spend a directory fetch to return an empty list.
  if (candidateSet.size === 0) {
    return [];
  }

  const users = await getWorkspaceSlackUsers();
  for (const user of users) {
    const identities = slackUserIdentityCandidates(user);
    if (
      matchedIds.has(user.slackUserId) ||
      identities.some((identity) => candidateSet.has(identity))
    ) {
      matchedUsers.push(user);
      matchedIds.add(user.slackUserId);
    }
  }

  for (const slackUserId of matchedIds) {
    if (!matchedUsers.some((user) => user.slackUserId === slackUserId)) {
      matchedUsers.push({ slackUserId, displayName: slackUserId });
    }
  }

  return matchedUsers;
}

export async function findSlackUsersMentionedInText(text: string) {
  const normalizedText = normalizeIdentity(text);
  if (!normalizedText) {
    return [];
  }

  const users = await getWorkspaceSlackUsers();
  return users.filter((user) => {
    const candidates = slackUserIdentityCandidates(user);
    return candidates.some((candidate) => {
      if (!candidate) {
        return false;
      }

      return (
        normalizedText.includes(`<@${candidate}>`) ||
        normalizedText.includes(`@${candidate}`) ||
        normalizedText.includes(candidate.includes("@") ? candidate : `@${candidate}`)
      );
    });
  });
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
