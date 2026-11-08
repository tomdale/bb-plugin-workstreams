/**
 * Diagnoses why an assistant message did or did not parse as a `:::reply`
 * block, with 1-based line numbers for opener, closer, placement, and
 * component errors.
 */
import type { Code, Nodes, RootContent } from "mdast";
import {
  parse,
  REPLY_BLOCK,
  REPLY_VERSIONS,
  type Reply,
  type ReplyStatus,
} from "./reply.ts";
import { compileFence } from "./reply.ts";
import { COMPONENT_FENCE, isComponentFence } from "./replyComponents.ts";
import { parseReplyMarkdown, readBlock } from "./replyText.ts";

export type ReplyIssue = {
  line?: number;
  message: string;
};

export type ReplyDiagnosisStatus = "valid" | "unclosed" | "missing" | "invalid";

export type ReplyDiagnosis = {
  status: ReplyDiagnosisStatus;
  issues: ReplyIssue[];
  reply: Reply | null;
};

function codeClosed(source: string): boolean {
  const lines = source.split(/\r?\n/);
  const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0] ?? "");
  return (
    lines.length > 1 &&
    Boolean(
      marker &&
      new RegExp(`^ {0,3}${marker[1]![0]}{${marker[1]!.length},}\\s*$`).test(
        lines.at(-1) ?? "",
      ),
    )
  );
}

/** Every reason a component fence would not render, one per failing statement. */
function validateComponentNode(node: Code, source: string): string[] {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  const raw =
    from !== undefined && to !== undefined ? source.slice(from, to).trim() : "";
  if (raw && !codeClosed(raw)) {
    return ["Component not displayed: close the workstreams code fence."];
  }
  return compileFence(node.value, raw).flatMap((part) =>
    part.type === "unparsed" ? [part.error] : [],
  );
}

function walkChildren(
  node: Nodes,
  visit: (child: Nodes, ancestors: Nodes[]) => void,
  ancestors: Nodes[] = [],
): void {
  if (!("children" in node) || !Array.isArray(node.children)) return;
  const nextAncestors = [...ancestors, node];
  for (const child of node.children as Nodes[]) {
    visit(child, nextAncestors);
    walkChildren(child, visit, nextAncestors);
  }
}

function findOpenerMistakes(message: string): ReplyIssue[] {
  const issues: ReplyIssue[] = [];
  const lines = message.split(/\r?\n/);
  let fence: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;
    if (fence) {
      if (
        new RegExp(`^ {0,3}${fence.char}{${fence.length},}[ \\t]*$`).test(line)
      ) {
        fence = null;
      }
      continue;
    }
    const openFence = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/.exec(line);
    if (openFence) {
      const marker = openFence[1]!;
      const info = openFence[2] ?? "";
      if (info.toLowerCase() === REPLY_BLOCK) {
        issues.push({
          line: lineNum,
          message: `"${line.trim()}" is a code fence — use a ":::${REPLY_BLOCK}" container directive closed with ":::".`,
        });
      }
      fence = { char: marker[0]!, length: marker.length };
      continue;
    }
    if (/^(?: {4,}|\t+):{3,}reply\b/i.test(line)) {
      issues.push({
        line: lineNum,
        message: `":::${REPLY_BLOCK}" is indented by 4+ spaces, so Markdown reads it as code instead of a directive.`,
      });
    } else if (/^[ \t]*:{3,}[ \t]+reply\b/i.test(line)) {
      issues.push({
        line: lineNum,
        message: `"${line.trim()}" has a space after ":::" — write ":::${REPLY_BLOCK}" with no space.`,
      });
    } else if (/^[ \t]*:{3,}reply[ \t]+\{/i.test(line)) {
      issues.push({
        line: lineNum,
        message: `"${line.trim()}" has a space before "{" — write ":::${REPLY_BLOCK}{...}" with no space.`,
      });
    } else if (/^[ \t]*:{1,2}reply\b/i.test(line)) {
      issues.push({
        line: lineNum,
        message: `"${line.trim()}" uses fewer than three colons — write ":::${REPLY_BLOCK}".`,
      });
    }
  }
  return issues;
}

