const tails = new Map<string, Promise<unknown>>();

/** Serializes mutations for one HH group so details fill and cart draft cannot clobber each other. */
export function withHhGroupLock<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(groupId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  tails.set(
    groupId,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}
