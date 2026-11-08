export function mutationTargetElement(record: MutationRecord): Element | null {
  return record.target instanceof Element
    ? record.target
    : record.target.parentElement;
}

export function changedSubtreesMatch(
  record: MutationRecord,
  selector: string,
): boolean {
  for (const node of [...record.addedNodes, ...record.removedNodes]) {
    if (!(node instanceof Element)) continue;
    if (node.matches(selector) || node.querySelector(selector) !== null)
      return true;
  }
  return false;
}
