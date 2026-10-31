import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";
import { RecapText } from "../composer/RecapCard.tsx";
import type { ReactNode } from "react";
import type { ReplyComponent } from "../../domain/replyComponents.ts";

export function ReplyContext({
  part,
  workspace,
  children,
}: {
  part: Extract<ReplyComponent, { type: "context" }>;
  workspace: string | null | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2 text-[0.85em] leading-[1.65] text-muted-foreground">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <RecapText
          text={part.topic}
          typeClass="text-[length:inherit] leading-[inherit]"
        />
        {part.where && part.where !== workspace ? (
          <>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Reported location:{" "}
              <code className="text-[0.95em]">{part.where}</code>
            </span>
          </>
        ) : null}
        {workspace ? (
          <>
            <span aria-hidden className="text-border">
              ·
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Show current workspace"
                  className="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-sm text-[length:inherit] leading-[inherit] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:pointer-coarse:min-h-9"
                >
                  Workspace
                  <Icon name="ChevronDown" aria-hidden className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                aria-label="Current workspace"
                align="start"
                mobileTitle="Current workspace"
                className="max-w-[calc(100vw-2rem)] space-y-2 p-3 text-xs"
              >
                <p className="m-0 font-medium">Current workspace</p>
                <code className="block text-muted-foreground [overflow-wrap:anywhere]">
                  {workspace}
                </code>
              </PopoverContent>
            </Popover>
          </>
        ) : null}
      </div>
      {children}
    </div>
  );
}
