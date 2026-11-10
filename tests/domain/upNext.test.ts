import { describe, expect, it } from "vitest";
import { DAY_MS, projectWorkstreams } from "../../src/domain/project.ts";
import type { UpNextKind } from "../../src/domain/status.ts";
import {
  UP_NEXT_FRESH_WINDOWS,
  UP_NEXT_LIMIT,
  UP_NEXT_MAX,
  UP_NEXT_STALE_AFTER_MS,
  agedKind,
  holdInPlace,
  selectRecent,
  selectUpNext,
} from "../../src/domain/upNext.ts";
import { thread, type TestThread } from "./fixtures.ts";

const now = 100 * DAY_MS;
/**
 * Up Next's clock for threads made with `t`: moments after their turns, so
 * none has aged out.
 */
const clock = 10_000;
const sections = [
  { id: "sec_a", name: "Alpha" },
  { id: "sec_b", name: "Beta" },
];
const ids = (rows: readonly { thread: { id: string } }[]) =>
  rows.map((row) => row.thread.id);

/**
 * A thread named for its tier: `q`uestion, `r`eview, `w`aiting, or `o`ther,
 * then `u`nread or `r`ead, then a suffix, e.g. `qu1`. `at` is its latest
 * attention.
 */
function t(id: string, at: number, overrides: Partial<TestThread> = {}) {
  return thread(id, {
    sectionId: "sec_a",
    isUnread: id[1] === "u",
    latestAttentionAt: at,
    ...overrides,
  });
}
const KINDS: Record<string, UpNextKind> = {
  q: "question",
  r: "review",
  w: "waiting",
};
const kindOf = (thread: { id: string }): UpNextKind =>
  KINDS[thread.id[0]!] ?? "other";

function upNext(
  threads: readonly TestThread[],
  options: {
    snoozedUntil?: (thread: TestThread) => number | null | undefined;
    exclude?: (thread: TestThread) => boolean;
    shown?: number;
    unreadFirst?: boolean;
    freshWithinMs?: number;
    fill?: boolean;
    includeWaiting?: boolean;
  } = {},
) {
  const projection = projectWorkstreams(threads, sections, {
    now,
    snoozedUntil: options.snoozedUntil,
  });
  return ids(
    selectUpNext(projection, {
      kindOf,
      now: clock,
      exclude: options.exclude,
      shown: options.shown,
      unreadFirst: options.unreadFirst,
      freshWithinMs: options.freshWithinMs,
      fill: options.fill,
      includeWaiting: options.includeWaiting,
    }).rows,
  );
}

