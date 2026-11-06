// Bound request fanout, preserve disjoint absolute unit indices, and drain siblings on failure.
export function partitionIndices(
  indices: number[],
  lanes: number,
  maxBatch: number,
) {
  if (
    !Number.isSafeInteger(lanes) ||
    lanes < 1 ||
    !Number.isSafeInteger(maxBatch) ||
    maxBatch < 1
  )
    throw Error("Invalid batch limits");
  const size = Math.max(
    1,
    Math.min(maxBatch, Math.ceil(indices.length / lanes)),
  );
  const batches: number[][] = [];
  for (let i = 0; i < indices.length; i += size)
    batches.push(indices.slice(i, i + size));
  return batches;
}
export async function runParallel(
  tasks: (() => Promise<void>)[],
  limit: () => number,
  controller: AbortController,
) {
  let next = 0,
    active = 0,
    firstError: unknown;
  await new Promise<void>((resolve) => {
    let finished = false;
    const pump = () => {
      if (finished) return;
      if (
        (controller.signal.aborted || next === tasks.length) &&
        active === 0
      ) {
        finished = true;
        clearInterval(timer);
        controller.signal.removeEventListener("abort", pump);
        resolve();
        return;
      }
      while (
        !controller.signal.aborted &&
        next < tasks.length &&
        active < Math.max(1, limit())
      ) {
        const task = tasks[next++];
        active++;
        void Promise.resolve()
          .then(task)
          .catch((error) => {
            firstError ??= error;
            controller.abort();
          })
          .finally(() => {
            active--;
            pump();
          });
      }
    };
    const timer = setInterval(pump, 1000);
    timer.unref();
    controller.signal.addEventListener("abort", pump);
    pump();
  });
  if (firstError) throw firstError;
  if (controller.signal.aborted) throw Error("Job interrupted");
}
export function interleave<T>(groups: T[][]) {
  const result: T[] = [];
  const rounds = Math.max(0, ...groups.map((group) => group.length));
  for (let round = 0; round < rounds; round++)
    for (const group of groups)
      if (round < group.length) result.push(group[round]);
  return result;
}
