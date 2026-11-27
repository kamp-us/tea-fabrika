// T2369 and T2380: a block of `.oxlintrc.json` that names `eslint/no-restricted-imports` drops the bans of the blocks above it unless it writes them
// again. This test asks oxlint itself whether every import ban still holds, for every tracked file, and reads which kalfa packages the kalfa product block
// reaches.
//
// What oxlint 1.90.0 does with a rule that several blocks name (a tryout, run on the lockfile's version):
// - The last block that reaches a file and names the rule gives the file that rule's entry, whole. Arrays are not joined: block 1 bans `one.ts` for
//   `**/*.ts`, block 2 bans `two.ts` for `a/**`, and in `a/x.ts` only `two.ts` is refused.
// - A block that writes only a severity (`"error"`) gives the file no options, so it drops every ban set above it. ESLint keeps the options; oxlint does not.
//   The same holds for `eslint/id-denylist`.
// - A block whose `excludeFiles` leaves a file out does not touch it: the earlier entry stays.
// - `typescript/no-restricted-imports` and the bare `no-restricted-imports` are the same rule, so a later block under any of the three names replaces the
//   earlier entry. `ruleBlocks` (one-rule.test-support.ts) reads all three, and throws on a block that writes two.
// - An entry with `allowTypeImports: true` refuses `import { x }` and lets `import type { x }` through. A later block that adds it to a ban drops the
//   type-only half.
// - A glob with no `/` reaches any depth (`excludeFiles: ["*.test.ts"]` leaves out `a/b/x.test.ts`), and a leading `./` is read too. `node:path`'s
//   `matchesGlob`, which this test uses to know which blocks reach a file, reads neither so, so the test refuses both forms (G2).
//
// So the check plants one file per set of blocks that reach some tracked file, at that file's real path, holding a value import and a type-only import
// for each ban of each of those blocks, lints it with the config's import-ban blocks alone (plant.ts, `only`), and reads which lines fired. A line that did
// not fire is a dropped ban, unless an exemption names it for that file. An exemption is a block's own comment in words: a block that lets an import in on
// purpose.
//
// Each law was planted once (the config or a function broken, the law seen red), then undone. The plants are in the commit that adds this file.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import { Array as Arr, Cause, Exit, Record as Rec, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ruleBlocks } from "./one-rule.test-support.ts";
import { plant } from "./plant.ts";

const ROOT = join(import.meta.dirname, "..");

const RULE = "eslint/no-restricted-imports";

const CODE = "eslint(no-restricted-imports)";

/** One block of `.oxlintrc.json` that sets the rule: the root `rules` is a block for every file. */
interface Block {
  readonly files: ReadonlyArray<string>;
  readonly excludeFiles: ReadonlyArray<string>;
  /** The rule's value as the block writes it: `"error"`, or `["error", { paths, patterns }]`. */
  readonly entry: unknown;
}

/** One ban: a `paths` name or a `patterns` glob, with `#name` when the entry lists `importNames`. */
interface Ban {
  /** `react#useState`, `**\/oxlint-plugins/plant.ts` */
  readonly key: string;
  /** What the planted import names: `react`, `x/oxlint-plugins/plant.ts`. */
  readonly specifier: string;
  /** `useState`: the import is `import { useState as p3 } from ...`. Null when the whole module is banned. */
  readonly name: string | null;
  /** False when the entry has `allowTypeImports: true`: it sets no type-only half. */
  readonly types: boolean;
}

type Half = "value" | "type";

/** A ban a later block lets go on purpose, for every file that block reaches: both halves, or the type-only half. */
interface Exemption {
  /** The exempting block's `files`, exactly as the config writes them. */
  readonly block: ReadonlyArray<string>;
  readonly imports: "all" | "type";
  /** Ban keys. */
  readonly bans: ReadonlyArray<string>;
  /** The block's own comment, in words. */
  readonly reason: string;
}

/** A glob that reaches no tracked file, and why it stays. */
interface Unreached {
  readonly glob: string;
  readonly reason: string;
}

/** What the check reports, one row each. */
interface Drop {
  /** The planted file: the first tracked file with this set of blocks. */
  readonly file: string;
  /** How many tracked files share that set. */
  readonly same: number;
  readonly ban: string;
  readonly imports: Half;
  /** The first block that sets it, named by its first `files` glob. */
  readonly setBy: string;
  /** The last block that reaches the file. */
  readonly last: string;
}

/** The tracked files that share one set of reaching blocks, stood for by one of them. */
interface Group {
  readonly file: string;
  readonly same: number;
  readonly blocks: ReadonlyArray<Block>;
}

// -- reading the config ---------------------------------------------------------------------------------------------------------------------

/** Every block of the config that sets the rule, in the config's order: the root entry, then each override. */
const readBlocks = (text: string): ReadonlyArray<Block> => {
  const { rules, overrides } = ruleBlocks(text, RULE);

  return [
    ...(Rec.has(rules, RULE) ? [{ files: ["**"], excludeFiles: [], entry: rules[RULE] }] : []),
    ...Arr.map(overrides, (o) => ({ files: o.files, excludeFiles: o.excludeFiles ?? [], entry: o.rules[RULE] })),
  ];
};