/** Diagnoses reply-block and component syntax issues on a raw agent message. */
export function diagnoseReply(
  message: string,
  options: { status?: ReplyStatus; error?: string | null } = {},
): ReplyDiagnosis {
  if (options.status === "streaming") {
    return { status: "valid", issues: [], reply: null };
  }
  const root = parseReplyMarkdown(message);
  const replyIndices = root.children.flatMap((node, index) =>
    node.type === "containerDirective" && node.name === REPLY_BLOCK
      ? [index]
      : [],
  );

  if (replyIndices.length === 0) {
    const issues = findOpenerMistakes(message);
    walkChildren(root, (node) => {
      if (node.type === "containerDirective" && node.name === REPLY_BLOCK) {
        issues.push({
          line: node.position?.start.line,
          message: `":::${REPLY_BLOCK}" is inside a list or quote — place it at the top level of the message.`,
        });
      } else if (node.type === "code" && isComponentFence(node.lang)) {
        issues.push({
          line: node.position?.start.line,
          message: `"${COMPONENT_FENCE}" code fence is outside a ":::${REPLY_BLOCK}" block, so it renders as raw source.`,
        });
        for (const message_ of validateComponentNode(node, message))
          issues.push({
            line: node.position?.start.line,
            message: message_,
          });
      }
    });
    if (issues.length === 0) {
      issues.push({
        line: 1,
        message: `No ":::${REPLY_BLOCK}" block found in this message.`,
      });
    }
    return { status: "missing", issues, reply: null };
  }

  const issues: ReplyIssue[] = [];
  const lastIndex = replyIndices.at(-1)!;
  const replyNode = root.children[lastIndex]!;

  if (replyIndices.length > 1) {
    const second = root.children[replyIndices[1]!]!;
    issues.push({
      line: second.position?.start.line,
      message: `Message contains ${replyIndices.length} ":::${REPLY_BLOCK}" blocks — put the whole reply in one ":::${REPLY_BLOCK}" block.`,
    });
  } else if (root.children.length > 1) {
    if (lastIndex > 0) {
      issues.push({
        line: root.children[0]?.position?.start.line ?? 1,
        message: `Content appears before ":::${REPLY_BLOCK}" — put the whole reply inside one ":::${REPLY_BLOCK}" block.`,
      });
    }
    if (lastIndex < root.children.length - 1) {
      issues.push({
        line: root.children[lastIndex + 1]?.position?.start.line,
        message: `Content appears after the closing ":::" — put the whole reply inside one ":::${REPLY_BLOCK}" block.`,
      });
    }
    for (let i = 0; i < root.children.length; i++) {
      if (i === lastIndex) continue;
      const outside = root.children[i]!;
      if (outside.type === "code" && isComponentFence(outside.lang)) {
        issues.push({
          line: outside.position?.start.line,
          message: `"${COMPONENT_FENCE}" code fence is outside ":::${REPLY_BLOCK}", so it renders as raw source.`,
        });
      }
      walkChildren(outside, (child) => {
        if (child.type === "code" && isComponentFence(child.lang)) {
          issues.push({
            line: child.position?.start.line,
            message: `"${COMPONENT_FENCE}" code fence is outside ":::${REPLY_BLOCK}", so it renders as raw source.`,
          });
        }
      });
    }
  }

  const start = replyNode.position?.start.offset ?? 0;
  const end = replyNode.position?.end.offset ?? message.length;
  const startLine = replyNode.position?.start.line ?? 1;
  const block = message.slice(start, end);
  const blockLines = block.split(/\r?\n/);
  const openerLine = blockLines[0] ?? "";
  const markerLength = /^[ \t]*(:{3,})/.exec(openerLine)?.[1]?.length ?? 3;
  const lastNewline = block.lastIndexOf("\n");

  const nodeChildren = (
    "children" in replyNode ? replyNode.children : []
  ) as RootContent[];
  if (
    (nodeChildren[0]?.data as { directiveLabel?: boolean } | undefined)
      ?.directiveLabel === true
  ) {
    issues.push({
      line: startLine,
      message: `":::${REPLY_BLOCK}[...]" bracket labels are ignored — put the heading inside the reply block.`,
    });
  }
  const contentChildren = nodeChildren.filter(
    (child) =>
      child.type !== "paragraph" ||
      (child.data as { directiveLabel?: boolean } | undefined)
        ?.directiveLabel !== true,
  );
  // Read offsets before `readBlock` shifts them relative to the inner source.
  const lastContentEnd = contentChildren.at(-1)?.position?.end.offset ?? start;
  const blockInput = readBlock(replyNode, message);
  const swallowedByCode =
    blockInput?.status === "closed" && lastContentEnd > start + lastNewline;
  const isUnclosed =
    !blockInput ||
    blockInput.status === "unclosed" ||
    options.status === "unclosed" ||
    swallowedByCode;

  let trailingReplyCloserLine: number | null = null;
  if (isUnclosed) {
    if (swallowedByCode) {
      const lastChild = contentChildren.at(-1);
      issues.push({
        line: lastChild?.position?.start.line ?? startLine,
        message: `Unclosed code fence inside ":::${REPLY_BLOCK}" swallowed the closing ":::" line.`,
      });
    } else {
      let lastNonEmptyIndex = -1;
      for (let k = blockLines.length - 1; k >= 1; k--) {
        if (blockLines[k]!.trim().length > 0) {
          lastNonEmptyIndex = k;
          break;
        }
      }
      const lastLine =
        lastNonEmptyIndex >= 1 ? blockLines[lastNonEmptyIndex]!.trim() : "";
      const lastLineNum = startLine + Math.max(0, lastNonEmptyIndex);
      if (/^:{3,}reply\b/i.test(lastLine)) {
        trailingReplyCloserLine = lastLineNum;
        issues.push({
          line: lastLineNum,
          message: `Closing line is "${lastLine}" — close ":::${REPLY_BLOCK}" with ":::" alone on a line, not "${lastLine}".`,
        });
      } else if (/^:+$/.test(lastLine) && lastLine.length < markerLength) {
        issues.push({
          line: lastLineNum,
          message: `Opened with ${markerLength} colons ("${openerLine.trim()}") but closed with ${lastLine.length} ("${lastLine}").`,
        });
      } else if (/^:{3,}\s*\S/.test(lastLine)) {
        issues.push({
          line: lastLineNum,
          message: `Closing ":::" must be alone on its line (found "${lastLine}").`,
        });
      } else {
        issues.push({
          line: startLine,
          message: `Unclosed ":::${REPLY_BLOCK}" block — end the block with ":::" alone on its own line.`,
        });
      }
    }
  }

  if (
    blockInput?.attributes.v !== undefined &&
    !REPLY_VERSIONS.some((v) => v === Number(blockInput.attributes.v))
  ) {
    issues.push({
      line: startLine,
      message: "Unsupported reply version.",
    });
  }

  const innerSource = blockInput?.source ?? "";
  for (const child of contentChildren) {
    if (child.type === "code" && isComponentFence(child.lang)) {
      for (const message of validateComponentNode(child, innerSource))
        issues.push({ line: child.position?.start.line, message });
    } else if (
      child.type === "containerDirective" &&
      child.name === REPLY_BLOCK &&
      child.position?.start.line !== trailingReplyCloserLine
    ) {
      issues.push({
        line: child.position?.start.line,
        message: `Nested ":::${REPLY_BLOCK}" directive inside the reply block.`,
      });
    }
    walkChildren(child, (nested) => {
      if (nested.type === "code" && isComponentFence(nested.lang)) {
        issues.push({
          line: nested.position?.start.line,
          message: `"${COMPONENT_FENCE}" code fence is inside a list or quote — place it at the top level of ":::${REPLY_BLOCK}".`,
        });
      } else if (
        nested.type === "containerDirective" &&
        nested.name === REPLY_BLOCK &&
        nested.position?.start.line !== trailingReplyCloserLine
      ) {
        issues.push({
          line: nested.position?.start.line,
          message: `Nested ":::${REPLY_BLOCK}" directive inside the reply block.`,
        });
      }
    });
  }

  if (isUnclosed) {
    return { status: "unclosed", issues, reply: null };
  }

  const parsed = parse(blockInput, { status: "closed" });
  if (!parsed.ok) {
    if (!issues.some((issue) => issue.message === parsed.error)) {
      issues.push({ line: startLine, message: parsed.error });
    }
    return { status: "invalid", issues, reply: null };
  }
  if (
    options.error &&
    !issues.some((issue) => issue.message === options.error)
  ) {
    issues.push({ line: startLine, message: options.error });
  }
  return {
    status: issues.length > 0 ? "invalid" : "valid",
    issues,
    reply: parsed.data,
  };
}

/**
 * Extracts a thread ID and optional message sequence from a thread ID,
 * `@thread:<id>[#msg=<seq>]` mention, or BB thread URL.
 */
export function parseReplyTarget(
  target: string,
  messageOption?: number,
): { threadId: string; messageSeq?: number } | null {
  const trimmed = target.trim();
  if (!trimmed) return null;
  let seqFromTarget: number | undefined;
  const hashMatch = /#msg=(\d+)\b/.exec(trimmed);
  if (hashMatch) {
    seqFromTarget = Number(hashMatch[1]);
  }
  const withoutHash = trimmed.replace(/#.*$/, "").replace(/\?.*$/, "");
  const urlMatch = /\/threads\/([^/?#]+)$/.exec(withoutHash);
  const rawThreadId = urlMatch
    ? urlMatch[1]!
    : withoutHash.replace(/^@thread:/, "");
  if (!rawThreadId || /[\s/]/.test(rawThreadId)) return null;
  const messageSeq = messageOption ?? seqFromTarget;
  return {
    threadId: rawThreadId,
    ...(messageSeq !== undefined ? { messageSeq } : {}),
  };
}
