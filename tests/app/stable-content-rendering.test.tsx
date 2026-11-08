// @vitest-environment jsdom
import { useComposer } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CardBody } from "../../src/app/composer/RecapCard.tsx";
import {
  PlainMarkdown,
  type ReplyDocument,
} from "../../src/app/reply/Evidence.tsx";
import { normalizeReplyMarkdown } from "../../src/app/reply/markdown.ts";
import {
  recapSegments,
  type Recap,
  type RecapFiles,
} from "../../src/domain/recap.ts";

const recapRenders = vi.hoisted(() => ({
  summary: 0,
  footer: 0,
  actions: 0,
}));

vi.mock("@/lib/portal-scope", () => ({
  usePortalScopeProps: () => {
    recapRenders.footer++;
    return {};
  },
}));

vi.mock("../../src/app/Hint.tsx", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/app/Hint.tsx")>();
  const React = await import("react");
  return {
    ...actual,
    Hint: (props: React.ComponentProps<typeof actual.Hint>) => {
      recapRenders.actions++;
      return props.children;
    },
  };
});

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  const React = await import("react");
  return {
    ...actual,
    Markdown: (props: React.ComponentProps<typeof actual.Markdown>) =>
      React.createElement("div", {
        "data-markdown": props.content,
        "data-document": JSON.stringify(props.experimental_document),
      }),
    useBbNavigate: () => {
      recapRenders.summary++;
      return actual.useBbNavigate();
    },
  };
});

vi.mock("../../src/domain/recap.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/domain/recap.ts")>();
  return { ...actual, recapSegments: vi.fn(actual.recapSegments) };
});

vi.mock("../../src/app/reply/markdown.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/app/reply/markdown.ts")>();
  return {
    ...actual,
    normalizeReplyMarkdown: vi.fn(actual.normalizeReplyMarkdown),
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(recapSegments).mockClear();
  vi.mocked(normalizeReplyMarkdown).mockClear();
  recapRenders.summary = 0;
  recapRenders.footer = 0;
  recapRenders.actions = 0;
});

const THREAD = { kind: "thread", threadId: "t1" } as const;
const FILES: RecapFiles = {
  environmentId: "env1",
  root: "/work",
  hostId: "host1",
};
const RECAP: Recap = {
  id: "r1",
  turnId: "turn1",
  at: 1,
  state: "complete",
  goal: "Build the card",
  latest: ["First result", "Second result"],
  review: [],
  links: [],
  next: [
    {
      title: "Run tests",
      message: "Run the full test suite",
      description: "Check for regressions",
    },
  ],
};
const DOCUMENT: NonNullable<ReplyDocument> = {
  threadId: "t1",
  rootPath: "/work",
  target: {
    kind: "workspace",
    environmentId: "env1",
    path: "__reply__.md",
  },
};

function RecapSuite({
  recap = RECAP,
  files = FILES,
  threadId = "t1",
}: {
  recap?: Recap;
  files?: RecapFiles;
  threadId?: string;
}) {
  useComposer();
  return (
    <CardBody
      recap={recap}
      layout="full"
      files={files}
      threadId={threadId}
      showArchive
      archiveBusy={false}
      archiveError={null}
      waitingCancelled={false}
      onArchive={noop}
      onDismiss={noop}
      onSend={send}
      onCompose={noop}
    />
  );
}

function noop() {}
async function send() {}

function ReplySuite({
  content,
  document = DOCUMENT,
}: {
  content: readonly [string, string];
  document?: ReplyDocument;
}) {
  useComposer();
  return (
    <>
      <PlainMarkdown content={content[0]} document={document} />
      <PlainMarkdown content={content[1]} document={document} />
    </>
  );
}

function report(metric: string, details: Record<string, number>) {
  console.log(`PERF ${metric} ${JSON.stringify(details)}`);
}

