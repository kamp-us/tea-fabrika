// Experiment 295, next/: what the inbox cap (`mail.unread`) and the chunk size (`mail.chunk`) of
// ticket 1041 should default to. It times main's own ledger on node:sqlite: a deliver-shaped turn
// (the cap's two lookups, then the inbox and outbox appends) against letter size and inbox size,
// and a reader's catch-up over k unread letters (`Mailbox.read` collected, as the runner's
// `catchUp` does). No network, no key, $0. One process; run it under `nice -n 15`.
//
//   node --max-old-space-size=6144 experiments/295-inbox-cap.ts [--smoke] [--out runs/295-inbox-cap]
//
// Raw samples go to `<out>/samples.jsonl` and the summary to `<out>/summary.json` (0027).
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { Effect, Layer, Stream } from "effect";
import { Doorbell } from "../next/packages/libfabrika/src/ledger/Ledger.ts";
import * as LedgerSql from "../next/packages/libfabrika/src/ledger/LedgerSql.ts";
import { LedgerTransaction, type LedgerTurn } from "../next/packages/libfabrika/src/ledger/LedgerTransaction.ts";
import * as LedgerTransactionSql from "../next/packages/libfabrika/src/ledger/LedgerTransactionSql.ts";
import { lineFor } from "../next/packages/libfabrika/src/ledger/Log.ts";
import { nodeSql } from "../next/packages/libfabrika/src/ledger/NodeSqlite.ts";
import { inbox, letterLine, Mailbox } from "../next/packages/libfabrika/src/processes/Mailbox.ts";

const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;
const smoke = process.argv.includes("--smoke");
const outAt = process.argv.indexOf("--out");
const out = outAt > 0 ? process.argv[outAt + 1]! : join("runs", smoke ? "295-inbox-cap-smoke" : "295-inbox-cap");

const SIZES = (smoke ? [1, 64] : [1, 4, 16, 64, 256, 1024]).map((k) => k * KiB);
const INBOXES = smoke ? [0, 1_000] : [0, 1_000, 10_000];
const BIG_INBOX = 100_000; // only at 1 and 4 KiB, as the plan says
const KS = smoke ? [1, 16, 256] : [1, 4, 16, 64, 256, 1_024, 4_096, 16_384];
const HISTORY = smoke ? [0, 1_000] : [0, 1_000, 10_000, 100_000]; // read letters before the unread ones
const RUNS = smoke ? 2 : 5;
const SENDS = 200;
const BOUND = GiB;

// A fixed seed for the one random thing, the letters' filler text.
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const random = mulberry32(295);
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const filler = (length: number) => {
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return s;
};

/** A letter's message whose `{ m }` body encodes to exactly `size` bytes of JSON. */
const messageOf = (size: number) => {
  const overhead = JSON.stringify({ m: { type: "rows", items: [""] } }).length;
  const m = { type: "rows", items: [filler(size - overhead)] };
  if (JSON.stringify({ m }).length !== size) throw new Error(`letter body is not ${size} bytes`);
  return m;
};

const from = {
  by: "w",
  for: "person",
  sentAt: "2026-11-15T00:00:00.000Z",
  seen: 0,
  parent: null,
  traceId: "0af7651916cd43dd8448eb211c80319c",
  build: "exp295",
};
const READER = "r";
const INBOX = inbox(READER);
const OUTBOX = "w/outbox";
const ACKED = "processes/r:1/acked";
const mailed = (n: number) =>
  lineFor(from, {
    _tag: "mailed",
    command: `process_w1/${n}/send`,
    source: { name: "w", process: "process_w1" },
    to: { name: READER, state: { _tag: "live", process: "process_r1" } },
    ref: null,
    grant: { source: "w", to: READER },
  });
const acked = (pos: number) => lineFor(from, { _tag: "acked", process: "process_r1", pos });

/** The newest entry of a stream, as the plan's cap reads it: `read(stream, head - 1)`. */
const newest = (turn: LedgerTurn, stream: string) => {
  const head = turn.head(stream);
  return head === 0 ? undefined : [...turn.read(stream, head - 1)].at(-1);
};

const quantile = (xs: ReadonlyArray<number>, q: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
};
const median = (xs: ReadonlyArray<number>) => quantile(xs, 0.5);
const round = (x: number, digits = 3) => Number(x.toFixed(digits));

mkdirSync(out, { recursive: true });
const SAMPLES = join(out, "samples.jsonl");
writeFileSync(SAMPLES, "");
const record = (row: object) => appendFileSync(SAMPLES, `${JSON.stringify(row)}\n`);

