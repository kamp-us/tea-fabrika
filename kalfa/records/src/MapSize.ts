/**
 * The map size check (decision 0608): an agent reads the root `AGENTS.md`, then the one of the folder
 * it works in, and stops adding files once the bytes reach its limit. A finding comes for each chain
 * of those files that holds more bytes than the limit: the root alone, and the root with each
 * folder's file one folder down.
 */
import { Effect } from "effect";
import { Finding } from "./Finding.ts";
import { read, Tracked } from "./Tracked.ts";

const ROOT = "AGENTS.md";

const FOLDER = /^[^/]+\/AGENTS\.md$/;

const utf8 = new TextEncoder();

/**
 * The `map` findings for a limit of `max` bytes. A file's size is its UTF-8 bytes, as an agent's reader counts them.
 *
 * @category constructors
 */
export const check = Effect.fnUntraced(function* (root: string, max: number) {
  const tracked = yield* Tracked;

  const paths = (yield* tracked.files)
    .filter((entry) => !entry.symlink && (entry.path === ROOT || FOLDER.test(entry.path)))
    .map((entry) => entry.path);

  const sizes = (yield* read(root, paths)).map(({ path, text }) => [path, utf8.encode(text).length] as const);
  const bytes = new Map(sizes);
  const rootBytes = bytes.get(ROOT);
  const base = rootBytes === undefined ? [] : [ROOT];

  const chains = [
    ...(rootBytes === undefined ? [] : [{ chain: [ROOT], bytes: rootBytes }]),
    ...[...bytes.keys()]
      .filter((each) => each !== ROOT)
      .map((each) => ({ chain: [...base, each], bytes: (rootBytes ?? 0) + (bytes.get(each) ?? 0) })),
  ];

  return chains.filter((each) => each.bytes > max).map((each) => Finding.cases.map.make({ ...each, max }));
});