it("segments recap text again only when its exact content changes", async () => {
  const view = renderSlot(
    { component: RecapSuite },
    {},
    { composer: { scope: THREAD, text: "draft" } },
  );
  vi.mocked(recapSegments).mockClear();
  recapRenders.summary = 0;
  recapRenders.footer = 0;
  recapRenders.actions = 0;
  for (let draft = 0; draft < 60; draft++)
    await view.behavior.setComposerText(`draft ${draft}`);
  const unchanged = vi.mocked(recapSegments).mock.calls.length;
  report("recap-segments-60-drafts", {
    calls: unchanged,
    textRuns: 3,
    summaryRenders: recapRenders.summary,
    footerRenders: recapRenders.footer,
    actionRenders: recapRenders.actions,
  });
  expect(unchanged).toBe(0);
  expect(recapRenders).toEqual({ summary: 0, footer: 0, actions: 0 });

  const changedRecap: Recap = {
    ...RECAP,
    latest: ["Changed result", RECAP.latest[1]!],
  };
  view.lifecycle.rerender(<RecapSuite recap={changedRecap} />);
  expect(vi.mocked(recapSegments)).toHaveBeenCalledTimes(1);
  expect(
    view.container.querySelector('[data-markdown="Changed result"]'),
  ).not.toBeNull();

  vi.mocked(recapSegments).mockClear();
  const nextFiles: RecapFiles = {
    environmentId: "env2",
    root: "/next workspace",
    hostId: "host2",
  };
  view.lifecycle.rerender(
    <RecapSuite recap={changedRecap} files={nextFiles} threadId="t2" />,
  );
  expect(vi.mocked(recapSegments)).not.toHaveBeenCalled();
  for (const markdown of view.container.querySelectorAll("[data-document]")) {
    expect(JSON.parse(markdown.getAttribute("data-document")!)).toEqual({
      threadId: "t2",
      rootPath: "/next workspace",
      target: {
        kind: "workspace",
        environmentId: "env2",
        path: "__recap__.md",
      },
    });
  }
});

it("normalizes reply Markdown again only when its exact content changes", async () => {
  const source = [
    "Read [the plan](docs/My Plan.md).",
    "`[code](docs/Code Sample.md)`",
    "$[math](docs/Math Sample.md)$",
    '<span data-value="[html](docs/Html Sample.md)">HTML</span>',
  ]
    .join("\n\n")
    .repeat(120);
  const detail = "See [the evidence](docs/Evidence Detail.md).";
  const content = [source, detail] as const;
  const view = renderSlot(
    { component: ReplySuite },
    { content },
    { composer: { scope: THREAD, text: "draft" } },
  );
  vi.mocked(normalizeReplyMarkdown).mockClear();
  for (let draft = 0; draft < 20; draft++)
    await view.behavior.setComposerText(`draft ${draft}`);
  const unchanged = vi.mocked(normalizeReplyMarkdown).mock.calls.length;
  report("reply-normalization-20-drafts", {
    calls: unchanged,
    markdownRuns: 2,
    sourceBytes: source.length,
  });
  expect(unchanged).toBe(0);

  const normalized = view.container
    .querySelector("[data-markdown]")!
    .getAttribute("data-markdown")!;
  expect(normalized).toContain("docs/My%20Plan.md");
  expect(normalized).not.toContain("Code%20Sample");
  expect(normalized).not.toContain("Math%20Sample");
  expect(normalized).not.toContain("Html%20Sample");

  const changedContent = [`${source}\n\nChanged.`, detail] as const;
  view.lifecycle.rerender(<ReplySuite content={changedContent} />);
  expect(vi.mocked(normalizeReplyMarkdown)).toHaveBeenCalledTimes(1);
  expect(
    view.container
      .querySelector("[data-markdown]")
      ?.getAttribute("data-markdown"),
  ).toContain("Changed.");

  vi.mocked(normalizeReplyMarkdown).mockClear();
  const nextDocument: NonNullable<ReplyDocument> = {
    ...DOCUMENT,
    threadId: "t2",
    rootPath: "/next workspace",
    target: {
      kind: "workspace",
      environmentId: "env2",
      path: "__reply__.md",
    },
  };
  view.lifecycle.rerender(
    <ReplySuite content={changedContent} document={nextDocument} />,
  );
  expect(vi.mocked(normalizeReplyMarkdown)).not.toHaveBeenCalled();
  for (const markdown of view.container.querySelectorAll("[data-document]"))
    expect(JSON.parse(markdown.getAttribute("data-document")!)).toEqual(
      nextDocument,
    );
});
