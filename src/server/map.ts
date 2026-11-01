/**
 * The workstream view: one record per native section, keyed by
 * `sectionId`, with the name mirrored from BB. A workstream bound to a topic
 * takes its description and aliases from that topic, so what a workstream is
 * about is written in one place, the Topics view. A section with no topic
 * keeps its own stored description. Projects and activity are refreshed
 * deterministically from live threads.
 */
import type { Database } from "./db.ts";

export type MapRecord = {
  sectionId: string;
  name: string;
  description: string | null;
  descriptionSource: "generated" | "user";
  aliases: string[];
  /** The topic the workstream belongs to, when Workstreams keeps it for one. */
  topicId: string | null;
  createdBy: "user" | "workstreams";
  updatedAt: number;
};

type Row = {
  section_id: string;
  name: string | null;
  description: string | null;
  description_source: MapRecord["descriptionSource"];
  aliases: string;
  topic_id: string | null;
  topic_description: string | null;
  topic_aliases: string | null;
  created_by: MapRecord["createdBy"];
  updated_at: number;
};

const parse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

export class WorkstreamMap {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  list(): MapRecord[] {
    return (
      this.db
        .prepare(
          `SELECT w.*, s.name, e.id AS topic_id, e.description AS topic_description, e.aliases AS topic_aliases
           FROM ws_workstream w
           JOIN ws_seen_section s ON s.section_id = w.section_id
           LEFT JOIN ws_corpus_group g ON g.section_id = w.section_id
           LEFT JOIN ws_corpus_entity e ON e.id = g.entity_id
           ORDER BY s.name COLLATE NOCASE`,
        )
        .all() as Row[]
    ).map((row) => ({
      sectionId: row.section_id,
      name: row.name ?? "",
      description: row.topic_id
        ? row.topic_description || null
        : row.description,
      descriptionSource: row.description_source,
      aliases: row.topic_id
        ? parse(row.topic_aliases ?? "[]", [])
        : parse(row.aliases, []),
      topicId: row.topic_id,
      createdBy: row.created_by,
      updatedAt: row.updated_at,
    }));
  }

  get(sectionId: string): MapRecord | undefined {
    return this.list().find((record) => record.sectionId === sectionId);
  }
}