const matched = (globs: ReadonlyArray<string>, file: string): boolean =>
  globs.some((glob) => glob === "**" || matchesGlob(file, glob));

/** Whether the block reaches the file: the file is in its `files` and not in its `excludeFiles`. */
const reaches = (block: Block, file: string): boolean =>
  matched(block.files, file) && !matched(block.excludeFiles, file);

/** A glob the check reads as oxlint does: it has a `/` (or is `**`) and does not start with `./`. */
const readable = (glob: string): boolean => (glob === "**" || glob.includes("/")) && !glob.startsWith("./");

const blockName = (block: Block): string =>
  block.files[0] === "**" ? "the root rules" : (block.files[0] ?? "no files");

const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((glob, at) => glob === b[at]);

/** Whether a class like `[A-Z]` or `a-c` holds the character. */
const holds = (chars: string, c: string): boolean => {
  for (let at = 0; at < chars.length; at++) {
    const [from, dash, to] = [chars[at], chars[at + 1], chars[at + 2]];

    if (dash === "-" && to !== undefined && from !== undefined) {
      if (from <= c && c <= to) {
        return true;
      }

      at += 2;
    } else if (from === c) {
      return true;
    }
  }

  return false;
};

/**
 * A specifier the glob matches: `**` and `*` become `x`; a class `[A-Z]` becomes its first character, `A`; a negated class, `[!o]` or `[^o]`, becomes the
 * first of `x`, `a`, `z`, `0` it does not hold. A form this cannot sample (`?`, braces, parentheses) throws.
 */
const specifier = (glob: string): string => {
  if (/[?{}()]/.test(glob)) {
    throw new Error(`the glob ${glob} has a form the check cannot sample`);
  }

  return glob
    .replace(/\[([!^]?)([^\]]+)\]/g, (_, negated: string, chars: string) =>
      negated === "" ? (chars[0] ?? "") : (["x", "a", "z", "0"].find((c) => !holds(chars, c)) ?? ""),
    )
    .replace(/\*+/g, "x");
};

/** What one `paths` item or `patterns` item may hold, key by key: a key outside these is one the check cannot read, so the decode refuses it. */
const Names = {
  message: Schema.optional(Schema.String),
  importNames: Schema.optional(Schema.Array(Schema.String)),
  allowTypeImports: Schema.optional(Schema.Boolean),
};

const Entry = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Tuple([
    Schema.Unknown,
    Schema.optionalKey(
      Schema.Struct({
        paths: Schema.optional(
          Schema.Array(Schema.Union([Schema.String, Schema.Struct({ name: Schema.String, ...Names })])),
        ),
        patterns: Schema.optional(
          Schema.Array(Schema.Union([Schema.String, Schema.Struct({ group: Schema.Array(Schema.String), ...Names })])),
        ),
      }),
    ),
  ]),
]);

const readEntry = Schema.decodeUnknownExit(Entry, { onExcessProperty: "error" });

/**
 * Every ban an entry sets. A `!` glob lets a path back in, so it is no ban. A `paths` item may be a plain string (a name). Known keys only: the options
 * `paths` and `patterns`; a path's `name`, `message`, `importNames` and `allowTypeImports`; a pattern's `group`, `message`, `importNames` and
 * `allowTypeImports`. Any other key (`regex`, `importNamePattern`, `allowImportNames`, `caseSensitive`, ...) throws, naming `where`, so a ban the check
 * cannot read is never skipped.
 */
const readBans = (entry: unknown, where = "an entry"): ReadonlyArray<Ban> => {
  const read = readEntry(entry);

  if (Exit.isFailure(read)) {
    throw new Error(
      `${where}: the check cannot read this entry, so a ban it sets would be skipped: ${Cause.pretty(read.cause)}`,
    );
  }

  const options = typeof read.value === "object" ? read.value[1] : undefined;

  const bans = (
    globs: ReadonlyArray<string>,
    item: { readonly importNames?: ReadonlyArray<string> | undefined; readonly allowTypeImports?: boolean | undefined },
    sample: boolean,
  ): ReadonlyArray<Ban> => {
    const names = item.importNames ?? [];
    const types = item.allowTypeImports !== true;

    return Arr.flatMap(
      globs.filter((glob) => !glob.startsWith("!")),
      (glob): ReadonlyArray<Ban> => {
        const sampled = sample ? specifier(glob) : glob;

        return names.length === 0
          ? [{ key: glob, specifier: sampled, name: null, types }]
          : Arr.map(names, (name) => ({ key: `${glob}#${name}`, specifier: sampled, name, types }));
      },
    );
  };

  return [
    ...Arr.flatMap(options?.paths ?? [], (path) =>
      typeof path === "string" ? bans([path], {}, false) : bans([path.name], path, false),
    ),
    ...Arr.flatMap(options?.patterns ?? [], (pattern) =>
      typeof pattern === "string" ? bans([pattern], {}, true) : bans(pattern.group, pattern, true),
    ),
  ];
};

