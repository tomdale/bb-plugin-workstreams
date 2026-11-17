import { useRpc } from "@get-bb/plugin-sdk/app";
import { Usage } from "../../src/app/page/Usage.tsx";
import type { RpcContract } from "../../src/server/contract.ts";

/** Usage in the SDK harness; page routing is tested through WorkstreamsPage. */
export function UsageView() {
  return <Usage rpc={useRpc<RpcContract>()} />;
}
