import type { ManufacturingRequest, ManufacturingStatus } from "../types";

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
  return process.env.SLACK_MANUFACTURING_CHANNEL_ID;
}

function statusChannelId() {
  return process.env.SLACK_STATUS_CHANNEL_ID ?? manufacturingChannelId();
}

function printChannelId() {
  return process.env.SLACK_3DP_CHANNEL_ID ?? manufacturingChannelId();
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

export async function notifyNewSubmission(request: ManufacturingRequest) {
  return postSlack({
    webhookUrl: manufacturingWebhookUrl(),
    channelId: manufacturingChannelId(),
    payload: {
      text: `New manufacturing request: ${request.partName}`,
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
              text: `*Subsystem*\n${request.subsystem || "Not specified"}`,
            },
            {
              type: "mrkdwn",
              text: `*Links*\n${slackLink(request.airtableUrl ?? "", "Airtable")} | ${slackLink(
                request.onshapePartUrl,
                "Onshape",
              )}`,
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
  return postSlack({
    webhookUrl: statusWebhookUrl(),
    channelId: statusChannelId(),
    payload: {
      text: `${input.request.partName}: ${input.oldStatus} -> ${input.newStatus}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${input.request.partName}* changed status from *${input.oldStatus}* to *${input.newStatus}*.\nChanged by: ${input.changedBySlackId ? `<@${input.changedBySlackId}>` : input.changedBy}`,
          },
        },
      ],
    },
  });
}

export async function notify3DPrintSubmission(request: ManufacturingRequest) {
  return postSlack({
    webhookUrl: printWebhookUrl(),
    channelId: printChannelId(),
    payload: {
      text: `3DP request: ${request.partName}`,
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
              text: `*Print Material*\n${request.printMaterial || "Not specified"}`,
            },
            {
              type: "mrkdwn",
              text: `*Color*\n${request.printColor || "Not specified"}`,
            },
            {
              type: "mrkdwn",
              text: `*Priority*\n${request.priority || "Normal"}`,
            },
          ],
        },
      ],
    },
  });
}