/** One database in a temp folder, with the ledger and the mailbox on it. */
const open = () => {
  const dir = mkdtempSync(join(tmpdir(), "exp295-"));
  const file = join(dir, "ledger.db");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
  const sql = nodeSql(db);
  const bell = Layer.succeed(Doorbell, { ring: () => Effect.void });
  const layer = Layer.mergeAll(
    LedgerTransactionSql.layer(sql),
    Mailbox.layer.pipe(Layer.provide(LedgerSql.layer(sql, { reader: "project:main" }))),
  ).pipe(Layer.provide(bell));
  const checkpoint = () => db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const walBytes = () => {
    try {
      return statSync(`${file}-wal`).size;
    } catch {
      return 0;
    }
  };
  const close = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { db, layer, checkpoint, walBytes, close };
};

let serial = 0;

/** Appends `count` letters of `m` to the inbox and their receipts to the outbox, in big turns. */
const fill = (count: number, m: object, size: number) =>
  Effect.gen(function* () {
    const tx = yield* LedgerTransaction;
    const perTurn = Math.max(1, Math.min(1_000, Math.floor((64 * MiB) / size)));
    for (let done = 0; done < count; done += perTurn) {
      const n = Math.min(perTurn, count - done);
      yield* tx.transact((turn) => {
        for (let i = 0; i < n; i++) {
          const id = `process_w1/${++serial}/mail`;
          turn.append(INBOX, id, letterLine(from, m as never));
          turn.append(OUTBOX, id, mailed(serial));
        }
      });
    }
  });

/** One deliver-shaped turn. With `cap`, the cap's two lookups run first, as the plan orders them. */
const deliver = (tx: (typeof LedgerTransaction)["Service"], m: object, cap: boolean) =>
  tx.transact((turn) => {
    if (cap) {
      const head = newest(turn, INBOX)?.pos ?? 0;
      const ack = newest(turn, ACKED);
      const unread = Math.max(0, head - ((ack?.body as { pos?: number } | undefined)?.pos ?? 0));
      if (unread >= Number.MAX_SAFE_INTEGER) return "full" as const;
    }
    const id = `process_w1/${++serial}/mail`;
    turn.append(INBOX, id, letterLine(from, m as never));
    turn.append(OUTBOX, id, mailed(serial));
    return "queued" as const;
  });

const summary: {
  write: Array<object>;
  read: Array<object>;
  history: Array<object>;
  ack: Array<object>;
  skipped: Array<string>;
} = { write: [], read: [], history: [], ack: [], skipped: [] };

/** Write cells: letter size x inbox size, 200 sends per run, cap turn then plain turn. */
const writeCell = (size: number, letters: number) =>
  Effect.gen(function* () {
    const m = messageOf(size);
    const db = open();
    const started = performance.now();
    yield* Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      yield* fill(letters, m, size);
      // The reader has read all of them: one ack at the inbox's newest pos.
      yield* tx.transact((turn) => turn.append(ACKED, `ack/${letters}`, acked(newest(turn, INBOX)?.pos ?? 0)));
      db.checkpoint();
      const mark = Number(db.db.prepare("SELECT coalesce(max(rev), 0) AS rev FROM entries").get()!["rev"]);
      const runs: Array<{ cap: number[]; plain: number[]; wal: number }> = [];
      for (let run = 0; run < RUNS; run++) {
        db.db.exec("PRAGMA wal_autocheckpoint=0");
        db.checkpoint();
        const cap: number[] = [];
        for (let i = 0; i < SENDS; i++) {
          const t0 = performance.now();
          yield* deliver(tx, m, true);
          cap.push(performance.now() - t0);
        }
        const wal = db.walBytes() / SENDS;
        db.checkpoint();
        const plain: number[] = [];
        for (let i = 0; i < SENDS; i++) {
          const t0 = performance.now();
          yield* deliver(tx, m, false);
          plain.push(performance.now() - t0);
        }
        // Back to the cell's inbox size for the next run.
        db.db.exec(`DELETE FROM entries WHERE rev > ${mark}`);
        db.db.exec("PRAGMA wal_autocheckpoint=1000");
        db.checkpoint();
        runs.push({ cap, plain, wal });
        record({ kind: "write", size, letters, run, cap, plain, walBytesPerLetter: wal });
      }
      const p = (key: "cap" | "plain", q: number) => runs.map((r) => quantile(r[key], q));
      const row = {
        sizeKiB: size / KiB,
        letters,
        capP50: round(median(p("cap", 0.5))),
        capP95: round(median(p("cap", 0.95))),
        capP50Range: [round(Math.min(...p("cap", 0.5))), round(Math.max(...p("cap", 0.5)))],
        plainP50: round(median(p("plain", 0.5))),
        plainP95: round(median(p("plain", 0.95))),
        capPerKiB: round(median(p("cap", 0.5)) / (size / KiB), 5),
        walBytesPerLetter: Math.round(median(runs.map((r) => r.wal))),
        seconds: round((performance.now() - started) / 1000, 1),
      };
      summary.write.push(row);
      console.log("write", JSON.stringify(row));

      // The ack append alone, once, in the 1 KiB cell at 10,000 letters (or the smoke's largest).
      if (size === KiB && letters === INBOXES.at(-1)) {
        const times: number[][] = [];
        for (let run = 0; run < RUNS; run++) {
          const one: number[] = [];
          for (let i = 0; i < SENDS; i++) {
            const t0 = performance.now();
            yield* tx.transact((turn) => turn.append(ACKED, `ack/${run}/${i}`, acked(letters + i)));
            one.push(performance.now() - t0);
          }
          times.push(one);
          record({ kind: "ack", letters, run, times: one });
        }
        const ack = {
          letters,
          p50: round(median(times.map((t) => quantile(t, 0.5)))),
          p95: round(median(times.map((t) => quantile(t, 0.95)))),
        };
        summary.ack.push(ack);
        console.log("ack", JSON.stringify(ack));
      }
    }).pipe(Effect.provide(db.layer), Effect.ensuring(Effect.sync(db.close)));
  });

