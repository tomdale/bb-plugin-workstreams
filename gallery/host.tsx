import * as React from "react";
import type { ComponentProps } from "react";
import type {
  Markdown,
  PluginSdkApp,
  PluginBrowserBbSdk,
  PluginComposerApi,
  BbNavigate,
  PluginSidebarThreadsState,
  ExperimentalQuestionFormHost,
  UrlLink,
  experimental_FileLink,
  experimental_Icon,
} from "@get-bb/plugin-sdk/app";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Archive03Icon from "@hugeicons/core-free-icons/Archive03Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CircleIcon from "@hugeicons/core-free-icons/CircleIcon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import UserIcon from "@hugeicons/core-free-icons/UserIcon";

/*
 * Standalone fixtures for the SDK's host seam, not an emulation of BB services.
 * The SDK testing runtime requires its private renderSlot context and renders
 * placeholder Markdown/icons; this browser entry instead renders local Markdown
 * and BB's actual icon assets, and refuses every unimplemented service call.
 */
const icons: Readonly<Record<string, IconSvgElement>> = {
  Archive: Archive03Icon,
  Check: Tick02Icon,
  ChevronDown: ArrowDown01Icon,
  ChevronUp: ArrowUp01Icon,
  ChevronRight: ArrowRight01Icon,
  ChevronLeft: ArrowLeft01Icon,
  X: Cancel01Icon,
  Circle: CircleIcon,
  Copy: Copy01Icon,
  Loading: Loading03Icon,
  Spinner: Loading03Icon,
  Plus: PlusSignIcon,
  Search: Search01Icon,
  UserRound: UserIcon,
};

const assets: Readonly<Record<string, string>> = {
  "workstreams/workstream": new URL("../assets/workstream.svg", import.meta.url)
    .href,
  "workstreams/tag": new URL("../assets/tag.svg", import.meta.url).href,
};

function GalleryIcon({
  name,
  fallback,
  ...props
}: ComponentProps<typeof experimental_Icon>) {
  const asset = assets[name];
  if (asset) {
    return (
      <span
        {...props}
        className={`inline-flex size-6 shrink-0 ${props.className ?? ""}`}
        style={{
          ...props.style,
          backgroundColor: "currentColor",
          mask: `url("${asset}") center / contain no-repeat`,
        }}
        data-icon={name}
      />
    );
  }
  const icon = icons[name] ?? (fallback ? icons[fallback] : undefined);
  if (!icon) {
    return (
      <span
        {...props}
        data-gallery-missing-icon={name}
        aria-label={`Unavailable host icon: ${name}`}
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={icon}
      size={24}
      strokeWidth={1.5}
      {...props}
      data-icon={name}
    />
  );
}

export type GalleryHostAction = { method: string; args: unknown[] };

function localAction(method: string, ...args: unknown[]) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<GalleryHostAction>("gallery-host-action", {
        detail: { method, args },
      }),
    );
  }
}

function GalleryUrlLink({
  href,
  children,
  ...props
}: ComponentProps<typeof UrlLink>) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        localAction("openUrl", href);
      }}
    >
      {children}
    </a>
  );
}

function GalleryMarkdown({
  content,
  className,
}: ComponentProps<typeof Markdown>) {
  return (
    <div className={`gallery-markdown ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <GalleryUrlLink href={href ?? "#"}>{children}</GalleryUrlLink>
          ),
          img: ({ alt }) => (
            <span>[Image preview unavailable: {alt ?? "image"}]</span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function GalleryFileLink({
  target,
  location,
  children,
  ...props
}: ComponentProps<typeof experimental_FileLink>) {
  return (
    <a
      {...props}
      href="#local-file-preview"
      onClick={(event) => {
        event.preventDefault();
        localAction("openFilePreview", { target, location });
      }}
    >
      {children}
    </a>
  );
}

function unavailable(path: string): object {
  return new Proxy(
    () => {
      throw new Error(`Gallery has no BB service: ${path}`);
    },
    {
      get: (_target, property) =>
        property === "then"
          ? undefined
          : unavailable(`${path}.${String(property)}`),
    },
  );
}

// The service proxies have no successful result type: every invocation throws.
const sdk = unavailable("sdk") as PluginBrowserBbSdk;
const useRpc = (() => unavailable("rpc")) as PluginSdkApp["useRpc"];
const navigate: BbNavigate = {
  toThread: (...args) => localAction("toThread", ...args),
  toProject: (...args) => localAction("toProject", ...args),
  toPluginPanel: (...args) => localAction("toPluginPanel", ...args),
  toCompose: (...args) => localAction("toCompose", ...args),
  openThreadPanel: (...args) => {
    localAction("openThreadPanel", ...args);
    return false;
  },
  openUrl: (...args) => {
    localAction("openUrl", ...args);
    return false;
  },
  experimental_openFilePreview: (...args) => {
    localAction("openFilePreview", ...args);
    return false;
  },
  experimental_openFileExternally: (...args) => {
    localAction("openFileExternally", ...args);
    return false;
  },
};
const composer: PluginComposerApi = {
  key: "gallery",
  scope: { kind: "new-thread", projectId: null },
  layout: "expanded",
  isRunning: false,
  isSubmitting: false,
  isSubmittingBlocked: true,
  submittingBlockedReason: "The gallery has no BB composer",
  isEmpty: true,
  attachmentCount: 0,
  text: "",
  draft: { text: "", mentions: [], attachments: [] },
  selection: null,
  insert: (...args) => localAction("composer.insert", ...args),
  replace: (...args) => localAction("composer.replace", ...args),
  setTextEffect: (...args) => localAction("composer.setTextEffect", ...args),
  setInputLock: (...args) => localAction("composer.setInputLock", ...args),
  onSubmitted: () => () => {},
  focus: () => localAction("composer.focus"),
  submit: async () => {
    throw new Error("The gallery has no BB composer");
  },
  setSelection: async () => {
    throw new Error("The gallery has no BB composer");
  },
};
const context = { projectId: null, threadId: null };
const questionFormHost: ExperimentalQuestionFormHost = {
  shortcuts: new Map(),
  registerChoiceHandler: () => () => {},
};
const sidebarThreads: PluginSidebarThreadsState = {
  status: "ready",
  threads: [],
  projects: [],
  sections: [],
  experimental_archived: null,
};

/** Install only for the standalone app; the returned cleanup restores a prior host for tests. */
export function installGalleryHost(): () => void {
  const host = globalThis as typeof globalThis & {
    __bbPluginRuntime?: unknown;
  };
  const previous = host.__bbPluginRuntime;
  host.__bbPluginRuntime = {
    react: React,
    pluginSdkApp: {
      experimental_Icon: GalleryIcon,
      Markdown: GalleryMarkdown,
      UrlLink: GalleryUrlLink,
      experimental_FileLink: GalleryFileLink,
      ThreadTitle: ({ threadId }: { threadId: string }) => (
        <span>{threadId}</span>
      ),
      useBbContext: () => context,
      useBbNavigate: () => navigate,
      useComposer: () => composer,
      useSdk: () => sdk,
      useRpc,
      useRealtime: () => {},
      useRealtimeConnectionState: () => "connecting",
      experimental_useQuestionFormHost: () => questionFormHost,
      experimental_useSidebarThreads: () => sidebarThreads,
    } satisfies Partial<PluginSdkApp>,
  };
  return () => {
    host.__bbPluginRuntime = previous;
  };
}
