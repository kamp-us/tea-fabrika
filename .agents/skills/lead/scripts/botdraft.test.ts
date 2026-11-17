import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "botpush.mjs");

const text = { title: 'T1131: exact "draft" title', body: "First line.\n\nSecond line with `code` and $literal." };

const oid = "a".repeat(40);

const shim = `
import cp from 'node:child_process';
import crypto from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const real = cp.execFileSync;
const note = x => appendFileSync(process.env.TEST_LOG, JSON.stringify(x)+'\\n');
cp.execFileSync = (cmd,args,options) => {
  if(cmd==='security'){note({keychain:true});return Buffer.from('fixture signing input');}
  if(cmd==='git'||cmd==='gh') throw Error('unexpected personal CLI or push');
  return real(cmd,args,options);
};
crypto.createSign = () => ({update(){return this;},sign(){return 'fixture-signature';}});
syncBuiltinESMExports();
const expected = JSON.parse(process.env.TEST_TEXT);
const response = {number:71,html_url:'https://github.com/owner/repo/pull/71',state:'open',draft:true,...expected,
 user:{login:'fabrikalfa[bot]',type:'Bot'},base:{ref:'main'},head:{ref:'fabrikalfa/test',sha:'${oid}',repo:{full_name:'owner/repo'}}};
let reads=0;
globalThis.fetch = async (url,init={}) => {
 const path=new URL(url).pathname;const method=init.method??'GET';
 note({path,method,body:init.body?JSON.parse(typeof init.body==='string'?init.body:new TextDecoder().decode(init.body)):null,installationAuth:(init.headers.Authorization??init.headers.authorization)==='Bearer fixture-installation'});
 let status=200;let value;
 if(path==='/app')value={slug:'fabrikalfa'};
 else if(path.endsWith('/installation'))value={id:17};
 else if(path.endsWith('/access_tokens'))value={token:'fixture-installation',expires_at:'later',permissions:{contents:'read',pull_requests:process.env.TEST_MODE==='permission'?'read':'write'}};
 else if(path.includes('/branches/'))value={commit:{sha:process.env.TEST_MODE==='moved'?'b'.repeat(40):'${oid}'}};
 else if(path.endsWith('/pulls')&&method==='GET')value=process.env.TEST_MODE==='existing'||(process.env.TEST_MODE==='race'&&reads++>0)?[response]:[];
 else if(path.endsWith('/pulls')&&method==='POST'){
   status=process.env.TEST_MODE==='denied'?403:process.env.TEST_MODE==='race'?422:201;
   value={...response};
   if(process.env.TEST_MODE==='actor')value.user={login:'fixture-person',type:'User'};
   if(process.env.TEST_MODE==='base')value.base={ref:'other'};
   if(process.env.TEST_MODE==='head')value.head={...response.head,sha:'b'.repeat(40)};
   if(process.env.TEST_MODE==='repo')value.head={...response.head,repo:{full_name:'owner/other'}};
   if(process.env.TEST_MODE==='title')value.title='changed';
   if(process.env.TEST_MODE==='body')value.body='changed';
   if(process.env.TEST_MODE==='ready')value.draft=false;
 }else throw Error('unexpected HTTP '+path);
 return new Response(JSON.stringify(value),{status});
};
`;

const draft = (mode = "create", branch = "fabrikalfa/test", words = "never-publish-this-word") => {
  const dir = mkdtempSync(join(tmpdir(), "botdraft-"));

  try {
    const log = join(dir, "calls");
    writeFileSync(log, "");
    writeFileSync(join(dir, "shim.mjs"), shim);
    writeFileSync(join(dir, "words"), `${words}\n`);

    const out = spawnSync(
      process.execPath,
      ["--import", join(dir, "shim.mjs"), script, "--draft", "owner/repo", branch, oid],
      {
        cwd: import.meta.dirname,
        input: JSON.stringify(text),
        encoding: "utf8",
        env: {
          PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
          HOME: dir,
          XDG_CONFIG_HOME: dir,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          TYPESAFE_API_KEY: undefined,
          FABRIKA_LEAK_WORDS: join(dir, "words"),
          TEST_LOG: log,
          TEST_MODE: mode,
          TEST_TEXT: JSON.stringify(text),
        },
      },
    );

    return {
      code: out.status,
      out: out.stdout,
      err: out.stderr,
      calls: readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((x) => JSON.parse(x)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("bot draft publication, today's lead tooling", () => {
  // scenario: the real CLI boundary, with only keychain, signing and HTTP replaced.
  it("scenario: one repo-scoped installation opens the exact draft as the bot", () => {
    const got = draft();
    expect(got.code, got.err).toBe(0);
    expect(got.out.trim()).toBe("https://github.com/owner/repo/pull/71");
    expect(got.calls.filter((c) => c.path?.endsWith("/access_tokens"))).toEqual([
      {
        path: "/app/installations/17/access_tokens",
        method: "POST",
        body: { repositories: ["repo"], permissions: { contents: "read", pull_requests: "write" } },
        installationAuth: false,
      },
    ]);
    expect(got.calls.filter((c) => c.path === "/repos/owner/repo/pulls" && c.method === "POST")).toEqual([
      {
        path: "/repos/owner/repo/pulls",
        method: "POST",
        body: { ...text, head: "fabrikalfa/test", base: "main", draft: true },
        installationAuth: true,
      },
    ]);
    expect(got.out + got.err).not.toContain("fixture-installation");
  });

  // scenario: a prior successful request or a concurrent creator must not create a second PR.
  it("scenario: exact existing drafts and a create race return the same pull request", () => {
    for (const mode of ["existing", "race"]) {
      const got = draft(mode);
      expect(got.code, got.err).toBe(0);
      expect(got.out.trim()).toBe("https://github.com/owner/repo/pull/71");
      expect(got.calls.filter((c) => c.path === "/repos/owner/repo/pulls" && c.method === "POST")).toHaveLength(
        mode === "existing" ? 0 : 1,
      );
    }
  });

  // scenario: denied credentials or a personal actor can never trigger a personal CLI fallback.
  it("scenario: missing write permission, API refusal and wrong actor fail safely", () => {
    for (const mode of ["permission", "denied", "actor", "moved"]) {
      const got = draft(mode);
      expect(got.code).not.toBe(0);
      expect(got.out + got.err).not.toContain("fixture-installation");
      expect(got.out).not.toContain("/pull/71");
      expect(got.calls.filter((c) => c.path === "/repos/owner/repo/pulls" && c.method === "POST")).toHaveLength(
        ["permission", "moved"].includes(mode) ? 0 : 1,
      );
    }
  });

  // scenario: a response for other text, head, repository, base or draft state cannot certify this request.
  it("scenario: mismatched publication facts fail instead of reporting success", () => {
    for (const mode of ["base", "head", "repo", "title", "body", "ready"]) {
      const got = draft(mode);
      expect(got.code).not.toBe(0);
      expect(got.err).toContain("differs; lead read required");
      expect(got.out).not.toContain("/pull/71");
    }
  });

  // scenario: the CLI must refuse before reading the key or making HTTP calls.
  it("scenario: other branches and private text reach no credential or network call", () => {
    for (const got of [draft("create", "person/test"), draft("create", "fabrikalfa/test", "Second line")]) {
      expect(got.code).not.toBe(0);
      expect(got.calls).toEqual([]);
    }
  });
});
