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
ONSHAPE_CLIENT_ID=
ONSHAPE_CLIENT_SECRET=
ONSHAPE_REDIRECT_URI=https://cheesy-parts.vercel.app/oauthRedirect
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
choices from Airtable for `Subsystem` and `Vendor Name`/`Vendor` and uses those
as dropdown options. Add `Notes` and `Time Created` fields to the manufacturing
table so those values can be written back to Airtable.

When no Drawing PDF is manually uploaded, the submission API can attach an
exported Onshape PDF automatically. It first searches drawing elements in the
same document and accepts only a drawing whose views reference exactly the
selected part ID, falling back to exact part-name matching only when drawing
view references are unavailable. Drawings that reference additional parts are
ignored.

Onshape App Store applications should use OAuth2 for user-authorized API access.
For internal team use, the panel can be embedded directly and fed metadata from
Onshape context or a lightweight browser extension until OAuth is wired in.
