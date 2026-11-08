import { useEffect, useState } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Hint } from "../Hint.tsx";

/**
 * A literal value the reader will paste somewhere: monospace, wrapping at any
 * character so a long path never overflows, with a copy button beside it. An
 * HTTPS value is also a link.
 */
export function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span
      data-reply-copy-value=""
      className="inline-flex min-w-0 max-w-full items-center gap-1"
    >
      {value.startsWith("https://") ? (
        <span className="min-w-0 break-all">
          <UrlLink href={value}>{value}</UrlLink>
        </span>
      ) : (
        <code className="min-w-0 rounded-sm bg-state-hover px-1 font-mono text-[0.9em] break-all">
          {value}
        </code>
      )}
      <Hint label={copied ? "Copied" : "Copy"}>
        <button
          type="button"
          aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(value)
              .then(() => setCopied(true));
          }}
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center self-center rounded-sm text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none max-md:pointer-coarse:size-7"
        >
          <Icon
            name={copied ? "Check" : "Copy"}
            aria-hidden
            className="size-3.5"
          />
        </button>
      </Hint>
    </span>
  );
}
