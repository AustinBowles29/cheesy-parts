# Cheesy Parts Tracker

Cheesy Parts Tracker is Team 254's beta manufacturing submission and queue
tool. It lets designers submit selected CAD parts from inside Onshape, sends the
request into Airtable, and posts Slack updates for new requests and status
changes.

The goal is to reduce manual manufacturing request entry. Designers should be
able to select a part in CAD, review the auto-filled metadata, fix anything that
looks wrong, and submit the part directly into the fabrication workflow.

## Project Status

This project is currently in design-side beta testing.

Core functionality is working:

- Onshape side-panel submission page
- Manufacturing queue dashboard
- Airtable-backed queue records
- Slack notifications with `chat.postMessage`
- Status updates from the app to Airtable
- Airtable status-change webhook back into the app
- Drawing link/PDF handling where available
- Spare request creation
- Queue filtering and status-card filtering

Expect rough edges around Onshape app visibility, private App Store access, and
CAD metadata quality.

## Designer Workflow

1. Open the robot CAD in Onshape.
2. Select the part you want to submit.
3. Open the Cheesy Parts app panel.
4. Review the selected part banner and auto-filled part information.
5. Correct any missing or wrong metadata.
6. Choose the Airtable target table, subsystem, machine type, priority, and
   post-process.
7. Add notes for manufacturing.
8. Attach or verify the drawing PDF if needed.
9. Submit the part.

The expected data flow is:

```text
Onshape selected part
  -> Cheesy Parts submission panel
  -> Backend API
  -> Airtable manufacturing queue
  -> Slack manufacturing notifications
```

## What Designers Should Check

Before submitting a part, verify:

- Part name
- Part number
- Quantity
- Material
- Subsystem
- Machine type
- Priority
- Post-process
- Drawing link or drawing PDF
- Notes for manufacturing

Auto-filled data is a starting point. Designers should fix it before submitting
if Onshape metadata or naming is incomplete.

## Queue Dashboard

The queue dashboard is available at `/`.

It shows records from the configured Airtable queue tables and supports:

- Status cards as filters
- Search and dropdown filters
- Status changes
- Airtable, Onshape part, drawing, and assembly links
- Spare quantity requests
- Delete requests
- Automatic refresh while visible
- "Last synced" trust indicator

The queue is intentionally backed by Airtable as the source of truth.

## Submission Panel

The Onshape submission panel is available at `/onshape`.

It supports:

- Onshape OAuth metadata fetch
- Selected-part confirmation banner
- Editable metadata fields
- Airtable table selection
- Subsystem dropdowns from Airtable when configured
- Machine type dropdowns from Airtable when configured
- Priority and post-process dropdowns
- 3DP-specific fields
- Vendor-specific fields
- Notes
- Drawing PDF upload

## Onshape Access Notes

The Onshape integration depends on both an OAuth application and a Store Entry.

For testing:

- The OAuth application must use the deployed app's OAuth redirect URL.
- The Store Entry must be visible to the right Onshape enterprise or team.
- If `Team Visibility` only shows `No Team`, that means no assignable Onshape
  Team is available to that app/store owner.
- `Enterprise Visibility` is separate from `Team Visibility`.
- A direct store-entry link can fail for users who do not pass the visibility
  check.

For a private beta, the most reliable path is usually for an Onshape enterprise
admin to give the right users access to the application directly.

## Local Development

Install dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .env.example .env.local
```

Run the development server:

```bash
npm run dev
```

Open:

- Queue dashboard: [http://localhost:3000](http://localhost:3000)
- Onshape panel route: [http://localhost:3000/onshape](http://localhost:3000/onshape)

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Environment Configuration

Use `.env.example` as the source of truth for supported variables.

Important groups:

### Airtable

- `AIRTABLE_PERSONAL_ACCESS_TOKEN`
- `AIRTABLE_BASE_ID`
- `AIRTABLE_TABLE_ID`
- `AIRTABLE_TABLES`
- `AIRTABLE_QUEUE_TABLES`
- `AIRTABLE_SUBMISSION_TABLES`
- `AIRTABLE_QUEUE_VIEW`
- `AIRTABLE_BASE_URL`
- `AIRTABLE_WEBHOOK_SECRET`

The queue can be limited to specific tables with `AIRTABLE_QUEUE_TABLES`.
Submission targets can be limited with `AIRTABLE_SUBMISSION_TABLES`.

### Onshape

- `ONSHAPE_CLIENT_ID`
- `ONSHAPE_CLIENT_SECRET`
- `ONSHAPE_REDIRECT_URI`
- `ONSHAPE_AUTHORIZATION_URL`
- `ONSHAPE_TOKEN_URL`
- `ONSHAPE_API_BASE_URL`

For production, `ONSHAPE_REDIRECT_URI` should point to:

```text
https://<production-domain>/oauthRedirect
```

### Slack

- `SLACK_BOT_TOKEN`
- `SLACK_MANUFACTURING_CHANNEL_ID`
- `SLACK_STATUS_CHANNEL_ID`
- `SLACK_3DP_CHANNEL_ID`
- `SLACK_MANUFACTURING_USERGROUP_ID`
- `SLACK_MANUFACTURING_USERGROUP_HANDLE`
- `SLACK_MANUFACTURING_FALLBACK_USERS`
- `SUBSYSTEM_OWNER_SLACK_IDS`

Slack channel posting uses `chat.postMessage` when a bot token and channel IDs
are configured. Incoming webhooks are optional fallback support.

`SLACK_MANUFACTURING_USERGROUP_HANDLE` can be comma-separated, for example:

```text
design,design-rooks
```

## Airtable Webhook

Airtable automations can notify the app when records change.

The app endpoint is:

```text
POST /api/airtable/webhook?secret=<AIRTABLE_WEBHOOK_SECRET>
```

The automation script should send the table ID/name, record ID, new status, and
the user/source that changed it.

## Onshape Comment Webhook

Onshape comment notifications can be sent to Slack through:

```text
POST /api/onshape/webhooks/comments?secret=<ONSHAPE_COMMENT_WEBHOOK_SECRET>
```

Register this endpoint with Onshape for:

```text
onshape.comment.create
onshape.comment.update
onshape.comment.delete
```

Recommended env vars:

- `ONSHAPE_COMMENT_WEBHOOK_SECRET`
- `SLACK_ONSHAPE_COMMENTS_CHANNEL_ID`
- `ONSHAPE_WEBHOOK_SERVER`
- `ONSHAPE_COMMENT_SLACK_USER_MAP`

`ONSHAPE_COMMENT_SLACK_USER_MAP` is optional and can force Onshape names or
emails to Slack IDs:

```json
{"Austin Bowles":"U0123456789","austin@example.com":"U0123456789"}
```

If no comment-specific Slack channel is configured, the app falls back to the
existing design/manufacturing Slack channel settings.

## File Storage

Uploaded files are stored locally for development.

On Vercel, local fallback storage uses `/tmp`, which is ephemeral. Airtable
should remain the production source of truth, and durable storage should be used
for any file URLs that need to last long term.

## Feedback To Report

When testing, report:

- App does not appear in Onshape
- Selected part does not auto-fill
- Wrong part number or material
- Missing or wrong drawing link/PDF
- Submission goes to the wrong Airtable table
- Slack message is missing information
- Queue status does not match Airtable
- Scrolling or layout issues in the Onshape side panel

Include the Onshape document, part name/number, Airtable record, and what you
expected to happen when possible.
