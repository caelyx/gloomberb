// The Changes tab (brief §4): which records moved between two dataset versions.
import type { ChangelogEntry } from "../schema";
import type { RecordHolder, RecordRow } from "./records";
import type { RecordsSnapshot } from "./snapshot";

export interface RecordChange {
  metricId: string;
  label: string;
  group: string | null;
  /**
   * `new`: no holder before; `removed`: no holder now; `changed`: holder or value differs.
   * `introduced` / `retired`: the metric id exists in only the newer / older snapshot (a
   * new, renamed or redefined record). Listed once per id, with no holders: values
   * measured on different definitions are not compared.
   */
  kind: "new" | "removed" | "changed" | "introduced" | "retired";
  before: Array<Pick<RecordHolder, "resultId" | "value">>;
  after: Array<Pick<RecordHolder, "resultId" | "value">>;
}

const key = (r: RecordRow) => `${r.metricId}|${r.group ?? ""}`;
const signature = (r: RecordRow | undefined) =>
  (r?.holders ?? []).map((h) => `${h.resultId}=${h.value}`).sort().join(",");
const brief = (r: RecordRow | undefined) => (r?.holders ?? []).map((h) => ({ resultId: h.resultId, value: h.value }));

export function diffSnapshots(older: RecordsSnapshot, newer: RecordsSnapshot): RecordChange[] {
  const olderIds = new Set(older.records.map((r) => r.metricId));
  const newerIds = new Set(newer.records.map((r) => r.metricId));
  const shared = (r: RecordRow) => olderIds.has(r.metricId) && newerIds.has(r.metricId);
  const before = new Map(older.records.filter(shared).map((r) => [key(r), r]));
  const after = new Map(newer.records.filter(shared).map((r) => [key(r), r]));
  const keys = [...new Set([...after.keys(), ...before.keys()])];
  const changes: RecordChange[] = [];
  const once = (rows: RecordRow[], kind: "introduced" | "retired", other: Set<string>) => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (other.has(r.metricId) || seen.has(r.metricId)) continue;
      seen.add(r.metricId);
      changes.push({ metricId: r.metricId, label: r.label, group: null, kind, before: [], after: [] });
    }
  };
  once(newer.records, "introduced", olderIds);
  once(older.records, "retired", newerIds);
  for (const k of keys) {
    const b = before.get(k);
    const a = after.get(k);
    if (signature(a) === signature(b)) continue;
    const row = (a ?? b)!;
    const kind = !b || b.holders.length === 0 ? "new" : !a || a.holders.length === 0 ? "removed" : "changed";
    changes.push({ metricId: row.metricId, label: row.label, group: row.group, kind, before: brief(b), after: brief(a) });
  }
  return changes;
}

export function changelogCounts(changelog: ChangelogEntry[], olderVersion: string, newerVersion: string) {
  const counts = { added: 0, updated: 0, superseded: 0, retracted: 0 };
  for (const entry of changelog) {
    if (entry.dataset_version <= olderVersion || entry.dataset_version > newerVersion) continue;
    counts.added += entry.added?.length ?? 0;
    counts.updated += entry.updated?.length ?? 0;
    counts.superseded += entry.superseded?.length ?? 0;
    counts.retracted += entry.retracted?.length ?? 0;
  }
  return counts;
}
