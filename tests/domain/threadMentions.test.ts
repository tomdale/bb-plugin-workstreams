import { expect, it } from "vitest";
import { splitThreadMentions } from "../../src/domain/threadMentions.ts";

it("splits literal text around thread mentions", () => {
  expect(
    splitThreadMentions("@thread:thr_a runs it, then (@thread:thr_b)."),
  ).toEqual([
    { threadId: "thr_a" },
    " runs it, then (",
    { threadId: "thr_b" },
    ").",
  ]);
});
it("leaves text with no mention whole", () => {
  expect(splitThreadMentions("Plain.")).toEqual(["Plain."]);
  expect(splitThreadMentions("")).toEqual([""]);
});
it.each(["mail@thread:thr_a", "see /x/@thread:thr_a/y", "@thread:thr_a/y"])(
  "ignores a mention inside a longer word or path (%s)",
  (text) => expect(splitThreadMentions(text)).toEqual([text]),
);
