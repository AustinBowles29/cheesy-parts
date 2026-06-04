# Onshape Panel Integration

The embedded submission UI is available at `/onshape`.

For an Onshape custom app or panel, pass as many of these query parameters as
the Onshape context can provide:

- `partName`
- `partNumber`
- `material`
- `thickness`
- `quantity`
- `subsystem`
- `machineType`
- `onshapePartUrl`
- `onshapeDrawingUrl`
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
ONSHAPE_CLIENT_ID=
ONSHAPE_CLIENT_SECRET=
ONSHAPE_REDIRECT_URI=https://cheesy-parts.vercel.app/oauthRedirect
```

After a user connects Onshape, the panel fetches the selected Part Studio parts
from Onshape and fills part name, part number, material, and thickness when the
API returns those values.

Onshape App Store applications should use OAuth2 for user-authorized API access.
For internal team use, the panel can be embedded directly and fed metadata from
Onshape context or a lightweight browser extension until OAuth is wired in.