/** One catch-up: every letter past `after`, collected, as `catchUp` reads them. */
const catchUp = (after: number) =>
  Effect.gen(function* () {
    const mailbox = yield* Mailbox;
    const t0 = performance.now();
    const letters = yield* Stream.runCollect(mailbox.read(READER, after));
    return { ms: performance.now() - t0, count: letters.length };
  });

/** Read cells: for one letter size, the inbox grows to each k and the reader catches up from 0. */
const readSize = (size: number) =>
  Effect.gen(function* () {
    const m = messageOf(size);
    const db = open();
    yield* Effect.gen(function* () {
      let held = 0;
      for (const k of KS) {
        if (k * size > BOUND) {
          summary.skipped.push(`read ${size / KiB} KiB x k=${k}: ${(k * size) / GiB} GiB is over the 1 GiB bound`);
          continue;
        }
        yield* fill(k - held, m, size);
        held = k;
        db.checkpoint();
        const times: number[] = [];
        for (let run = 0; run < RUNS; run++) {
          const { ms, count } = yield* catchUp(0);
          if (count !== k) throw new Error(`read ${count} letters, wanted ${k}`);
          times.push(ms);
        }
        record({ kind: "read", size, k, times });
        const row = {
          sizeKiB: size / KiB,
          k,
          p50: round(median(times)),
          p95: round(quantile(times, 0.95)),
          min: round(Math.min(...times)),
          bytesMiB: round((k * size) / MiB, 3),
        };
        summary.read.push(row);
        console.log("read", JSON.stringify(row));
      }
    }).pipe(Effect.provide(db.layer), Effect.ensuring(Effect.sync(db.close)));
  });

/** History cells: 256 unread letters of 1 KiB behind h letters already read, since each page read
 *  counts the whole stream (`behind` in ledgerStore.ts). */
const historyCells = Effect.gen(function* () {
  const size = KiB;
  const k = 256;
  const m = messageOf(size);
  for (const h of HISTORY) {
    const db = open();
    yield* Effect.gen(function* () {
      const tx = yield* LedgerTransaction;
      yield* fill(h, m, size);
      const after = yield* tx.transact((turn) => Math.max(turn.head(INBOX), turn.head(OUTBOX)));
      yield* fill(k, m, size);
      db.checkpoint();
      const times: number[] = [];
      for (let run = 0; run < RUNS; run++) {
        const { ms, count } = yield* catchUp(after);
        if (count !== k) throw new Error(`read ${count} letters, wanted ${k}`);
        times.push(ms);
      }
      record({ kind: "history", size, k, history: h, times });
      const row = { sizeKiB: 1, k, history: h, p50: round(median(times)), p95: round(quantile(times, 0.95)) };
      summary.history.push(row);
      console.log("history", JSON.stringify(row));
    }).pipe(Effect.provide(db.layer), Effect.ensuring(Effect.sync(db.close)));
  }
});

const main = Effect.gen(function* () {
  const started = performance.now();
  for (const size of SIZES) {
    const inboxes = size <= 4 * KiB && !smoke ? [...INBOXES, BIG_INBOX] : INBOXES;
    for (const letters of inboxes) {
      if ((letters + SENDS) * size > BOUND) {
        summary.skipped.push(
          `write ${size / KiB} KiB x ${letters} letters: ${round(((letters + SENDS) * size) / GiB, 2)} GiB is over the 1 GiB bound`,
        );
        continue;
      }
      yield* writeCell(size, letters);
    }
  }
  for (const size of SIZES) yield* readSize(size);
  yield* historyCells;
  const seconds = round((performance.now() - started) / 1000, 1);
  const versions = {
    node: process.version,
    sqlite: new DatabaseSync(":memory:").prepare("SELECT sqlite_version() AS v").get()!["v"],
  };
  writeFileSync(join(out, "summary.json"), JSON.stringify({ versions, seconds, ...summary }, null, 2));
  console.log("skipped", JSON.stringify(summary.skipped, null, 2));
  console.log("done", JSON.stringify({ seconds, versions }));
});

await Effect.runPromise(main);
