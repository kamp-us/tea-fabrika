/**
 * A file system held in memory, for the laws of `SettingGroup.layer`: the files are a record of path to text, a path
 * that is not there answers `NotFound` as a real disk does, and a path named in `broken` fails with the error planted
 * there in place of its text. A law that wants the calls watches this service with `Recorder` (see SettingGroup.test.ts),
 * which lint keeps out of this file, since the package's own files import no workspace package. R1 checks this stand-in
 * against a real temp folder, so a law that reads from it is as true as one on a disk.
 */
import { Effect, FileSystem, Layer, Path, type PlatformError } from "effect";

export interface Disk {
  /** The text of each file, by the path the program reads it from. */
  readonly files: Readonly<Record<string, string>>;
  /** A path whose read fails with the error given here, whatever else the disk holds at that path. */
  readonly broken?: Readonly<Record<string, PlatformError.PlatformError>>;
}

// The platform's own refusal for a path that is not there: what `makeNoop` answers for a method it was not given.
const noop = FileSystem.makeNoop({});

/** The file system on a disk. */
export const make = (disk: Disk): FileSystem.FileSystem =>
  FileSystem.makeNoop({
    exists: (path) => {
      const fault = disk.broken?.[path];

      return fault === undefined ? Effect.succeed(disk.files[path] !== undefined) : Effect.fail(fault);
    },
    readFileString: (path) => {
      const fault = disk.broken?.[path];
      const text = disk.files[path];

      return fault !== undefined
        ? Effect.fail(fault)
        : text === undefined
          ? noop.readFileString(path)
          : Effect.succeed(text);
    },
    readFile: (path) => {
      const fault = disk.broken?.[path];
      const text = disk.files[path];

      return fault !== undefined
        ? Effect.fail(fault)
        : text === undefined
          ? noop.readFile(path)
          : Effect.succeed(new TextEncoder().encode(text));
    },
  });

/** The file system on a disk, and the path service. */
export const layer = (disk: Disk): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
  Layer.merge(Layer.succeed(FileSystem.FileSystem)(make(disk)), Path.layer);
