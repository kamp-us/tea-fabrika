// Push a worktree's branch as fabrikalfa[bot]. When the worktree has step notes, they go with the
// branch in one atomic push, after the remote's notes are merged in. Without notes (every commit is
// plain, decisions 0161 and 0164) the branch alone is pushed and the remote's notes are not touched.
// The app key is read from the keychain into memory only; the token is never printed or written.
// usage: node botpush.mjs <worktree> <branch> [src=HEAD]   (branch "-" pushes only the step notes,
// and refuses a worktree that has none)
// FABRIKA_APP_ID names the GitHub App; GH_REPO (owner/name) defaults to the worktree's origin.
import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs"; // edge: stdin can be a socket descriptor; FileSystem reads paths only.
import { createRequire } from "node:module"; // edge: load the optional draft module synchronously on Node, without starting a second process.
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

const draft = args[0] === "--draft";

const [dir, branch, src = "HEAD"] = draft ? [process.cwd(), args[2], "HEAD"] : args;

const leakgrep = fileURLToPath(new URL("./leakgrep.sh", import.meta.url));

let text;

if (draft) {
  if (
    args.length !== 4 ||
    !/^[a-f0-9]{40}$/.test(args[3] ?? "") ||
    !/^[\w.-]+\/[\w.-]+$/.test(args[1] ?? "") ||
    !branch?.startsWith("fabrikalfa/")
  ) {
    throw new Error("usage: botpush.mjs --draft owner/repo fabrikalfa/<name>, expected-head, JSON title/body on stdin");
  }

  try {
    text = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    console.error("bot draft: unreadable title/body JSON");
    process.exit(1);
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the stdin JSON's one shape check, by hand: this script imports no effect, since an effect import makes its seven try blocks fabrika/no-raw-try-catch errors
  if (typeof text?.title !== "string" || text.title.trim() === "" || typeof text.body !== "string") {
    throw new Error("bot draft: title and body must be text");
  }

  text = { title: text.title, body: text.body };

  try {
    execFileSync("sh", [leakgrep, "--text", "-"], {
      cwd: dir,
      input: `${text.title}\n${text.body}`,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    console.error("bot draft: text leak check refused");
    process.exit(1);
  }
}

if (!dir || !(branch === "-" || branch?.startsWith("fabrikalfa/"))) {
  throw new Error("usage: botpush.mjs <worktree> fabrikalfa/<name>");
}

// Whether this worktree has step notes. Without them only the branch is pushed, and a notes-only
// push has nothing to send, so it stops here, before any diff, credential or network request.
const notesExist = () => {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--verify", "-q", "refs/notes/fabrika"]);

    return true;
  } catch {
    return false;
  }
};

const hasNotes = !draft && notesExist();

if (!draft && !hasNotes && branch === "-") {
  console.error("botpush: no step notes to push (no refs/notes/fabrika here)");
  process.exit(1);
}

// Check only committed additions, before reading credentials or making any network request.
// A quest's diff can pass execFileSync's 1 MB default (a minified CSS patch did), so the buffer is
// wide, and a failure says which part failed instead of exiting with no word.
let diff;

if (!draft) {
  try {
    diff = execFileSync(
      "git",
      ["-C", dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=0", `origin/main...${src}`],
      { maxBuffer: 256 * 1024 * 1024 },
    );
  } catch {
    console.error("botpush: cannot read the diff from origin/main");
    process.exit(1);
  }

  try {
    execFileSync("sh", [leakgrep], {
      cwd: dir,
      input: diff,
      stdio: ["pipe", "inherit", "inherit"],
    });
    // Decision 0048: each commit this push sends is read on its own, beside the branch's net change
    // above. A commit a ref of origin already holds is not sent, so it is not read again.
    execFileSync("sh", [leakgrep, "--commits", src, "--not", "--remotes=origin"], {
      cwd: dir,
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch {
    process.exit(1);
  }
}

const APP = process.env.FABRIKA_APP_ID ?? "5640348";

const REPO = draft
  ? args[1]
  : (process.env.GH_REPO ??
    execFileSync("git", ["-C", dir, "remote", "get-url", "origin"])
      .toString()
      .trim()
      .replace(/^(https:\/\/github\.com\/|git@github\.com:)/, "")
      .replace(/\.git$/, ""));

const b64 = (s) => Buffer.from(s).toString("base64url");

// No keychain (a Linux box has no `security`) or no item: one plain line, never the error and never
// the key. This refuses; it is no fallback, and no other credential source is read.
let raw;

try {
  raw = execFileSync("security", ["find-generic-password", "-s", "fabrika-github-app-key", "-a", "fabrika", "-w"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  console.error("botpush: cannot read the app key from the keychain");
  process.exit(1);
}

const pem = raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString();

const now = Math.floor(Date.now() / 1000);

const body = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(JSON.stringify({ iat: now - 60, exp: now + 540, iss: APP }))}`;

const jwt = `${body}.${createSign("RSA-SHA256").update(body).sign(pem, "base64url")}`;

const api = async (path, init = {}, auth = `Bearer ${jwt}`) => {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: auth,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!r.ok) {
    throw new Error(`${path}: ${r.status}`);
  }

  return r.json();
};

const inst = await api(`/repos/${REPO}/installation`);

const tok = await api(`/app/installations/${inst.id}/access_tokens`, {
  method: "POST",
  body: JSON.stringify({
    repositories: [REPO.split("/")[1]],
    permissions: draft ? { contents: "read", pull_requests: "write" } : { contents: "write", workflows: "write" },
  }),
});

if (draft) {
  const BotDraft = createRequire(import.meta.url)("./pr/BotDraft.ts");
  BotDraft.run({
    repo: REPO,
    branch,
    head: args[3],
    text,
    token: tok.token,
    jwt,
    write: tok.permissions?.pull_requests === "write",
  });
} else {
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${tok.token}`).toString("base64")}`;

  // No global or system git config, so no credential helper answers before the bot's token.
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };

  const git = (...a) =>
    execFileSync("git", ["-c", `http.https://github.com/.extraheader=${header}`, ...a], {
      cwd: dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();

  const url = `https://github.com/${REPO}.git`;

  // With notes: one atomic push, so the notes and the branch land together or not at all. Without
  // notes the branch goes alone.
  const refs = hasNotes ? ["refs/notes/fabrika:refs/notes/fabrika"] : [];

  if (branch !== "-") {
    refs.push(`${src}:refs/heads/${branch}`);
  }

  // Take the remote's notes first and merge them in, as the signer's own push does, so the push is a
  // fast-forward. A conflict (two notes on one commit) stops here, before anything is pushed.
  const takeNotes = () => {
    if (hasNotes && git("ls-remote", url, "refs/notes/fabrika").trim()) {
      git("fetch", "--no-tags", "-q", url, "+refs/notes/fabrika:refs/notes/fabrika-origin");
      git(
        "-c",
        "user.name=fabrikalfa[bot]",
        "-c",
        "user.email=353269643+fabrikalfa[bot]@users.noreply.github.com",
        "notes",
        "--ref=fabrika",
        "merge",
        "-q",
        "refs/notes/fabrika-origin",
      );
    }
  };

  /**
   * Whether the push was refused only because the remote's notes moved after we took them: another
   * session pushed refs/notes/fabrika in between (ci375 build, 2026-11-09, ticket 388). GitHub says
   * "cannot lock ref" for that race and plain git says "fetch first"; with --atomic every other ref
   * then reads "(failed)" or "(atomic push failed)". Any other refusal is real and is not retried.
   */
  const staleNotesOnly = (stderr) => {
    const refused = stderr.split("\n").filter((l) => /^\s*!\s/.test(l));
    const notes = refused.filter((l) => /->\s+refs\/notes\/fabrika\b/.test(l));

    return (
      notes.length > 0 &&
      notes.every((l) => /cannot lock ref|fetch first|non-fast-forward/.test(l)) &&
      refused.every((l) => notes.includes(l) || /\((atomic push )?failed\)\s*$/.test(l))
    );
  };

  try {
    takeNotes();
    let retried = false;

    try {
      git("push", "--atomic", url, ...refs);
    } catch (e) {
      if (!staleNotesOnly(String(e.stderr ?? ""))) {
        throw e;
      }

      // One retry, never a force: take the newer notes, merge them, push again.
      retried = true;
      takeNotes();
      git("push", "--atomic", url, ...refs);
    }

    console.log(
      `pushed ${branch} as fabrikalfa[bot]${hasNotes ? "" : " without step notes"}${retried ? " after one notes retry" : ""}; installation ${inst.id}; token expires ${tok.expires_at}`,
    );
  } catch (e) {
    console.log(
      `push refused: ${String(e.stderr ?? e.message)
        .replaceAll(tok.token, "***")
        .split("\n")
        .filter((l) => /GH0|refused|rejected|error|conflict/i.test(l))
        .join(" | ")}`,
    );
    process.exitCode = 1;
  }
}
