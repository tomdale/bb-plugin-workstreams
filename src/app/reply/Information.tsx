/*
 * Purpose-built views of reported information. Status colors distinguish
 * observations from unknown or untested work; they do not verify a claim.
 * Supporting details are disclosed locally, while qualifications stay visible.
 */
import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import {
  Markdown,
  UrlLink,
  experimental_FileLink as FileLink,
} from "@get-bb/plugin-sdk/app";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { MarkdownDocumentContext, RecapText } from "../composer/RecapCard.tsx";
import { ReplyContext } from "./ReplyContext.tsx";
import { isInlineProse } from "./opening.ts";
import {
  evidenceFilePath,
  type ReplyEvidence,
  type ReplyPart,
  type ReplyLeaf,
} from "../../domain/replyComponents.ts";

const Heading = ({ children }: { children: ReactNode }) => (
  <h3 className="m-0 mb-3 text-[1.08em] font-semibold leading-[1.5] text-foreground">
    {children}
  </h3>
);
const MUTED = "text-muted-foreground";
const GOOD = "text-(--ws-complete-text)";
const WARN = "text-(--ws-needs-you-text)";
const BAD = "text-(--ws-failure-text)";
export const ReplyFiles = createContext<RecapFiles | null>(null);

export function ReplyText({ markdown }: { markdown: string }) {
  const document = useContext(MarkdownDocumentContext);
  return !isInlineProse(markdown) ? (
    <Markdown
      content={markdown}
      experimental_document={document}
      className="min-w-0 text-[length:inherit] leading-[inherit] [&>:first-child]:mt-0 [&>:last-child]:mb-0"
    />
  ) : (
    <RecapText
      text={markdown}
      typeClass="text-[length:inherit] leading-[inherit]"
    />
  );
}

