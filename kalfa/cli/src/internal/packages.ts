/**
 * The one seam to Node's module system: the repo's manifest, the manifest of an installed package, and the module of an entry point.
 *
 * **Details**
 *
 * A package is looked for from the repo's own folder, never from where `kalfa` is installed, so it finds the packages the repo depends on. The laws run on a stand-in of this service held in memory.
 */
import { createRequire, findPackageJSON } from "node:module"; // edge: Node's own resolve is the only way to find a package as Node itself would, and it is a synchronous call
import { Context, Effect, FileSystem, Layer, Option, Path, Predicate } from "effect";
import { Refused } from "./failure.ts";

/**
 * What `kalfa` asks of the repo it runs in.
 *
 * @category services
 */
export class Packages extends Context.Service<
  Packages,
  {
    /** The repo's root folder: the current folder, decided once by `kalfa`. */
    readonly folder: string;
    /** `<folder>/package.json`, as text. */
    readonly root: Effect.Effect<string, Refused>;
    /** The `package.json` text of an installed package, found from the repo's folder; none when it is not installed. */
    readonly manifest: (name: string) => Effect.Effect<Option.Option<string>, Refused>;
    /** The exports of the module that a specifier resolves to, found from the repo's folder. */
    readonly load: (pkg: string, specifier: string) => Effect.Effect<Record<string, unknown>, Refused>;
  }
>()("@kalfa/cli/Packages") {}

// The `code` Node puts on an error it throws, such as `ERR_PACKAGE_PATH_NOT_EXPORTED`.
const errorCode = (cause: unknown): string | undefined =>
  Predicate.hasProperty(cause, "code") && Predicate.isString(cause.code) ? cause.code : undefined;

/** Imports the module at a URL of a package: a module that throws as it loads is `load`. */
const imported = (pkg: string, href: string): Effect.Effect<Record<string, unknown>, Refused> =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: a package named at run time is loaded only by import(), which answers a Promise
  Effect.tryPromise({ try: () => import(href), catch: () => new Refused({ reason: "load", packages: [pkg] }) });

/**
 * `Packages` on Node: files read through the file system, packages found with `findPackageJSON` and `createRequire`, modules loaded with `import()`.
 *
 * @category layers
 */
export const layerNode = (folder: string): Layer.Layer<Packages, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    Packages,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(folder, "package.json");
      const require = createRequire(file);

      const manifest = (name: string) =>
        Effect.try({ try: () => findPackageJSON(name, file), catch: errorCode }).pipe(
          Effect.map(Option.fromUndefinedOr),
          Effect.catchIf(
            (code) => code === "ERR_MODULE_NOT_FOUND",
            () => Effect.succeed(Option.none<string>()),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(Option.none<string>()),
              onSome: (found) => Effect.asSome(fs.readFileString(found)),
            }),
          ),
          Effect.mapError(() => new Refused({ reason: "bad-manifest", packages: [name] })),
        );

      const load = (pkg: string, specifier: string) =>
        Effect.try({ try: () => require.resolve(specifier), catch: errorCode }).pipe(
          Effect.mapError(
            (code) =>
              new Refused({
                reason: code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ? "not-exported" : "load",
                packages: [pkg],
              }),
          ),
          Effect.flatMap((resolved) =>
            path.toFileUrl(resolved).pipe(
              Effect.mapError(() => new Refused({ reason: "load", packages: [pkg] })),
              Effect.flatMap((url) => imported(pkg, url.href)),
            ),
          ),
        );

      return Packages.of({
        folder,
        root: Effect.mapError(fs.readFileString(file), () => new Refused({ reason: "no-manifest", packages: [] })),
        manifest,
        load,
      });
    }),
  );