// -- the groups and what the planted file holds ---------------------------------------------------------------------------------------------

const TYPED = /\.(?:[cm]?ts|tsx)$/;

/** One group per set of reaching blocks, in the order the sets first appear. A file in a TypeScript form stands for its group when there is one. */
const groupFiles = (config: ReadonlyArray<Block>, files: ReadonlyArray<string>): ReadonlyArray<Group> => {
  const sets = new Map<string, { blocks: Block[]; files: string[] }>();

  for (const file of files) {
    const blocks = config.filter((block) => reaches(block, file));
    const key = blocks.map((block) => config.indexOf(block)).join(",");
    const set = sets.get(key) ?? { blocks, files: [] };

    set.files.push(file);
    sets.set(key, set);
  }

  return [...sets.values()].map(({ blocks, files: all }) => ({
    file: all.find((file) => TYPED.test(file)) ?? all[0] ?? "",
    same: all.length,
    blocks,
  }));
};

/** The bans of every block of a group, by key, with the type-only half set when any block sets it. */
const banned = (blocks: ReadonlyArray<Block>): ReadonlyArray<Ban> => {
  const all = new Map<string, Ban>();

  for (const block of blocks) {
    for (const ban of readBans(block.entry, blockName(block))) {
      const before = all.get(ban.key);
      all.set(ban.key, before === undefined ? ban : { ...before, types: before.types || ban.types });
    }
  }

  return [...all.values()];
};

/** The planted file of a group, and the line of each ban's two imports. */
const planted = (group: Group): { readonly text: string; readonly lines: ReadonlyMap<string, number> } => {
  const typed = TYPED.test(group.file);
  const lines = new Map<string, number>();
  const text: string[] = [];

  for (const [at, ban] of banned(group.blocks).entries()) {
    const imported = ban.name ?? "x";

    text.push(`import { ${imported} as p${at} } from "${ban.specifier}";`);
    lines.set(`${ban.key}|value`, text.length);

    if (ban.types && typed) {
      text.push(`import type { ${imported} as t${at} } from "${ban.specifier}";`);
      lines.set(`${ban.key}|type`, text.length);
    }
  }

  return { text: `${text.join("\n")}\n`, lines };
};

// -- what the check reports -----------------------------------------------------------------------------------------------------------------

/** Whether one planted import of a file fired. */
type Fired = (file: string, ban: string, imports: Half) => boolean;

/** Whether an exemption holds for one half of one ban in one file: its block reaches the file, and it names the ban and the half. */
const exempts = (e: Exemption, config: ReadonlyArray<Block>, file: string, ban: string, imports: Half): boolean =>
  e.bans.includes(ban) &&
  (e.imports === "all" || imports === "type") &&
  config.some((block) => same(block.files, e.block) && reaches(block, file));

/** One half of a ban: the ban's key, and whether it is the value import or the type-only one. */
interface HalfBan {
  readonly ban: string;
  readonly imports: Half;
}

/** The half-bans a block sets: each key's value half, and its type-only half when the entry does not allow type imports. */
const halves = (block: Block): ReadonlyMap<string, HalfBan> =>
  new Map(
    Arr.flatMap(readBans(block.entry, blockName(block)), (ban): ReadonlyArray<readonly [string, HalfBan]> => {
      const value = { ban: ban.key, imports: "value" as const };

      return ban.types
        ? [
            [`${ban.key}|value`, value],
            [`${ban.key}|type`, { ban: ban.key, imports: "type" }],
          ]
        : [[`${ban.key}|value`, value]];
    }),
  );

/**
 * The dropped bans: each half-ban some block above the last one that reaches the file sets, whose planted line did not fire and no exemption covers. What the
 * last block sets is not here: `unrefused` reads it. Also the exemptions that covered no drop, to be deleted.
 */
const findDrops = (
  groups: ReadonlyArray<Group>,
  fired: Fired,
  exemptions: ReadonlyArray<Exemption>,
  config: ReadonlyArray<Block>,
): { readonly drops: ReadonlyArray<Drop>; readonly unused: ReadonlyArray<Exemption> } => {
  const used = new Set<Exemption>();
  const drops: Drop[] = [];

  for (const group of groups) {
    const last = group.blocks.at(-1);

    if (last === undefined) {
      continue;
    }

    const own = halves(last);

    for (const [at, block] of group.blocks.slice(0, -1).entries()) {
      for (const [id, { ban, imports }] of halves(block)) {
        // The first block that sets the half reports it, once.
        if (own.has(id) || group.blocks.slice(0, at).some((earlier) => halves(earlier).has(id))) {
          continue;
        }

        if (fired(group.file, ban, imports)) {
          continue;
        }

        const covering = exemptions.filter((e) => exempts(e, config, group.file, ban, imports));

        for (const e of covering) {
          used.add(e);
        }

        if (covering.length === 0) {
          drops.push({
            file: group.file,
            same: group.same,
            ban,
            imports,
            setBy: blockName(block),
            last: blockName(last),
          });
        }
      }
    }
  }

  return { drops, unused: exemptions.filter((e) => !used.has(e)) };
};

