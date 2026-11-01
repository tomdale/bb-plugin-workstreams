import { expect, it } from "vitest";
import { subagentDelivery } from "../../src/domain/subagentDelivery.ts";

const id = "12345678-1234-1234-1234-123456789abc";
const reply = `:::reply{state="complete"}
# The review is complete
- [x] Reviewed the behavior

The controls fit the app.
:::`;
const wrap = (output: string, title = "Review") =>
  `Subagent ${JSON.stringify(title)} (${id}) completed. \n${output}\nFull transcript: @thread:thr_worker`;

it("reads Subagents' exact completion format and escaped titles", () => {
  const title = 'Review "controls" \\ layout';
  const delivery = subagentDelivery(wrap(reply, title));
  expect(delivery).toMatchObject({
    runId: id,
    threadId: "thr_worker",
    title,
    status: "completed",
    error: "",
    reply: { card: { headline: "The review is complete" } },
  });
});

it("keeps failure details and returned-control results", () => {
  expect(
    subagentDelivery(
      wrap(reply).replace("completed. ", "timed-out. Time limit exceeded."),
    ),
  ).toMatchObject({ status: "timed-out", error: "Time limit exceeded." });
  expect(
    subagentDelivery(
      `The user returned control of subagent "Review" (${id}).\n${reply}\nFull transcript: @thread:thr_worker`,
    ),
  ).toMatchObject({ status: "returned", error: "" });
});

it.each([
  "Ordinary Markdown",
  reply.replace(/\n:::$/, ""),
  `Before the reply\n\n${reply}`,
  `${reply}\n\nAfter the reply`,
  `\`\`\`markdown\n${reply}\n\`\`\``,
  reply.replace('state="complete"', 'v="2" state="complete"'),
])("leaves unsupported or incomplete output untouched: %s", (output) => {
  expect(subagentDelivery(wrap(output))).toBeNull();
});

it("rejects malformed envelopes without throwing", () => {
  expect(
    subagentDelivery(wrap(reply).replace('"Review"', '"bad\\q"')),
  ).toBeNull();
  expect(
    subagentDelivery(wrap(reply).replace("thr_worker", "null")),
  ).toBeNull();
});
