// T878, next/. The repository stand-in OpenRepository.test.ts and OpenRepository.composed.integration.test.ts
// share, so the plain L3 does not copy it (0040, 0587). It reaches nothing real: no disk, no git, no process, no
// network, so a plain `.test.ts` may import it and still run on every pull request (0584).
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import {
  Repositories,
  RepositoriesError,
  ReadFailed,
  Snapshot as RepoSnapshot,
} from "../../repositories/Repositories.ts";

/** The name the person's settings file shows in diagnostics. */
export const personName = "~/.fabrika/fabrika.toml";

/** The path of the repository's settings document. */
export const document = ".fabrika/fabrika.toml";

/** A repository snapshot of the release branch that holds `text` (null: no document) at fixed key, commit and hash. */
export const repoSnapshot = (text: string | null) =>
  Schema.decodeSync(RepoSnapshot)({
    key: Function.pipe("a", Str.repeat(64)),
    branch: "release",
    commit: Function.pipe("b", Str.repeat(40)),
    file: document,
    text,
    hash: Function.pipe("c", Str.repeat(64)),
  });

/**
 * A `Repositories` layer that holds `text` as its settings document and refuses to resolve any source. When
 * `touches` is given, each read path and each resolve is pushed on it ("outside source" for a resolve), so a law
 * can show that nothing outside the document was touched.
 */
export const reader = (text: string | null, touches?: Array<string>) =>
  Layer.succeed(Repositories, {
    open: () =>
      Effect.succeed({
        snapshot: repoSnapshot(text),
        read: (path: string) => {
          touches?.push(path);

          return Effect.succeed(null);
        },
        resolve: () => {
          touches?.push("outside source");

          return Effect.fail(
            RepositoriesError.make({ reason: ReadFailed.make({ cause: Redacted.make("must not resolve code") }) }),
          );
        },
      }),
  });
