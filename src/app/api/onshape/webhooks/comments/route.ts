import {
  enrichOnshapeCommentNotification,
  isOnshapeCommentEvent,
  onshapeCommentNotificationFromPayload,
} from "@/lib/integrations/onshape-comments";
import { notifyOnshapeComment } from "@/lib/integrations/slack";
import { markWebhookMessageProcessed } from "@/lib/storage/webhook-dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuredSecret() {
  return (
    process.env.ONSHAPE_COMMENT_WEBHOOK_SECRET ??
    process.env.ONSHAPE_WEBHOOK_SECRET
  );
}

function webhookSecretMatches(req: Request) {
  const secret = configuredSecret();
  if (!secret) {
    return true;
  }

  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerSecret = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim();
  const incomingSecret =
    url.searchParams.get("secret") ??
    req.headers.get("x-onshape-webhook-secret") ??
    req.headers.get("x-webhook-secret") ??
    bearerSecret;

  return incomingSecret === secret;
}

function eventFromBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "";
  }

  const record = body as Record<string, unknown>;
  return String(record.event ?? record.eventType ?? record.type ?? "").trim();
}

export function GET() {
  return Response.json({
    ok: true,
    endpoint: "/api/onshape/webhooks/comments",
    events: [
      "onshape.comment.create",
      "onshape.comment.update",
      "onshape.comment.delete",
    ],
  });
}

export async function POST(req: Request) {
  if (!webhookSecretMatches(req)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const event = eventFromBody(body);
  if (event === "webhook.register" || event === "webhook.ping") {
    return Response.json({ ok: true, ignored: true, event });
  }

  if (!isOnshapeCommentEvent(event)) {
    return Response.json({ ok: true, ignored: true, event });
  }

  let notification = onshapeCommentNotificationFromPayload(body);
  if (!notification) {
    return Response.json({
      ok: true,
      processed: false,
      warning: "Comment webhook payload could not be parsed.",
    });
  }

  const dedupeId =
    notification.messageId ||
    [
      notification.event,
      notification.documentId,
      notification.commentId,
      notification.timestamp,
    ]
      .filter(Boolean)
      .join(":");
  const shouldProcess = await markWebhookMessageProcessed(dedupeId);
  if (!shouldProcess) {
    return Response.json({ ok: true, duplicate: true, event });
  }

  let enrichmentWarning = "";
  try {
    notification = await enrichOnshapeCommentNotification(notification);
  } catch (error) {
    enrichmentWarning =
      error instanceof Error
        ? error.message
        : "Onshape comment details could not be fetched.";
    console.warn("Onshape comment detail enrichment failed", error);
  }

  try {
    const slackResult = await notifyOnshapeComment(notification);
    const slackWarning = typeof slackResult === "string" ? slackResult : "";
    return Response.json({
      ok: true,
      processed: true,
      event,
      notified: !slackWarning,
      slackResult,
      warning: slackWarning || enrichmentWarning || undefined,
    });
  } catch (error) {
    console.error("Onshape comment Slack notification failed", error);
    return Response.json({
      ok: true,
      processed: true,
      notified: false,
      warning:
        error instanceof Error
          ? error.message
          : "Slack notification failed.",
    });
  }
}