/** The bans the last block of each group sets that its own planted import did not hit: the planted specifier is wrong, not the config. */
const unrefused = (groups: ReadonlyArray<Group>, fired: Fired): ReadonlyArray<string> =>
  Arr.flatMap(groups, (group) => {
    const last = group.blocks.at(-1);

    return last === undefined
      ? []
      : Arr.flatMap([...halves(last).values()], ({ ban, imports }) =>
          fired(group.file, ban, imports)
            ? []
            : [
                `${group.file}: the planted import for ${ban} (${imports}) is not refused even by the block that sets it, ${blockName(last)}`,
              ],
        );
  });

const say = (d: Drop): string =>
  `${d.file}${d.same > 1 ? ` (and ${d.same - 1} more)` : ""}: ${d.ban} (${d.imports}), set by ${d.setBy}, dropped by ${d.last}`;

// -- the real config ------------------------------------------------------------------------------------------------------------------------

/** The TOML adapter's group: the five spellings of the adapter and the settings module's own path. */
const ADAPTER_BANS = [
  "**/settings/TomlParser.ts",
  "**/settings/TomlParser",
  "@kampus/libfabrika/settings/TomlParser",
  "**/config/src/TomlParser.ts",
  "**/config/src/TomlParser",
  "@kalfa/config/TomlParser",
];

/** The helper that lints planted files (`oxlint-plugins/plant.ts`), by both spellings. */
const PLANT_BANS = ["**/oxlint-plugins/plant.ts", "**/oxlint-plugins/plant"];

/** Radix's own steps, by both spellings. */
const RADIX_BANS = ["@radix-ui/colors", "@radix-ui/colors/*"];

/** What `next/**` and the libfabrika folder ban, which a type-only import of `objects.ts` is let past (every ban of a block above it that sets the type-only half). */
const OBJECTS_BANS = [
  ...RADIX_BANS,
  "playwright#_electron",
  "@playwright/test#_electron",
  "@decimalturn/toml-patch",
  "toml-eslint-parser",
  "react#useState",
  ...PLANT_BANS,
  "@decimalturn/toml-patch/**",
  "toml-eslint-parser/**",
  ...ADAPTER_BANS,
  "./*/internal/**",
  "../*/internal/**",
  "./../*/internal/**",
  "../../*/internal/**",
  "./../../*/internal/**",
];

/**
 * A ban a later block lets go on purpose, for the files that block reaches. Each reason is the block's own comment, in words. A ban a block drops by
 * mistake is written into the block again, never listed here.
 */
const EXEMPTIONS: ReadonlyArray<Exemption> = [
  {
    block: [
      "next/apps/fabrika/dev.ts",
      "next/apps/fabrika/cli.ts",
      "next/apps/fabrika/hands.ts",
      "next/apps/fabrika/src/settings-start.integration.test.ts",
    ],
    imports: "all",
    bans: ADAPTER_BANS,
    reason: "only these start files in next/apps choose the TOML adapter; the parser stays banned there",
  },
  {
    block: [
      "next/packages/libfabrika/src/settings/**",
      "kalfa/config/src/**",
      "next/packages/libfabrika/src/node/settings/**",
    ],
    imports: "all",
    bans: ADAPTER_BANS,
    reason: "the settings module, its Node loader and kalfa/config/src take the TOML adapter",
  },
  {
    block: ["kalfa/config/src/internal/toml.ts"],
    imports: "all",
    bans: ["@decimalturn/toml-patch", "toml-eslint-parser", "@decimalturn/toml-patch/**", "toml-eslint-parser/**"],
    reason: "the TOML format file is the one file of kalfa/config that imports the parser and the serializer",
  },
  {
    block: [
      "next/apps/fabrika/src/exam/**",
      "next/apps/fabrika/src/settings-generated.test.ts",
      "next/apps/fabrika/src/build.integration.test.ts",
      "next/apps/fabrika/src/build-command.integration.test.ts",
      "next/apps/fabrika/src/instance-one-file.integration.test.ts",
    ],
    imports: "all",
    bans: PLANT_BANS,
    reason: "CI paths, law 20: the tests on the reader list in .github/ci/changes.mjs may import the plant helper",
  },
  {
    block: ["next/packages/libfabrika/src/node/build/**"],
    imports: "all",
    bans: PLANT_BANS,
    reason: "CI paths, law 20: the reader list's libfabrika folder may import the plant helper",
  },
  {
    block: ["kalfa/transport/src/cloudflare/**"],
    imports: "all",
    bans: ["alchemy", "alchemy/**", "@alchemy.run/**", "./cloudflare/**", "**/cloudflare/**"],
    reason: "the Cloudflare half of @kalfa/transport imports Alchemy and its own folder on purpose",
  },
  {
    block: ["apps/fabrika/test-window.ts"],
    imports: "all",
    bans: ["playwright#_electron", "@playwright/test#_electron"],
    reason: "today's version, ticket 733: the one file that launches a test window takes Electron",
  },
  {
    block: ["packages/fabrika-design/src/build/**"],
    imports: "all",
    bans: RADIX_BANS,
    reason: "today's version: the token build reads Radix's steps",
  },
  {
    block: ["next/packages/libfabrika/src/cloudflare/objects.ts"],
    imports: "type",
    bans: OBJECTS_BANS,
    reason: "T502: object names must not load their implementations, and type imports erase at build time",
  },
];

