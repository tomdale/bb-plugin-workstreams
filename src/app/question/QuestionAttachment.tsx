import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { InteractionAnswer } from "../../server/questions/contracts.ts";

type Attachment = NonNullable<InteractionAnswer["attachments"]>[number];

/** Read through the SDK so attachments keep their project ownership. */
export function QuestionAttachment({ attachment }: { attachment: Attachment }) {
  const sdk = useSdk();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const {
    projectId,
    path,
    name = path.split("/").at(-1) ?? "Attachment",
  } = attachment;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setUrl(null);
    setFailed(false);
    void sdk.projects.attachments
      .read({ projectId, path, signal: controller.signal })
      .then((file) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(
          new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
        );
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sdk, projectId, path]);
  return (
    <li className="min-w-0 rounded-md border border-border bg-background/50 p-2 text-xs">
      {url ? (
        <a
          href={url}
          download={name}
          className="block break-words underline underline-offset-2"
        >
          {attachment.type === "localImage" ? (
            <img
              src={url}
              alt={name}
              className="mb-2 max-h-48 max-w-full rounded object-contain"
            />
          ) : null}
          {name}
        </a>
      ) : (
        <span className="break-words">{name}</span>
      )}
      <p className="mt-1 break-all text-muted-foreground">
        {attachment.mimeType}
        {attachment.sizeBytes === undefined
          ? ""
          : ` · ${attachment.sizeBytes} bytes`}
      </p>
      {failed ? (
        <p className="mt-1 text-muted-foreground">Attachment unavailable</p>
      ) : null}
    </li>
  );
}
