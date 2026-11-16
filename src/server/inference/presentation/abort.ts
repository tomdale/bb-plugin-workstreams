/**
 * Settles with `work`, or rejects with the signal's reason when it aborts
 * first, so a call that ignores its signal cannot outlast a deadline. Work
 * left behind may fail later (Chrome closing under it); that failure is
 * expected and dropped.
 */
export function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  work.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