/** A glob of a block that reaches no tracked file today, and why it stays. */
const UNREACHED: ReadonlyArray<Unreached> = [
  {
    glob: "kalfa/ledger/src/LedgerTest.ts",
    reason:
      "slice 2 of https://github.com/kamp-us/tea-fabrika/issues/2082 (open) adds the file, and it must meet the same rules",
  },
  {
    glob: "kalfa/**/*.test.tsx",
    reason: "a React test in a kalfa package is still to come, and it must meet the same rules",
  },
];

const tracked = (): ReadonlyArray<string> =>
  execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 2 ** 26 })
    .split("\0")
    .filter((file) => file !== "");

const source = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.filter((file) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file));

const config = readBlocks(readFileSync(join(ROOT, ".oxlintrc.json"), "utf8"));

/** One oxlint run over the whole config, shared by the laws that read it. */
const run = (() => {
  let once: Promise<{ readonly groups: ReadonlyArray<Group>; readonly fired: Fired }> | undefined;

  return () => {
    once ??= (async () => {
      const groups = groupFiles(config, source(tracked()));
      const texts = groups.map((group) => ({ group, ...planted(group) }));
      const fires = await plant(Object.fromEntries(texts.map((t) => [t.group.file, t.text])), undefined, RULE);

      const at = new Map(texts.map((t) => [t.group.file, t]));

      return {
        groups,
        fired: (file: string, ban: string, imports: Half) => {
          const line = at.get(file)?.lines.get(`${ban}|${imports}`);

          return line !== undefined && fires(CODE, file).includes(line);
        },
      };
    })();

    return once;
  };
})();

describe("every import ban a block sets still holds for the files it reaches", () => {
  // Plant, run once each: deleted the new `kalfa/quality` test block; deleted the `react` entry from the `kalfa/git/src/**` block; wrote the
  // `kalfa/markdown/src/**` block's entry as plain "error"; renamed that block's rule key to `typescript/no-restricted-imports`, then to the bare name,
  // with an entry that leaves out `react`; added `allowTypeImports: true` to the `react` entry of the `kalfa/git/src/**` block.
  it("scenario: B1, oxlint refuses each planted import of each ban a block sets, as a value import and a type-only one, unless an exemption names it", async () => {
    const { groups, fired } = await run();
    const { drops } = findDrops(groups, fired, EXEMPTIONS, config);

    expect(drops.map(say)).toEqual([]);
  }, 60_000);

  // Plant, run once each: kept `[A-Z]` as written in `specifier`; read `[!o]` as its first character; kept `!` globs as bans.
  it("scenario: B2, each planted import is refused by the block that sets it, when that block is the last to reach the file", async () => {
    const { groups, fired } = await run();

    expect(unrefused(groups, fired)).toEqual([]);
  }, 60_000);

  // Plant, run once each: added an exemption for the `kalfa/records/src/**` files and `react#useState`; deleted the `next/apps` start files' TOML block
  // and kept its exemption.
  it("scenario: B3, each exemption covers at least one drop the check would report without it", async () => {
    const { groups, fired } = await run();
    const { unused } = findDrops(groups, fired, EXEMPTIONS, config);

    expect(unused.map((e) => `${e.block.join(" ")}: ${e.reason}`)).toEqual([]);
  }, 60_000);
});

describe("every glob of a block that sets the rule is one the check and oxlint read the same way, and reaches a file", () => {
  // Plant, run once each: put back `next/programs/inbox/src/**/tile.ts` in the inbox block; added an `UNREACHED` row for `kalfa/git/src/**`.
  it("scenario: G1, each `files` and `excludeFiles` glob reaches a tracked file or stands in UNREACHED with its reason, and no UNREACHED row reaches one", () => {
    const all = tracked();
    const reached = (glob: string): number => all.filter((file) => matchesGlob(file, glob)).length;

    const globs = [...new Set(config.flatMap((block) => [...block.files, ...block.excludeFiles]))].filter(
      (glob) => glob !== "**",
    );

    expect([
      ...globs
        .filter((glob) => reached(glob) === 0 && !UNREACHED.some((row) => row.glob === glob))
        .map((glob) => `${glob}: reaches no tracked file`),
      ...UNREACHED.flatMap((row) =>
        !globs.includes(row.glob)
          ? [`${row.glob}: no block names it, delete the row`]
          : reached(row.glob) > 0
            ? [`${row.glob}: reaches ${reached(row.glob)} files, delete the row`]
            : [],
      ),
    ]).toEqual([]);
  });

  // pinned: the two forms a review found oxlint reads wider than `matchesGlob` does (`*.test.ts` at any depth, `./` as the config's folder).
  // Plant, run once each: let `readable` pass a glob with no `/`; let it pass a `./` glob.
  it("pinned: G2, each glob holds a `/` or is `**`, and does not start with `./`", () => {
    expect(unreadable(config)).toEqual([]);

    const fixed = readBlocks(
      JSON.stringify({
        rules: { [RULE]: ["error", {}] },
        overrides: [
          { files: ["a/**"], excludeFiles: ["*.test.ts"], rules: { [RULE]: "error" } },
          { files: ["./a/b/y.ts", "a/b/**"], rules: { [RULE]: "error" } },
        ],
      }),
    );

    expect(unreadable(fixed)).toEqual(["*.test.ts", "./a/b/y.ts"]);
  });
});

