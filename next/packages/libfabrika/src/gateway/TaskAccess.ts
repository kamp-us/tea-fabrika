/**
 * Selection and ownership rules for authenticated task access.
 */
import { Result } from "effect";
import { State, type Task } from "../tasks/Task.ts";

type Subject = { readonly process: string; readonly key: string; readonly execution?: string };

/**
 * Checks the saved request and, once assigned, its executor and execution.
 *
 * @category guards
 */
export const owns = (task: Task, subject: Subject): boolean => {
  const state = task.state;

  if (
    State.isAnyOf(["absent"])(state) ||
    state.request.process !== subject.process ||
    state.request.target !== subject.key
  ) {
    return false;
  }

  if (State.isAnyOf(["requested"])(state)) {
    return subject.execution === undefined;
  }

  return (
    state.assignment.executor.key === subject.key &&
    (subject.execution === undefined || state.assignment.execution === subject.execution)
  );
};

/**
 * Selects unfinished work for one process and key, refusing competing candidates.
 *
 * @category getters
 */
export const select = (tasks: ReadonlyArray<Task>, subject: Subject): Result.Result<Task | null, "ambiguous"> => {
  const candidates = tasks.filter(
    (task) =>
      !State.isAnyOf(["absent", "finished", "collected"])(task.state) &&
      task.state.request.process === subject.process &&
      task.state.request.target === subject.key,
  );

  return candidates.length > 1 ? Result.fail("ambiguous") : Result.succeed(candidates[0] ?? null);
};
