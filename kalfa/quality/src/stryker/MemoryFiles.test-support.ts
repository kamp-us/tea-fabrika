// A file system held in a record, for the plant runner's laws that run on its in-memory stand-ins
// (Run.test.ts). It answers the calls a run has reason to make: reading a file as text or bytes,
// asking whether a path exists, a scoped temp folder, and the writes into it. Any other call fails
// the run, so a law notices a run that reaches for the real disk.
import { Effect, FileSystem, Layer, PlatformError } from "effect";

const missing = (method: string, path: string) =>
  PlatformError.systemError({ _tag: "NotFound", module: "FileSystem", method, pathOrDescriptor: path });

/** `files` maps an absolute path to its text. A folder exists when a file is under it. */
export const layer = (files: Readonly<Record<string, string>>) => {
  const written = new Map<string, string>(Object.entries(files));
  const folders = (path: string) => [...written.keys()].some((file) => file.startsWith(`${path}/`));

  return Layer.succeed(
    FileSystem.FileSystem,
    FileSystem.makeNoop({
      readFileString: (path) => {
        const text = written.get(path);

        return text === undefined ? Effect.fail(missing("readFileString", path)) : Effect.succeed(text);
      },
      readFile: (path) => {
        const text = written.get(path);

        return text === undefined
          ? Effect.fail(missing("readFile", path))
          : Effect.succeed(new TextEncoder().encode(text));
      },
      exists: (path) => Effect.succeed(written.has(path) || folders(path)),
      makeTempDirectoryScoped: () => Effect.succeed("/scoped/temp"),
      makeTempDirectory: () => Effect.succeed("/scoped/temp"),
      realPath: (path) => Effect.succeed(path),
      makeDirectory: () => Effect.void,
      writeFileString: (path, text) =>
        Effect.sync(() => {
          written.set(path, text);
        }),
      writeFile: (path, bytes) =>
        Effect.sync(() => {
          written.set(path, new TextDecoder().decode(bytes));
        }),
      remove: () => Effect.void,
    }),
  );
};