/** The globs of the blocks that oxlint and `matchesGlob` would read differently. */
const unreadable = (blocks: ReadonlyArray<Block>): ReadonlyArray<string> =>
  [...new Set(blocks.flatMap((block) => [...block.files, ...block.excludeFiles]))].filter((glob) => !readable(glob));

describe("the kalfa product block reaches every kalfa package", () => {
  // Plant, run once each: added `kalfa/records/src/**` to the block's `excludeFiles`; put back the explicit list of packages without `kalfa/ci/src/**`.
  it("scenario: K1, every tracked file under `kalfa/<package>/src/` that is not a test is reached by the block whose `files` holds `kalfa/*/src/**`", () => {
    expect(unreached(config, source(tracked()))).toEqual([]);
  });
});

const KALFA = "kalfa/*/src/**";

/** The files of the tests the kalfa product block leaves to the kalfa test block. */
const TESTS = ["kalfa/**/*.test.ts", "kalfa/**/*.test.tsx"];

/** The non-test files under a kalfa package's `src/` that the kalfa product block does not reach, or that no such block exists. */
const unreached = (blocks: ReadonlyArray<Block>, files: ReadonlyArray<string>): ReadonlyArray<string> => {
  const product = blocks.filter((block) => block.files.includes(KALFA));

  if (product.length !== 1 || product[0] === undefined) {
    return [`no block holds ${KALFA}: ${product.length} do`];
  }

  const [block] = product;

  return files.filter((file) => matchesGlob(file, KALFA) && !matched(TESTS, file) && !reaches(block, file));
};

// -- the readers, pinned ----------------------------------------------------------------------------------------------------------------------

/** A config text with the rule written under the given name in each block, comments allowed. */
const TYPESCRIPT = "typescript/no-restricted-imports";

const BARE = "no-restricted-imports";

const configWith = (names: ReadonlyArray<string>): string =>
  `{
    // the base entry
    "rules": { "${names[0]}": ["error", { "paths": ["root"] }] },
    "overrides": [
      ${names
        .slice(1)
        .map(
          (name, at) =>
            `{ "files": ["a/${at}/**"], "excludeFiles": ["a/${at}/x.ts"], "rules": { "${name}": ["error", { "paths": ["b${at}"] }], "eqeqeq": "error" } }`,
        )
        .join(",\n")}
    ]
  }`;

describe("the readers", () => {
  // pinned: oxlint 1.90 reads three names as one rule (the review's tryout). Plant, run once each: read only the asked name in `ruleBlocks`; take the first
  // name of a block that writes two.
  it("pinned: B5, ruleBlocks reads the rule under each of its three names, and throws on a block that writes two", () => {
    const read = readBlocks(configWith([TYPESCRIPT, BARE, RULE, TYPESCRIPT]));

    expect(read.map((block) => [block.files, block.excludeFiles, readBans(block.entry).map((ban) => ban.key)])).toEqual(
      [
        [["**"], [], ["root"]],
        [["a/0/**"], ["a/0/x.ts"], ["b0"]],
        [["a/1/**"], ["a/1/x.ts"], ["b1"]],
        [["a/2/**"], ["a/2/x.ts"], ["b2"]],
      ],
    );

    for (const [a, b] of [
      [RULE, TYPESCRIPT],
      [RULE, BARE],
      [TYPESCRIPT, BARE],
    ]) {
      const both = `{ "overrides": [{ "files": ["a/**"], "rules": { "${a}": "error", "${b}": "error" } }] }`;

      expect(() => readBlocks(both)).toThrow(/twice/);
      expect(() => readBlocks(`{ "rules": { "${a}": "error", "${b}": "error" } }`)).toThrow(/twice/);
    }
  });

  // Plant, run once each: skipped unknown keys in `readBans`; let a `patterns` item's unknown key through.
  it("pinned: B5, readBans reads each known key, and throws on any other", () => {
    const entry = [
      "error",
      {
        paths: [
          "plain",
          { name: "named", message: "m", importNames: ["a", "b"] },
          { name: "wide", allowTypeImports: true },
        ],
        patterns: [
          { group: ["m/**", "!n/**"], message: "m" },
          "q/[A-Z]*",
          { group: ["@o/[!o]*", "r/[^o]", "s/[a-c]"], allowTypeImports: true, importNames: ["z"] },
        ],
      },
    ];

    expect(readBans(entry).map((ban) => [ban.key, ban.specifier, ban.name, ban.types])).toEqual([
      ["plain", "plain", null, true],
      ["named#a", "named", "a", true],
      ["named#b", "named", "b", true],
      ["wide", "wide", null, false],
      ["m/**", "m/x", null, true],
      ["q/[A-Z]*", "q/Ax", null, true],
      ["@o/[!o]*#z", "@o/xx", "z", false],
      ["r/[^o]#z", "r/x", "z", false],
      ["s/[a-c]#z", "s/a", "z", false],
    ]);
    expect(readBans("error")).toEqual([]);
    expect(readBans(["error"])).toEqual([]);

    for (const bad of [
      ["error", { paths: [{ name: "a", regex: "b" }] }],
      ["error", { patterns: [{ group: ["a"], importNamePattern: "b" }] }],
      ["error", { patterns: [{ group: ["a"], caseSensitive: true }] }],
      ["error", { paths: [], other: [] }],
    ]) {
      expect(() => readBans(bad, "a block")).toThrow(/cannot read this entry/);
    }
  });
});

