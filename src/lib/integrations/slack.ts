import type { ManufacturingRequest, ManufacturingStatus } from "../types";

interface SlackPayload {
  text: string;
  blocks?: Array<Record<string, unknown>>;
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

async function postSlack(webhookUrl: string | undefined, payload: SlackPayload) {
  if (!webhookUrl) {
    return "Slack webhook not configured.";
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack notification failed (${response.status}): ${body}`);
  }

  return null;
}

function slackLink(url: string, label: string) {
  return url ? `<${url}|${label}>` : label;
}

export async function notifyNewSubmission(request: ManufacturingRequest) {
  return postSlack(manufacturingWebhookUrl(), {
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
  });
}

export async function notifyStatusChange(input: {
  request: ManufacturingRequest;
  oldStatus: ManufacturingStatus;
  newStatus: ManufacturingStatus;
  changedBy: string;
  changedBySlackId?: string;
}) {
  return postSlack(statusWebhookUrl(), {
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
  });
}

export async function notify3DPrintSubmission(request: ManufacturingRequest) {
  return postSlack(printWebhookUrl(), {
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
  });
}
