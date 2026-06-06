import type { Metadata } from "next";
import { OnshapeSubmissionPanelLoader } from "@/components/onshape-submission-panel-loader";
import {
  defaultsFromPanelParams,
  emptySubmissionFieldOptions,
  panelParamsToQueryString,
} from "@/lib/onshape-panel-defaults";

export const metadata: Metadata = {
  title: "Submit Part | Team 254 Manufacturing",
};

export const dynamic = "force-dynamic";

export default async function OnshapePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <OnshapeSubmissionPanelLoader
      initialDefaults={defaultsFromPanelParams(params)}
      initialFieldOptions={emptySubmissionFieldOptions()}
      panelDataUrl={`/api/onshape/panel-data${panelParamsToQueryString(params)}`}
    />
  );
}
