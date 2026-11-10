import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type Database = ReturnType<BbPluginApi["storage"]["database"]>;

// The established ws_corpus_* table names hold topics, assignments, and section bindings.
/**
 * Append-only migration list: statement index is the durable migration ID.
 * Applied entries must stay unchanged, even when later entries remove their
 * tables, so installed databases advance through the same history.
 */
const MIGRATIONS = [
  "CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS banners (key TEXT PRIMARY KEY, name TEXT NOT NULL, motif TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, cost REAL NOT NULL, at INTEGER NOT NULL)",
  `CREATE TABLE ws_workstream (
    section_id TEXT PRIMARY KEY,
    description TEXT,
    description_source TEXT NOT NULL DEFAULT 'generated',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE ws_placement (
    thread_id TEXT PRIMARY KEY,
    section_id TEXT,
    source TEXT NOT NULL,
    entry_id TEXT,
    at INTEGER NOT NULL
  )`,
  `CREATE TABLE ws_journal (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    action TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    rationale TEXT NOT NULL,
    subject TEXT NOT NULL,
    undo TEXT,
    undoes TEXT,
    undone_by TEXT,
    detail TEXT
  )`,
  "CREATE INDEX ws_journal_at ON ws_journal (at DESC)",
  `CREATE TABLE ws_seen_thread (
    thread_id TEXT PRIMARY KEY,
    section_id TEXT,
    parent_thread_id TEXT
  )`,
  "CREATE TABLE ws_seen_section (section_id TEXT PRIMARY KEY, name TEXT NOT NULL)",
  "CREATE TABLE ws_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  `CREATE TABLE ws_analysis (
    thread_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    at INTEGER NOT NULL,
    result TEXT NOT NULL
  )`,
  "ALTER TABLE ws_workstream ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE ws_workstream ADD COLUMN subjects TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE ws_workstream ADD COLUMN projects TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE ws_workstream ADD COLUMN evidence TEXT NOT NULL DEFAULT '{}'",
  `CREATE TABLE ws_proposal (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    subject TEXT NOT NULL,
    source_section_id TEXT NOT NULL,
    target_section_id TEXT,
    new_name TEXT,
    thread_ids TEXT NOT NULL,
    evidence_count INTEGER NOT NULL,
    entry_id TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  "CREATE INDEX ws_proposal_status ON ws_proposal (status, updated_at DESC)",
  "CREATE TABLE ws_snooze (key TEXT PRIMARY KEY, evidence_count INTEGER NOT NULL, at INTEGER NOT NULL)",
  "ALTER TABLE ws_seen_thread ADD COLUMN title TEXT",
  `CREATE TABLE ws_project_shape (
    project_id TEXT PRIMARY KEY,
    shape TEXT NOT NULL,
    checked_at INTEGER NOT NULL
  )`,
  "CREATE TABLE ws_drift_dismissed (thread_id TEXT PRIMARY KEY, target TEXT NOT NULL, at INTEGER NOT NULL)",
  `CREATE TABLE ws_title (
    thread_id TEXT PRIMARY KEY,
    observed TEXT,
    written TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    retitled_at INTEGER
  )`,
  `CREATE TABLE ws_trace (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    label TEXT NOT NULL,
    model TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    replay_of TEXT,
    data TEXT NOT NULL
  )`,
  "CREATE INDEX ws_trace_at ON ws_trace (at DESC)",
  `CREATE TABLE ws_trace_link (
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    PRIMARY KEY (kind, ref, trace_id)
  )`,
  "CREATE INDEX ws_trace_link_trace ON ws_trace_link (trace_id)",
  "CREATE TABLE ws_archive_dismissed (thread_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
  `CREATE TABLE ws_recap (
    thread_id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    generated_at INTEGER NOT NULL,
    turns INTEGER NOT NULL,
    model TEXT NOT NULL
  )`,
  `CREATE TABLE ws_understanding_progress (
    thread_id TEXT PRIMARY KEY,
    cursor TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    error TEXT,
    updated_at INTEGER NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE ws_understanding_observation (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    speaker TEXT NOT NULL,
    quote TEXT NOT NULL,
    observation TEXT NOT NULL,
    epistemic TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(thread_id, entry_id, observation)
  )`,
  "CREATE INDEX ws_understanding_observation_thread ON ws_understanding_observation(thread_id)",
  `CREATE TABLE ws_understanding_account (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    narrative TEXT NOT NULL,
    questions TEXT NOT NULL,
    evidence_ids TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE ws_understanding_account_observation (
    account_id TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    PRIMARY KEY(account_id, observation_id)
  )`,
  "ALTER TABLE ws_understanding_observation ADD COLUMN source_at INTEGER",
  "ALTER TABLE ws_understanding_observation ADD COLUMN terms TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE ws_understanding_progress ADD COLUMN completed_revision INTEGER",
  "ALTER TABLE ws_understanding_progress ADD COLUMN backlog INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE ws_understanding_observation ADD COLUMN trace_id TEXT",
  "ALTER TABLE ws_understanding_account ADD COLUMN trace_id TEXT",
  `CREATE TABLE ws_understanding_revision (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    action TEXT NOT NULL,
    before TEXT,
    after TEXT,
    trace_id TEXT,
    reason TEXT NOT NULL
  )`,
  "CREATE INDEX ws_understanding_revision_account ON ws_understanding_revision(account_id, at DESC, id DESC)",
  `CREATE TABLE ws_understanding_retrieval (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    consumer TEXT NOT NULL,
    thread_id TEXT,
    trace_id TEXT,
    report TEXT NOT NULL
  )`,
  "CREATE INDEX ws_understanding_retrieval_thread ON ws_understanding_retrieval(thread_id, at DESC, id DESC)",
  "CREATE INDEX ws_understanding_retrieval_trace ON ws_understanding_retrieval(trace_id, at DESC, id DESC)",
  `CREATE TABLE ws_notebook (
    thread_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    cursor TEXT,
    revision INTEGER,
    error TEXT
  )`,
  `CREATE TABLE ws_notebook_brief (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    text TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE ws_notebook_run (
    id TEXT PRIMARY KEY,
    thread_id TEXT,
    question TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    summary TEXT NOT NULL,
    error TEXT,
    steps TEXT NOT NULL,
    usage TEXT NOT NULL,
    model TEXT NOT NULL
  )`,
  "CREATE INDEX ws_notebook_run_started ON ws_notebook_run(started_at DESC)",
  `CREATE TABLE ws_notebook_version (
    id TEXT PRIMARY KEY,
    thread_id TEXT,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    run_id TEXT
  )`,
  "CREATE INDEX ws_notebook_version_doc ON ws_notebook_version(thread_id, at DESC)",
  `CREATE TABLE ws_notebook_dependency (
    doc_thread_id TEXT,
    source_thread_id TEXT NOT NULL,
    PRIMARY KEY(doc_thread_id, source_thread_id)
  )`,
  "CREATE INDEX ws_notebook_dependency_source ON ws_notebook_dependency(source_thread_id)",
  `CREATE TABLE ws_notebook_run_dependency (
    run_id TEXT NOT NULL,
    source_thread_id TEXT NOT NULL,
    PRIMARY KEY(run_id, source_thread_id)
  )`,
  "CREATE INDEX ws_notebook_run_dependency_source ON ws_notebook_run_dependency(source_thread_id)",
  "DROP TABLE IF EXISTS ws_understanding_retrieval",
  "DROP TABLE IF EXISTS ws_understanding_revision",
  "DROP TABLE IF EXISTS ws_understanding_account_observation",
  "DROP TABLE IF EXISTS ws_understanding_account",
  "DROP TABLE IF EXISTS ws_understanding_observation",
  "DROP TABLE IF EXISTS ws_understanding_progress",
  "DELETE FROM ws_trace_link WHERE trace_id IN (SELECT id FROM ws_trace WHERE kind IN ('understanding-extract','understanding-synthesis'))",
  "DELETE FROM ws_trace WHERE kind IN ('understanding-extract','understanding-synthesis')",
  "ALTER TABLE ws_notebook ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 0",
  `INSERT OR IGNORE INTO ws_placement(thread_id,section_id,source,entry_id,at)
    SELECT t.thread_id,t.section_id,'auto',NULL,0 FROM ws_seen_thread t
    JOIN ws_seen_section s ON s.section_id=t.section_id
    JOIN json_each(CASE WHEN json_valid((SELECT value FROM state WHERE key='organize-log')) THEN (SELECT value FROM state WHERE key='organize-log') ELSE '[]' END) e
      ON json_extract(e.value,'$.action.threadId')=t.thread_id
    WHERE json_extract(e.value,'$.action.kind')='section' AND json_extract(e.value,'$.result')='done'
      AND COALESCE(json_extract(e.value,'$.undone'),0)=0
      AND (json_extract(e.value,'$.undo.workstreamsSectionId')=t.section_id
        OR lower(json_extract(e.value,'$.action.section'))=lower(s.name))`,
  "DROP TABLE IF EXISTS banners",
  "DROP TABLE IF EXISTS state",
  "ALTER TABLE ws_proposal ADD COLUMN snapshot TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE ws_proposal ADD COLUMN reason TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE ws_proposal ADD COLUMN confidence REAL NOT NULL DEFAULT 0",
  "ALTER TABLE ws_recap ADD COLUMN revision INTEGER",
  "ALTER TABLE ws_workstream ADD COLUMN metadata_revision INTEGER NOT NULL DEFAULT 0",
  "DROP TABLE IF EXISTS ws_notebook_run_dependency",
  "DROP TABLE IF EXISTS ws_notebook_dependency",
  "DROP TABLE IF EXISTS ws_notebook_version",
  "DROP TABLE IF EXISTS ws_notebook_run",
  "DROP TABLE IF EXISTS ws_notebook_brief",
  "DROP TABLE IF EXISTS ws_notebook",
  "DROP TABLE IF EXISTS ws_proposal",
  "DROP TABLE IF EXISTS ws_snooze",
  "DELETE FROM ws_meta WHERE key IN ('bootstrap', 'supervision_snapshot', 'supervision_failure')",
  "DELETE FROM ws_trace_link WHERE trace_id IN (SELECT id FROM ws_trace WHERE kind IN ('organize-map','organize-assign','file-unsorted','describe','supervision'))",
  "DELETE FROM ws_trace WHERE kind IN ('organize-map','organize-assign','file-unsorted','describe','supervision')",
  "UPDATE ws_journal SET status = 'dismissed' WHERE action = 'proposal' AND status = 'pending'",
  `CREATE TABLE ws_agent_recap (
    thread_id TEXT PRIMARY KEY,
    epoch INTEGER NOT NULL DEFAULT 0,
    intercepts INTEGER NOT NULL DEFAULT 0,
    checked_seq INTEGER NOT NULL DEFAULT 0,
    accepted_turn TEXT,
    recap TEXT,
    dismissed INTEGER NOT NULL DEFAULT 0,
    enrolled INTEGER NOT NULL DEFAULT 0,
    capped INTEGER NOT NULL DEFAULT 0,
    correction_token TEXT,
    input_key TEXT
  )`,
  "DROP TABLE IF EXISTS ws_recap",
  "DROP TABLE IF EXISTS ws_archive_dismissed",
  "DELETE FROM ws_trace_link WHERE trace_id IN (SELECT id FROM ws_trace WHERE kind = 'recap')",
  "DELETE FROM ws_trace WHERE kind = 'recap'",
  "ALTER TABLE ws_agent_recap ADD COLUMN proven INTEGER NOT NULL DEFAULT 0",
  `CREATE TABLE ws_question (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL)`,
  "CREATE UNIQUE INDEX ws_question_pending ON ws_question(thread_id) WHERE status IN ('pending', 'sending')",
  "ALTER TABLE ws_question ADD COLUMN result TEXT",
  "ALTER TABLE ws_question ADD COLUMN created_at INTEGER",
  "ALTER TABLE ws_question ADD COLUMN outcome TEXT",
  "ALTER TABLE ws_question ADD COLUMN interaction_id TEXT",
  "CREATE INDEX ws_question_interaction ON ws_question(interaction_id)",
  "ALTER TABLE ws_agent_recap ADD COLUMN waiting_nudged INTEGER NOT NULL DEFAULT 0",
  // A waiting recap needs an agent-selected timeout before it can schedule a check.
  `UPDATE ws_agent_recap SET recap = NULL WHERE json_extract(recap, '$.state') = 'continuing'`,
  `UPDATE ws_agent_recap SET recap = json_remove(recap, '$.active', '$.next') WHERE recap IS NOT NULL`,
  "ALTER TABLE ws_agent_recap ADD COLUMN waiting_cancelled INTEGER NOT NULL DEFAULT 0",
  `CREATE TABLE ws_corpus_entity (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    parent_id TEXT REFERENCES ws_corpus_entity(id),
    aliases TEXT NOT NULL DEFAULT '[]',
    UNIQUE(name, parent_id)
  )`,
  `CREATE TABLE ws_corpus_group (
    section_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES ws_corpus_entity(id)
  )`,
  `CREATE TABLE ws_corpus_subject (
    thread_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES ws_corpus_entity(id)
  )`,
  "ALTER TABLE ws_corpus_subject ADD COLUMN evidence TEXT",
  "ALTER TABLE ws_corpus_subject ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'",
  "ALTER TABLE ws_title ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS ws_corpus_subject_v2 (
    thread_id TEXT PRIMARY KEY,
    entity_id TEXT REFERENCES ws_corpus_entity(id),
    evidence TEXT,
    source TEXT NOT NULL DEFAULT 'legacy'
  )`,
  "INSERT OR REPLACE INTO ws_corpus_subject_v2(thread_id, entity_id, evidence, source) SELECT thread_id, entity_id, evidence, source FROM ws_corpus_subject",
  "DROP TABLE ws_corpus_subject",
  "ALTER TABLE ws_corpus_subject_v2 RENAME TO ws_corpus_subject",
  // Topics Workstreams discovered may be pruned once unused; yours never are.
  "ALTER TABLE ws_corpus_entity ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'",
  "UPDATE ws_corpus_subject SET source = 'full' WHERE source IN ('automatic', 'legacy')",
  "DROP TABLE IF EXISTS ws_drift_dismissed",
  "DROP TABLE IF EXISTS ws_project_shape",
  // Workstreams follow topics, so where a thread was placed and by whom no
  // longer decides anything.
  "DROP TABLE IF EXISTS ws_placement",
  "DELETE FROM ws_trace_link WHERE trace_id IN (SELECT id FROM ws_trace WHERE kind IN ('analysis', 'opening-goal', 'classify', 'regroup', 'route'))",
  "DELETE FROM ws_trace WHERE kind IN ('analysis', 'opening-goal', 'classify', 'regroup', 'route')",
  `CREATE TABLE ws_name_observation (
    id INTEGER PRIMARY KEY,
    thread_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    at INTEGER NOT NULL,
    names TEXT NOT NULL
  )`,
  "CREATE INDEX ws_name_observation_thread ON ws_name_observation(thread_id)",
  // Storage from before sources were named `manual`, `inherited`, `full`, and
  // `quick` recorded a topic you chose as `selected`. It is still your choice:
  // read as automatic, it would be replaced by the next analysis.
  "UPDATE ws_corpus_subject SET source = 'manual' WHERE source = 'selected'",
  // `classified` is the earlier name for an automatic topic, which is `full`.
  "UPDATE ws_corpus_subject SET source = 'full' WHERE source = 'classified'",
  "ALTER TABLE ws_corpus_entity ADD COLUMN partitioned INTEGER NOT NULL DEFAULT 0",
  // Each root's checkout, and whether its requests point at other
  // repositories, for placement's checkout hints.
  `CREATE TABLE ws_thread_checkout (
    thread_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    elsewhere INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX ws_thread_checkout_path ON ws_thread_checkout(path)",
  // Organizing suggestions, and the topic tree before each accepted one.
  `CREATE TABLE ws_suggestion (
    id TEXT PRIMARY KEY,
    pass_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    reason TEXT NOT NULL,
    summary TEXT NOT NULL,
    key TEXT NOT NULL,
    status TEXT NOT NULL,
    at INTEGER NOT NULL,
    decided_at INTEGER,
    detail TEXT,
    trace_id TEXT
  )`,
  "CREATE INDEX ws_suggestion_status ON ws_suggestion(status, at)",
  `CREATE TABLE ws_topic_snapshot (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    entities TEXT NOT NULL,
    subjects TEXT NOT NULL
  )`,
  // Nothing reads when a title was written or whether it was an opening one.
  "ALTER TABLE ws_title DROP COLUMN provisional",
  "ALTER TABLE ws_title DROP COLUMN retitled_at",
  "ALTER TABLE ws_corpus_entity ADD COLUMN project_id TEXT",
  "ALTER TABLE ws_corpus_entity ADD COLUMN project_source TEXT",
  "ALTER TABLE ws_corpus_entity ADD COLUMN project_revision INTEGER NOT NULL DEFAULT 0",
  "UPDATE ws_corpus_entity SET project_source = 'manual' WHERE project_id IS NOT NULL",
  `CREATE TABLE ws_project_draft (
    draft_key TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
  `CREATE TABLE ws_project_thread (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL
  )`,
  `CREATE TABLE ws_project_suggestion (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES ws_corpus_entity(id) ON DELETE CASCADE,
    association_revision INTEGER NOT NULL,
    project_id TEXT,
    evidence TEXT NOT NULL,
    status TEXT NOT NULL,
    UNIQUE(entity_id, association_revision, project_id)
  )`,
  "DROP TABLE IF EXISTS ws_name_observation",
  // Recaps written before an item was `{ text, detail }` kept their review
  // steps as `{ step, expect }`. Rewriting them lets the recap schema describe
  // one item shape for a stored recap and for the tool that writes a new one.
  // `item.type` reads each element's JSON type; `json_type(item.value)` would
  // parse a plain step string as JSON and fail.
  `UPDATE ws_agent_recap
     SET recap = json_set(recap, '$.review', (
       SELECT json_group_array(CASE
         WHEN item.type = 'object' THEN CASE
           WHEN json_type(item.value, '$.step') IS NULL THEN item.value
           WHEN json_type(item.value, '$.expect') IS NULL THEN json(json_remove(
             json_set(item.value, '$.text', json_extract(item.value, '$.step')),
             '$.step'))
           ELSE json(json_remove(
             json_set(item.value, '$.text', json_extract(item.value, '$.step'),
                      '$.detail', json_extract(item.value, '$.expect')),
             '$.step', '$.expect'))
         END
         ELSE item.value END)
       FROM json_each(recap, '$.review') AS item))
   WHERE json_type(recap, '$.review') = 'array'
     AND json_array_length(recap, '$.review') > 0
     AND recap LIKE '%"step"%'`,
  // `task` was the Waiting title before `goal` held it everywhere, and `tasks`
  // is the list `task` replaced; both are stored without a reader.
  "UPDATE ws_agent_recap SET recap = json_remove(recap, '$.task') WHERE json_type(recap, '$.task') IS NOT NULL",
  "UPDATE ws_agent_recap SET recap = json_remove(recap, '$.tasks') WHERE json_type(recap, '$.tasks') IS NOT NULL",
  // Workstream records carried the projects and thread evidence a page showed
  // and the subjects its earlier design filed; nothing reads or writes them.
  "ALTER TABLE ws_workstream DROP COLUMN subjects",
  "ALTER TABLE ws_workstream DROP COLUMN projects",
  "ALTER TABLE ws_workstream DROP COLUMN evidence",
  // Keys no code reads: the organizer's run state, and the flag that guarded
  // goal-title adoption before titles were generated from analysis.
  "DELETE FROM ws_meta WHERE key IN ('organizer', 'goal_titles_adopted')",
  // Traces once linked to proposals, sections, and organize runs. Those kinds
  // no longer parse, so a row left behind would fail the trace that owns it.
  "DELETE FROM ws_trace_link WHERE kind NOT IN ('thread', 'entry')",
  // The organizer recorded that its first pass had run; the state payload was
  // its only reader, and that field is gone.
  "DELETE FROM ws_meta WHERE key = 'bootstrapped'",
  // A journal row recorded which entry an undo reversed, and which entry
  // undone it; the original's own status records that, and nothing reads
  // either column.
  "ALTER TABLE ws_journal DROP COLUMN undoes",
  "ALTER TABLE ws_journal DROP COLUMN undone_by",
  // A suggestion kept the trace that proposed it, which no view offers.
  "ALTER TABLE ws_suggestion DROP COLUMN trace_id",
  // Analysis stored six keys from model schemas it no longer asks for.
  `UPDATE ws_analysis SET result = json_remove(result, '$.title', '$.subject', '$.drift', '$.driftSectionId', '$.objective', '$.identityVersion') WHERE result IS NOT NULL`,
  // Undo no longer restores a deleted workstream's description or edits one:
  // those steps referred to columns that are going away, so a batch keeps only
  // the steps that still reverse something.
  `UPDATE ws_journal
     SET undo = json_set(undo, '$.steps', (
       SELECT json_group_array(item.value) FROM json_each(undo, '$.steps') AS item
       WHERE json_extract(item.value, '$.kind') NOT IN ('metadata', 'restore-section')
     ))
   WHERE json_extract(undo, '$.kind') = 'batch'
     AND (undo LIKE '%"metadata"%' OR undo LIKE '%"restore-section"%')`,
  "UPDATE ws_journal SET undo = NULL WHERE json_extract(undo, '$.kind') IN ('metadata', 'restore-section')",
  "DELETE FROM ws_meta WHERE key LIKE 'restore-section:%'",
  // Proposal entries could not be applied once their feature was retired, and
  // they were the only rows with the retired action and source.
  "DELETE FROM ws_journal WHERE action = 'proposal'",
  // Workstream records kept a description, aliases, and revisions for an editor
  // that no longer exists; the organizer reads only who created the record.
  "ALTER TABLE ws_workstream DROP COLUMN description",
  "ALTER TABLE ws_workstream DROP COLUMN description_source",
  "ALTER TABLE ws_workstream DROP COLUMN aliases",
  "ALTER TABLE ws_workstream DROP COLUMN metadata_revision",
  "ALTER TABLE ws_workstream DROP COLUMN updated_at",
  "ALTER TABLE ws_workstream DROP COLUMN created_at",
  "ALTER TABLE ws_corpus_entity DROP COLUMN partitioned",
  `UPDATE ws_topic_snapshot SET entities = (
     SELECT json_group_array(json_remove(item.value, '$.partitioned'))
     FROM json_each(ws_topic_snapshot.entities) AS item
   ) WHERE json_valid(entities)`,
  "DELETE FROM ws_meta WHERE key = 'suggestions_splits'",
  `UPDATE ws_suggestion SET status = 'stale', detail = 'Review a scope-based topic division under the two-level identity rules.'
   WHERE kind = 'split' AND status = 'pending'`,
  `CREATE TABLE ws_topic_color (
    topic_id TEXT PRIMARY KEY REFERENCES ws_corpus_entity(id) ON DELETE CASCADE,
    family_id TEXT NOT NULL,
    hue INTEGER NOT NULL,
    level INTEGER NOT NULL
  )`,
  // A workstream's last visible-thread time kept an emptied one on the list;
  // an empty workstream now leaves at once, and nothing reads it.
  "DELETE FROM ws_meta WHERE key = 'last-populated-workstreams'",
  // A suggestion's own model call, so the debug UI can start a thread that
  // carries the prompt and response behind it.
  "ALTER TABLE ws_suggestion ADD COLUMN trace_id TEXT",
  // The project and title BB last reported for each visible, undeleted root
  // that nothing derived. Project learning plans from it rather than listing
  // every thread BB has.
  `CREATE TABLE ws_project_root (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL
  )`,
];

export function openDatabase(bb: BbPluginApi): Database {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  return db;
}

export function getMeta(db: Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM ws_meta WHERE key = ?").get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO ws_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
