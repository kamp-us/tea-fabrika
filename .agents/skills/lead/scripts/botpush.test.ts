import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const options = { seed: 119120, numRuns: 10 };

const word = fc.stringMatching(/^[a-z]{8,12}$/).map((s) => `private_${s}`);

const ranges = ["tip", "saved", "diverged", "undone", "held"] as const;

const input = fc.record({ word, leak: fc.boolean(), range: fc.constantFrom(...ranges), notes: fc.boolean() });

// Real Git and real caller. Only keychain, HTTP and network Git are replaced. The RSA key exists
// only in this child process's memory. No real key file, login or network request is touched.
const shim = `
import cp from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const real = cp.execFileSync;
// TEST_CALLS, when set, names a file that gets one JSON line per keychain read and per network Git call.
const log = (line) => { if (process.env.TEST_CALLS) appendFileSync(process.env.TEST_CALLS, JSON.stringify(line) + '\\n'); };
cp.execFileSync = (cmd, args, options) => {
  if (cmd === 'security') {
    log({security: true});
    // TEST_SECURITY: a Linux box has no security command (ENOENT); a Mac can lack the item (exit 44). Both messages carry a made-up marker that must never be printed.
    if (process.env.TEST_SECURITY === 'missing') { const e = new Error('spawnSync security ENOENT KEY-MARKER'); e.code = 'ENOENT'; throw e; }
    if (process.env.TEST_SECURITY === 'no-item') { const e = new Error('Command failed: security find-generic-password KEY-MARKER'); e.status = 44; throw e; }
    return Buffer.from(generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}}).privateKey);
  }
  if (cmd === 'git' && args.includes('ls-remote')) { log({lsRemote: true}); return Buffer.from(''); }
  if (cmd === 'git' && args.includes('push')) { log({push: args.slice(args.indexOf('push') + 1)}); appendFileSync(process.env.TEST_PUSH_LOG, 'push\\n'); return Buffer.from(''); }
  if (cmd === 'git' && args.includes('fetch')) { log({fetch: true}); throw new Error('unexpected network Git'); }
  if (cmd === 'git' && args.includes('notes') && args.includes('merge')) log({notesMerge: true});
  return real(cmd, args, options);
};
globalThis.fetch = async (url) => { log({http: String(url)}); return {ok: true, json: async () => String(url).endsWith('access_tokens') ? {token: 'made-up', expires_at: 'never'} : {id: 1}}; };
syncBuiltinESMExports();
`;

