import { isDrawingPdfAttachment } from "../attachments";
import { normalizeString } from "../manufacturing";
import type { ManufacturingRequest, ManufacturingStatus, SlackUser } from "../types";
import type { OnshapeCommentNotification } from "./onshape-comments";
import { onshapeCommentActionLabel } from "./onshape-comments";
import {
  findSlackUsersByIdentity,
  findSlackUsersMentionedInText,
  getManufacturingSlackUsers,
} from "./slack-users";

interface SlackPayload {
  text: string;
  blocks?: Array<Record<string, unknown>>;
  threadTs?: string;
}

interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
  channel?: string;
  ts?: string;
  message?: {
    ts?: string;
  };
}

const slackApiBase = "https://slack.com/api";

export interface SlackNotificationResult {
  channelId?: string;
  messageTs?: string;
}

function slackBotToken() {
  return process.env.SLACK_BOT_TOKEN;
}

function manufacturingWebhookUrl() {
  return process.env.SLACK_MANUFACTURING_WEBHOOK_URL;
}

function statusWebhookUrl() {
  return (
    process.env.SLACK_STATUS_WEBHOOK_URL ??
    process.env.SLACK_MANUFACTURING_WEBHOOK_URL
  );
}

function printWebhookUrl() {
  return process.env.SLACK_3DP_WEBHOOK_URL;
}

function manufacturingChannelId() {
  return (
    process.env.SLACK_MANUFACTURING_CHANNEL_ID ??
    process.env.SLACK_SUBMISSION_CHANNEL_ID ??
    process.env.SLACK_CHANNEL_ID ??
    process.env.SLACK_STATUS_CHANNEL_ID
  );
}

function statusChannelId() {
  return process.env.SLACK_STATUS_CHANNEL_ID ?? manufacturingChannelId();
}

function printChannelId() {
  return process.env.SLACK_3DP_CHANNEL_ID ?? manufacturingChannelId();
}

function onshapeCommentsWebhookUrl() {
  return process.env.SLACK_ONSHAPE_COMMENTS_WEBHOOK_URL;
}

function onshapeCommentsChannelId() {
  return (
    process.env.SLACK_ONSHAPE_COMMENTS_CHANNEL_ID ??
    process.env.SLACK_DESIGN_CHANNEL_ID ??
    manufacturingChannelId()
  );
}

function firstConfiguredValue(keys: string[]) {
  for (const key of keys) {
    const value = normalizeString(process.env[key]).split(",")[0];
    if (value) {
      return value;
    }
  }

  return "";
}

function normalizeUsergroupId(value: string) {
  return normalizeString(value)
    .replace(/^<!subteam\^/, "")
    .replace(/\|[^>]+>$/, "")
    .replace(/>$/, "");
}

function normalizeUsergroupHandle(value: string) {
  return normalizeString(value).replace(/^@/, "");
}

function usergroupMention(input: {
  idKeys?: string[];
  handleKeys?: string[];
  fallbackHandle: string;
}) {
  const usergroupId = normalizeUsergroupId(
    firstConfiguredValue(input.idKeys ?? []),
  );
  const handle =
    normalizeUsergroupHandle(firstConfiguredValue(input.handleKeys ?? [])) ||
    normalizeUsergroupHandle(input.fallbackHandle);

  if (usergroupId) {
    return `<!subteam^${usergroupId}${handle ? `|${handle}` : ""}>`;
  }

  return handle ? `@${handle}` : "";
}

function manufacturingUsergroupMention() {
  return usergroupMention({
    idKeys: [
      "SLACK_MANUFACTURING_NOTIFY_USERGROUP_ID",
      "SLACK_MANUFACTURING_NOTIFICATION_USERGROUP_ID",
    ],
    handleKeys: [
      "SLACK_MANUFACTURING_NOTIFY_USERGROUP_HANDLE",
      "SLACK_MANUFACTURING_NOTIFICATION_USERGROUP_HANDLE",
    ],
    fallbackHandle: "manufacturing",
  });
}