// -- findDrops, over made-up configs -----------------------------------------------------------------------------------------------------------

const SEED = 119120;

const RUNS = 100;

const WORLD = ["a/x.ts", "a/b/y.ts", "c/z.ts"];

const FOLDERS = ["a/**", "a/b/**", "c/**"];

const KEYS = ["m0", "m1", "m2", "m3", "m4"];

/** The folder a made-up glob stands for: `a/b/**` reaches the files that start with `a/b/`. */
const under = (glob: string, file: string): boolean => file.startsWith(glob.slice(0, -2));

interface Made {
  readonly files: ReadonlyArray<string>;
  /** Index 0 is the root entry; each other block has `files` of the three folders and maybe `excludeFiles`. */
  readonly blocks: ReadonlyArray<{
    readonly files: ReadonlyArray<string>;
    readonly excludeFiles: ReadonlyArray<string>;
    readonly bans: ReadonlyArray<readonly [string, boolean]>;
  }>;
  readonly exemptions: ReadonlyArray<{
    readonly block: number;
    readonly imports: "all" | "type";
    readonly bans: ReadonlyArray<string>;
  }>;
  /** One bit for each file, key and half: whether that planted import fired. */
  readonly bits: ReadonlyArray<boolean>;
}

const bans = fc.uniqueArray(fc.tuple(fc.constantFrom(...KEYS), fc.boolean()), {
  maxLength: 4,
  selector: ([key]) => key,
});

const made: fc.Arbitrary<Made> = fc.record({
  files: fc.subarray(WORLD, { minLength: 1 }),
  blocks: fc
    .tuple(
      fc.record({ files: fc.constant(["**"]), excludeFiles: fc.constant([]), bans }),
      fc.array(
        fc.record({
          files: fc.uniqueArray(fc.constantFrom(...FOLDERS), { minLength: 1, maxLength: 2 }),
          excludeFiles: fc.uniqueArray(fc.constantFrom(...FOLDERS), { maxLength: 1 }),
          bans,
        }),
        { minLength: 2, maxLength: 4 },
      ),
    )
    .map(([root, rest]) => [root, ...rest]),
  exemptions: fc.array(
    fc.record({
      block: fc.nat(3),
      imports: fc.constantFrom("all" as const, "type" as const),
      bans: fc.uniqueArray(fc.constantFrom(...KEYS), { minLength: 1, maxLength: 3 }),
    }),
    { maxLength: 2 },
  ),
  bits: fc.array(fc.boolean(), {
    minLength: WORLD.length * KEYS.length * 2,
    maxLength: WORLD.length * KEYS.length * 2,
  }),
});

/** The config of a made-up draw, as `readBlocks` would read it: an entry with no ban is a severity alone. */
const buildConfig = (m: Made): ReadonlyArray<Block> =>
  m.blocks.map((block) => ({
    ...block,
    entry:
      block.bans.length === 0
        ? "error"
        : [
            "error",
            { paths: block.bans.map(([name, types]) => (types ? { name } : { name, allowTypeImports: true })) },
          ],
  }));

const buildExemptions = (m: Made): ReadonlyArray<Exemption> =>
  m.exemptions.map((e) => ({
    block: m.blocks[1 + (e.block % (m.blocks.length - 1))]?.files ?? [],
    imports: e.imports,
    bans: e.bans,
    reason: "made up",
  }));

/** The ways a wrong `findDrops` would differ, one for each class of the plan's generators; the answer of a made-up draw is read with each in turn. */
const FLAWS = {
  a: "excludeFiles is not read",
  b: "exemptions are dropped",
  c: "an exemption holds by its ban alone",
  d: "an exemption holds by its block alone",
  e: "an unused exemption is not reported",
  f: "the root entry is skipped",
  g: "allowTypeImports is not read",
  h: "every exemption holds for both halves",
} as const;

