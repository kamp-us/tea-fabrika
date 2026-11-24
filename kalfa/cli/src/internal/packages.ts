/**
 * The one seam to Node's module system: the repo's manifest, the manifest of an installed package, and the module of an entry point.
 *
 * **Details**
 *
 * A package is looked for from the repo's own folder, never from where `kalfa` is installed, so it finds the packages the repo depends on. The laws run on a stand-in of this service held in memory.
 */
import { createRequire, findPackageJSON } from "node:module"; // edge: Node's own resolve is the only way to find a package as Node itself would, and it is a synchronous call
import { Context, Effect, FileSystem, Layer, Option, Path, Predicate, Schema } from "effect";
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
    /** The exports of the module a specifier resolves to, found from the repo's folder; `Unloaded` when Node refuses it. */
    readonly load: (pkg: string, specifier: string) => Effect.Effect<Record<string, unknown>, Unloaded | Refused>;
  }
>()("@kalfa/cli/Packages") {}

/**
 * A module that Node could not give: its resolve refused the specifier, or it threw as it loaded. It knows no field and no subpath, which `kalfa` adds when it turns this into a `Refused`.
 *
 * @category errors
 */
export class Unloaded extends Schema.TaggedError<Unloaded, { readonly brand: unique symbol }>()("Unloaded", {
  reason: Schema.Literals(["not-exported", "load"]),
}) {}

// The `code` Node puts on an error it throws, such as `ERR_PACKAGE_PATH_NOT_EXPORTED`.
const errorCode = (cause: unknown): string | undefined =>
  Predicate.hasProperty(cause, "code") && Predicate.isString(cause.code) ? cause.code : undefined;

/** Imports the module at a URL: a module that throws as it loads is `load`. */
const imported = (href: string): Effect.Effect<Record<string, unknown>, Unloaded> =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: a package named at run time is loaded only by import(), which answers a Promise
  Effect.tryPromise({ try: () => import(href), catch: () => new Unloaded({ reason: "load" }) });

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

      const load = (_pkg: string, specifier: string) =>
        Effect.try({ try: () => require.resolve(specifier), catch: errorCode }).pipe(
          Effect.mapError(
            (code) => new Unloaded({ reason: code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ? "not-exported" : "load" }),
          ),
          Effect.flatMap((resolved) =>
            path.toFileUrl(resolved).pipe(
              Effect.mapError(() => new Unloaded({ reason: "load" })),
              Effect.flatMap((url) => imported(url.href)),
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