function machineUsergroupMention(machineType: ManufacturingRequest["machineType"]) {
  const machine = normalizeString(machineType).toLowerCase();

  if (machine.includes("router")) {
    return usergroupMention({
      idKeys: ["SLACK_ROUTER_USERGROUP_ID", "SLACK_MACHINE_ROUTER_USERGROUP_ID"],
      handleKeys: [
        "SLACK_ROUTER_USERGROUP_HANDLE",
        "SLACK_MACHINE_ROUTER_USERGROUP_HANDLE",
      ],
      fallbackHandle: "router",
    });
  }

  if (machine.includes("lathe")) {
    return usergroupMention({
      idKeys: ["SLACK_LATHE_USERGROUP_ID", "SLACK_MACHINE_LATHE_USERGROUP_ID"],
      handleKeys: [
        "SLACK_LATHE_USERGROUP_HANDLE",
        "SLACK_MACHINE_LATHE_USERGROUP_HANDLE",
      ],
      fallbackHandle: "lathe",
    });
  }

  if (machine.includes("mill")) {
    return usergroupMention({
      idKeys: ["SLACK_MILL_USERGROUP_ID", "SLACK_MACHINE_MILL_USERGROUP_ID"],
      handleKeys: [
        "SLACK_MILL_USERGROUP_HANDLE",
        "SLACK_MACHINE_MILL_USERGROUP_HANDLE",
      ],
      fallbackHandle: "mill",
    });
  }

  return "";
}

function newSubmissionMentions(request: ManufacturingRequest) {
  const machineMention = machineUsergroupMention(request.machineType);
  return [machineMention || manufacturingUsergroupMention()].filter(Boolean);
}

function subsystemOwnerMapRaw() {
  return (
    process.env.SUBSYSTEM_OWNER_SLACK_IDS ??
    process.env.SLACK_SUBSYSTEM_OWNER_IDS
  );
}

function normalizedSubsystemKey(value: string) {
  return normalizeString(value).toLowerCase();
}

function normalizeSlackUserId(value: unknown) {
  return normalizeString(value)
    .replace(/^<@/, "")
    .replace(/>$/, "")
    .replace(/^@/, "");
}

function normalizeOwnerIds(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : normalizeString(value)
        .split(/[,\s]+/)
        .filter(Boolean);

  return values.map(normalizeSlackUserId).filter(Boolean);
}

function subsystemOwnerMap() {
  const raw = subsystemOwnerMapRaw();
  const ownerMap = new Map<string, string[]>();

  if (!raw) {
    return ownerMap;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [subsystem, ownerIds] of Object.entries(parsed)) {
      const key = normalizedSubsystemKey(subsystem);
      const ids = normalizeOwnerIds(ownerIds);
      if (key && ids.length > 0) {
        ownerMap.set(key, ids);
      }
    }
  } catch {
    for (const entry of raw.split(";")) {
      const [subsystem, ownerIds] = entry.split(":");
      const key = normalizedSubsystemKey(subsystem);
      const ids = normalizeOwnerIds(ownerIds);
      if (key && ids.length > 0) {
        ownerMap.set(key, ids);
      }
    }
  }

  return ownerMap;
}

function subsystemOwnerMentions(subsystem: string) {
  const ownerIds = subsystemOwnerMap().get(normalizedSubsystemKey(subsystem)) ?? [];
  return ownerIds.map((ownerId) => `<@${ownerId}>`);
}

