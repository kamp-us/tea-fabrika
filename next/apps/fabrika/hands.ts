// The hands launcher: one hands process on this laptop. It wires the hands client's real laptop
// parts (the key file, the journal file and the real command layer) to `HandsStart.start`, holds
// the scope until the process is stopped, and prints one JSON line per change a parent process
// needs. No person reads those lines: they are for the app that will start the hands.
//
//   home    FABRIKA_HOME, or ~/.fabrika, as dev.ts reads it
//   files   home/hands/key.json and home/hands/journal.sqlite, in a folder of mode 0700
//   brain   http://127.0.0.1:<instance.port>, the port from the person's settings
//   stdout  {"_tag":"waiting","fingerprint":...,"code":...,"until":...}, then
//           {"_tag":"online","fingerprint":...} or {"_tag":"offline","fingerprint":...}
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as TomlParser from "@kalfa/config/TomlParser";
import { Id } from "@kampus/libfabrika";
import { start } from "@kampus/libfabrika/client/HandsStart";
import * as JournalStore from "@kampus/libfabrika/client/JournalStore";
import * as CommandsNode from "@kampus/libfabrika/node/client/CommandsNode";
import * as JournalSqlite from "@kampus/libfabrika/node/client/JournalSqlite";
import * as KeyFile from "@kampus/libfabrika/node/client/KeyFile";
import * as Load from "@kampus/libfabrika/node/settings/Load";
import * as Declarations from "@kampus/libfabrika/settings/Declarations";
import { ClientKey } from "@kampus/libfabrika/transport/ClientKey";
import type { Link } from "@kampus/libfabrika/transport/Link";
import { Config, Effect, FileSystem, Layer, Path, Queue, Schema, Stream } from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import { Socket } from "effect/socket";

const VERSION = "0.0.0";

/** What the launcher prints, one line per change: the protocol between it and its parent. */
const Line = Schema.TaggedUnion({
  /** The key is not granted yet: a person approves `code` before `until`. */
  waiting: { fingerprint: Schema.String, code: Schema.String, until: Schema.Finite },
  online: { fingerprint: Schema.String },
  offline: { fingerprint: Schema.String },
});

type Line = typeof Line.Type;

const encodeLine = Schema.encodeEffect(Schema.fromJsonString(Line));

/** The host's `os` as the hello names it. */
const OS: Partial<Record<NodeJS.Platform, "macos" | "linux" | "windows">> = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
};

/** The entries that hold a value, as one record. */
const present = (entries: ReadonlyArray<readonly [string, string | undefined]>) =>
  Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));

/** What a parent needs to know of the link: waiting for a grant, online, or neither. */
const lineFor = (link: Link, fingerprint: string): Line =>
  link._tag === "waiting_grant"
    ? Line.cases.waiting.make({ fingerprint, code: link.code, until: link.until })
    : link._tag === "online"
      ? Line.cases.online.make({ fingerprint })
      : Line.cases.offline.make({ fingerprint });

const hands = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;

  const home = process.env.FABRIKA_HOME ?? path.join(yield* Config.String("HOME"), ".fabrika");

  const loaded = yield* Load.load({
    person: {
      path: path.join(home, "fabrika.toml"),
      name: `${process.env.FABRIKA_HOME === undefined ? "~/.fabrika" : "$FABRIKA_HOME"}/fabrika.toml`,
    },
    flags: {},
    env: present(Declarations.all.declarations.map((d) => [d.env, process.env[d.env]])),
    version: VERSION,
  }).pipe(Effect.provide([TomlParser.layer, Digest.layerWebCrypto]));

  const folder = path.join(home, "hands");
  // The journal opens its file as its layer is built, so the folder is made first, private.
  yield* fs.makeDirectory(folder, { recursive: true, mode: 0o700 });

  const layers = Layer.mergeAll(
    KeyFile.layer({ file: path.join(folder, "key.json") }),
    JournalStore.layer.pipe(Layer.provide(JournalSqlite.layer({ file: path.join(folder, "journal.sqlite") }))),
    CommandsNode.layer,
    Socket.layerWebSocketConstructorGlobal,
    Id.Generator.layer,
  );

  return yield* Effect.gen(function* () {
    const { fingerprint } = yield* ClientKey.use((keys) => keys.current(null));

    const booting = yield* start({
      origin: `http://127.0.0.1:${loaded.values.port}`,
      build: VERSION,
      label: "hands",
      os: OS[process.platform] ?? "unknown",
    });

    const runtime = yield* booting.ready;
    // Every state the run reaches, from the first, as the line a parent reads; a line is printed
    // only when it changes.
    yield* Stream.callback<Line>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const push = () => Queue.offerUnsafe(queue, lineFor(runtime.getState().link, fingerprint));
          push();

          return runtime.subscribe(push);
        }),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    ).pipe(
      Stream.mapEffect((line) => encodeLine(line)),
      Stream.changes,
      Stream.runForEach((text) => Effect.sync(() => process.stdout.write(`${text}\n`))),
    );
    // The run's scope closes first, then the layers': the journal stays open while the run stops.
  }).pipe(Effect.scoped, Effect.provide(layers));
});

NodeRuntime.runMain(hands.pipe(Effect.provide([NodeServices.layer, SecureRandom.layerWebCrypto])));