type Flaw = keyof typeof FLAWS;

/** The answer of a draw, worked out from its folders alone: the drops as `file|ban|half`, and the exemptions that cover no drop. With a flaw, the answer a wrong `findDrops` would give. */
const answer = (
  m: Made,
  flaw?: Flaw,
): { readonly drops: ReadonlyArray<string>; readonly unused: ReadonlyArray<number> } => {
  const exemptions = flaw === "b" ? [] : buildExemptions(m);

  const reach = (at: number, file: string): boolean => {
    const block = m.blocks[at];

    return (
      block !== undefined &&
      (at === 0 ? flaw !== "f" : block.files.some((glob) => under(glob, file))) &&
      (flaw === "a" || !block.excludeFiles.some((glob) => under(glob, file)))
    );
  };

  const sets = (at: number, key: string, half: Half): boolean =>
    m.blocks[at]?.bans.some(([name, types]) => name === key && (half === "value" || types || flaw === "g")) ?? false;

  const covers = (e: Exemption, file: string, key: string, half: Half): boolean =>
    (flaw === "d" || e.bans.includes(key)) &&
    (flaw === "h" || e.imports === "all" || half === "type") &&
    (flaw === "c" || m.blocks.some((block, at) => at > 0 && same(block.files, e.block) && reach(at, file)));

  const drops = new Set<string>();
  const used = new Set<Exemption>();

  // Files with the same reaching blocks are one planted file: the first of them stands for the rest.
  const seen = new Set<string>();

  for (const file of m.files) {
    const reaching = m.blocks.flatMap((_, at) => (reach(at, file) ? [at] : []));
    const last = reaching.at(-1);

    if (seen.has(reaching.join(","))) {
      continue;
    }

    seen.add(reaching.join(","));

    for (const [keyAt, key] of KEYS.entries()) {
      for (const half of ["value", "type"] as const) {
        const wanted =
          last !== undefined &&
          reaching.slice(0, -1).some((at) => sets(at, key, half)) &&
          !sets(last, key, half) &&
          !(m.bits[(WORLD.indexOf(file) * KEYS.length + keyAt) * 2 + (half === "type" ? 1 : 0)] ?? false);

        if (wanted) {
          const covering = exemptions.filter((e) => covers(e, file, key, half));

          for (const e of covering) {
            used.add(e);
          }

          if (covering.length === 0) {
            drops.add(`${file}|${key}|${half}`);
          }
        }
      }
    }
  }

  return {
    drops: [...drops].sort(),
    unused: flaw === "e" ? [] : exemptions.flatMap((e, at) => (used.has(e) ? [] : [at])),
  };
};

describe("findDrops", () => {
  // Plants, run once each, one for each class of the draw (a to h, in FLAWS): `reaches` reads `files` and skips `excludeFiles`; `findDrops` skips the
  // exemptions; matches an exemption by its ban alone; by its block alone; never reports an unused exemption; `reaches` says false for the root entry;
  // `halves` ignores `types`; `exempts` reads every exemption as `all`.
  it("B4: reports exactly the drops and unused exemptions the draw's own answer holds", () => {
    const tally = new Map<string, number>();

    fc.assert(
      fc.property(made, (m) => {
        const config = buildConfig(m);
        const groups = groupFiles(config, m.files);
        const exemptions = buildExemptions(m);

        const { drops, unused } = findDrops(
          groups,
          (file, key, half) =>
            m.bits[(WORLD.indexOf(file) * KEYS.length + KEYS.indexOf(key)) * 2 + (half === "type" ? 1 : 0)] ?? false,
          exemptions,
          config,
        );

        const right = answer(m);

        for (const flaw of Rec.keys(FLAWS)) {
          const wrong = answer(m, flaw);

          if (JSON.stringify(wrong) !== JSON.stringify(right)) {
            tally.set(flaw, (tally.get(flaw) ?? 0) + 1);
          }
        }

        tally.set("case", (tally.get("case") ?? 0) + 1);

        expect(Arr.map(drops, (d) => `${d.file}|${d.ban}|${d.imports}`).sort()).toEqual(right.drops);
        expect(unused.map((e) => exemptions.indexOf(e))).toEqual(right.unused);
      }),
      { seed: SEED, numRuns: RUNS },
    );

    // Each class of the draw must be reached, but only a full run can say so: a capped run (the mutation box's) draws too few cases to reach every
    // class, so it skips the kinds. Both numbers are asserted, so a lost counter, a gate that moved or a count that changed fails here and never skips quietly.
    const drawn = tally.get("case") ?? 0;
    const cap = Number(process.env.MUTATE_RUNS) || RUNS;

    expect(drawn, "B4 drew its cases").toBe(Math.min(RUNS, cap));

    if (cap >= RUNS) {
      expect(
        Rec.keys(FLAWS).filter((flaw) => (tally.get(flaw) ?? 0) === 0),
        "B4 reached each class of the draw",
      ).toEqual([]);
    }
  });
});
