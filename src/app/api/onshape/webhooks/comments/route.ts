import {
  enrichOnshapeCommentNotification,
  isOnshapeCommentEvent,
  onshapeCommentNotificationFromPayload,
} from "@/lib/integrations/onshape-comments";
import type { OnshapeCommentNotification } from "@/lib/integrations/onshape-comments";
import { withOnshapeUsage } from "@/lib/integrations/onshape-usage";
import { notifyOnshapeCommentWithOptions } from "@/lib/integrations/slack";
import { normalizeString } from "@/lib/manufacturing";
import {
  loadOnshapeCommentThreads,
  saveOnshapeCommentThread,
} from "@/lib/storage/onshape-comment-threads";
import type { OnshapeCommentThreadRecord } from "@/lib/storage/onshape-comment-threads";
import {
  hasWebhookMessageBeenProcessed,
  markWebhookMessageProcessed,
} from "@/lib/storage/webhook-dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ThreadRecords = Record<string, OnshapeCommentThreadRecord>;

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

function commentCreateDedupeId(documentId: string, commentId: string) {
  return ["onshape-comment-create", documentId, commentId]
    .filter(Boolean)
    .join(":");
}

function dedupeIdForCommentNotification(notification: {
  event: string;
  documentId: string;
  commentId: string;
  messageId: string;
  timestamp: string;
}) {
  if (notification.event === "onshape.comment.create" && notification.commentId) {
    return commentCreateDedupeId(notification.documentId, notification.commentId);
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

// An update whose text matches what we already posted is a no-op redelivery
// (resolve/unresolve, mention resolution, etc.). A record with no stored text
// predates text tracking, so it is "unknown" rather than unchanged; an empty
// string is a known-empty comment and compares normally.
function isUnchangedCommentText(incoming: string, stored: string | undefined) {
  return stored !== undefined && normalizeString(incoming) === normalizeString(stored);
}

function threadLookupIdsFor(
  notification: OnshapeCommentNotification,
  ownCommentId: string,
) {
  return [notification.parentCommentId, notification.rootCommentId].filter(
    (commentId) => commentId && commentId !== ownCommentId,
  );
}

function firstThread(threads: ThreadRecords, ids: string[]) {
  return ids.map((id) => threads[id]).find(Boolean) ?? null;
}

// A record only proves the comment was posted if it is not a placeholder that
// saveOnshapeCommentThread synthesized for a root seen first through a reply.
function postedThread(record: OnshapeCommentThreadRecord | undefined) {
  return record && !record.placeholder ? record : null;
}

// A store outage must degrade to "post without threading", never to a 5xx that
// makes Onshape retry into the dedupe marker and drop the comment entirely.
async function loadThreadsSafely(...ids: string[]): Promise<ThreadRecords> {
  try {
    return await loadOnshapeCommentThreads(...ids);
  } catch (error) {
    console.warn("Onshape comment thread store could not be read", error);
    return {};
  }
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

  const isUpdate = event === "onshape.comment.update";
  const ownCommentId = notification.commentId;
  const initialLookupIds = threadLookupIdsFor(notification, ownCommentId);
  const checkedIds = new Set([ownCommentId, ...initialLookupIds]);
  // One store read covers this comment's own record and its parent thread.
  let threads = await loadThreadsSafely(ownCommentId, ...initialLookupIds);
  const ownThread = postedThread(threads[ownCommentId]);
  const duplicateResponse = (reason: string) =>
    Response.json({ ok: true, duplicate: true, event, reason });
  const unchangedUpdate = (commentText: string) =>
    isUpdate &&
    ownThread !== null &&
    isUnchangedCommentText(commentText, ownThread.commentText);

  // Fast paths that need no Onshape or Slack calls.
  if (unchangedUpdate(notification.commentText)) {
    return duplicateResponse("unchanged");
  }

  if (!isUpdate && ownThread) {
    return duplicateResponse("already-posted");
  }

  // Onshape fires create and update back-to-back for a new comment. If the
  // create has been claimed but not yet recorded, it is still in flight; treat
  // this update as part of it instead of racing it to a second top-level post.
  if (isUpdate && !ownThread && ownCommentId) {
    const createClaimed = await hasWebhookMessageBeenProcessed(
      commentCreateDedupeId(notification.documentId, ownCommentId),
    );
    if (createClaimed) {
      return duplicateResponse("create-in-progress");
    }
  }

  // Seed the document name from the store so a known name survives even if
  // enrichment fails, and so no Onshape call is spent re-fetching it.
  notification = {
    ...notification,
    documentName:
      ownThread?.documentName ||
      firstThread(threads, initialLookupIds)?.documentName ||
      "",
  };

  let enrichmentWarning = "";
  try {
    // Captured as a const so the closure keeps the non-null narrowing.
    const pendingNotification = notification;
    notification = await withOnshapeUsage("comment-webhook", () =>
      enrichOnshapeCommentNotification(pendingNotification),
    );
  } catch (error) {
    enrichmentWarning =
      error instanceof Error
        ? error.message
        : "Onshape comment details could not be fetched.";
    console.warn("Onshape comment detail enrichment failed", error);
  }

  // The payload may have lacked the text; re-check once enrichment filled it in.
  if (unchangedUpdate(notification.commentText)) {
    return duplicateResponse("unchanged");
  }

  // An update whose text could not be recovered must neither repost a
  // placeholder nor wipe the text we already know.
  if (isUpdate && ownThread && !normalizeString(notification.commentText)) {
    return duplicateResponse("no-text");
  }

  // Enrichment may have supplied parent/root ids the payload lacked; look up
  // only the ids the first read did not already cover.
  const lookupIds = threadLookupIdsFor(notification, ownCommentId);
  const missingIds = lookupIds.filter((id) => !checkedIds.has(id));
  if (missingIds.length > 0) {
    threads = { ...threads, ...(await loadThreadsSafely(...missingIds)) };
  }
  const parentThread = firstThread(threads, lookupIds);

  try {
    // Edits of a posted comment (and a root first seen through a reply) go into
    // the existing Slack thread instead of a new top-level message.
    const anchorThread: OnshapeCommentThreadRecord | null =
      threads[ownCommentId] ?? parentThread;
    const slackResult = await notifyOnshapeCommentWithOptions(notification, {
      threadTs: anchorThread?.slackMessageTs,
      isReply: Boolean(parentThread),
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
        rootThread: anchorThread,
      });
    }

    return Response.json({
      ok: true,
      processed: true,
      event,
      notified: !slackWarning,
      threaded: Boolean(anchorThread?.slackMessageTs),
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
