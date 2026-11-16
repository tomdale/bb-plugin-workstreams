/** A count with its noun: "1 thread", "3 threads". */
export function counted(count: number, noun: string, plural = `${noun}s`) {
  return `${count} ${count === 1 ? noun : plural}`;
}