describe("selectUpNext", () => {
  it("ranks unread threads first, newest first, whatever their kind", () => {
    // A read question outranks no unread one, however recent, and among
    // unread threads only recency counts, not question versus review.
    expect(
      upNext([
        t("rr1", 700),
        t("qr1", 900),
        t("ru1", 500),
        t("qu1", 100),
        t("qu2", 200),
      ]),
    ).toEqual(["ru1", "qu2", "qu1", "qr1", "rr1"]);
  });

  it("ranks an unread thread above a read question blocked on you", () => {
    expect(upNext([t("or1", 900), t("ou1", 800), t("qr1", 1)])).toEqual([
      "ou1",
      "qr1",
      "or1",
    ]);
  });

  it("leaves Waiting and working threads out", () => {
    expect(
      upNext([
        t("wu1", 900),
        t("wr1", 800),
        t("or1", 1),
        t("ou1", 2),
        t("or2", 3, { status: "active" }),
      ]),
    ).toEqual(["ou1", "or1"]);
    // A pending question keeps a running thread in: it is on the user now.
    expect(
      upNext([
        t("or1", 1),
        t("qu1", 2, { status: "active", hasPendingInteraction: true }),
      ]),
    ).toEqual(["qu1", "or1"]);
  });

  it("takes Waiting threads last when the caller asks for them", () => {
    // The queue page lists them for their status check; the sidebar never
    // does. Unread or read, they follow every other thread.
    expect(
      upNext([t("wu1", 900), t("wr1", 800), t("or1", 1), t("ou1", 2)], {
        includeWaiting: true,
      }),
    ).toEqual(["ou1", "or1", "wu1", "wr1"]);
  });

  it("puts the unread threads blocked on you first, whatever failed", () => {
    // A failed turn gets no boost: it ranks with the other unread threads, by
    // recency, and behind the unread thread that asks for something.
    expect(
      upNext([
        t("ou1", 900),
        t("ou2", 800, { status: "error" }),
        t("qu1", 700),
        t("qr1", 950),
      ]),
    ).toEqual(["qu1", "ou1", "ou2", "qr1"]);
  });

  it("shows the most urgent threads and no more", () => {
    expect(
      upNext([
        t("qu1", 1),
        t("wu1", 900),
        t("wr1", 800),
        t("ou1", 3),
        t("or1", 5),
        t("or2", 4),
        t("or3", 2),
      ]),
    ).toEqual(["qu1", "ou1", "or1", "or2", "or3"]);
    expect(
      upNext([
        ...[1, 2, 3, 4, 5].map((n) => t(`ou${n}`, 10 - n)),
        t("or1", 99),
      ]),
    ).toEqual(["ou1", "ou2", "ou3", "ou4", "ou5"]);
  });

  it("keeps a trimmed unread thread behind Show more", () => {
    const projection = projectWorkstreams(
      [...[1, 2, 3, 4, 5, 6].map((n) => t(`ou${n}`, 100 - n)), t("or1", 999)],
      sections,
      { now },
    );
    const selection = selectUpNext(projection, { kindOf, now: clock });
    expect(ids(selection.rows)).toEqual(["ou1", "ou2", "ou3", "ou4", "ou5"]);
    expect(ids(selection.more)).toEqual(["ou6"]);
  });

  it("lists every thread while there are few", () => {
    expect(upNext([t("or1", 1), t("or2", 2), t("ou1", 3)])).toEqual([
      "ou1",
      "or2",
      "or1",
    ]);
  });

  it("fills only with threads that are unread or blocked on you", () => {
    const threads = [
      t("ou1", 9),
      t("qr1", 8),
      t("or1", 7),
      t("or2", 6),
      t("wr1", 5),
    ];
    expect(upNext(threads, { fill: false })).toEqual(["ou1", "qr1"]);
    // The read threads the fill would have shown stay out of Show more too.
    const projection = projectWorkstreams(threads, sections, { now });
    expect(
      ids(selectUpNext(projection, { kindOf, now: clock, fill: false }).more),
    ).toEqual([]);
  });

  it("shows nothing rather than a read thread when nothing needs you", () => {
    const projection = projectWorkstreams(
      [t("or1", 1), t("wr1", 2)],
      sections,
      {
        now,
      },
    );
    const selection = selectUpNext(projection, {
      kindOf,
      now: clock,
      fill: false,
    });
    expect(ids(selection.rows)).toEqual([]);
    expect(ids(selection.more)).toEqual([]);
  });

  it("drops read threads not blocked on you first, least urgent first", () => {
    expect(
      upNext([
        t("qu1", 10),
        t("ou1", 9),
        t("ou2", 8),
        t("or1", 7),
        t("or2", 6),
        t("or3", 5),
      ]),
    ).toEqual(["qu1", "ou1", "ou2", "or1", "or2"]);
  });

  it("fills the last rows from the read threads once the unread ones run out", () => {
    expect(
      upNext([
        t("qr1", 10),
        t("rr1", 9),
        t("qu1", 8),
        t("or1", 99),
        t("ou1", 7),
        t("ou2", 6),
        t("ou3", 5),
      ]),
    ).toEqual(["qu1", "ou1", "ou2", "ou3", "qr1"]);
  });

  it("never lists more than Threads shown, however many are blocked on you", () => {
    const threads = [
      t("qu1", 10),
      t("ru1", 9),
      t("qr1", 8),
      t("qr2", 7),
      t("rr1", 6),
      t("rr2", 5),
      t("ou1", 99),
      t("or1", 98),
    ];
    const projection = projectWorkstreams(threads, sections, { now });
    const selection = selectUpNext(projection, { kindOf, now: clock });
    expect(ids(selection.rows)).toEqual(["qu1", "ru1", "ou1", "qr1", "qr2"]);
    // The read threads it cut still wait behind Show more, most urgent first.
    expect(ids(selection.more)).toEqual(["rr1", "rr2"]);
  });

  it("lands read blocked threads past the count behind Show more", () => {
    const unread = Array.from({ length: 6 }, (_, i) => t(`qu${i}`, 100 - i));
    const read = [
      t("qr1", 50),
      t("qr2", 49),
      t("rr1", 200),
      t("rr2", 48),
      t("rr3", 47),
    ];
    const projection = projectWorkstreams(
      [...unread, ...read, t("ou1", 300)],
      sections,
      { now },
    );
    const selection = selectUpNext(projection, { kindOf, now: clock });
    expect(ids(selection.rows)).toEqual(["qu0", "qu1", "qu2", "qu3", "qu4"]);
    expect(ids(selection.more)).toEqual([
      "qu5",
      "ou1",
      "qr1",
      "qr2",
      "rr1",
      "rr2",
      "rr3",
    ]);
  });

  it("shows at most the ten the setting allows", () => {
    // Unread threads rank newest first, so the newer reviews lead and the
    // oldest questions leave.
    const questions = Array.from({ length: 8 }, (_, i) => t(`qu${i}`, 100 + i));
    const reviews = Array.from({ length: 4 }, (_, i) => t(`ru${i}`, 200 + i));
    const shown = upNext([...questions, ...reviews, t("qr1", 999)], {
      shown: UP_NEXT_MAX,
    });
    expect(shown).toEqual([
      "ru3",
      "ru2",
      "ru1",
      "ru0",
      "qu7",
      "qu6",
      "qu5",
      "qu4",
      "qu3",
      "qu2",
    ]);
  });

  it("leaves out snoozed, archived, hidden, and excluded threads", () => {
    expect(
      upNext(
        [
          t("qu1", 1),
          t("qu2", 2, { isArchived: true }),
          t("qu3", 3, { isHidden: true }),
          t("qu4", 4),
          t("qu5", 5),
        ],
        {
          snoozedUntil: (thread) =>
            thread.id === "qu4" ? now + DAY_MS : undefined,
          exclude: (thread) => thread.id === "qu5",
        },
      ),
    ).toEqual(["qu1"]);
  });

  it.each(["pending", "starting", "active", "stopping"])(
    "leaves out a %s thread that asks nothing of you",
    (status) => {
      expect(
        upNext([t("or1", 1), t("or2", 9, { status }), t("ou1", 2, { status })]),
      ).toEqual(["or1"]);
    },
  );

  it("keeps a running thread with a pending question card or approval", () => {
    expect(
      upNext([
        t("or1", 9),
        t("qr1", 1, { status: "active", hasPendingInteraction: true }),
      ]),
    ).toEqual(["qr1", "or1"]);
  });

  it("keeps idle and failed threads, and treats an unknown status as idle", () => {
    expect(
      upNext([
        t("or1", 3, { status: "error" }),
        t("or2", 2, { status: "idle" }),
        t("or3", 1, { status: "someday" }),
      ]),
    ).toEqual(["or1", "or2", "or3"]);
  });

  it("lists only top-level threads, even when a parent is missing", () => {
    expect(
      upNext([
        t("or1", 1),
        t("qu1", 5, { parentThreadId: "or1" }),
        t("qu2", 6, { parentThreadId: "missing" }),
        t("qu3", 7, { parentThreadId: "archived" }),
        t("or2", 2, { id: "archived", isArchived: true }),
      ]),
    ).toEqual(["or1"]);
  });

  it("lists Unfiled and dormant threads too", () => {
    const old = now - 60 * DAY_MS;
    const projection = projectWorkstreams(
      [
        t("qu1", now - 1, { sectionId: null }),
        t("ru1", old, { sectionId: "sec_b" }),
      ],
      sections,
      { now },
    );
    expect(projection.dormant.map((group) => group.id)).toEqual(["sec_b"]);
    expect(ids(selectUpNext(projection, { kindOf, now: clock }).rows)).toEqual([
      "qu1",
      "ru1",
    ]);
  });

  it("focuses on prioritized workstreams while one has a thread blocked on you", () => {
    const projection = projectWorkstreams(
      [
        t("rr1", 1, { sectionId: "sec_b" }),
        t("or1", 2, { sectionId: "sec_b" }),
        t("qu1", 9, { sectionId: "sec_a" }),
        t("ru1", 8, { sectionId: "sec_a" }),
        t("ou1", 7, { sectionId: null }),
      ],
      sections,
      { now },
    );
    const focused = selectUpNext(projection, {
      kindOf,
      now: clock,
      prioritized: new Set(["sec_b"]),
    });
    expect(focused.focused).toBe(true);
    // The rules then apply to prioritized threads alone.
    expect(ids(focused.rows)).toEqual(["rr1", "or1"]);
  });

  it("doesn't focus while prioritized workstreams have nothing blocked on you", () => {
    const projection = projectWorkstreams(
      [
        t("ou1", 9, { sectionId: "sec_b" }),
        t("qr1", 1, { sectionId: "sec_a" }),
      ],
      sections,
      { now },
    );
    const selection = selectUpNext(projection, {
      kindOf,
      now: clock,
      prioritized: new Set(["sec_b"]),
    });
    expect(selection.focused).toBe(false);
    expect(ids(selection.rows)).toEqual(["ou1", "qr1"]);
  });

  describe("Show more", () => {
    const more = (threads: readonly TestThread[], prioritized?: string[]) =>
      ids(
        selectUpNext(projectWorkstreams(threads, sections, { now }), {
          kindOf,
          now: clock,
          prioritized: prioritized && new Set(prioritized),
        }).more,
      );

    it("holds the trimmed unread threads, but not the read ones not blocked on you", () => {
      expect(
        more([
          t("qu1", 99),
          ...[1, 2, 3, 4, 5].map((n) => t(`ou${n}`, 90 - n)),
          t("or1", 98),
          t("or2", 97),
        ]),
      ).toEqual(["ou5"]);
    });

    it("holds trimmed blocked threads, read or past the recency cut, most urgent first", () => {
      expect(
        more([
          ...Array.from({ length: 12 }, (_, i) => t(`qu${i}`, 100 + i)),
          t("rr1", 999),
          t("or1", 998),
        ]),
      ).toEqual(["qu6", "qu5", "qu4", "qu3", "qu2", "qu1", "qu0", "rr1"]);
    });

    it("stays within the focused workstreams", () => {
      expect(
        more(
          [
            ...Array.from({ length: 6 }, (_, i) =>
              t(`ou${i}`, 50 - i, { sectionId: "sec_b" }),
            ),
            t("qu1", 99, { sectionId: "sec_b" }),
            t("qu2", 98),
          ],
          ["sec_b"],
        ),
      ).toEqual(["ou4", "ou5"]);
    });
  });

  describe("aging out", () => {
    const stale = now - 8 * DAY_MS;
    const select = (
      threads: readonly TestThread[],
      prioritized?: ReadonlySet<string>,
    ) =>
      selectUpNext(projectWorkstreams(threads, sections, { now }), {
        kindOf,
        now,
        prioritized,
      });

    it("ranks a stale review or decision with the threads not blocked on you, keeping its read state", () => {
      expect(
        ids(
          select([
            t("ru1", stale),
            t("rr1", stale),
            // Analysis's needed decision, not a live question card.
            t("qr1", stale - DAY_MS),
            t("ou1", now - 1),
            t("rr2", now - 2),
          ]).rows,
        ),
      ).toEqual(["ou1", "ru1", "rr2", "rr1", "qr1"]);
    });

    it("holds a stale unread review behind Show more, but not a stale read one", () => {
      const selection = select([
        ...[1, 2, 3, 4, 5].map((n) => t(`ou${n}`, now - n)),
        t("ru1", stale),
        t("rr1", stale),
      ]);
      expect(ids(selection.rows)).toEqual(["ou1", "ou2", "ou3", "ou4", "ou5"]);
      expect(ids(selection.more)).toEqual(["ru1"]);
    });

    it("never ages a pending question card or approval", () => {
      // A stale question with a live card still ranks as a question: it
      // leads a fresh read review, which an aged-out decision would not.
      expect(
        ids(
          select([
            t("qr1", now - 30 * DAY_MS, { hasPendingInteraction: true }),
            t("rr1", now - 1),
          ]).rows,
        ),
      ).toEqual(["qr1", "rr1"]);
    });

    it("lets go of more than ten stale threads without a recency cut", () => {
      const threads = [
        ...Array.from({ length: 12 }, (_, i) => t(`ru${i}`, stale - i)),
        t("qu1", now - 1),
      ];
      // Once stale, they're trimmed as threads not blocked on you.
      expect(ids(select(threads).rows)).toEqual([
        "qu1",
        "ru0",
        "ru1",
        "ru2",
        "ru3",
      ]);
    });

    it("doesn't focus on a workstream whose only blocked thread is stale", () => {
      const selection = select(
        [t("rr1", stale, { sectionId: "sec_b" }), t("qu1", now - 1)],
        new Set(["sec_b"]),
      );
      expect(selection.focused).toBe(false);
      expect(ids(selection.rows)).toEqual(["qu1", "rr1"]);
    });

    it("ages a thread once more than the window has passed since its turn", () => {
      const quiet = { hasPendingInteraction: false, latestAttentionAt: 0 };
      expect(agedKind(quiet, "review", UP_NEXT_STALE_AFTER_MS)).toBe("review");
      expect(agedKind(quiet, "question", UP_NEXT_STALE_AFTER_MS + 1)).toBe(
        "other",
      );
      expect(UP_NEXT_STALE_AFTER_MS).toBe(7 * DAY_MS);
    });
  });

  it("trims to five and caps at ten", () => {
    expect([UP_NEXT_LIMIT, UP_NEXT_MAX]).toEqual([5, 10]);
  });

  describe("settings", () => {
    const HOUR = 60 * 60 * 1000;
    const ago = (hours: number) => clock - hours * HOUR;

    it("shows the chosen number of rows before Show more", () => {
      const quiet = [
        t("qu1", 10),
        t("or1", 9),
        t("or2", 8),
        t("or3", 7),
        t("or4", 6),
      ];
      expect(upNext(quiet)).toHaveLength(5);
      // The rows are the most urgent threads, cut at the chosen count.
      expect(upNext(quiet, { shown: 2 })).toEqual(["qu1", "or1"]);
      // Threads blocked on you don't grow the list past that count.
      const blocked = [
        t("qu1", 10),
        t("qr1", 9),
        t("qr2", 8),
        t("rr1", 7),
        t("or1", 6),
      ];
      expect(upNext(blocked, { shown: 2 })).toEqual(["qu1", "qr1"]);
    });

    it("leaves the trimmed unread threads behind Show more", () => {
      const projection = projectWorkstreams(
        [t("qu1", 10), t("ou1", 9), t("ou2", 8), t("or1", 7)],
        sections,
        { now },
      );
      const selection = selectUpNext(projection, {
        kindOf,
        now: clock,
        shown: 1,
      });
      expect(ids(selection.rows)).toEqual(["qu1"]);
      expect(ids(selection.more)).toEqual(["ou1", "ou2"]);
    });

    it("never shows more than the count, whatever the count allows", () => {
      const threads = Array.from({ length: 12 }, (_, i) =>
        t(`qu${i}`, 100 + i),
      );
      expect(upNext(threads, { shown: 99 })).toHaveLength(UP_NEXT_MAX);
      expect(upNext(threads)).toHaveLength(UP_NEXT_LIMIT);
    });

    it("ranks by kind alone when unread threads don't lead", () => {
      const threads = [t("ou1", 200), t("ru1", 100), t("qr1", 90)];
      // Unread leads every read thread by default, and a thread blocked on you
      // leads the unread ones.
      expect(upNext(threads)).toEqual(["ru1", "ou1", "qr1"]);
      // Turned off, kind alone decides, so a read question comes before an
      // unread review and unread only breaks a kind's tie. A Waiting thread
      // stays out either way.
      expect(
        upNext([...threads, t("wu1", 300)], { unreadFirst: false }),
      ).toEqual(["qr1", "ru1", "ou1"]);
    });

    it("holds trimmed unread threads behind Show more even when they don't lead", () => {
      const projection = projectWorkstreams(
        [...[1, 2, 3, 4, 5].map((n) => t(`or${n}`, 10 - n)), t("ou1", 1)],
        sections,
        { now },
      );
      const selection = selectUpNext(projection, {
        kindOf,
        now: clock,
        unreadFirst: false,
        shown: 2,
      });
      expect(ids(selection.rows)).toEqual(["or1", "or2"]);
      expect(ids(selection.more)).toEqual(["ou1"]);
    });

    it("moves threads whose turn ended within the window above older ones", () => {
      const threads = [t("qr1", ago(30)), t("rr1", ago(2)), t("or1", ago(1))];
      // Without a window the read question leads on kind alone.
      expect(upNext(threads)).toEqual(["qr1", "rr1", "or1"]);
      // A day and a quarter old, it falls behind both fresh threads, which
      // keep the usual order between them.
      expect(
        upNext(threads, { freshWithinMs: UP_NEXT_FRESH_WINDOWS["1d"] }),
      ).toEqual(["rr1", "or1", "qr1"]);
    });

    it("counts a thread still inside its window as fresh", () => {
      const window = UP_NEXT_FRESH_WINDOWS["1h"];
      // The boundary itself is inside the window, so a question exactly an
      // hour old leads only because it is a question, not because it's fresh.
      const fresh = t("qr1", clock - window);
      const older = t("or1", clock - window - 1);
      expect(upNext([older, fresh], { freshWithinMs: window })).toEqual([
        "qr1",
        "or1",
      ]);
      // One millisecond past it, the fresh thread wins on freshness instead.
      expect(
        upNext([t("qr1", clock - window - 1), t("or1", clock - window)], {
          freshWithinMs: window,
        }),
      ).toEqual(["or1", "qr1"]);
    });
  });
});

