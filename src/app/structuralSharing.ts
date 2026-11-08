/*
 * JSON-RPC results arrive as fresh trees. Reusing equal branches keeps React
 * subscriptions and memoized projections tied to the values that changed.
 */
export function shareJson<T>(previous: T, next: T): T {
  return shareValue(previous, next) as T;
}

function shareValue(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;

  if (Array.isArray(previous) && Array.isArray(next)) {
    let shared = next;
    let changed = previous.length !== next.length;
    const length = Math.min(previous.length, next.length);
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(previous, index) || !Object.hasOwn(next, index)) {
        changed = true;
        continue;
      }
      const before = previous[index];
      const after = next[index];
      if (Object.is(before, after)) continue;
      const value = shareValue(before, after);
      if (!Object.is(value, after)) {
        if (shared === next) shared = [...next];
        shared[index] = value;
      }
      if (!Object.is(value, before)) changed = true;
    }
    return changed ? shared : previous;
  }

  if (isRecord(previous) && isRecord(next)) {
    let shared = next;
    const nextKeys = Object.keys(next);
    let changed =
      Object.keys(previous).length !== nextKeys.length ||
      Object.keys(previous).some((key) => !Object.hasOwn(next, key));
    for (const key of nextKeys) {
      if (!Object.hasOwn(previous, key)) continue;
      const before = previous[key];
      const after = next[key];
      if (Object.is(before, after)) continue;
      const value = shareValue(before, after);
      if (!Object.is(value, after)) {
        if (shared === next) shared = { ...next };
        shared[key] = value;
      }
      if (!Object.is(value, before)) changed = true;
    }
    return changed ? shared : previous;
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
