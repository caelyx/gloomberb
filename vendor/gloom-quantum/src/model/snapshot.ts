// The Records table frozen per dataset version, for the Changes tab (brief §3.6).
import type { Dataset } from "../schema";
import { versionDate } from "./lookback";
import { computeRecords, type RecordRow } from "./records";

export interface RecordsSnapshot {
  dataset_version: string;
  records: RecordRow[];
}

/** Records over all results dated on or before the version's own date. */
export function snapshotRecords(dataset: Dataset): RecordsSnapshot {
  const today = versionDate(dataset.dataset_version);
  // The "all" window keeps future-dated rows, so the version's own date cuts them here.
  const asOfVersion = { ...dataset, results: dataset.results.filter((r) => r.date_primary <= today) };
  return { dataset_version: dataset.dataset_version, records: computeRecords(asOfVersion, { lookback: "all", today }) };
}