describe("selectRecent", () => {
  it("carries on past Up Next with the newest top-level threads it leaves out", () => {
    const threads = [
      ...Array.from({ length: 8 }, (_, i) => t(`or${i}`, 100 - i)),
      t("qu1", 1),
      t("child", 999, { parentThreadId: "or0" }),
      t("snoozed", 998),
    ];
    const projection = projectWorkstreams(threads, sections, {
      now,
      snoozedUntil: (thread) => (thread.id === "snoozed" ? null : undefined),
    });
    const shown = selectUpNext(projection, { kindOf, now: clock }).rows;
    expect(ids(shown)).toEqual(["qu1", "or0", "or1", "or2", "or3"]);
    expect(ids(selectRecent(projection, shown, 3))).toEqual([
      "or4",
      "or5",
      "or6",
    ]);
  });

  it("leaves out whatever Up Next draws, including a held row", () => {
    const projection = projectWorkstreams(
      [t("or1", 3), t("or2", 2), t("or3", 1)],
      sections,
      { now },
    );
    const held = projection.rowOf.get("or2")!;
    expect(ids(selectRecent(projection, [held], 5))).toEqual(["or1", "or3"]);
  });
});

describe("holdInPlace", () => {
  const projection = projectWorkstreams(
    [t("or1", 3), t("or2", 2), t("or3", 1)],
    sections,
    { now },
  );
  const row = (id: string) => projection.rowOf.get(id)!;
  const rows = [row("or1"), row("or2")];

  it("moves a listed row back to where it was", () => {
    expect(ids(holdInPlace(rows, row("or2"), 0))).toEqual(["or2", "or1"]);
  });

  it("keeps a row the list dropped, at its old place or last", () => {
    expect(ids(holdInPlace(rows, row("or3"), 1))).toEqual([
      "or1",
      "or3",
      "or2",
    ]);
    expect(ids(holdInPlace(rows, row("or3"), 7))).toEqual([
      "or1",
      "or2",
      "or3",
    ]);
  });

  it("holds nothing without a row or a place", () => {
    expect(ids(holdInPlace(rows, undefined, 0))).toEqual(["or1", "or2"]);
    expect(ids(holdInPlace(rows, row("or3"), -1))).toEqual(["or1", "or2"]);
  });
});
