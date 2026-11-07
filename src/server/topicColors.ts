import {
  allocateChildColor,
  allocateFamilyColor,
  type TopicColor,
} from "../domain/workstreamColor.ts";
import type { Topic } from "../domain/topics.ts";
import type { Database } from "./db.ts";

type StoredColor = TopicColor & { topicId: string; familyId: string };

/** Persists workstream colors by topic, independently of disposable BB sections. */
export class TopicColors {
  constructor(private readonly db: Database) {}

  /** Allocate missing colors and reassign topics whose family changed, atomically. */
  snapshot(
    entities: readonly Topic[],
    groups: Readonly<Record<string, string>>,
  ): Record<string, TopicColor> {
    return this.db.transaction(() => {
      const byId = new Map(entities.map((entity) => [entity.id, entity]));
      const familyOf = (id: string): string | null => {
        const seen = new Set<string>();
        let at: string | null = id;
        while (at) {
          if (seen.has(at)) return null;
          seen.add(at);
          const entity = byId.get(at);
          if (!entity) return null;
          if (!entity.parentId) return entity.id;
          at = entity.parentId;
        }
        return null;
      };
      const rows = this.db
        .prepare(
          "SELECT topic_id, family_id, hue, level FROM ws_topic_color ORDER BY topic_id",
        )
        .all() as {
        topic_id: string;
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
        const topic = byId.get(row.topic_id);
        if (!topic) {
          this.db
            .prepare("DELETE FROM ws_topic_color WHERE topic_id = ?")
            .run(row.topic_id);
          continue;
        }
        required.add(topic.id);
        const familyId = familyOf(topic.id);
        if (familyId && row.family_id !== familyId) {
          this.db
            .prepare("DELETE FROM ws_topic_color WHERE topic_id = ?")
            .run(topic.id);
          reparented.add(topic.id);
        } else {
          colors.set(topic.id, {
            topicId: topic.id,
            familyId: row.family_id,
            hue: row.hue,
            level: row.level,
          });
        }
      }
      const used = () => {
        const roots = [...colors.values()].filter(
          (color) => color.topicId === color.familyId,
        );
        return roots.flatMap((root) => {
          const children = [...colors.values()].filter(
            (color) =>
              color.familyId === root.topicId && color.topicId !== root.topicId,
          );
          return children.length ? children : [root];
        });
      };
      const put = (topicId: string, familyId: string, color: TopicColor) => {
        this.db
          .prepare(
            "INSERT INTO ws_topic_color(topic_id, family_id, hue, level) VALUES (?, ?, ?, ?)",
          )
          .run(topicId, familyId, color.hue, color.level);
        const stored = {
          topicId,
          familyId,
          hue: color.hue,
          level: color.level,
        };
        colors.set(topicId, stored);
        return stored;
      };
      for (const id of [...required].sort()) {
        const topic = byId.get(id)!;
        const familyId = familyOf(topic.id);
        if (!familyId) continue;
        let parent = colors.get(familyId);
        if (!parent)
          parent = put(familyId, familyId, allocateFamilyColor(used()));
        if (topic.id === familyId || colors.has(topic.id)) continue;
        const siblings = [...colors.values()].filter(
          (color) => color.familyId === familyId && color.topicId !== familyId,
        );
        put(
          topic.id,
          familyId,
          allocateChildColor(
            parent,
            siblings,
            used(),
            reparented.has(topic.id),
          ),
        );
      }
      return Object.fromEntries(
        [...colors].map(([id, { hue, level }]) => [id, { hue, level }]),
      );
    })();
  }
}
