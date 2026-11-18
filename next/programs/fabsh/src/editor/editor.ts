import { applyCell, type Sub } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { type ProgramList } from "../check.ts";
import { complete, type Jobs } from "../complete.ts";
import { roles } from "../roles.ts";
import { words, Token } from "../words.ts";
import { spot } from "./cells.ts";
import { keys, Key, pending, printable } from "./keys.ts";
import {
  back,
  BELL,
  CLEAR,
  columns,
  draw,
  fitsRow,
  NEWLINE,
  paint,
  PROMPT,
  redrawRow,
  shown,
  table,
  Table,
} from "./screen.ts";

import { find, Search, shownSearch } from "./search.ts";

const Line = Schema.Struct({ left: Schema.String, right: Schema.String });

type Line = typeof Line.Type;

const Recall = Schema.Struct({ back: Schema.Int, typed: Line });

const Yank = Schema.Struct({ at: Schema.Int, length: Schema.Int, index: Schema.Int });

const PromptFields = {
  line: Line,
  recall: Schema.NullOr(Recall),
  undo: Schema.Array(Line),
  yank: Schema.NullOr(Yank),
};

const Prompt = Schema.TaggedStruct("prompt", PromptFields);

type Prompt = typeof Prompt.Type;

const Mode = Schema.TaggedUnion({
  prompt: PromptFields,
  search: { search: Search, typed: Prompt },
  busy: { ahead: Schema.Array(Schema.String), flushes: Schema.Array(Schema.Int) },
  asking: { job: Schema.Int, ahead: Schema.Array(Schema.String), flushes: Schema.Array(Schema.Int) },
  ended: {},
});

const TalkSchema = Schema.Struct({
  names: Schema.Array(Schema.String),
  harnesses: Schema.Array(Schema.String),
  offers: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))),
});

const Model = Schema.Struct({
  mode: Mode,
  history: Schema.Array(Schema.String),
  historyLimit: Schema.Int,
  ring: Schema.Array(Schema.String),
  last: Schema.NullOr(Schema.String),
  cols: Schema.Int,
  resized: Schema.Boolean,
  framing: keys.model,
  programs: Schema.declare<ProgramList>((value) => value instanceof Map),
  jobs: Schema.declare<Jobs>((value) => value instanceof Map),
  talk: TalkSchema,
  status: Schema.NullOr(Schema.String),
});

type Model = typeof Model.Type;

