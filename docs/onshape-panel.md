# Onshape Panel Integration

The embedded submission UI is available at `/onshape`.

For an Onshape custom app or panel, pass as many of these query parameters as
the Onshape context can provide:

- `partName`
- `partNumber`
- `notes`
- `material`
- `thickness`
- `quantity`
- `subsystem`
- `machineType`
- `onshapePartUrl`
- `onshapeDrawingUrl`
- `onshapeDrawingElementId`
- `assemblyUrl`
- `branchVersionReference`
- `documentId`
- `workspaceId`
- `versionId`
- `workspaceOrVersion`
- `workspaceOrVersionId`
- `elementId`
- `drawingElementId`
- `assemblyElementId`
- `partId`
- `documentTitle`
- `submitter`

If only Onshape IDs are supplied, the panel builds the part URL from
`documentId`, `workspaceId`, `versionId`, or `workspaceOrVersionId`,
`elementId`, and `partId`.

Recommended extension action URL:

```text
https://cheesy-parts.vercel.app/onshape?documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}&partId={$partId}&partNumber={$partNumber}
```

If Onshape leaves an unsupported replacement token such as `{$partNumber}` in
the URL, the panel ignores it and leaves that field editable. The embedded
right-panel context does not currently provide part names directly, so the panel
uses Onshape OAuth plus API metadata lookup when configured.

OAuth app configuration:

- Redirect URL: `https://cheesy-parts.vercel.app/oauthRedirect`
- Optional OAuth URL: `https://cheesy-parts.vercel.app/api/onshape/oauth/start`

Vercel environment variables:

```text
AIRTABLE_PERSONAL_ACCESS_TOKEN=
AIRTABLE_BASE_ID=
AIRTABLE_TABLE_ID=
AIRTABLE_TABLES=
AIRTABLE_QUEUE_VIEW=To manufacture
AIRTABLE_TABLE_ROBOT=
AIRTABLE_TABLE_SPARES=
AIRTABLE_WEBHOOK_ID=
AIRTABLE_WEBHOOK_SECRET=
ONSHAPE_CLIENT_ID=
ONSHAPE_CLIENT_SECRET=
ONSHAPE_REDIRECT_URI=https://cheesy-parts.vercel.app/oauthRedirect
SLACK_BOT_TOKEN=
SLACK_MANUFACTURING_CHANNEL_ID=
SLACK_STATUS_CHANNEL_ID=
SLACK_3DP_CHANNEL_ID=
```

After a user connects Onshape, the panel fetches the selected Part Studio parts
from Onshape and fills part name, part number, material, notes, and drawing
links when the API returns those values.

If selected-part metadata has no part number, the panel looks through Assembly
BOMs in the same document and uses the first matching BOM part number. Matching
uses `partId` first because it is more precise, then falls back to part name.

Thickness is intentionally left as a designer-reviewed field. The app does not
estimate thickness from geometry because many submitted parts are not flat plate
parts.

If the Airtable token includes schema read access, the panel reads select-field
choices from all configured Airtable tables for `Subsystem` and
`Vendor Name`/`Vendor` and uses those as dropdown options. Add `Notes` and
`Time Created` fields to each manufacturing table so those values can be
written back to Airtable.

For multi-table bases, set `AIRTABLE_TABLES` to a comma-separated list of every
part tracking table ID or exact table name. For the current setup, include only
the main subsystem table and the spares table. Keep `AIRTABLE_TABLE_ID` as the
default fallback table. Route normal submissions with `AIRTABLE_TABLE_ROBOT` and
spares with `AIRTABLE_TABLE_SPARES`, or use `AIRTABLE_CATEGORY_TABLE_MAP` with
JSON values. When multiple tables are configured, the submit panel also shows a
`Tracking table` selector for explicit manual routing. Queue reads default to
the `To manufacture` view so the app does not load every historical record in
each table. Set `AIRTABLE_QUEUE_VIEW` to override that default with another view
name or ID.

Slack notifications use incoming webhook URLs when configured. If webhook URLs
are not configured, the app uses Slack `chat.postMessage` with
`SLACK_BOT_TOKEN` plus channel IDs. The Slack app needs `chat:write`, and the
bot must be in private channels before it can post there.

Airtable manual status changes can notify the app through:

```text
https://cheesy-parts.vercel.app/api/airtable/webhook?secret=YOUR_SECRET
```

Set the same value in `AIRTABLE_WEBHOOK_SECRET`. Airtable Automations can send
`recordId`, `tableName` or `tableId`, `oldStatus`, `newStatus`, and `changedBy`
directly. For separate Airtable tables, create one automation per table and send
that table's exact name or ID in the payload, for example:

```json
{
  "tableName": "Spares Tracking",
  "recordId": "recXXXXXXXXXXXXXX",
  "newStatus": "Ready for Assembly",
  "changedBy": "Airtable"
}
```

The official Airtable Webhooks API can also be used by setting
`AIRTABLE_WEBHOOK_ID`; the app drains webhook payloads, fetches changed records,
compares cached status, and posts Slack notifications for detected status
changes when record/table IDs are available.

When no Drawing PDF is manually uploaded, the submission API can attach an
exported Onshape PDF automatically. It first searches drawing elements in the
same document and accepts only a drawing whose views reference exactly the
selected part ID, falling back to exact part-name matching only when drawing
view references are unavailable. Drawings that reference additional parts are
ignored.

Onshape App Store applications should use OAuth2 for user-authorized API access.
For internal team use, the panel can be embedded directly and fed metadata from
Onshape context or a lightweight browser extension until OAuth is wired in.
