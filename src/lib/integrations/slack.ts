import { coerceStatus, normalizeString } from "../manufacturing";
import type { ManufacturingRequest, ManufacturingStatus } from "../types";
import { getManufacturingSlackUsers } from "./slack-users";

interface SlackPayload {
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
}

const slackApiBase = "https://slack.com/api";

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

  return null;
}

async function postSlack(input: {
  webhookUrl?: string;
  channelId?: string;
  payload: SlackPayload;
}) {
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
  const drawingAttachment = request.attachments.find(
    (attachment) => attachment.kind === "drawing" && attachment.url,
  );

  if (drawingAttachment?.url) {
    return slackLink(drawingAttachment.url, drawingAttachment.filename || "Drawing PDF");
  }

  return "";
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
  const drawingText = drawingPdfLinkLabel(request) || "No drawing PDF attached";

  return postSlack({
    webhookUrl: manufacturingWebhookUrl(),
    channelId: manufacturingChannelId(),
    payload: {
      text: `New manufacturing request: ${request.partName} submitted by ${request.submitter || "Unknown"}${
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
  const ownerMentions =
    coerceStatus(input.newStatus) === "Manufacturing In Progress"
      ? subsystemOwnerMentions(input.request.subsystem)
      : [];
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

  return postSlack({
    webhookUrl: statusWebhookUrl(),
    channelId: statusChannelId(),
    payload: {
      text: `${plainStatusText} changed by ${input.changedBy || "Unknown"} manufacturing`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${statusText}\nPriority: ${priorityLabel(
              input.request,
            )}\nChanged by: ${changedByText}\nNotify: manufacturing${
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
  const drawingText = drawingPdfLinkLabel(request) || "No drawing PDF attached";

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
