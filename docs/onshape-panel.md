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
- `elementId`
- `drawingElementId`
- `assemblyElementId`
- `partId`
- `documentTitle`
- `submitter`

If only Onshape IDs are supplied, the panel builds the part URL from
`documentId`, `workspaceId` or `versionId`, `elementId`, and `partId`.

Onshape App Store applications should use OAuth2 for user-authorized API access.
For internal team use, the panel can be embedded directly and fed metadata from
Onshape context or a lightweight browser extension until OAuth is wired in.