describe("T325 K6 botpush, today's tooling", () => {
  // Each case runs in a tree with step notes and in one without (decisions 0161 and 0164: plain
  // commits). Plants: omit the leakgrep call (the "held" range, a leak in a commit an origin ref
  // already holds, is the one only it catches); omit its --commits call; skip both leak greps when
  // the tree has no step notes. Removed private text and the repo URL must still push.
  it("scans every submitted commit from the merge base at the requested source", () => {
    fc.assert(
      fc.property(input, ({ word, leak, range, notes }) => {
        const dir = mkdtempSync(join(tmpdir(), "push-"));

        try {
          const scripts = join(dir, ".agents/skills/lead/scripts");
          mkdirSync(scripts, { recursive: true });

          for (const file of ["botpush.mjs", "leakgrep.sh"]) {
            cpSync(join(import.meta.dirname, file), join(scripts, file));
          }

          writeFileSync(join(dir, "shim.mjs"), shim);
          const words = join(tmpdir(), `words-${dir.split("/").at(-1)}`);
          writeFileSync(words, `${word}\n${"https://github.com/usirin/tea-fabrika".split("/").slice(-2).join("\n")}\n`);

          try {
            const git = (...args: string[]) => {
              const out = spawnSync(
                "git",
                [
                  "-c",
                  "user.name=fabrikalfa[bot]",
                  "-c",
                  "user.email=353269643+fabrikalfa[bot]@users.noreply.github.com",
                  ...args,
                ],
                { cwd: dir, encoding: "utf8" },
              );

              expect(out.status, out.stderr).toBe(0);

              return out.stdout.trim();
            };

            git("init", "-q");
            // A leaked case must add the word; a clean case must remove it.
            writeFileSync(join(dir, "subject.md"), `${leak ? "safe base" : word}\n`);
            git("add", "subject.md");
            git("commit", "-qm", "base");
            git("update-ref", "refs/remotes/origin/main", "HEAD");
            writeFileSync(
              join(dir, "subject.md"),
              `https://github.com/usirin/tea-fabrika/pull/532\n${leak ? word : "safe addition"}\n`,
            );
            git("add", "subject.md");
            git("commit", "-qm", "change");
            const source = git("rev-parse", "HEAD");

            if (range === "diverged") {
              const text = readFileSync(join(dir, "subject.md"), "utf8");
              git("checkout", "-qb", "upstream", "HEAD^");
              writeFileSync(join(dir, "subject.md"), text);
              writeFileSync(join(dir, "upstream.md"), "safe upstream\n");
              git("add", "subject.md", "upstream.md");
              git("commit", "-qm", "independent upstream change");
              git("update-ref", "refs/remotes/origin/main", "HEAD");
              git("checkout", "--detach", source);
            }

            // The change commit is one an origin ref already holds, so the per-commit grep (--commits
            // ... --not --remotes=origin) skips it, and only the net diff from origin/main carries it.
            if (range === "held") {
              git("update-ref", "refs/remotes/origin/held", "HEAD");
            }

            // Decision 0048: each commit is read on its own, so a later commit changes no answer.
            if (range === "undone") {
              writeFileSync(join(dir, "subject.md"), "safe again\n");
              git("add", "subject.md");
              git("commit", "-qm", "the next commit takes the change back");
            }

            writeFileSync(join(dir, "tip.md"), "safe followup\n");
            git("add", "tip.md");
            git("commit", "-qm", "safe followup");

            if (range === "saved") {
              writeFileSync(join(dir, "subject.md"), `${leak ? "safe after source" : word}\n`);
              git("add", "subject.md");
              git("commit", "-qm", "opposite result after source");
            }

            const sourceArgs = range === "saved" ? [source] : [];

            if (notes) {
              git("notes", "--ref=fabrika", "add", "-m", "throwaway");
            }

            const pushed = join(dir, "pushed");
            writeFileSync(pushed, "");

            const out = spawnSync(
              process.execPath,
              ["--import", join(dir, "shim.mjs"), join(scripts, "botpush.mjs"), dir, "fabrikalfa/test", ...sourceArgs],
              {
                cwd: dir,
                encoding: "utf8",
                timeout: 10_000,
                env: {
                  ...process.env,
                  GH_REPO: "example/repo",
                  FABRIKA_LEAK_WORDS: words,
                  TEST_PUSH_LOG: pushed,
                  TYPESAFE_API_KEY: undefined,
                },
              },
            );

            expect(out.error).toBeUndefined();
            expect({ code: out.status, pushed: readFileSync(pushed, "utf8") }, out.stdout + out.stderr).toEqual({
              code: leak ? 1 : 0,
              pushed: leak ? "" : "push\n",
            });
            // A refusing shared checker must stop this caller even when its text is safe.
            writeFileSync(join(scripts, "leakgrep.sh"), "#!/bin/sh\necho 'leakgrep: planted refusal' >&2\nexit 1\n");
            writeFileSync(pushed, "");

            const refused = spawnSync(
              process.execPath,
              ["--import", join(dir, "shim.mjs"), join(scripts, "botpush.mjs"), dir, "fabrikalfa/test", ...sourceArgs],
              {
                cwd: dir,
                encoding: "utf8",
                env: {
                  ...process.env,
                  GH_REPO: "example/repo",
                  FABRIKA_LEAK_WORDS: words,
                  TEST_PUSH_LOG: pushed,
                  TYPESAFE_API_KEY: undefined,
                },
              },
            );

            expect(refused.status).toBe(1);
            expect(readFileSync(pushed, "utf8")).toBe("");
          } finally {
            rmSync(words, { force: true });
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      {
        ...options,
        // numRuns must cover every pinned example, or fast-check drops the ones past it.
        numRuns: 24,
        // pinned: earlier commits, a saved source and diverged main must all be scanned, in a tree with
        // step notes and in one without.
        examples: ranges.flatMap((range) =>
          [true, false].flatMap((notes) =>
            [true, false].map(
              (leak) =>
                // SAFETY: each example is one record of `input`: a word, two booleans and a range.
                [{ word: "private_aaaaaaaa", leak, range, notes }] as [
                  typeof input extends fc.Arbitrary<infer T> ? T : never,
                ],
            ),
          ),
        ),
      },
    );
  });
});

// A real bare repository stands in for GitHub. The shim sends botpush's Git there and, before each
// of the first `races` pushes, has "another session" push a note to it, so the notes botpush merged
// are stale by the time it pushes. ci375 build, 2026-11-09: GitHub refused the -wip push with
// "cannot lock ref 'refs/notes/fabrika'" and a hand rerun worked (ticket 388).
const raceShim = `
import cp from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {appendFileSync, readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const real = cp.execFileSync;
const remote = process.env.TEST_REMOTE;
const races = Number(process.env.TEST_RACES);
const asGithub = process.env.TEST_SERVER === 'github';
cp.execFileSync = (cmd, args, options) => {
  if (cmd === 'security') return Buffer.from(generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}}).privateKey);
  if (cmd !== 'git') return real(cmd, args, options);
  args = args.map((a) => (a === 'https://github.com/example/repo.git' ? remote : a));
  if (args.includes('push')) {
    const n = readFileSync(process.env.TEST_PUSH_LOG, 'utf8').split('\\n').filter(Boolean).length;
    appendFileSync(process.env.TEST_PUSH_LOG, 'push\\n');
    if (n < races) {
      real('git', ['--git-dir', remote, '-c', 'user.name=Other', '-c', 'user.email=other@example.invalid', 'notes', '--ref=fabrika', 'append', '-m', 'race ' + n, process.env.TEST_BASE]);
      if (asGithub && process.env.TEST_BRANCH_REFUSED !== 'true') {
        const e = new Error('push failed');
        // format: GitHub's own words for the race, as the ci375 build's drive log saved them.
        e.stderr = Buffer.from(' ! [remote rejected]   ' + process.env.TEST_SOURCE + ' -> fabrikalfa/test (failed)\\n ! [remote rejected]   refs/notes/fabrika -> refs/notes/fabrika (cannot lock ref \\'refs/notes/fabrika\\': is at a71902ce904538345e9415c9d652a017f5b66416 but expected dd4346f8544fd6b2fc05085a17b832b7b4e4b44f)\\nerror: failed to push some refs\\n');
        throw e;
      }
    }
  }
  return real('git', args, options);
};
globalThis.fetch = async (url) => ({ok: true, json: async () => String(url).endsWith('access_tokens') ? {token: 'made-up', expires_at: 'never'} : {id: 1}});
syncBuiltinESMExports();
`;

const race = fc.record({
  server: fc.constantFrom("git", "github"),
  races: fc.constantFrom(0, 1, 2),
  branchRefused: fc.boolean(),
});

describe("T388 botpush retries a notes race once, today's tooling", () => {
  // Plants: no retry; retry on any refusal; retry more than once; force the notes.
  it("pushes again once when only the notes went stale, and never on any other refusal", () => {
    fc.assert(
      fc.property(race, ({ server, races, branchRefused }) => {
        const dir = mkdtempSync(join(tmpdir(), "race-"));

        try {
          const scripts = join(dir, "work/.agents/skills/lead/scripts");
          mkdirSync(scripts, { recursive: true });

          for (const file of ["botpush.mjs", "leakgrep.sh"]) {
            cpSync(join(import.meta.dirname, file), join(scripts, file));
          }

          writeFileSync(join(dir, "shim.mjs"), raceShim);
          writeFileSync(join(dir, "words"), "private_zzzzzzzz\n");
          const work = join(dir, "work");
          const remote = join(dir, "remote.git");

          const run = (cwd: string, ...args: string[]) => {
            const out = spawnSync(
              "git",
              [
                "-c",
                "user.name=fabrikalfa[bot]",
                "-c",
                "user.email=353269643+fabrikalfa[bot]@users.noreply.github.com",
                ...args,
              ],
              {
                cwd,
                encoding: "utf8",
              },
            );

            expect(out.status, out.stderr).toBe(0);

            return out.stdout.trim();
          };

          run(dir, "init", "-q", "--bare", remote);
          run(work, "init", "-q");
          writeFileSync(join(work, "a.md"), "base\n");
          run(work, "add", "a.md");
          run(work, "commit", "-qm", "base");
          const base = run(work, "rev-parse", "HEAD");
          run(work, "push", "-q", remote, "HEAD:refs/heads/main");
          run(work, "update-ref", "refs/remotes/origin/main", base);

          if (branchRefused) {
            // The remote branch holds a commit the source lacks: a real refusal.
            writeFileSync(join(work, "other.md"), "other\n");
            run(work, "add", "other.md");
            run(work, "commit", "-qm", "elsewhere");
            run(work, "push", "-q", remote, "HEAD:refs/heads/fabrikalfa/test");
            run(work, "reset", "-q", "--hard", base);
          }

          writeFileSync(join(work, "a.md"), "step\n");
          run(work, "add", "a.md");
          run(work, "commit", "-qm", "step");
          const source = run(work, "rev-parse", "HEAD");
          run(work, "notes", "--ref=fabrika", "add", "-m", "signed", source);

          const tipOf = () =>
            spawnSync(
              "git",
              ["--git-dir", remote, "rev-parse", "-q", "--verify", "refs/heads/fabrikalfa/test^{commit}"],
              { encoding: "utf8" },
            ).stdout.trim();

          const before = tipOf();
          const pushed = join(dir, "pushed");
          writeFileSync(pushed, "");

          const out = spawnSync(
            process.execPath,
            ["--import", join(dir, "shim.mjs"), join(scripts, "botpush.mjs"), work, "fabrikalfa/test"],
            {
              cwd: work,
              encoding: "utf8",
              timeout: 20_000,
              env: {
                ...process.env,
                GH_REPO: "example/repo",
                FABRIKA_LEAK_WORDS: join(dir, "words"),
                TEST_PUSH_LOG: pushed,
                TEST_REMOTE: remote,
                TEST_RACES: String(races),
                TEST_SERVER: server,
                TEST_BASE: base,
                TEST_SOURCE: source,
                TEST_BRANCH_REFUSED: String(branchRefused),
                TYPESAFE_API_KEY: undefined,
              },
            },
          );

          expect(out.error).toBeUndefined();
          const pushes = readFileSync(pushed, "utf8").split("\n").filter(Boolean).length;
          const tip = tipOf();
          const lands = !branchRefused && races <= 1;
          expect({ code: out.status, pushes }, out.stdout + out.stderr).toEqual({
            code: lands ? 0 : 1,
            // A real refusal is never retried; a race is retried once, never twice.
            pushes: branchRefused ? 1 : Math.min(races, 1) + 1,
          });
          expect(tip).toBe(lands ? source : before);

          if (lands) {
            // Nothing forced: the other session's notes are kept beside ours.
            const notes = (sha: string) =>
              spawnSync("git", ["--git-dir", remote, "notes", "--ref=fabrika", "show", sha], {
                encoding: "utf8",
              }).stdout;

            expect(notes(source)).toContain("signed");

            if (races > 0) {
              expect(notes(base)).toContain("race 0");
            }
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      {
        seed: 119120,
        numRuns: 12,
        // scenario: each mix of server words, race count and a real branch refusal runs once.
        examples: (["git", "github"] as const).flatMap((server) =>
          ([0, 1, 2] as const).flatMap((races) =>
            [false, true].map(
              (branchRefused) =>
                // SAFETY: each example is one record of `race`: a server word, a race count
                // of 0 to 2 and a boolean, the three fields `race` draws.
                [{ server, races, branchRefused }] as [typeof race extends fc.Arbitrary<infer T> ? T : never],
            ),
          ),
        ),
      },
    );
  }, 300_000);
});

// A tree one commit ahead of origin/main, with step notes or without, and a run of botpush on it
// under the first shim. The shim's call log says what reached the keychain and the network.
// `by` makes the step commit with another git identity, as a hand `git merge` with the person's
// config did on 2026-11-18; the bot's when absent.
type Tree = {
  notes: boolean;
  branch: string;
  src?: string;
  security?: "missing" | "no-item";
  by?: { readonly author: string; readonly committer: string };
};

// One line of the shim's call log.
type Call = { security?: true; lsRemote?: true; fetch?: true; notesMerge?: true; http?: string; push?: string[] };

type Ran = { code: number | null; text: string; stderr: string; calls: Call[] };

const runTree = ({ notes, branch, src, security, by }: Tree): Ran => {
  const dir = mkdtempSync(join(tmpdir(), "nonotes-"));
  // The leak words stay outside the tree, as the checker requires.
  const words = join(tmpdir(), `words-${dir.split("/").at(-1)}`);

  try {
    const scripts = join(dir, ".agents/skills/lead/scripts");
    mkdirSync(scripts, { recursive: true });

    for (const file of ["botpush.mjs", "leakgrep.sh"]) {
      cpSync(join(import.meta.dirname, file), join(scripts, file));
    }

    writeFileSync(join(dir, "shim.mjs"), shim);
    writeFileSync(words, "private_zzzzzzzz\n");

    const git = (...args: string[]) => {
      const out = spawnSync(
        "git",
        [
          "-c",
          "user.name=fabrikalfa[bot]",
          "-c",
          "user.email=353269643+fabrikalfa[bot]@users.noreply.github.com",
          ...args,
        ],
        {
          cwd: dir,
          encoding: "utf8",
        },
      );

      expect(out.status, out.stderr).toBe(0);

      return out.stdout.trim();
    };

    git("init", "-q");
    writeFileSync(join(dir, "a.md"), "base\n");
    git("add", "a.md");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(dir, "a.md"), "step\n");
    git("add", "a.md");

    if (by === undefined) {
      git("commit", "-qm", "step");
    } else {
      // Each identity keeps its own email: the bot's noreply address, or a person's.
      const email = (name: string) =>
        name === "fabrikalfa[bot]" ? "353269643+fabrikalfa[bot]@users.noreply.github.com" : "someone@example.invalid";

      git(
        "-c",
        `user.name=${by.committer}`,
        "-c",
        `user.email=${email(by.committer)}`,
        "commit",
        "-qm",
        "step",
        `--author=${by.author} <${email(by.author)}>`,
      );
    }

    if (notes) {
      git("notes", "--ref=fabrika", "add", "-m", "signed");
    }

    const calls = join(dir, "calls");
    const pushed = join(dir, "pushed");
    writeFileSync(calls, "");
    writeFileSync(pushed, "");

    const out = spawnSync(
      process.execPath,
      ["--import", join(dir, "shim.mjs"), join(scripts, "botpush.mjs"), dir, branch, ...(src ? [src] : [])],
      {
        cwd: dir,
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          GH_REPO: "example/repo",
          FABRIKA_LEAK_WORDS: words,
          TEST_CALLS: calls,
          TEST_PUSH_LOG: pushed,
          TEST_SECURITY: security,
          TYPESAFE_API_KEY: undefined,
        },
      },
    );

    expect(out.error).toBeUndefined();

    return {
      code: out.status,
      text: out.stdout + out.stderr,
      stderr: out.stderr,
      calls: readFileSync(calls, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    };
  } finally {
    rmSync(words, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
};

const notesRef = "refs/notes/fabrika:refs/notes/fabrika";

const pushes = (ran: Ran) => ran.calls.flatMap((c) => (c.push ? [c.push] : []));

const named = (ran: Ran, key: keyof Call) => ran.calls.filter((c) => key in c);

describe("T1610 botpush pushes the notes a tree has, and a plain branch when it has none", () => {
  // B1 and B2. Every commit is plain (decisions 0161 and 0164), so a tree with no step notes is the
  // usual case. Plants: restore the notes refusal (no notes then exits 1 and pushes nothing); always
  // include the notes refspec (the no-notes push then names refs/notes/fabrika); fetch or merge the
  // remote's notes with no notes of our own; drop --atomic or the notes refspec from the with-notes
  // push.
  it("B1 B2 pushes the branch alone without notes, and the notes with the branch atomically with them", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{1,10}$/), fc.boolean(), fc.boolean(), (name, notes, explicit) => {
        const branch = `fabrikalfa/${name}`;
        const ran = runTree({ notes, branch, src: explicit ? "HEAD" : undefined });
        const url = "https://github.com/example/repo.git";

        expect(ran.code, ran.text).toBe(0);
        // B1: one push, one refspec for the branch, and the remote's notes never listed, fetched or merged.
        // B2: with notes, the one atomic push holds the notes first and the branch second.
        expect(pushes(ran)).toEqual([
          notes
            ? ["--atomic", url, notesRef, `HEAD:refs/heads/${branch}`]
            : ["--atomic", url, `HEAD:refs/heads/${branch}`],
        ]);
        expect(
          {
            lsRemote: named(ran, "lsRemote").length,
            fetch: named(ran, "fetch").length,
            merge: named(ran, "notesMerge").length,
          },
          ran.text,
        ).toEqual({ lsRemote: notes ? 1 : 0, fetch: 0, merge: 0 });
        expect(ran.text).toContain(notes ? `pushed ${branch} as fabrikalfa[bot];` : "without step notes");
      }),
      {
        ...options,
        examples: [
          ["one", false, false],
          ["one", false, true],
          ["one", true, false],
          ["one", true, true],
        ],
      },
    );
  }, 60_000);

  // B3. A notes-only push of a tree with no notes has nothing to send. Plant: let "-" through when
  // there are no notes (it then reads the keychain and calls the network).
  it("B3 scenario: branch - with no step notes refuses before any keychain read or network call", () => {
    const ran = runTree({ notes: false, branch: "-" });

    expect(ran.code, ran.text).toBe(1);
    expect(ran.stderr.trim()).toBe("botpush: no step notes to push (no refs/notes/fabrika here)");
    expect(ran.calls).toEqual([]);
  });

  // The same branch "-" with notes still pushes the notes alone, as before.
  it("B3 scenario: branch - with step notes pushes only the notes", () => {
    const ran = runTree({ notes: true, branch: "-" });

    expect(ran.code, ran.text).toBe(0);
    expect(pushes(ran)).toEqual([["--atomic", "https://github.com/example/repo.git", notesRef]]);
  });

  // B5. No keychain (a Linux box) or no item: one plain line and exit 1, the error never printed,
  // nothing pushed, in both kinds of tree. Plant: let the raw error throw (a stack trace, and the
  // error's own words, reach the output).
  it("B5 a failing keychain read exits 1 with one plain line, no stack and no key, and pushes nothing", () => {
    fc.assert(
      fc.property(fc.constantFrom<"missing" | "no-item">("missing", "no-item"), fc.boolean(), (security, notes) => {
        const ran = runTree({ notes, branch: "fabrikalfa/test", security });

        expect(ran.code, ran.text).toBe(1);
        expect(ran.stderr.trim()).toBe("botpush: cannot read the app key from the keychain");
        expect(ran.text).not.toMatch(/KEY-MARKER|\n\s+at |Error/);
        expect(pushes(ran)).toEqual([]);
        expect(named(ran, "http")).toEqual([]);
        expect(named(ran, "security")).toHaveLength(1);
      }),
      {
        ...options,
        examples: [
          ["missing", false],
          ["missing", true],
          ["no-item", false],
          ["no-item", true],
        ],
      },
    );
  }, 60_000);

  // B6. A commit this push sends that is not the bot's, by author or by committer, refuses before
  // any keychain read or network call, names the commit, and pushes nothing (0401, 0407). Plant:
  // check only the author, or only the newest commit's, or check after the token is made.
  it("B6 a sent commit not authored and committed by the bot refuses before any key read, and pushes nothing", () => {
    const bot = "fabrikalfa[bot]";

    fc.assert(
      fc.property(
        fc.constantFrom(
          { author: "A Person", committer: "A Person" },
          { author: bot, committer: "A Person" },
          { author: "A Person", committer: bot },
        ),
        fc.boolean(),
        (by, notes) => {
          const ran = runTree({ notes, branch: "fabrikalfa/test", by });

          expect(ran.code, ran.text).toBe(1);
          expect(ran.stderr).toMatch(
            /^botpush: [0-9a-f]{7,} is authored by .+ and committed by .+, not fabrikalfa\[bot\] \(0401, 0407\)$/m,
          );
          expect(ran.stderr).toContain("botpush: nothing pushed.");
          expect(pushes(ran)).toEqual([]);
          expect(named(ran, "security")).toEqual([]);
          expect(named(ran, "http")).toEqual([]);
        },
      ),
      { ...options, examples: [[{ author: "A Person", committer: "A Person" }, false]] },
    );
  }, 60_000);
});
