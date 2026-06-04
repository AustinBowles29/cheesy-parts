Team 254 manufacturing request and tracking MVP.

## What is included

- Onshape-facing submission panel at `/onshape`
- Queue dashboard at `/`
- Airtable record creation when Airtable env vars are present
- Local `.data/requests.json` fallback for development
- Slack notifications for new submissions, status changes, and 3DP requests
- Status tracking, queue filters, attachments, and spare request generation
- Slack `@manufacturing` user-group dropdowns for submitter and acting user

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Required Airtable fields are named to match the project brief:

- Part Name
- Part Number
- Quantity
- Subsystem
- Category
- Material
- Thickness
- Finish
- Machine Type
- Status
- Onshape Part URL
- Onshape Drawing URL
- Assembly URL
- Branch/Version Reference
- Submitter
- Timestamp
- Drawing
- DXF
- Other files
- Manufacturing Notes
- Priority
- Print Material
- Submitter Slack ID
- Last Status Changed By
- Last Status Changed By Slack ID
- Last Status Change At
- Audit History
- Print Color
- Infill
- Layer Height
- Printer Notes
- Vendor Name
- Quote Required
- Lead Time
- Vendor Notes

Slack user dropdowns use `SLACK_BOT_TOKEN` plus either
`SLACK_MANUFACTURING_USERGROUP_ID` or `SLACK_MANUFACTURING_USERGROUP_HANDLE`.
The Slack app needs `usergroups:read` and `users:read`.

## Onshape

See `docs/onshape-panel.md` for supported query parameters and panel wiring.

Onshape OAuth metadata auto-fill uses:

- `ONSHAPE_CLIENT_ID`
- `ONSHAPE_CLIENT_SECRET`
- `ONSHAPE_REDIRECT_URI=https://cheesy-parts.vercel.app/oauthRedirect`

When configured, the panel can fetch selected-part metadata from Onshape after a
user clicks **Connect Onshape** and authorizes the app.

## Notes

Uploaded files are stored locally for development. For production deployment,
use durable file storage and pass public file URLs to Airtable attachments.

On Vercel, local fallback storage uses `/tmp` only to keep the app running when
Airtable is not configured. That storage is ephemeral and can disappear between
function invocations, so production queues should use Airtable.
