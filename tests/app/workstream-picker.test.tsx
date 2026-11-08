// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { NewWork } from "../../src/app/composer/new-work.ts";
import type { Preview } from "../../src/server/preview.ts";
import { WorkstreamPicker } from "../../src/app/composer/WorkstreamPicker.tsx";

const { chipRenders } = vi.hoisted(() => ({ chipRenders: vi.fn() }));

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...actual,
    experimental_Icon: () => <svg aria-hidden />,
  };
});

vi.mock("../../src/app/composer/picker-options.tsx", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/app/composer/picker-options.tsx")
    >();
  return {
    ...actual,
    ChipLabel: ({ children }: { children: ReactNode }) => {
      chipRenders();
      return <span>{children}</span>;
    },
    IdentityOptions: ({
      newWork,
      onDone,
    }: {
      newWork: NewWork;
      onDone: () => void;
    }) => (
      <button
        type="button"
        onClick={() => {
          newWork.selectIdentity(null);
          onDone();
        }}
      >
        Use no topic
      </button>
    ),
    useCatalogEntities: () => [],
  };
});

function SourceBanner({
  nativeText,
  newWork,
}: {
  nativeText: string;
  newWork: NewWork;
}) {
  return (
    <>
      <p>{nativeText}</p>
      <WorkstreamPicker newWork={newWork} />
    </>
  );
}

afterEach(cleanup);

it("skips native parent and draft-text renders without blocking view updates or callbacks", () => {
  const newWork = new NewWork({
    route: () => new Promise<Preview>(() => {}),
    cancelRoute: () => {},
  });
  const view = render(
    <SourceBanner nativeText="Native draft" newWork={newWork} />,
  );
  expect(chipRenders).toHaveBeenCalledTimes(1);
  expect(view.getByRole("button", { name: "Topic: Automatic" })).toBeTruthy();

  view.rerender(
    <SourceBanner nativeText="Native parent update" newWork={newWork} />,
  );
  expect(chipRenders).toHaveBeenCalledTimes(1);

  act(() => newWork.observe("Hidden view text update"));
  expect(chipRenders).toHaveBeenCalledTimes(1);

  act(() =>
    newWork.selectIdentity({ entityId: "ent_billing", label: "Billing" }),
  );
  expect(chipRenders).toHaveBeenCalledTimes(2);
  expect(view.getByRole("button", { name: "Topic: Billing" })).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "Topic: Billing" }));
  fireEvent.click(view.getByRole("button", { name: "Use no topic" }));
  expect(newWork.snapshot().identity).toMatchObject({
    entityId: null,
    label: "No topic",
    provenance: "manual",
  });
  expect(view.queryByRole("button", { name: "Use no topic" })).toBeNull();
  expect(view.getByRole("button", { name: "Topic: No topic" })).toBeTruthy();
  newWork.dispose();
});
