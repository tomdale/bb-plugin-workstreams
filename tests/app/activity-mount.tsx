import { useRpc } from "@get-bb/plugin-sdk/app";
import { Activity } from "../../src/app/page/Activity.tsx";
import type { RpcContract } from "../../src/server/contract.ts";

/** Activity in the SDK harness; page routing is tested through WorkstreamsPage. */
export function ActivityView() {
  const rpc = useRpc<RpcContract>();
  return (
    <Activity
      rpc={rpc}
      focus={null}
      modelCalls
      sections={[]}
      workstreamOf={() => null}
    />
  );
}
