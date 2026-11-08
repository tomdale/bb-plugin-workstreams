// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  WorkstreamName,
  splitWorkstreamName,
} from "../../src/app/WorkstreamName.tsx";

afterEach(cleanup);

describe("WorkstreamName", () => {
  it("renders a plain name as is", () => {
    const { container } = render(<WorkstreamName name="Workstreams" />);
    expect(container.textContent).toBe("Workstreams");
  });

  it("shows an area's owner subdued and hides the colon visually", () => {
    const { container, getByText } = render(
      <WorkstreamName name="Workstreams: Recaps" />,
    );
    expect(getByText("Workstreams").className).toContain(
      "text-muted-foreground",
    );
    expect(getByText(":").className).toContain("sr-only");
    expect(container.textContent).toBe("Workstreams: Recaps");
  });

  it("accents only the workstream name, leaving the parent subdued", () => {
    const { getByText } = render(
      <WorkstreamName name="Vercel Agent: Automations" accent />,
    );
    expect(getByText("Vercel Agent").className).toContain(
      "text-muted-foreground/60",
    );
    expect(getByText("Vercel Agent").className).not.toContain(
      "ws-workstream-name",
    );
    expect(getByText("Automations").className).toContain("ws-workstream-name");
  });

  it("lets the caller's classes replace its default type", () => {
    const plain = render(
      <WorkstreamName name="Workstreams" className="font-medium" />,
    ).getByText("Workstreams");
    expect(plain.className).toContain("font-medium");
    expect(plain.className).not.toContain("font-semibold");
    expect(plain.className).not.toContain("ws-text-workstream");
    const { getByText } = render(
      <WorkstreamName
        name="Vercel Agent: Automations"
        className="text-[12px]"
      />,
    );
    const split = getByText("Automations").parentElement!;
    expect(split.className).toContain("text-[12px]");
    // The parts carry no size or weight of their own, so they inherit it.
    for (const part of [getByText("Vercel Agent"), getByText("Automations")])
      expect(part.className).not.toMatch(/\b(text-\[|font-|leading-)/);
  });

  it("treats a leading or trailing colon as a plain name", () => {
    expect(splitWorkstreamName(":test")).toBeNull();
    expect(splitWorkstreamName("test:")).toBeNull();
    expect(splitWorkstreamName("A: B")).toEqual({ owner: "A", area: "B" });
  });
});
