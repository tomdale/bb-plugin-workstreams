import {
  allocateChildColor,
  allocateFamilyColor,
  type WorkstreamColor,
} from "../domain/workstreamColor.ts";
import type { Workstream } from "../domain/workstreams.ts";
import type { Database } from "./db.ts";

type StoredColor = WorkstreamColor & { workstreamId: string; familyId: string };

/** Persists workstream colors by workstream, independently of disposable BB sections. */
export class WorkstreamColors {
  constructor(private readonly db: Database) {}

  /** Allocate missing colors and reassign workstreams whose family changed, atomically. */
  snapshot(
    workstreams: readonly Workstream[],
    groups: Readonly<Record<string, string>>,
  ): Record<string, WorkstreamColor> {
    return this.db.transaction(() => {
      const byId = new Map(
        workstreams.map((workstream) => [workstream.id, workstream]),
      );
      const familyOf = (id: string): string | null => {
        const seen = new Set<string>();
        let at: string | null = id;
        while (at) {
          if (seen.has(at)) return null;
          seen.add(at);
          const workstream = byId.get(at);
          if (!workstream) return null;
          if (!workstream.parentId) return workstream.id;
          at = workstream.parentId;
        }
        return null;
      };
      const rows = this.db
        .prepare(
          "SELECT workstream_id, family_id, hue, level FROM ws_workstream_color ORDER BY workstream_id",
        )
        .all() as {
        workstream_id: string;
        family_id: string;
        hue: number;
        level: -1 | 0 | 1;
      }[];
      const required = new Set(
        Object.values(groups).filter((id) => byId.has(id)),
      );
      const colors = new Map<string, StoredColor>();
      const reparented = new Set<string>();
      for (const row of rows) {
        const workstream = byId.get(row.workstream_id);
        if (!workstream) {
          this.db
            .prepare("DELETE FROM ws_workstream_color WHERE workstream_id = ?")
            .run(row.workstream_id);
          continue;
        }
        required.add(workstream.id);
        const familyId = familyOf(workstream.id);
        if (familyId && row.family_id !== familyId) {
          this.db
            .prepare("DELETE FROM ws_workstream_color WHERE workstream_id = ?")
            .run(workstream.id);
          reparented.add(workstream.id);
        } else {
          colors.set(workstream.id, {
            workstreamId: workstream.id,
            familyId: row.family_id,
            hue: row.hue,
            level: row.level,
          });
        }
      }
      const used = () => {
        const families = [...colors.values()].filter(
          (color) => color.workstreamId === color.familyId,
        );
        return families.flatMap((family) => {
          const children = [...colors.values()].filter(
            (color) =>
              color.familyId === family.workstreamId &&
              color.workstreamId !== family.workstreamId,
          );
          return children.length ? children : [family];
        });
      };
      const put = (
        workstreamId: string,
        familyId: string,
        color: WorkstreamColor,
      ) => {
        this.db
          .prepare(
            "INSERT INTO ws_workstream_color(workstream_id, family_id, hue, level) VALUES (?, ?, ?, ?)",
          )
          .run(workstreamId, familyId, color.hue, color.level);
        const stored = {
          workstreamId,
          familyId,
          hue: color.hue,
          level: color.level,
        };
        colors.set(workstreamId, stored);
        return stored;
      };
      for (const id of [...required].sort()) {
        const workstream = byId.get(id)!;
        const familyId = familyOf(workstream.id);
        if (!familyId) continue;
        let parent = colors.get(familyId);
        if (!parent)
          parent = put(familyId, familyId, allocateFamilyColor(used()));
        if (workstream.id === familyId || colors.has(workstream.id)) continue;
        const siblings = [...colors.values()].filter(
          (color) =>
            color.familyId === familyId && color.workstreamId !== familyId,
        );
        put(
          workstream.id,
          familyId,
          allocateChildColor(
            parent,
            siblings,
            used(),
            reparented.has(workstream.id),
          ),
        );
      }
      return Object.fromEntries(
        [...colors].map(([id, { hue, level }]) => [id, { hue, level }]),
      );
    })();
  }
}
