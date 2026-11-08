import { useId, useState, type ReactNode } from "react";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { LABEL_CLASS } from "../recap/marks.tsx";
import { PANEL_ROW_CLASS } from "./Panel.tsx";
import { SECONDARY_CLASS } from "./type.ts";

type Actions = Extract<ReplyPart, { type: "actions" }>;
type Md = (content: string | undefined) => ReactNode;

function ActionRow({
  item,
  md,
  threadId,
  pad,
}: {
  item: Actions["items"][number];
  md: Md;
  threadId: string | null;
  pad: string;
}) {
  const composer = useComposer();
  const titleId = useId();
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Embedded worker replies must not write into the parent or another open draft.
  const canCompose =
    !!threadId &&
    composer.scope.kind === "thread" &&
    composer.scope.threadId === threadId;
  const rows = [
    ["Owner", item.owner],
    ["When", item.condition],
    ["Permission", item.permission],
    ["Request", item.message],
  ] as const;
  return (
    <li data-reply-action="" className={`min-w-0 ${pad || "py-2"}`}>
      <div
        id={titleId}
        className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-medium [&_p]:my-0"
      >
        {md(item.title)}
        {item.recommended ? (
          <span
            className={`${LABEL_CLASS} pt-0 text-(--ws-reply-accent,var(--muted-foreground))`}
          >
            Recommended
          </span>
        ) : null}
      </div>
      {item.detail ? (
        <div className="mt-1 [&_p]:my-0">{md(item.detail)}</div>
      ) : null}
      <dl className="m-0 mt-1 grid grid-cols-[minmax(3.25rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 @max-[24rem]/actions:grid-cols-1">
        {rows.map(([label, value]) =>
          value ? (
            <div
              key={label}
              className="col-span-full grid grid-cols-subgrid gap-y-0.5 @max-[24rem]/actions:grid-cols-1"
            >
              <dt className={`${LABEL_CLASS} text-muted-foreground`}>
                {label}
              </dt>
              <dd className="m-0 min-w-0 [&_p]:my-0">
                {label === "Request" ? (
                  <p
                    data-reply-action-request=""
                    className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]"
                  >
                    {value}
                  </p>
                ) : (
                  md(value)
                )}
              </dd>
            </div>
          ) : null,
        )}
      </dl>
      {item.message ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs max-md:pointer-coarse:h-9 max-md:pointer-coarse:text-[13px]"
            aria-describedby={titleId}
            disabled={!canCompose}
            onClick={() => {
              try {
                composer.insert(
                  (composer.text.trim() ? "\n\n" : "") + item.message!,
                  { at: "end" },
                );
                composer.focus();
                setError(null);
              } catch {
                setError("Could not add the request to your message");
              }
            }}
          >
            Add to message
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs max-md:pointer-coarse:h-9 max-md:pointer-coarse:text-[13px]"
            aria-describedby={titleId}
            onClick={async () => {
              try {
                if (!navigator.clipboard?.writeText)
                  throw new Error("Clipboard unavailable");
                await navigator.clipboard.writeText(item.message!);
                setCopied(item.message!);
                setError(null);
              } catch {
                setError("Could not copy the request");
              }
            }}
          >
            {copied === item.message ? "Copied" : "Copy request"}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className={`mt-2 ${SECONDARY_CLASS} text-(--ws-failure-text)`}
        >
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function ActionsBody({
  part,
  md,
  threadId,
  pad = PANEL_ROW_CLASS,
}: {
  part: Actions;
  md: Md;
  threadId: string | null;
  pad?: string;
}) {
  return (
    <div className="@container/actions min-w-0 [overflow-wrap:anywhere]">
      <ul className="m-0 list-none divide-y divide-border p-0">
        {part.items.map((item, i) => (
          <ActionRow
            key={i}
            item={item}
            md={md}
            threadId={threadId}
            pad={pad}
          />
        ))}
      </ul>
    </div>
  );
}
