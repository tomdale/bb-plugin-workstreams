import type { CategoryGeneration } from "./categories.ts";

type TreeRow = { depth: number; thread: { id: string } };

/**
 * A category's rows, as the sidebar draws them. `index` is the category's
 * position in its generation, which the markers key off, so an empty sibling
 * dropping out never shifts the others; the bucket for rows no category has
 * filed yet sits after every category and carries that index.
 */
export type CategoryBucket<R> = {
  id: string | null;
  name: string | null;
  rows: R[];
  /** Position in the generation; the unfiled bucket sits after every category. */
  index: number;
};

/** Categories move whole root trees in the view, leaving section IDs untouched. */
export function categoryRows<R extends TreeRow>(
  rows: readonly R[],
  generation?: CategoryGeneration,
): Array<CategoryBucket<R>> {
  if (!generation) return [{ id: null, name: null, rows: [...rows], index: 0 }];
  const categories = generation.categories.map((category, index) => ({
    id: category.id,
    name: category.name,
    rows: [] as R[],
    index,
  }));
  const unplaced = {
    id: null,
    name: null,
    rows: [] as R[],
    index: categories.length,
  };
  const byRoot = new Map<string, number>();
  generation.categories.forEach((category, index) => {
    for (const id of category.threadIds)
      if (!byRoot.has(id)) byRoot.set(id, index);
  });
  let bucket = unplaced.rows;
  for (const row of rows) {
    if (row.depth === 0) {
      const index = byRoot.get(row.thread.id);
      bucket = index === undefined ? unplaced.rows : categories[index]!.rows;
    }
    bucket.push(row);
  }
  return [unplaced, ...categories].filter(
    (category) => category.rows.length > 0,
  );
}
