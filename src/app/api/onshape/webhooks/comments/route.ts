import {
  enrichOnshapeCommentNotification,
  isOnshapeCommentEvent,
  onshapeCommentNotificationFromPayload,
} from "@/lib/integrations/onshape-comments";
import { notifyOnshapeCommentWithOptions } from "@/lib/integrations/slack";
import {
  findOnshapeCommentThread,
  saveOnshapeCommentThread,
} from "@/lib/storage/onshape-comment-threads";
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

function dedupeIdForCommentNotification(notification: {
  event: string;
  documentId: string;
  commentId: string;
  messageId: string;
  timestamp: string;
}) {
  if (notification.event === "onshape.comment.create" && notification.commentId) {
    return [
      "onshape-comment-create",
      notification.documentId,
      notification.commentId,
    ]
      .filter(Boolean)
      .join(":");
  }

  return (
    notification.messageId ||
    [
      notification.event,
      notification.documentId,
      notification.commentId,
      notification.timestamp,
    ]
      .filter(Boolean)
      .join(":")
  );
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

  if (event === "onshape.comment.delete") {
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

  const dedupeId = dedupeIdForCommentNotification(notification);
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
    const threadLookupIds = [
      notification.parentCommentId,
      notification.rootCommentId,
    ].filter((commentId) => commentId && commentId !== notification.commentId);
    const parentThread = await findOnshapeCommentThread(...threadLookupIds);
    const slackResult = await notifyOnshapeCommentWithOptions(notification, {
      threadTs: parentThread?.slackMessageTs,
      replyToAuthorName:
        parentThread?.rootAuthorName || parentThread?.authorName || "",
      replyToAuthorEmail:
        parentThread?.rootAuthorEmail || parentThread?.authorEmail || "",
    });
    const slackWarning = typeof slackResult === "string" ? slackResult : "";
    if (
      slackResult &&
      typeof slackResult === "object" &&
      slackResult.channelId &&
      slackResult.messageTs
    ) {
      await saveOnshapeCommentThread({
        notification,
        slackChannelId: slackResult.channelId,
        slackMessageTs: slackResult.messageTs,
        rootThread: parentThread,
      });
    }

    return Response.json({
      ok: true,
      processed: true,
      event,
      notified: !slackWarning,
      threaded: Boolean(parentThread?.slackMessageTs),
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