async function postSlackToWebhook(webhookUrl: string, payload: SlackPayload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook notification failed (${response.status}): ${body}`);
  }

  return null;
}

async function postSlackToChannel(channelId: string, payload: SlackPayload) {
  const token = slackBotToken();
  if (!token) {
    return "Slack bot token is not configured.";
  }

  const response = await fetch(`${slackApiBase}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      text: payload.text,
      blocks: payload.blocks,
      thread_ts: payload.threadTs || undefined,
      link_names: true,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack API notification failed (${response.status}): ${body}`);
  }

  const body = (await response.json()) as SlackPostMessageResponse;
  if (!body.ok) {
    throw new Error(`Slack chat.postMessage failed: ${body.error ?? "unknown_error"}`);
  }

  return {
    channelId: body.channel ?? channelId,
    messageTs: body.ts ?? body.message?.ts,
  };
}

async function postSlack(input: {
  webhookUrl?: string;
  channelId?: string;
  payload: SlackPayload;
}) {
  if (input.channelId && slackBotToken()) {
    return postSlackToChannel(input.channelId, input.payload);
  }

  if (input.webhookUrl) {
    return postSlackToWebhook(input.webhookUrl, input.payload);
  }

  if (input.channelId) {
    return postSlackToChannel(input.channelId, input.payload);
  }

  return "Slack channel is not configured.";
}

function slackLink(url: string, label: string) {
  return url ? `<${url}|${label}>` : label;
}

function optionalSlackLink(url: string | undefined, label: string) {
  return url ? `<${url}|${label}>` : "";
}

function truncateSlackText(value: string, maxLength: number) {
  const normalized = normalizeString(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function isLikelySlackUserId(value: string | undefined) {
  return /^[UW][A-Z0-9]+$/i.test(normalizeString(value));
}

function normalizedPersonKey(value: string | undefined) {
  return normalizeString(value).toLowerCase().replace(/\s+/g, " ").trim();
}

async function submitterLabel(request: ManufacturingRequest) {
  if (isLikelySlackUserId(request.submitterSlackId)) {
    return `<@${request.submitterSlackId}>`;
  }

  const submitterKey = normalizedPersonKey(request.submitter);
  if (submitterKey) {
    const slackUsers = await getManufacturingSlackUsers();
    const matchingUser = slackUsers.users.find((user) => {
      const emailPrefix = user.email?.split("@")[0];
      return [
        user.displayName,
        user.handle,
        user.email,
        emailPrefix,
      ].some((value) => normalizedPersonKey(value) === submitterKey);
    });

    if (matchingUser && isLikelySlackUserId(matchingUser.slackUserId)) {
      return `<@${matchingUser.slackUserId}>`;
    }
  }

  return request.submitter || "Not specified";
}

function drawingPdfLinkLabel(request: ManufacturingRequest) {
  const drawingAttachment = request.attachments.find(isDrawingPdfAttachment);

  if (!drawingAttachment?.url) {
    return "";
  }

  const stableUrl = stableDrawingPdfUrl(request);
  return slackLink(
    stableUrl || drawingAttachment.url,
    drawingAttachment.filename || "Drawing PDF",
  );
}

function appBaseUrl() {
  const explicitUrl =
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL;

  if (!explicitUrl) {
    return "";
  }

  return explicitUrl.startsWith("http")
    ? explicitUrl.replace(/\/$/, "")
    : `https://${explicitUrl.replace(/\/$/, "")}`;
}

function stableDrawingPdfUrl(request: ManufacturingRequest) {
  const baseUrl = appBaseUrl();
  const recordId = request.airtableId ?? request.id;

  if (!baseUrl || !recordId) {
    return "";
  }

  const url = new URL(
    `/api/requests/${encodeURIComponent(recordId)}/drawing`,
    baseUrl,
  );

  if (request.airtableTableId) {
    url.searchParams.set("tableId", request.airtableTableId);
  } else if (request.airtableTableName) {
    url.searchParams.set("tableName", request.airtableTableName);
  }

  return url.toString();
}

function onshapeDrawingLinkLabel(request: ManufacturingRequest) {
  return optionalSlackLink(request.onshapeDrawingUrl, "Onshape drawing");
}

function drawingLinksLabel(request: ManufacturingRequest) {
  const links = [
    drawingPdfLinkLabel(request) || "No drawing PDF attached",
    onshapeDrawingLinkLabel(request),
  ].filter(Boolean);

  return links.join(" | ");
}

function linksLabel(request: ManufacturingRequest) {
  const links = [
    optionalSlackLink(request.airtableUrl, "Airtable"),
    optionalSlackLink(request.onshapePartUrl, "Onshape part"),
    optionalSlackLink(request.assemblyUrl, "Assembly"),
  ].filter(Boolean);

  return links.length > 0 ? links.join(" | ") : "No links";
}

function priorityLabel(request: ManufacturingRequest) {
  return request.priority || "Normal";
}

