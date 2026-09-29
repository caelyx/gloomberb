import type { PluginPersistence } from "gloomberb/types/plugin";
import { createPluginCache } from "gloomberb/utils";
import type { AnnouncementExtract, AnnouncementsPage, EntityMatch } from "./model";
import { normaliseAsxCode } from "./urls";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A list can gain a row at any moment in market hours, and occasionally loses one (CBA's total fell from 7,773 to 7,772 on 29 Sep 2026). */
export const ANNOUNCEMENTS_POLICY = { staleMs: 15 * MINUTE, expireMs: 7 * DAY };
/** A published PDF does not change. */
export const EXTRACT_POLICY = { staleMs: 30 * DAY, expireMs: 90 * DAY };

const SOURCE = "markitdigital";
const ENTITY_SCHEMA = 1;

export type AsxCaches = ReturnType<typeof createAsxCaches>;

export function announcementsCacheKey(code: string, page: number, itemsPerPage: number): string {
  return `${normaliseAsxCode(code)}:${page}:${itemsPerPage}`;
}

export function createAsxCaches() {
  let persistence: PluginPersistence | null = null;
  const announcements = createPluginCache<AnnouncementsPage>({ kind: "asx-announcements", source: SOURCE, schemaVersion: 1, policy: ANNOUNCEMENTS_POLICY });
  // Version 2: running headers and page counters are stripped, so older cleaned extracts are rebuilt.
  const extracts = createPluginCache<AnnouncementExtract>({ kind: "asx-extract", source: SOURCE, schemaVersion: 2, policy: EXTRACT_POLICY });
  return {
    announcements,
    extracts,
    attach(next: PluginPersistence) {
      persistence = next;
      announcements.attach(next);
      extracts.attach(next);
    },
    reset() {
      persistence = null;
      announcements.reset();
      extracts.reset();
    },
    /** The xid for a code never changes, so it is plain state rather than a TTL resource. */
    getEntity(code: string): EntityMatch | null {
      return persistence?.getState<EntityMatch>(`entity:${normaliseAsxCode(code)}`, { schemaVersion: ENTITY_SCHEMA }) ?? null;
    },
    setEntity(code: string, entity: EntityMatch): void {
      persistence?.setState(`entity:${normaliseAsxCode(code)}`, entity, { schemaVersion: ENTITY_SCHEMA });
    },
  };
}
