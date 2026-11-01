import type { CategoryGeneration } from "./categories.ts";

type TreeRow = { depth: number; thread: { id: string } };

/** Categories move whole root trees in the view, leaving section IDs untouched. */
export function categoryRows<R extends TreeRow>(
  rows: readonly R[],
  generation?: CategoryGeneration,
): Array<{ id: string | null; name: string | null; rows: R[] }> {
  if (!generation) return [{ id: null, name: null, rows: [...rows] }];
  const categories = generation.categories.map((category) => ({
    id: category.id,
    name: category.name,
    rows: [] as R[],
  }));
  const unplaced = { id: null, name: null, rows: [] as R[] };
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