interface Context {
  readonly programs: ProgramList;
  readonly history: ReadonlyArray<string>;
  readonly historyLimit: number;
}

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("keys"), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("flush") }),
  Schema.Struct({ type: Schema.Literal("ready") }),
  Schema.Struct({ type: Schema.Literal("size"), cols: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("printed"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("table"), table: Table }),
  Schema.Struct({ type: Schema.Literal("history"), lines: Schema.Array(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("jobs"), jobs: Schema.declare<Jobs>((value) => value instanceof Map) }),
  Schema.Struct({ type: Schema.Literal("talk"), talk: TalkSchema }),
  Schema.Struct({ type: Schema.Literal("status"), text: Schema.NullOr(Schema.String) }),
  Schema.Struct({
    type: Schema.Literal("asked"),
    job: Schema.Int,
    text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({ type: Schema.Literal("ended") }),
]);

const write = Cmd.make("write", { input: Schema.Struct({ bytes: Schema.String }), ok: Schema.Null, err: [] });

const submit = Cmd.make("submit", { input: Schema.Struct({ line: Schema.String }), ok: Schema.Null, err: [] });

const interrupt = Cmd.make("interrupt", { input: Schema.Struct({}), ok: Schema.Null, err: [] });

const close = Cmd.make("close", { input: Schema.Struct({}), ok: Schema.Null, err: [] });

const keep = Cmd.make("keep", { input: Schema.Struct({ line: Schema.String }), ok: Schema.Null, err: [] });

const answer = Cmd.make("answer", {
  input: Schema.Struct({ job: Schema.Int, allow: Schema.Boolean }),
  ok: Schema.Null,
  err: [],
});

const CMDS = [write, submit, interrupt, close, keep, answer];

type Output =
  | ReturnType<typeof write>
  | ReturnType<typeof submit>
  | ReturnType<typeof interrupt>
  | ReturnType<typeof close>
  | ReturnType<typeof keep>
  | ReturnType<typeof answer>;
type Step = readonly [Model, ReadonlyArray<Output>];

const EMPTY: Line = { left: "", right: "" };

const prompt = (line: Line = EMPTY): Prompt => Prompt.make({ line, recall: null, undo: [], yank: null });

const clean = (line: string): string => [...line].filter(printable).join("");

const history = (lines: ReadonlyArray<string>, limit: number): ReadonlyArray<string> => {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const raw of [...lines].reverse()) {
    const text = clean(raw);

    if (text.trim() !== "" && !seen.has(text)) {
      seen.add(text);
      unique.push(text);
    }

    if (unique.length === limit) {
      break;
    }
  }

  return unique.reverse();
};

const display = (s: Model) =>
  Mode.matchOrElse(
    s.mode,
    {
      prompt: ({ line }) => ({
        plain: PROMPT + line.left + line.right,
        colored: PROMPT + paint(line.left + line.right, roles(line.left + line.right, s.programs, line.left.length)),
        at: spot(PROMPT + line.left, s.cols),
      }),
      search: ({ search }) => {
        const text = shownSearch([...s.history].reverse(), search);
        return { plain: text, colored: text, at: spot(text, s.cols) };
      },
    },
    () => null,
  );

const drawn = (s: Model): string => {
  const d = display(s);
  return d === null ? "" : draw(d.plain, d.colored, d.at, s.cols);
};

const backFrom = (s: Model): string => {
  const d = display(s);
  return d === null ? "" : back(d.at, s.cols);
};

const leave = (s: Model): string => {
  const d = display(s);
  return d === null ? "" : `${back(d.at, s.cols)}\x1b[J${d.colored}${NEWLINE}`;
};

const redraw = (before: Model, after: Model, prefix = ""): Step => {
  const a = display(before);
  const b = display(after);
  const row =
    !before.resized && a !== null && b !== null && fitsRow(a.plain, before.cols) && fitsRow(b.plain, after.cols);
  const bytes = row && b !== null ? redrawRow(b.colored, b.at) : `${backFrom(before)}${drawn(after)}`;
  return [{ ...after, resized: false }, [write({ bytes: `${prefix}${bytes}` })]];
};

const bell = (s: Model): Step => [s, [write({ bytes: BELL })]];

const cutAt = (text: ReadonlyArray<string>, at: number): Line => ({
  left: text.slice(0, at).join(""),
  right: text.slice(at).join(""),
});

const word = (c: string) => /[\p{L}\p{N}]/u.test(c);

const beforeWord = (chars: ReadonlyArray<string>, at: number, inside = word): number => {
  let n = at;

  while (n > 0) {
    const char = chars.at(n - 1);

    if (char === undefined || inside(char)) {
      break;
    }

    n -= 1;
  }

  while (n > 0) {
    const char = chars.at(n - 1);

    if (char === undefined || !inside(char)) {
      break;
    }

    n -= 1;
  }

  return n;
};

const afterWord = (chars: ReadonlyArray<string>, at: number): number => {
  let n = at;

  while (n < chars.length) {
    const char = chars.at(n);

    if (char === undefined || word(char)) {
      break;
    }

    n += 1;
  }

  while (n < chars.length) {
    const char = chars.at(n);

    if (char === undefined || !word(char)) {
      break;
    }

    n += 1;
  }

  return n;
};

const KILLS = new Set<string>([
  "kill-line",
  "unix-line-discard",
  "unix-word-rubout",
  "kill-word",
  "backward-kill-word",
]);

const shared = (candidates: ReadonlyArray<string>): string => {
  let prefix = candidates[0] ?? "";

  for (const candidate of candidates.slice(1)) {
    while (!candidate.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }

  return prefix;
};

const accepted = (s: Model, line: string): Step => {
  if (line.trim() === "") {
    const next = { ...s, mode: prompt() };
    return [next, [write({ bytes: leave(s) + drawn(next) })]];
  }

  return [
    {
      ...s,
      mode: Mode.cases.busy.make({ ahead: [], flushes: [] }),
      history: history([...s.history, line], s.historyLimit),
      last: null,
    },
    [write({ bytes: leave(s) }), submit({ line }), keep({ line })],
  ];
};

const atPrompt = (s: Model, mode: Prompt, key: Key): Step => {
  const { left, right } = mode.line;
  const chars = [...left, ...right];
  const cursor = [...left].length;
  const edit = (line: Line, changed = true, yank: typeof Yank.Type | null = null): Step =>
    redraw(s, {
      ...s,
      mode: Prompt.make({ ...mode, line, undo: changed ? [...mode.undo, mode.line] : mode.undo, yank }),
    });
  const kill = (cut: string, line: Line, backwards: boolean): Step => {
    let ring = s.ring;

    if (cut !== "") {
      const joined = s.last !== null && KILLS.has(s.last);
      const first = ring.at(0);
      ring =
        joined && ring.length > 0
          ? [backwards ? `${cut}${String(first)}` : `${String(first)}${cut}`, ...ring.slice(1)]
          : [cut, ...ring].slice(0, 10);
    }

    if (cut === "") {
      return [s, []];
    }

    const [next, cmds] = edit(line);
    return [{ ...next, ring }, cmds];
  };
  const recall = (count: number): Step => {
    if (count < 0 || count > s.history.length || (count > 0 && s.history.length === 0)) {
      return bell(s);
    }

    const back = count;
    const typed = mode.recall?.typed ?? mode.line;
    const line = back === 0 ? typed : { left: s.history[s.history.length - back] ?? "", right: "" };
    return redraw(s, {
      ...s,
      mode: Prompt.make({ ...mode, line, recall: back === 0 ? null : { back, typed }, yank: null }),
    });
  };
  return Key.match(key, {
    unknown: (): Step => [s, []],
    text: ({ text }) => edit({ left: left + text, right }),
    command: ({ command }): Step => {
      switch (command) {
        case "beginning-of-line":
          return edit({ left: "", right: left + right }, false);
        case "end-of-line":
          return edit({ left: left + right, right: "" }, false);
        case "backward-char":
          return edit(cutAt(chars, Math.max(0, cursor - 1)), false);
        case "forward-char":
          return edit(cutAt(chars, Math.min(chars.length, cursor + 1)), false);
        case "backward-word":
          return edit(cutAt(chars, beforeWord(chars, cursor)), false);
        case "forward-word":
          return edit(cutAt(chars, afterWord(chars, cursor)), false);
        case "backward-delete-char":
          return cursor === 0 ? bell(s) : edit({ left: [...left].slice(0, -1).join(""), right });
        case "delete-char":
          return right === "" ? bell(s) : edit({ left, right: [...right].slice(1).join("") });
        case "kill-line":
          return kill(right, { left, right: "" }, false);
        case "unix-line-discard":
          return kill(left, { left: "", right }, true);
        case "unix-word-rubout": {
          const start = beforeWord(chars, cursor, (c) => !/\s/.test(c));
          return kill(chars.slice(start, cursor).join(""), { left: chars.slice(0, start).join(""), right }, true);
        }

        case "backward-kill-word": {
          const start = beforeWord(chars, cursor);
          return kill(chars.slice(start, cursor).join(""), { left: chars.slice(0, start).join(""), right }, true);
        }

        case "kill-word": {
          const end = afterWord(chars, cursor);
          return kill(chars.slice(cursor, end).join(""), { left, right: chars.slice(end).join("") }, false);
        }

        case "yank": {
          const text = s.ring[0];
          return text === undefined
            ? bell(s)
            : edit({ left: left + text, right }, true, { at: left.length, length: text.length, index: 0 });
        }

        case "yank-pop": {
          if (mode.yank === null || s.ring.length === 0) {
            return bell(s);
          }

          const index = (mode.yank.index + 1) % s.ring.length;
          const text = s.ring.at(index);

          if (text === undefined) {
            return bell(s);
          }

          const all = left + right;
          return edit(
            { left: all.slice(0, mode.yank.at) + text, right: all.slice(mode.yank.at + mode.yank.length) },
            true,
            { at: mode.yank.at, length: text.length, index },
          );
        }

        case "undo": {
          const line = mode.undo.at(-1);
          return line === undefined
            ? bell(s)
            : redraw(s, { ...s, mode: Prompt.make({ ...mode, line, undo: mode.undo.slice(0, -1), yank: null }) });
        }

        case "transpose-chars": {
          if (chars.length < 2 || cursor === 0) {
            return bell(s);
          }

          const at = cursor === chars.length ? cursor - 1 : cursor;
          const next = [...chars];
          const before = chars.at(at - 1);
          const current = chars.at(at);

          if (before === undefined || current === undefined) {
            return bell(s);
          }

          next[at] = before;
          next[at - 1] = current;
          return edit(cutAt(next, at + 1));
        }

        case "upcase-word":
        case "downcase-word":
        case "capitalize-word": {
          let start = cursor;

          while (start < chars.length) {
            const char = chars.at(start);

            if (char === undefined || word(char)) {
              break;
            }

            start += 1;
          }

          const end = afterWord(chars, start);
          const text = chars.slice(start, end).join("");
          const changed =
            command === "upcase-word"
              ? text.toUpperCase()
              : command === "downcase-word"
                ? text.toLowerCase()
                : text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
          return edit({ left: chars.slice(0, start).join("") + changed, right: chars.slice(end).join("") });
        }

        case "yank-last-arg": {
          const last = s.history.at(-1);
          const token = last === undefined ? undefined : words(last).tokens.at(-1);
          return token !== undefined && Token.guards.word(token) ? edit({ left: left + token.text, right }) : bell(s);
        }

        case "clear-screen":
          return [s, [write({ bytes: CLEAR + drawn(s) })]];
        case "accept-line":
          return accepted(s, left + right);
        case "previous-history":
          return recall((mode.recall?.back ?? 0) + 1);
        case "next-history":
          return recall((mode.recall?.back ?? 0) - 1);
        case "beginning-of-history":
          return recall(s.history.length);
        case "end-of-history":
          return recall(0);
        case "reverse-search-history":
        case "forward-search-history":
          return redraw(s, {
            ...s,
            mode: Mode.cases.search.make({
              search: { query: "", at: -1, way: command === "reverse-search-history" ? "back" : "forward" },
              typed: mode,
            }),
          });
        case "complete": {
          const { candidates, word: typed } = complete(left, s.programs, s.jobs, s.talk);
          const first = candidates[0];

          if (first === undefined) {
            return bell(s);
          }

          const stem = left.slice(0, left.length - typed.length);

          if (candidates.length === 1) {
            return edit({ left: stem + first + (first.endsWith("=") ? "" : " "), right });
          }

          const prefix = shared(candidates);

          if (prefix.length > typed.length) {
            return edit({ left: stem + prefix, right });
          }

          return s.last === "complete"
            ? [s, [write({ bytes: `${leave(s)}${columns(candidates.map(clean), s.cols)}${drawn(s)}` })]]
            : bell(s);
        }

        case "interrupt": {
          const next = { ...s, mode: prompt() };
          return [next, [write({ bytes: `${leave(s).replace(/\r\n$/, "")}^C${NEWLINE}${drawn(next)}` })]];
        }

        case "end-of-file":
          return left + right === ""
            ? [{ ...s, mode: Mode.cases.ended.make({}) }, [write({ bytes: NEWLINE }), close({})]]
            : right === ""
              ? bell(s)
              : edit({ left, right: [...right].slice(1).join("") });
        case "cancel":
          return bell(s);
      }
    },
  });
};

type SearchMode = ReturnType<typeof Mode.cases.search.make>;

const inSearch = (s: Model, mode: SearchMode, key: Key): Step => {
  const newest = [...s.history].reverse();
  const change = (search: Search): Step => redraw(s, { ...s, mode: Mode.cases.search.make({ ...mode, search }) });
  const found = newest[mode.search.at];
  const restore = (line: Line): Model => ({ ...s, mode: Prompt.make({ ...mode.typed, line }) });
  return Key.match(key, {
    text: ({ text }) => {
      const query = mode.search.query + text;
      const at = found?.includes(query) ? mode.search.at : find(newest, query, 0, "back");
      return change({ ...mode.search, query, at });
    },
    unknown: (): Step => [s, []],
    command: ({ command }): Step => {
      if (command === "cancel" || command === "interrupt") {
        return redraw(s, restore(mode.typed.line));
      }

      if (command === "backward-delete-char") {
        const query = mode.search.query.slice(0, -1);
        return change({ ...mode.search, query, at: find(newest, query, 0, "back") });
      }

      if (command === "reverse-search-history" || command === "forward-search-history") {
        const way = command === "reverse-search-history" ? "back" : "forward";
        const at = find(newest, mode.search.query, mode.search.at + (way === "back" ? 1 : -1), way);
        return change({ ...mode.search, way, at: at < 0 ? mode.search.at : at });
      }

      const next = restore(found === undefined ? mode.typed.line : { left: found, right: "" });
      const [restored, cmds] = redraw(s, next);

      if (command === "accept-line") {
        if (found === undefined) {
          return [restored, cmds];
        }

        const [acceptedModel, acceptedCmds] = accepted(restored, found);
        return [acceptedModel, [...cmds, ...acceptedCmds]];
      }

      const [edited, outputs] = one(restored, key);
      return [edited, [...cmds, ...outputs]];
    },
  });
};

const one = (s: Model, key: Key): Step => {
  const command = Key.matchOrElse(key, { command: (k) => k.command }, () => null);
  const [next, outputs] = Mode.match(s.mode, {
    prompt: (mode) => atPrompt(s, mode, key),
    search: (mode) => inSearch(s, mode, key),
    busy: (): Step => [s, []],
    asking: (mode): Step => {
      const answered = (allow: boolean): Step => {
        const feedback = `  ${allow ? "y: allowed once" : "n: refused"}${NEWLINE}`;
        const bytes = s.status === null ? feedback : `\r\x1b[J${feedback}${statusRow(s.status, s.cols)}`;
        return [
          { ...s, mode: Mode.cases.busy.make({ ahead: mode.ahead, flushes: mode.flushes }) },
          [write({ bytes }), answer({ job: mode.job, allow })],
        ];
      };

      return Key.match(key, {
        text: ({ text }): Step => (/^[yn]$/i.test(text) ? answered(text.toLowerCase() === "y") : bell(s)),
        command: ({ command: action }): Step =>
          action === "interrupt" ? queued(s, mode, "\x03") : action === "accept-line" ? answered(false) : bell(s),
        unknown: () => bell(s),
      });
    },
    ended: (): Step => [s, []],
  });
  // Only a yank or yank-pop leaves a replacement span available for Alt-Y.
  const mode = Mode.matchOrElse(
    next.mode,
    { prompt: (p) => (command === "yank" || command === "yank-pop" ? p : Prompt.make({ ...p, yank: null })) },
    (m) => m,
  );
  return [{ ...next, mode, last: command }, outputs];
};

type BusyMode = ReturnType<typeof Mode.cases.busy.make>;

type Ahead = Pick<BusyMode, "ahead" | "flushes">;

const queued = (s: Model, mode: Ahead, data: string): Step => {
  if (data.includes("\x03")) {
    const rest = data.slice(data.lastIndexOf("\x03") + 1).replaceAll("\x04", "");
    const [framing] = keys.init(null, undefined);
    return [
      { ...s, framing, status: null, mode: Mode.cases.busy.make({ ahead: rest === "" ? [] : [rest], flushes: [] }) },
      [write({ bytes: `${s.status === null ? "" : "\r\x1b[J"}^C${NEWLINE}` }), interrupt({})],
    ];
  }

  const text = data.replaceAll("\x04", "");
  return [
    {
      ...s,
      mode: Mode.cases.busy.make({ ahead: text === "" ? mode.ahead : [...mode.ahead, text], flushes: mode.flushes }),
    },
    [],
  ];
};

const input = (s: Model, data: string, flush = false): Step => {
  if (Mode.guards.busy(s.mode)) {
    if (flush) {
      const text = s.mode.ahead.join("");
      const flushes =
        text.endsWith("\x1b") && s.mode.flushes.at(-1) !== text.length
          ? [...s.mode.flushes, text.length]
          : s.mode.flushes;
      return [{ ...s, mode: Mode.cases.busy.make({ ...s.mode, flushes }) }, []];
    }

    return queued(s, s.mode, data);
  }

  const [framing] = applyCell(keys, s.framing, flush ? { type: "flush" } : { type: "data", data });
  let current: Model = { ...s, framing };
  const outputs: Output[] = [];

  for (;;) {
    const event = current.framing.keys[0];

    if (event === undefined) {
      break;
    }

    const suffix = pending(current.framing);
    const [next, cmds] = one(current, event.key);
    current = next;
    outputs.push(...cmds);

    if (Mode.guards.busy(current.mode)) {
      // The child has read only this key. Its pending text is the exact untouched suffix.
      const [fresh] = keys.init(null, undefined);
      const [queuedModel, queuedCmds] = queued({ ...current, framing: fresh }, current.mode, suffix);
      current = queuedModel;
      outputs.push(...queuedCmds);
      break;
    }

    const [framing] = applyCell(keys, current.framing, { type: "data", data: "" });
    current = { ...current, framing };
  }

  return [current, outputs];
};

const ready = (s: Model, mode: Ahead): Step => {
  const [framing] = keys.init(null, undefined);
  const next: Model = { ...s, framing, mode: prompt(), status: null };
  let current = next;
  const outputs: Output[] = [write({ bytes: `${s.status === null ? "" : "\r\x1b[J"}${drawn(next)}` })];
  const text = mode.ahead.join("") + pending(s.framing);
  let from = 0;

  for (const at of mode.flushes) {
    const [after, cmds] = input(current, text.slice(from, at));
    const [flushed, more] = input(after, "", true);
    current = flushed;
    outputs.push(...cmds, ...more);
    from = at;
  }

  const [after, cmds] = input(current, text.slice(from));
  return [after, [...outputs, ...cmds]];
};

const statusRow = (text: string, cols: number): string => {
  const safe = shown(text).replaceAll(NEWLINE, " ");
  let cut = "";

  for (const char of safe) {
    if (spot(cut + char, Number.MAX_SAFE_INTEGER) >= cols - 1) {
      return `\x1b[90m${cut}…\x1b[0m`;
    }

    cut += char;
  }

  return `\x1b[90m${cut}\x1b[0m`;
};

const unchanged = (s: Model): Step => [s, []];

/** The pure S1 editor. A parent steps it; no runtime, terminal or history file is opened here. */
export const editor = Machine.make<Model, typeof Msg.Type, (typeof CMDS)[number], Sub<never>, Context>({
  model: Model,
  msg: Msg,
  cmds: CMDS,
  init: (loaded, ctx: Context): Step => {
    const limit = Math.max(1, Math.floor(ctx.historyLimit));
    const [framing] = keys.init(null, undefined);
    const s: Model = loaded ?? {
      mode: prompt(),
      history: history(ctx.history, limit),
      historyLimit: limit,
      ring: [],
      last: null,
      cols: 80,
      resized: false,
      framing,
      programs: ctx.programs,
      jobs: new Map(),
      talk: { names: [], harnesses: [] },
      status: null,
    };
    return [s, [write({ bytes: `\x1b[?2004h${drawn(s)}` })]];
  },
  update: {
    keys: (s, msg) => input(s, msg.data),
    flush: (s): Step => input(s, "", true),
    ready: (s): Step =>
      Mode.matchOrElse(
        s.mode,
        {
          busy: (mode) => ready(s, mode),
          asking: (mode) => ready(s, mode),
        },
        (): Step => [s, []],
      ),
    size: (s, msg): Step => [{ ...s, cols: Math.min(1000, Math.max(2, msg.cols)), resized: true }, []],
    printed: (s, msg): Step => {
      const text = shown(msg.text) + NEWLINE;
      return [
        s,
        [
          write({
            bytes:
              display(s) === null
                ? s.status === null
                  ? text
                  : `\r\x1b[J${text}${statusRow(s.status, s.cols)}`
                : `${backFrom(s)}\x1b[J${text}${drawn(s)}`,
          }),
        ],
      ];
    },
    table: (s, msg): Step => {
      const bytes = table(msg.table, s.cols);
      return [
        s,
        [
          write({
            bytes:
              display(s) === null
                ? s.status === null
                  ? bytes
                  : `\r\x1b[J${bytes}${statusRow(s.status, s.cols)}`
                : `${backFrom(s)}\x1b[J${bytes}${drawn(s)}`,
          }),
        ],
      ];
    },
    history: (s, msg): Step => [{ ...s, history: history(msg.lines, s.historyLimit) }, []],
    jobs: (s, msg): Step => [{ ...s, jobs: msg.jobs }, []],
    talk: (s, msg): Step => [{ ...s, talk: msg.talk }, []],
    status: (s, msg): Step =>
      display(s) === null
        ? [
            { ...s, status: msg.text },
            [write({ bytes: `\r\x1b[J${msg.text === null ? "" : statusRow(msg.text, s.cols)}` })],
          ]
        : [s, []],
    asked: (s, msg): Step =>
      Mode.matchOrElse(
        s.mode,
        {
          busy: (mode): Step =>
            msg.text === null
              ? [s, []]
              : [
                  { ...s, mode: Mode.cases.asking.make({ job: msg.job, ahead: mode.ahead, flushes: mode.flushes }) },
                  [],
                ],
          asking: (mode): Step => [
            {
              ...s,
              mode:
                msg.text === null
                  ? Mode.cases.busy.make({ ahead: mode.ahead, flushes: mode.flushes })
                  : Mode.cases.asking.make({ ...mode, job: msg.job }),
            },
            [],
          ],
        },
        (): Step => [s, []],
      ),
    ended: (s): Step => [{ ...s, mode: Mode.cases.ended.make({}) }, [write({ bytes: "\x1b[?2004l" })]],
    write_ok: unchanged,
    write_err: unchanged,
    submit_ok: unchanged,
    submit_err: unchanged,
    interrupt_ok: unchanged,
    interrupt_err: unchanged,
    close_ok: unchanged,
    close_err: unchanged,
    keep_ok: unchanged,
    keep_err: unchanged,
    answer_ok: unchanged,
    answer_err: unchanged,
  },
});