export async function notifyNewSubmission(request: ManufacturingRequest) {
  const ownerMentions = subsystemOwnerMentions(request.subsystem);
  const ownerText =
    ownerMentions.length > 0 ? ownerMentions.join(" ") : "Not configured";
  const submitterText = await submitterLabel(request);
  const drawingText = drawingLinksLabel(request);
  const notifyText = newSubmissionMentions(request).join(" ");

  return postSlack({
    webhookUrl: manufacturingWebhookUrl(),
    channelId: manufacturingChannelId(),
    payload: {
      text: `New manufacturing request: ${request.partName} submitted by ${request.submitter || "Unknown"} ${notifyText}${
        ownerMentions.length > 0 ? ` ${ownerMentions.join(" ")}` : ""
      }`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "New manufacturing request",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Notify: ${notifyText || "@manufacturing"}`,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Part*\n${request.partName}`,
            },
            {
              type: "mrkdwn",
              text: `*Quantity*\n${request.quantity}`,
            },
            {
              type: "mrkdwn",
              text: `*Material*\n${request.material || "Not specified"}`,
            },
            {
              type: "mrkdwn",
              text: `*Machine*\n${request.machineType}`,
            },
            {
              type: "mrkdwn",
              text: `*Priority*\n${priorityLabel(request)}`,
            },
            {
              type: "mrkdwn",
              text: `*Subsystem*\n${request.subsystem || "Not specified"}`,
            },
            {
              type: "mrkdwn",
              text: `*Owner*\n${submitterText}`,
            },
            {
              type: "mrkdwn",
              text: `*Subsystem owner*\n${ownerText}`,
            },
            {
              type: "mrkdwn",
              text: `*Drawing*\n${drawingText}`,
            },
            {
              type: "mrkdwn",
              text: `*Links*\n${linksLabel(request)}`,
            },
          ],
        },
      ],
    },
  });
}

export async function notifyStatusChange(input: {
  request: ManufacturingRequest;
  oldStatus: ManufacturingStatus | "Unknown";
  newStatus: ManufacturingStatus;
  changedBy: string;
  changedBySlackId?: string;
}) {
  const ownerMentions = subsystemOwnerMentions(input.request.subsystem);
  const partLabel =
    input.request.partName ||
    input.request.partNumber ||
    input.request.airtableId ||
    "Part";
  const statusText =
    input.oldStatus === "Unknown"
      ? `*${partLabel}* changed status to *${input.newStatus}*.`
      : `*${partLabel}* changed status from *${input.oldStatus}* to *${input.newStatus}*.`;
  const plainStatusText =
    input.oldStatus === "Unknown"
      ? `${partLabel}: ${input.newStatus}`
      : `${partLabel}: ${input.oldStatus} -> ${input.newStatus}`;
  const changedByText = input.changedBySlackId
    ? `<@${input.changedBySlackId}>`
    : input.changedBy || "Unknown";
  const partOwnerText = await submitterLabel(input.request);
  const threadTs = normalizeString(input.request.slackMessageTs);

  return postSlack({
    webhookUrl: statusWebhookUrl(),
    channelId: threadTs
      ? input.request.slackChannelId ?? statusChannelId()
      : statusChannelId(),
    payload: {
      threadTs,
      text: `${plainStatusText} changed by ${input.changedBy || "Unknown"}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${statusText}\nPriority: ${priorityLabel(
              input.request,
            )}\nChanged by: ${changedByText}\nPart owner: ${partOwnerText}${
              ownerMentions.length > 0
                ? `\nSubsystem owner: ${ownerMentions.join(" ")}`
                : ""
            }`,
          },
        },
      ],
    },
  });
}

export async function notify3DPrintSubmission(request: ManufacturingRequest) {
  const submitterText = await submitterLabel(request);
  const drawingText = drawingLinksLabel(request);

  return postSlack({
    webhookUrl: printWebhookUrl(),
    channelId: printChannelId(),
    payload: {
      text: `3DP request: ${request.partName} submitted by ${request.submitter || "Unknown"}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "3D print request",
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Part*\n${request.partName}`,
            },
            {
              type: "mrkdwn",
              text: `*Material*\n${request.material || "Not specified"}`,
            },
            {
              type: "mrkdwn",
              text: `*Quantity*\n${request.quantity}`,
            },
            {
              type: "mrkdwn",
              text: `*Owner*\n${submitterText}`,
            },
            {
              type: "mrkdwn",
              text: `*Print Material*\n${request.printMaterial || "Not specified"}`,
            },
            {
              type: "mrkdwn",
              text: `*Color*\n${request.printColor || "Not specified"}`,
            },
            {
              type: "mrkdwn",
              text: `*Priority*\n${priorityLabel(request)}`,
            },
            {
              type: "mrkdwn",
              text: `*Drawing*\n${drawingText}`,
            },
          ],
        },
      ],
    },
  });
}

