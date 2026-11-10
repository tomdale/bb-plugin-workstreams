import { createRoot } from "react-dom/client";
import { installGalleryHost } from "../../gallery/host.tsx";
import { ColorSettings } from "../../src/app/settings/ColorSettings.tsx";
import { ColorTokenStyle } from "../../src/app/theme/ColorTokenStyle.tsx";
import {
  mergePrefs,
  parsePrefs,
  type PrefsPatch,
} from "../../src/domain/prefs.ts";
import "../../gallery/base.css";

installGalleryHost();
const runtime = (
  globalThis as typeof globalThis & {
    __bbPluginRuntime: { pluginSdkApp: { useRpc: unknown } };
  }
).__bbPluginRuntime;
let prefs = parsePrefs(JSON.parse(localStorage.getItem("colors") ?? "{}"));
const rpc = {
  call: async (method: string, input: { patch: PrefsPatch }) => {
    if (method === "setPrefs") {
      prefs = mergePrefs(prefs, input.patch);
      localStorage.setItem("colors", JSON.stringify(prefs));
    } else if (method !== "prefs") throw new Error(method);
    return { prefs };
  },
};
runtime.pluginSdkApp.useRpc = () => rpc;

createRoot(document.getElementById("root")!).render(
  <>
    <ColorTokenStyle />
    <main
      data-bb-plugin="workstreams"
      style={{ maxWidth: 640, margin: "24px auto", padding: 16 }}
    >
      <h1 className="mb-6 text-lg font-medium">Colors</h1>
      <ColorSettings />
    </main>
  </>,
);
