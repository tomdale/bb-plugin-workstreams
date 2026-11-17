/**
 * The host side of one composition: a Chrome preview host and an AI Gateway
 * tool model on this machine, driven by the bounded loop. Chrome starts with
 * the composition and is closed when it ends, however it ends.
 */
import { gatewayKey } from "../gateway.ts";
import { findChrome } from "./chrome.ts";
import {
  runPresentation,
  type PresentationInput,
  type PresentationOutcome,
} from "./driver.ts";
import { gatewayToolModel } from "./gatewayModel.ts";
import { PreviewHost, type Theme } from "./preview.ts";
import { PREVIEW_STYLES } from "./styles.ts";

const none = {
  previews: 0,
  modelCalls: 0,
  usage: { input: 0, output: 0, cost: 0 },
};

export async function presentOnHost(options: {
  input: PresentationInput;
  model: string;
  theme: Theme;
  signal: AbortSignal;
}): Promise<PresentationOutcome> {
  const apiKey = await gatewayKey();
  if (!apiKey)
    return {
      kind: "failed",
      reason: "No AI Gateway key on this machine.",
      ...none,
    };
  const chromePath = findChrome();
  if (!chromePath)
    return {
      kind: "failed",
      reason: "No Chrome on this machine for previews. Set CHROME_PATH.",
      ...none,
    };
  let host: PreviewHost | null = null;
  try {
    host = await PreviewHost.open({
      chromePath,
      styles: PREVIEW_STYLES,
      theme: options.theme,
      signal: options.signal,
    });
    const opened = host;
    return await runPresentation({
      input: options.input,
      model: gatewayToolModel({ model: options.model, apiKey }),
      preview: (document, signal) =>
        opened.render(document, options.input.workstream, signal),
      signal: options.signal,
    });
  } catch (error) {
    return {
      kind: "failed",
      reason: `The preview host failed: ${error instanceof Error ? error.message : String(error)}`,
      ...none,
    };
  } finally {
    await host?.close();
  }
}