function uniqueSlackUsers(users: SlackUser[]) {
  const seen = new Set<string>();
  const uniqueUsers: SlackUser[] = [];

  for (const user of users) {
    if (!user.slackUserId || seen.has(user.slackUserId)) {
      continue;
    }

    seen.add(user.slackUserId);
    uniqueUsers.push(user);
  }

  return uniqueUsers;
}

function normalizedSlackIdentity(value: unknown) {
  return normalizeString(value)
    .replace(/^<@/, "")
    .replace(/>$/, "")
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function slackUserMatchesOnshapeMention(user: SlackUser, input: {
  onshapeUserId: string;
  name: string;
}) {
  const emailLocalPart = user.email?.split("@")[0];
  const candidates = [
    user.slackUserId,
    user.displayName,
    user.handle,
    user.email,
    emailLocalPart,
  ]
    .map(normalizedSlackIdentity)
    .filter(Boolean);
  const mentionCandidates = [
    input.onshapeUserId,
    input.name,
  ].map(normalizedSlackIdentity);

  return mentionCandidates.some((candidate) => candidates.includes(candidate));
}

function formatOnshapeCommentText(text: string, mentionedUsers: SlackUser[]) {
  return text.replace(/\[~([^:\]]+):([^\]]+)\]/g, (_match, onshapeUserId, name) => {
    const matchedUser =
      mentionedUsers.find((user) =>
        slackUserMatchesOnshapeMention(user, {
          onshapeUserId,
          name,
        }),
      ) || (mentionedUsers.length === 1 ? mentionedUsers[0] : undefined);

    return matchedUser?.slackUserId ? `<@${matchedUser.slackUserId}>` : `@${name}`;
  });
}

export async function notifyOnshapeComment(input: OnshapeCommentNotification) {
  const explicitMentionUsers = await findSlackUsersByIdentity(input.mentionCandidates);
  const textMentionUsers = await findSlackUsersMentionedInText(input.commentText);
  const mentionedUsers = uniqueSlackUsers([
    ...explicitMentionUsers,
    ...textMentionUsers,
  ]);
  const mentionText = mentionedUsers
    .map((user) => `<@${user.slackUserId}>`)
    .join(" ");
  const action = onshapeCommentActionLabel(input.event);
  const author =
    input.authorName ||
    input.authorEmail ||
    (input.event === "onshape.comment.delete" ? "Someone" : "Unknown author");
  const formattedCommentText = formatOnshapeCommentText(
    input.commentText,
    mentionedUsers,
  );
  const commentText =
    truncateSlackText(formattedCommentText, 1200) ||
    (input.event === "onshape.comment.delete"
      ? "Comment deleted."
      : "No comment text was included in the webhook payload.");
  const fallbackTitle =
    input.event === "onshape.comment.delete"
      ? "Onshape comment deleted"
      : "New Onshape comment";

  return postSlack({
    webhookUrl: onshapeCommentsWebhookUrl(),
    channelId: onshapeCommentsChannelId(),
    payload: {
      text: `${fallbackTitle}: ${author} ${action} a comment${mentionText ? ` for ${mentionText}` : ""}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${mentionText ? `${mentionText}\n` : ""}*${fallbackTitle}*\n${author} ${action} a comment in Onshape.`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `>${commentText.replace(/\n/g, "\n>")}`,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Document*\n${optionalSlackLink(input.documentUrl, "Open in Onshape") || "Not available"}`,
            },
            {
              type: "mrkdwn",
              text: `*Event*\n${input.event}`,
            },
            {
              type: "mrkdwn",
              text: `*Comment ID*\n${input.commentId || "Not available"}`,
            },
            {
              type: "mrkdwn",
              text: `*Webhook message*\n${input.messageId || "Not available"}`,
            },
          ],
        },
      ],
    },
  });
}
