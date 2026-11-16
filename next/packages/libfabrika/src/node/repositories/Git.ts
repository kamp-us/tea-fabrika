/**
 * Git in memory, for laws: the `git` command answered from an in-memory object store, so a law over
 * a repository runs without starting git (0535).
 */
import { Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import * as gitMemory from "./internal/gitMemory.ts";

/**
 * Layer that provides a `ChildProcessSpawner` which answers `git` in memory and passes every other
 * command to the spawner below it.
 *
 * **Details**
 *
 * The real git layer is the platform's own spawner: `RepositoriesGit` speaks to git through its
 * command line, so this layer emulates that command line, the subset `RepositoriesGit` and its laws
 * use, and nothing above it changes. Objects, refs, HEAD, the index and config live in memory, one
 * world per built layer; a checkout's files are written to the real file system, so a law's own
 * edits to a working tree are what git sees. Blob and tree ids are git's own; commit ids follow git's
 * object format with a counting clock, so they differ from real git's but stay stable within a run.
 * Exit codes follow git's: 128 for a fatal error, 1 for a refused commit, push or config read.
 *
 * **Gotchas**
 *
 * A command or flag outside the subset dies with `git memory: unsupported command`, never a quiet
 * guess. A remote is a path to a repository this world made: a URL fails as an unreachable network
 * would. Hooks and configured commands never run, so a law about them needs real git.
 *
 * @category layers
 */
export const layerMemory = Layer.effect(ChildProcessSpawner.ChildProcessSpawner, gitMemory.make());