export function Disclosure({
  title,
  children,
  open = false,
  label,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(open);
  const id = useId();
  return (
    <div className="min-w-0 border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        aria-label={label}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-8 max-w-full max-md:pointer-coarse:min-h-11 cursor-pointer items-start gap-1.5 rounded-sm text-left text-[0.9em] font-medium leading-[1.6] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon
          name="ChevronRight"
          aria-hidden
          className={cn(
            "mt-[0.3em] size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
      </button>
      <div
        id={id}
        hidden={!expanded}
        className="min-w-0 pb-1 pl-[1.125rem] pt-2"
      >
        {expanded ? children : null}
      </div>
    </div>
  );
}

function EvidenceLink({ item }: { item: ReplyEvidence }) {
  const files = useContext(ReplyFiles);
  if (!item.location) return <span>{item.label}</span>;
  const className =
    "[overflow-wrap:anywhere] underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (item.location.startsWith("https://"))
    return (
      <UrlLink href={item.location} className={className}>
        {item.label}
      </UrlLink>
    );
  const path = evidenceFilePath(item.location, files?.root ?? null);
  const target = path ? fileTarget(path, files) : null;
  const location = item.line
    ? {
        kind: "range" as const,
        startLine: item.line,
        endLine: item.endLine ?? item.line,
      }
    : null;
  return target ? (
    <FileLink target={target} location={location} className={className}>
      {item.label}
    </FileLink>
  ) : (
    <span>{item.label}</span>
  );
}

function Evidence({ items }: { items: ReplyEvidence[] | undefined }) {
  if (!items?.length) return null;
  return (
    <div aria-label="Evidence" className="min-w-0 border-t border-border pt-3">
      <ul className="m-0 list-none space-y-3 p-0">
        {items.map((item, i) => (
          <li key={i} className="min-w-0 text-[0.9em]">
            <EvidenceLink item={item} />
            {item.detail ? (
              <div className="mt-1 text-muted-foreground">
                <ReplyText markdown={item.detail} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Qualification({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 border-l-2 border-(--ws-needs-you-rule) pl-3 text-[0.95em] leading-[1.7] text-foreground">
      {children}
    </div>
  );
}
const CHECK_NAMES = {
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  blocked: "Blocked",
  untested: "Not tested",
} as const;
function Status({
  state,
}: {
  state: keyof typeof CHECK_NAMES | "done" | "pending" | "unknown";
}) {
  const good = state === "passed" || state === "done";
  const bad = state === "failed";
  const unknown = ["skipped", "untested", "pending", "unknown"].includes(state);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-[0.85em] leading-[1.6]",
        good ? GOOD : bad ? BAD : unknown ? MUTED : WARN,
      )}
    >
      <Icon
        name={good ? "Check" : bad ? "X" : "Circle"}
        aria-hidden
        className="size-3 shrink-0"
      />
      {state in CHECK_NAMES
        ? CHECK_NAMES[state as keyof typeof CHECK_NAMES]
        : { done: "Done", pending: "Pending", unknown: "Unknown" }[
            state as "done" | "pending" | "unknown"
          ]}
    </span>
  );
}

export function Information({ part }: { part: ReplyPart }) {
  const location = useContext(ReplyFiles)?.root;
  if (part.type === "pending")
    return (
      <div
        role="status"
        className="min-h-12 text-[0.9em] text-muted-foreground"
      >
        Receiving information…
      </div>
    );
  if (part.type === "text") return <ReplyText markdown={part.body} />;
  if (part.type === "unparsed")
    return (
      <div className="min-w-0">
        <p role="status" className="mb-2 text-[0.9em] text-muted-foreground">
          {part.error}
        </p>
        <Markdown content={part.source} />
      </div>
    );
  let content: ReactNode;
  switch (part.type) {
    case "context":
      content = (
        <ReplyContext part={part} workspace={location}>
          {part.background ? <ReplyText markdown={part.background} /> : null}
        </ReplyContext>
      );
      break;
    case "finding":
      content = (
        <div className="space-y-3">
          <div>
            <span
              className={cn(
                "mb-1.5 inline-block text-[0.8em]",
                part.certainty === "observed" ? MUTED : WARN,
              )}
            >
              {
                {
                  observed: "Observed",
                  inferred: "Inference",
                  unknown: "Not established",
                }[part.certainty]
              }
            </span>
            <Heading>{part.title}</Heading>
            <ReplyText markdown={part.explanation} />
          </div>
          {part.consequence ? (
            <Qualification>
              <ReplyText markdown={part.consequence} />
            </Qualification>
          ) : null}
          <Evidence items={part.evidence} />
        </div>
      );
      break;
    case "comparison":
      content = (
        <div>
          <Heading>{part.title}</Heading>
          <div
            className={cn(
              "min-w-0 divide-y divide-border",
              part.items.length === 2
                ? "grid overflow-hidden rounded-lg border border-border @min-[32rem]/information:grid-cols-2 @min-[32rem]/information:divide-x @min-[32rem]/information:divide-y-0"
                : "flex flex-col",
            )}
          >
            {part.items.map((item, i) => (
              <div
                key={i}
                className={cn(
                  "min-w-0 space-y-2",
                  part.items.length === 2
                    ? "bg-surface-recessed/25 p-4"
                    : "py-3.5",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "font-semibold",
                      part.items.length === 2
                        ? "text-[0.85em]"
                        : "text-[length:inherit]",
                    )}
                  >
                    {item.name}
                  </span>
                  {item.recommended ? (
                    <span className="text-[0.75em] text-(--ws-review-text)">
                      Recommended
                    </span>
                  ) : null}
                </div>
                <RecapText
                  text={item.summary}
                  typeClass={
                    part.items.length === 2
                      ? "text-[1.25em] font-medium leading-[1.4]"
                      : "text-[0.95em] leading-[1.6]"
                  }
                />
                {item.qualification ? (
                  <div className="text-[0.9em] text-muted-foreground">
                    <ReplyText markdown={item.qualification} />
                  </div>
                ) : null}
                {item.detail ? (
                  <Disclosure title="Details" label={`Details: ${item.name}`}>
                    <ReplyText markdown={item.detail} />
                  </Disclosure>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      );
      break;
    case "sequence":
      content = (
        <div>
          <Heading>{part.title}</Heading>
          <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 p-0">
            {part.steps.map((step, i) => (
              <li
                key={i}
                className={cn(
                  "flex min-w-0 items-start gap-2 rounded-md bg-surface-recessed/30 px-3 py-2.5",
                  step.attention && "border-t-2 border-(--ws-needs-you-border)",
                )}
              >
                <span className="pt-0.5 text-[0.8em] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <RecapText
                    text={step.title}
                    typeClass="text-[0.9em] font-medium leading-[1.6]"
                  />
                  {step.detail ? (
                    <div className="mt-1 text-[0.85em] text-muted-foreground">
                      <ReplyText markdown={step.detail} />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      );
      break;
    case "change":
      content = (
        <div>
          <Heading>{part.title}</Heading>
          <dl className="m-0 divide-y divide-border">
            {[
              ["Before", part.before],
              ["After", part.after],
              ["Unchanged", part.unchanged],
            ]
              .filter(([, value]) => value)
              .map(([name, value]) => (
                <div
                  key={name}
                  className="grid min-w-0 gap-1 py-2.5 first:pt-0 @min-[24rem]/information:grid-cols-[5rem_minmax(0,1fr)] @min-[24rem]/information:gap-3"
                >
                  <dt
                    className={cn(
                      "text-[0.8em]",
                      name === "After" ? GOOD : MUTED,
                    )}
                  >
                    {name}
                  </dt>
                  <dd className="m-0 min-w-0">
                    <ReplyText markdown={value!} />
                  </dd>
                </div>
              ))}
          </dl>
          {part.limitation ? (
            <div className="mt-2">
              <Qualification>
                <ReplyText markdown={part.limitation} />
              </Qualification>
            </div>
          ) : null}
        </div>
      );
      break;
    case "checks": {
      const passed = part.items.filter((item) => item.status === "passed");
      const attention = part.items.filter((item) => item.status !== "passed");
      const rows = (items: typeof passed) => (
        <ul className="m-0 list-none space-y-3 p-0">
          {items.map((item, i) => (
            <li key={i} className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 font-medium">
                  <RecapText
                    text={item.name}
                    typeClass="text-[length:inherit] leading-[inherit]"
                  />
                </span>
                <Status state={item.status} />
              </div>
              {item.detail ? (
                <div className="text-[0.9em]">
                  <ReplyText markdown={item.detail} />
                </div>
              ) : null}
              <Evidence items={item.evidence} />
            </li>
          ))}
        </ul>
      );
      content = (
        <div className="space-y-3">
          <div>
            <Heading>{part.title}</Heading>
            <p className="m-0 text-[0.85em] leading-[1.7] text-muted-foreground">
              {part.scope}
            </p>
          </div>
          {part.testTotals ? (
            <dl
              aria-label="Reported test totals"
              className="m-0 flex flex-wrap gap-x-6 gap-y-3"
            >
              {(["passed", "failed", "skipped"] as const).map((status) => (
                <div key={status}>
                  <dd
                    className={cn(
                      "m-0 text-[1.7em] font-medium tabular-nums leading-[1.2]",
                      status === "passed"
                        ? GOOD
                        : status === "failed" && part.testTotals!.failed > 0
                          ? BAD
                          : MUTED,
                    )}
                  >
                    {part.testTotals![status].toLocaleString()}
                  </dd>
                  <dt className="mt-1 text-[0.8em] text-muted-foreground">
                    tests {status}
                  </dt>
                </div>
              ))}
            </dl>
          ) : null}
          {attention.length ? rows(attention) : null}
          {passed.length ? (
            <Disclosure
              title={`${passed.length} ${passed.length === 1 ? "check" : "checks"} passed`}
            >
              {rows(passed)}
            </Disclosure>
          ) : null}
        </div>
      );
      break;
    }
    case "delivery":
      content = (
        <div>
          <Heading>{part.title}</Heading>
          <p className="mb-3 mt-0 text-[0.85em] leading-[1.7] text-muted-foreground">
            {part.scope}
          </p>
          <ol className="m-0 list-none space-y-4 border-l border-border pl-3.5">
            {part.stages.map((stage, i) => (
              <li key={i} className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{stage.name}</span>
                  <Status state={stage.status} />
                </div>
                <div className="text-[0.9em]">
                  <ReplyText markdown={stage.detail} />
                </div>
                <Evidence items={stage.evidence} />
              </li>
            ))}
          </ol>
        </div>
      );
      break;
    case "recommendation":
      content = (
        <div className="space-y-2 border-l-2 border-(--ws-review-rule) pl-3.5">
          <RecapText
            text={part.choice}
            typeClass="text-[1.05em] font-medium leading-[1.5]"
          />
          <ReplyText markdown={part.reason} />
          {part.qualification ? (
            <div className="pt-1 text-[0.9em] text-muted-foreground">
              <ReplyText markdown={part.qualification} />
            </div>
          ) : null}
        </div>
      );
      break;
    case "details":
      content = (
        <Disclosure title={part.title}>
          <ReplyText markdown={part.body} />
        </Disclosure>
      );
      break;
    case "group":
      content = (
        <div
          data-relationship={part.relationship}
          className={cn(
            "grid min-w-0 gap-5",
            part.relationship === "peers"
              ? "@min-[38rem]/information:grid-cols-2"
              : "@min-[38rem]/information:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]",
          )}
        >
          {part.relationship === "peers" ? (
            part.children.map((child, i) => (
              <div key={i} className="@container/information min-w-0">
                <GroupContent child={child} />
              </div>
            ))
          ) : (
            <>
              <div className="@container/information min-w-0">
                <GroupContent child={part.children[0]!} />
              </div>
              <aside
                aria-label="Supporting information"
                className="min-w-0 space-y-5 border-t border-border pt-4 @min-[38rem]/information:border-l @min-[38rem]/information:border-t-0 @min-[38rem]/information:pl-4 @min-[38rem]/information:pt-0"
              >
                {part.children.slice(1).map((child, i) => (
                  <div key={i} className="@container/information min-w-0">
                    <GroupContent child={child} />
                  </div>
                ))}
              </aside>
            </>
          )}
        </div>
      );
      break;
    default: {
      const unsupported: never = part;
      throw new Error(`Unknown reply component: ${String(unsupported)}`);
    }
  }
  return (
    <section
      data-reply-component={part.type}
      className="@container/information min-w-0 [overflow-wrap:anywhere]"
    >
      {content}
    </section>
  );
}

function GroupContent({ child }: { child: ReplyLeaf | ReplyLeaf[] }) {
  const parts = Array.isArray(child) ? child : [child];
  return (
    <div className="min-w-0 space-y-7">
      {parts.map((part, index) => (
        <Information key={index} part={part} />
      ))}
    </div>
  );
}
