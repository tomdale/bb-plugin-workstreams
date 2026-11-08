import { sidebarThread, section } from "./fixtures.ts";
import { mount, mountWithBands } from "./sidebar-fixture.tsx";

/** Mounts a real sidebar with only Alpha and one row unless a case needs more. */
export const mountOneWorkstream: typeof mount = (
  threads = [sidebarThread("root", { sectionId: "sec_a", title: "Root task" })],
  options = {},
) =>
  mount(threads, {
    ...options,
    sections: options.sections ?? [section("sec_a", "Alpha")],
  });

/** Requests the same two bands as the full-list fixture, with one workstream. */
export const mountOneWorkstreamWithBands: typeof mountWithBands = (
  threads = [sidebarThread("root", { sectionId: "sec_a", title: "Root task" })],
  options = {},
) =>
  mountWithBands(threads, {
    ...options,
    sections: options.sections ?? [section("sec_a", "Alpha")],
  });
