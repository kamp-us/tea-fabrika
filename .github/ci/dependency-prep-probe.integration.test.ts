import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
// Today's proof tooling for the next/ consumers. This file stays on the two proof refs.
import { expect, it } from "@effect/vitest";
import { Effect, Exit, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const base = "ab47ff27805749e5cfb27a2170cbea381304b7ca";

const graphs: Record<string, Record<string, string | null>> = {
  before: {
    ".agents/package.json": "eb2fb2022ea97290785cfc5234983dd434b77fbd967c995a709afc4805da0163",
    ".github/ci/package.json": "922a0052c768bf7115664e020e31c875433cc2aa762e69cc2ffc1bc956fa7e67",
    "adapters/package.json": "a8b3053b56f4947fe448ffeae6ebdd41df7e0b8f428ca3e453005bebdc62cf23",
    "apps/fabrika/package.json": "d84e7923eb49ee8fb478a44ebadc940e8e99c4402a54442489579ecaf3e191b7",
    "docs/tutorials/agents/package.json": "0dab12d6935d3d5526bcad79902a0e72be311e953b0d8cf2c4f4475eec4d1ce1",
    "docs/tutorials/two-hosts/package.json": "f002ed87658298efd606e307f98a3e47019c5fc44b0975ffb1179fd46e5b4879",
    "fixtures/next/p19-launchd/package.json": "c9a463cd8e852bc880ea44c98af67eea04607e775e3b399045874ec8974f3d87",
    "next/apps/fabrika/package.json": "3f6c47338f6a6a195b77f81da6b94c206d20094c0ae7f5f7486c5096bd00dd15",
    "next/packages/libfabrika/package.json": "e8adac489fab37100c04a6c2b233922de9c22eb44ff32a94bdb512c1825ee5d9",
    "next/packages/tuval/package.json": "569dc1c829978d6434717535704e18c31c07bb97d5d25a29b975872410cfd5eb",
    "next/packages/vitest/package.json": "1479ed5ca9a8bec7e6996500e8fbadd0745bda9a9df99af16354c0033ff32352",
    "next/programs/chaos/package.json": "9c2ef7fc2da3642408ec5ad4d91fb4e3ff9adec707f4709fca10f3c25859e179",
    "next/programs/checklist/package.json": "33debb10a3fd11ec25e5db919c8f2c524f60313e93433233211bdf624112c84a",
    "next/programs/counter/package.json": "aec7d7651086362c8235ef5dc593d8718b13161237cba2c40d41d3c62c8e7bca",
    "next/programs/inbox/package.json": "8033f65ebda7e51815455ba87bd41f219cd16c0629f2fb077d082641bbae9e5a",
    "next/programs/pipeline/package.json": "06a7a0661fe8a6aa1333418b488334b7d7d3634d51f3eec6d1cda6adfdc54b46",
    "next/programs/tezgah/package.json": "91ace5483d7d7ad68a2b35f8f5ff68a1c7bb7a26b5c89ef48244d5a80281be01",
    "oxlint-plugins/package.json": "0ac102b6fbd579a99fcfb3d3f2ca5228357f413a476943215f0281ee3f1aabec",
    "package.json": "4c5fab617350cda472466a1504e4d8147f31bab65301e8867f5dc8499e887c1d",
    "packages/fabrika-design/package.json": "d0c426b4191dbc72978533b93c9d05ffe1994ed1af2a4407fc20c034680ca3a9",
    "packages/fabrika/package.json": "8e8e1771dd371cf8538be810fe5547a768bd8f2fe831ad253284cbf5e19c02c1",
    "packages/ledger-server/package.json": "ab7fc2922534756d73cc8500f13df7a70fe8b31783e812386064a55e3d4a1b7e",
    "packages/pipeline/package.json": "492df6c0e9943c691bfc46b8f322d198c701e1a2e320deb35b03ad069f0b81b1",
    "patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.85.patch":
      "14384a567c64fa21b5aa3aff50ba52e0f3e5c8ac403e5ad4e5b572fee1c62dc1",
    "patches/@alchemy.run__cloudflare@2.0.0-beta.85.patch":
      "54f0ba306cb70c8383a3b53bf22114369d5dd5ed10aeb0cd09b4d89cbc1d1878",
    "patches/@demlik__code-graph@0.15.0.patch": "2dd91ed537dd68f4b8b860974cedfdc84fa8e9dae3480db9a410d99734f3b59d",
    "patches/@demlik__tea@0.25.0.patch": "a0705fe157e523553033f02a0e50155c9c1599c28f3825dc262e53089c5f75d3",
    "patches/@effect__platform-node@4.1.3.patch": null,
    "patches/@manti-ui__react@0.13.0.patch": "520d7a5a9bd1d87685cc28543cfe91901c23e101a365e53cdeff7f40c031eeef",
    "patches/@manti-ui__styles@0.13.0.patch": "09f034efa447d755f779db1008ce64ea7787a3b2407951fd8c94b46513bba91e",
    "patches/effect@4.1.3.patch": "062265f7196a83cf802cda9213efbaee1e0e24b42f5bd9d92f0310e770d939f9",
    "patches/ghostty-web@0.4.0.patch": "28f943f1f6dce932fac5730afcbd278dfbbe017f43b896765d7146580f6dfb54",
    "pnpm-lock.yaml": "1800791fae8716cfb063adc7bd50822a0bfe07d7980eb599543e07c948032c95",
    "pnpm-workspace.yaml": "2dbe2a8e5e781cefa412fb2a43723b6dad1c8586bb49948d5d79eb1f81bef758",
    "programs/compare/package.json": "8c028734750d978014d8ceca0cee01fb9e5e2c2c556cc5398956866647337b6e",
    "programs/counter/package.json": "aa319baf8712aad0deb2938375932155600148644a03ed5a70d6491f8daca2de",
    "programs/experiment/package.json": "13b821bd8b301459aaa446df85ebf6ce11d9bd00e1fb43c275e6b5e811b1b0b9",
    "programs/experiments/package.json": "02271c145cfdff9bd71e84aaef2af2db8ce9c1b20824a7b7cd81a60baed8e4e5",
    "programs/map/package.json": "d19be7ab879d0291b3968a03558e16e346d3734f0667aba3d5f4047c1b526375",
    "programs/markdown/package.json": "5cfd7542c2981d704edc20106b0e7c1c7525b58acdb5b8ec482d589a9cc4d02c",
    "programs/pipeline/package.json": "8a2e136d71c22aa4e71fe9fcfb3e3ef9bd495f6a0f394165a15a4bf4ff681b9f",
    "programs/ticket/package.json": "79295c7986995761ab359d6c04718c7110bc0c2654a4e9218704a645309a3119",
    "programs/trace/package.json": "d78ab1a521df662f59154f1fe34e095ea4ee39c92b9b35d6c372326dc2e2918f",
    "programs/tracker/package.json": "732ee42f337235e06598a527d52ca89220450ef11360255d2eccc7da6b82e9c3",
  },
  after: {
    ".agents/package.json": "eb2fb2022ea97290785cfc5234983dd434b77fbd967c995a709afc4805da0163",
    ".github/ci/package.json": "922a0052c768bf7115664e020e31c875433cc2aa762e69cc2ffc1bc956fa7e67",
    "adapters/package.json": "a8b3053b56f4947fe448ffeae6ebdd41df7e0b8f428ca3e453005bebdc62cf23",
    "apps/fabrika/package.json": "d84e7923eb49ee8fb478a44ebadc940e8e99c4402a54442489579ecaf3e191b7",
    "docs/tutorials/agents/package.json": "0dab12d6935d3d5526bcad79902a0e72be311e953b0d8cf2c4f4475eec4d1ce1",
    "docs/tutorials/two-hosts/package.json": "f002ed87658298efd606e307f98a3e47019c5fc44b0975ffb1179fd46e5b4879",
    "fixtures/next/p19-launchd/package.json": "c9a463cd8e852bc880ea44c98af67eea04607e775e3b399045874ec8974f3d87",
    "next/apps/fabrika/package.json": "3f6c47338f6a6a195b77f81da6b94c206d20094c0ae7f5f7486c5096bd00dd15",
    "next/packages/libfabrika/package.json": "3a8524b129bcb88dcce1feef6983b6e85e2cd17f556c3e6da44643cd6810c09c",
    "next/packages/tuval/package.json": "569dc1c829978d6434717535704e18c31c07bb97d5d25a29b975872410cfd5eb",
    "next/packages/vitest/package.json": "1479ed5ca9a8bec7e6996500e8fbadd0745bda9a9df99af16354c0033ff32352",
    "next/programs/chaos/package.json": "9c2ef7fc2da3642408ec5ad4d91fb4e3ff9adec707f4709fca10f3c25859e179",
    "next/programs/checklist/package.json": "33debb10a3fd11ec25e5db919c8f2c524f60313e93433233211bdf624112c84a",
    "next/programs/counter/package.json": "aec7d7651086362c8235ef5dc593d8718b13161237cba2c40d41d3c62c8e7bca",
    "next/programs/inbox/package.json": "8033f65ebda7e51815455ba87bd41f219cd16c0629f2fb077d082641bbae9e5a",
    "next/programs/pipeline/package.json": "06a7a0661fe8a6aa1333418b488334b7d7d3634d51f3eec6d1cda6adfdc54b46",
    "next/programs/tezgah/package.json": "91ace5483d7d7ad68a2b35f8f5ff68a1c7bb7a26b5c89ef48244d5a80281be01",
    "oxlint-plugins/package.json": "0ac102b6fbd579a99fcfb3d3f2ca5228357f413a476943215f0281ee3f1aabec",
    "package.json": "4c5fab617350cda472466a1504e4d8147f31bab65301e8867f5dc8499e887c1d",
    "packages/fabrika-design/package.json": "d0c426b4191dbc72978533b93c9d05ffe1994ed1af2a4407fc20c034680ca3a9",
    "packages/fabrika/package.json": "8e8e1771dd371cf8538be810fe5547a768bd8f2fe831ad253284cbf5e19c02c1",
    "packages/ledger-server/package.json": "ab7fc2922534756d73cc8500f13df7a70fe8b31783e812386064a55e3d4a1b7e",
    "packages/pipeline/package.json": "492df6c0e9943c691bfc46b8f322d198c701e1a2e320deb35b03ad069f0b81b1",
    "patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.85.patch":
      "14384a567c64fa21b5aa3aff50ba52e0f3e5c8ac403e5ad4e5b572fee1c62dc1",
    "patches/@alchemy.run__cloudflare@2.0.0-beta.85.patch":
      "54f0ba306cb70c8383a3b53bf22114369d5dd5ed10aeb0cd09b4d89cbc1d1878",
    "patches/@demlik__code-graph@0.15.0.patch": "2dd91ed537dd68f4b8b860974cedfdc84fa8e9dae3480db9a410d99734f3b59d",
    "patches/@demlik__tea@0.25.0.patch": "a0705fe157e523553033f02a0e50155c9c1599c28f3825dc262e53089c5f75d3",
    "patches/@effect__platform-node@4.1.3.patch": "01679769b2c1a2b1cae15e9ee60052a73da7099390b5489b08ba2a49ef8cbc01",
    "patches/@manti-ui__react@0.13.0.patch": "520d7a5a9bd1d87685cc28543cfe91901c23e101a365e53cdeff7f40c031eeef",
    "patches/@manti-ui__styles@0.13.0.patch": "09f034efa447d755f779db1008ce64ea7787a3b2407951fd8c94b46513bba91e",
    "patches/effect@4.1.3.patch": "062265f7196a83cf802cda9213efbaee1e0e24b42f5bd9d92f0310e770d939f9",
    "patches/ghostty-web@0.4.0.patch": "28f943f1f6dce932fac5730afcbd278dfbbe017f43b896765d7146580f6dfb54",
    "pnpm-lock.yaml": "88e8babe6406aa0357b141c267f9af2663ffee9b7ac629d9d406d4a7e2c93a49",
    "pnpm-workspace.yaml": "ee222919871c408145ca34a66cda6377a6dbe4de2f3f2790cfb71806c0c08c4a",
    "programs/compare/package.json": "8c028734750d978014d8ceca0cee01fb9e5e2c2c556cc5398956866647337b6e",
    "programs/counter/package.json": "aa319baf8712aad0deb2938375932155600148644a03ed5a70d6491f8daca2de",
    "programs/experiment/package.json": "13b821bd8b301459aaa446df85ebf6ce11d9bd00e1fb43c275e6b5e811b1b0b9",
    "programs/experiments/package.json": "02271c145cfdff9bd71e84aaef2af2db8ce9c1b20824a7b7cd81a60baed8e4e5",
    "programs/map/package.json": "d19be7ab879d0291b3968a03558e16e346d3734f0667aba3d5f4047c1b526375",
    "programs/markdown/package.json": "5cfd7542c2981d704edc20106b0e7c1c7525b58acdb5b8ec482d589a9cc4d02c",
    "programs/pipeline/package.json": "8a2e136d71c22aa4e71fe9fcfb3e3ef9bd495f6a0f394165a15a4bf4ff681b9f",
    "programs/ticket/package.json": "79295c7986995761ab359d6c04718c7110bc0c2654a4e9218704a645309a3119",
    "programs/trace/package.json": "d78ab1a521df662f59154f1fe34e095ea4ee39c92b9b35d6c372326dc2e2918f",
    "programs/tracker/package.json": "732ee42f337235e06598a527d52ca89220450ef11360255d2eccc7da6b82e9c3",
  },
};

const probe = ".github/ci/dependency-prep-probe.integration.test.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const disk = (path: string) => (existsSync(path) ? hash(readFileSync(path)) : null);

class ProbeError extends Schema.TaggedError<ProbeError, { readonly brand: unique symbol }>()("ProbeError", {
  stage: Schema.String,
}) {}

// These fixed native Node entries resolve from the deployed consumer, never the source workspace.
const common = String.raw`
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const consumer = realpathSync(process.cwd());
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const report = { consumer, manifest: hash("package.json"), node: process.version, entry: null,
  version: null, files: {}, address: null, ip: null, port: null, status: null, body: null,
  values: null, resolution: null, released: null, failure: null };
let stage = "resolve";
const owned = path => {
  const actual = realpathSync(path);
  if (!actual.startsWith(consumer + sep)) throw new Error("entry_outside_deployment");
  return actual;
};
report.files.probe = { path: owned(fileURLToPath(import.meta.url)), hash: hash(fileURLToPath(import.meta.url)) };
const entry = specifier => {
  const actual = owned(fileURLToPath(import.meta.resolve(specifier)));
  report.files[specifier] = { path: actual, hash: hash(actual) };
  return actual;
};
const failure = error => { report.failure = { stage, code: typeof error?.code === "string" ? error.code : "operation_failed" }; };
`;

const app =
  common +
  String.raw`
try {
  report.entry = entry("@effect/platform-node/NodeHttpServer");
  const pkg = resolve(dirname(report.entry), "../package.json");
  report.version = JSON.parse(readFileSync(pkg, "utf8")).version;
  report.files.source = { path: owned(resolve(dirname(report.entry), "../src/NodeHttpServer.ts")),
    hash: hash(resolve(dirname(report.entry), "../src/NodeHttpServer.ts")) };
  entry("effect"); entry("effect/http"); entry("effect/net");
  stage = "import";
  const { Effect, Context, Layer, Result } = await import("effect");
  const { HttpServer, HttpServerResponse, HttpClient } = await import("effect/http");
  const { NetAddress } = await import("effect/net");
  const NodeHttpServer = await import("@effect/platform-node/NodeHttpServer");
  stage = "http";
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const services = yield* Layer.build(NodeHttpServer.layerTest);
    const server = Context.get(services, HttpServer.HttpServer);
    report.address = HttpServer.formatAddress(server.address);
    if (NetAddress.isUnixPathAddress(server.address)) throw new Error("not_tcp");
    report.ip = NetAddress.formatIp(server.address.address);
    report.port = server.address.port;
    yield* server.serve(Effect.succeed(HttpServerResponse.text("dependency-prep-control")));
    const client = Context.get(services, HttpClient.HttpClient);
    const response = yield* client.get("http://127.0.0.1:" + report.port);
    report.status = response.status;
    report.body = yield* response.text;
  })));
  stage = "release";
  const net = await import("node:net");
  report.released = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(Effect.sync(() => new net.Socket()), s => Effect.sync(() => s.destroy()));
    return yield* Effect.callback(resume => {
      socket.once("connect", () => resume(Effect.succeed(false)));
      socket.once("error", error => resume(Effect.succeed(error.code === "ECONNREFUSED")));
      socket.connect(report.port, "127.0.0.1");
    });
  })));
} catch (error) { failure(error); }
console.log(JSON.stringify(report));
`;

const library = (development: boolean) =>
  common +
  String.raw`
try {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  report.direct = { runtime: manifest.dependencies?.ajv ?? null, development: manifest.devDependencies?.ajv ?? null };
  try { report.entry = entry("ajv/dist/2020.js"); report.resolution = "resolved"; }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" && error.code !== "MODULE_NOT_FOUND") throw error;
    report.resolution = error.code;
  }
  if (report.entry !== null) {
    report.version = JSON.parse(readFileSync(resolve(dirname(report.entry), "../package.json"), "utf8")).version;
    ${
      development
        ? String.raw`
    stage = "import";
    const { default: Ajv2020 } = await import("ajv/dist/2020.js");
    stage = "compile";
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile({
      $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
      required: ["value"], properties: { value: { type: "string" } }, additionalProperties: false
    });
    report.values = [{ value: "ok" }, {}, { value: 3 }, { value: "ok", extra: true }].map(value => validate(value));
    `
        : ""
    }
  }
  report.released = true;
} catch (error) { failure(error); }
console.log(JSON.stringify(report));
`;

const Observation = Schema.Struct({
  consumer: Schema.String,
  manifest: Schema.String,
  node: Schema.String,
  entry: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  files: Schema.Record(Schema.String, Schema.Struct({ path: Schema.String, hash: Schema.String })),
  address: Schema.NullOr(Schema.String),
  ip: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Finite),
  status: Schema.NullOr(Schema.Finite),
  body: Schema.NullOr(Schema.String),
  values: Schema.NullOr(Schema.Array(Schema.Boolean)),
  resolution: Schema.NullOr(Schema.String),
  released: Schema.NullOr(Schema.Boolean),
  failure: Schema.NullOr(Schema.Struct({ stage: Schema.String, code: Schema.String })),
  direct: Schema.optionalKey(
    Schema.Struct({ runtime: Schema.NullOr(Schema.String), development: Schema.NullOr(Schema.String) }),
  ),
});

const scenario = (role: "app-prod" | "lib-dev" | "lib-prod") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const environment = { ...process.env };
    delete environment.NODE_PATH;
    delete environment.TYPESAFE_API_KEY;
    let stage = "guard";
    const observed: { value: typeof Observation.Type | null } = { value: null };
    let target: string | null = null;
    let cleaned = false;
    let childExit: number | null = null;
    let deployed: number | null = null;

    type Snapshot = {
      head: string;
      status: string;
      index: string;
      graph: Record<string, string | null>;
      probe: string | null;
    };

    const saved: { before: Snapshot | null; after: Snapshot | null } = { before: null, after: null };
    let parent: string | null = null;
    let pnpm: string | null = null;
    let native: string | null = null;
    const phase = process.env.GITHUB_REF_NAME === "fabrikalfa/e88-p25-deps-before-proof" ? "before" : "after";

    const children: Array<{ role: string; started: boolean; exit: number | null; reaped: boolean | null }> = [];

    const child = Effect.fn("dependency-prep.child")(function* (
      role: "git" | "pnpm-version" | "node-version" | "deployment" | "entry",
      cwd: string,
      command: string,
      args: readonly string[],
    ) {
      const fact: { role: string; started: boolean; exit: number | null; reaped: boolean | null } = {
        role,
        started: false,
        exit: null,
        reaped: null,
      };

      children.push(fact);

      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, { cwd, env: environment, extendEnv: false, stdin: "ignore" }),
      );

      fact.started = true;

      const [exit, stdout] = yield* Effect.all(
        [
          handle.exitCode.pipe(
            Effect.tap((code) =>
              Effect.sync(() => {
                fact.exit = Number(code);
                fact.reaped = true;
              }),
            ),
          ),
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.runDrain),
        ],
        { concurrency: "unbounded" },
      );

      return { exit: Number(exit), stdout };
    }, Effect.scoped);

    const git = Effect.fn("dependency-prep.git")(function* (args: readonly string[]) {
      const result = yield* child("git", root, "git", args);

      if (result.exit !== 0) {
        return yield* ProbeError.make({ stage: "git" });
      }

      return result.stdout;
    });

    const snapshot = Effect.fn("dependency-prep.snapshot")(function* () {
      return {
        head: (yield* git(["rev-parse", "HEAD"])).trim(),
        status: yield* git(["status", "--porcelain", "--untracked-files=no"]),
        index: yield* git(["ls-files", "--stage"]),
        graph: Object.fromEntries(Object.keys(graphs[phase]!).map((path) => [path, disk(join(root, path))])),
        probe: disk(join(root, probe)),
      };
    });

    const checked = yield* Effect.exit(
      Effect.scoped(
        Effect.gen(function* () {
          if (
            process.platform !== "linux" ||
            process.env.CI !== "true" ||
            process.env.GITHUB_ACTIONS !== "true" ||
            process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
            process.env.GITHUB_WORKFLOW !== "scheduled" ||
            !["fabrikalfa/e88-p25-deps-before-proof", "fabrikalfa/e88-p25-deps-after-proof"].includes(
              process.env.GITHUB_REF_NAME ?? "",
            ) ||
            process.env.FABRIKA_TEST_DEPTH !== "full" ||
            !process.env.GITHUB_RUN_ID ||
            !process.env.GITHUB_RUN_ATTEMPT ||
            !process.env.GITHUB_JOB ||
            !process.env.RUNNER_NAME ||
            !process.env.RUNNER_TEMP ||
            !process.env.HOME ||
            process.version !== "v26.13.0"
          ) {
            return yield* ProbeError.make({ stage });
          }

          saved.before = yield* snapshot();
          expect(saved.before.status).toBe("");
          expect(saved.before.head).toMatch(/^[0-9a-f]{40}$/);
          expect(saved.before.head).toBe(process.env.GITHUB_SHA);
          expect(saved.before.graph).toEqual(graphs[phase]);

          const parents = (yield* git(["cat-file", "-p", "HEAD"]))
            .split("\n\n")[0]!
            .split("\n")
            .filter((line) => line.startsWith("parent "));

          expect(parents).toHaveLength(1);
          parent = parents[0]!.slice(7);

          if (phase === "before") {
            expect(parent).toBe(base);
          }

          pnpm = (yield* child("pnpm-version", root, "pnpm", ["--version"])).stdout.trim();
          native = (yield* child("node-version", root, process.execPath, ["--version"])).stdout.trim();
          expect(pnpm).toBe("12.16.1");
          expect(native).toBe("v26.13.0");
          stage = "deploy";

          const owned = yield* Effect.acquireRelease(
            fs.makeTempDirectory({ prefix: `dependency-prep-${phase}-${role}-` }),
            (path) =>
              fs.remove(path, { recursive: true }).pipe(
                Effect.tap(() =>
                  fs.exists(path).pipe(
                    Effect.tap((exists) =>
                      Effect.sync(() => {
                        cleaned = !exists;
                      }),
                    ),
                  ),
                ),
              ),
          );

          target = join(owned, "consumer");

          for (let ancestor = owned; ; ancestor = dirname(ancestor)) {
            expect(existsSync(join(ancestor, "node_modules"))).toBe(false);

            if (dirname(ancestor) === ancestor) {
              break;
            }
          }

          const consumer = role === "app-prod" ? "@kampus/fabrika" : "@kampus/libfabrika";

          const args = [
            `--filter=${consumer}`,
            ...(role === "lib-dev" ? [] : ["--prod"]),
            "deploy",
            "--offline",
            "--frozen-lockfile",
            "--ignore-scripts",
            target,
          ];

          const deployment = yield* child("deployment", root, "pnpm", args);
          deployed = deployment.exit;

          if (deployment.exit !== 0) {
            return yield* ProbeError.make({ stage });
          }

          stage = "entry";
          const script = role === "app-prod" ? app : library(role === "lib-dev");
          yield* fs.writeFileString(join(target, "dependency-prep-entry.mjs"), script);
          const result = yield* child("entry", target, process.execPath, ["dependency-prep-entry.mjs"]);
          childExit = result.exit;

          if (result.exit !== 0) {
            return yield* ProbeError.make({ stage });
          }

          observed.value = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Observation))(result.stdout.trim());
          expect(observed.value.consumer).toBe(realpathSync(target));
        }),
      ),
    );

    const restoration = yield* Effect.exit(
      Effect.gen(function* () {
        saved.after = yield* snapshot();
        expect(saved.after).toEqual(saved.before);
      }),
    );

    console.log(
      `DEPENDENCY_PREP_RECEIPT ${JSON.stringify({
        role,
        phase,
        base,
        source: parent,
        proof: saved.before?.head ?? null,
        probe: saved.before?.probe ?? null,
        graph: saved.before?.graph ?? null,
        node: process.version,
        native,
        pnpm,
        depth: process.env.FABRIKA_TEST_DEPTH ?? null,
        runner: process.env.RUNNER_NAME ?? null,
        run: process.env.GITHUB_RUN_ID ?? null,
        attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
        job: process.env.GITHUB_JOB ?? null,
        deployed,
        childExit,
        observation: observed.value,
        failure: Exit.isFailure(checked) ? { stage } : null,
        cleanup: {
          children,
          targetRemoved: cleaned,
          restored: Exit.isSuccess(restoration),
        },
      })}`,
    );
    expect(Exit.isSuccess(checked), `setup failed at ${stage}`).toBe(true);
    expect(Exit.isSuccess(restoration), "source checkout changed").toBe(true);
    expect(cleaned, "deployment cleanup").toBe(true);
    expect(observed.value).not.toBeNull();

    if (observed.value === null) {
      return;
    }

    expect(observed.value.failure, "consumer operation").toBeNull();
    expect(observed.value.node).toBe("v26.13.0");
    expect(observed.value.released, "consumer resources released").toBe(true);

    if (role === "app-prod") {
      expect(observed.value.version).toBe("4.1.3");
      expect(observed.value.port).toBeGreaterThan(0);
      expect(observed.value.status).toBe(200);
      expect(observed.value.body).toBe("dependency-prep-control");
      expect(observed.value.files["@effect/platform-node/NodeHttpServer"]?.hash).toBe(
        phase === "before"
          ? "883378f8c26feefcfaeba33946c4db96698c657716243b4536aee46839b18102"
          : "e1ec40da0b42257436dd94c3c4b6b9ac6fbf279361313963137ae9457a6cd583",
      );
      expect(observed.value.files.source?.hash).toBe(
        phase === "before"
          ? "0e471bae512bf70f9cb5a3d43eb6dfd54ca79a68be8026c48663057d069f12ef"
          : "f6fc32dc693e9ab4df77800dd05ab93214fbdaaa9e6f16e130bb553f4d3d69d0",
      );
      expect(observed.value.ip, "layerTest binds IPv4 loopback").toBe("127.0.0.1");
    } else {
      const source = JSON.parse(readFileSync(join(root, "next/packages/libfabrika/package.json"), "utf8"));
      expect(source.dependencies.ajv ?? null).toBeNull();
      expect(source.devDependencies.ajv ?? null).toBe(phase === "after" ? "catalog:" : null);
      expect(observed.value.direct?.runtime ?? null).toBeNull();

      if (role === "lib-dev") {
        expect(observed.value.version).toBe("8.20.0");
        expect(observed.value.files["ajv/dist/2020.js"]?.hash).toBe(
          "908e9670b478b2ba126802a221b7e47006f50cf467e2c5dd7935d3dbef10a20a",
        );
        expect(observed.value.values).toEqual([true, false, false, false]);
      } else {
        expect(["resolved", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]).toContain(observed.value.resolution);
      }
    }
  }).pipe(Effect.provide(NodeServices.layer));

// scenario: only a real deployed app proves the installed test layer's listener and control request.
// Plant: baseline graph retains the unpatched wildcard listener; the same assertion runs in both phases.
it.effect("app-prod loads its own platform-node and binds IPv4 loopback with HTTP control", () => scenario("app-prod"));

// scenario: development resolution is measured through the actual libfabrika deployment.
// Plant: baseline has no direct Ajv declaration; a transitive resolution is recorded honestly.
it.effect("lib-dev loads Ajv2020 and distinguishes all four closed-schema values", () => scenario("lib-dev"));

// scenario: production deployment records direct classification and optional transitive resolution.
// Plant: the baseline production consumer supplies the unchanged direct-dependency comparison.
it.effect("lib-prod keeps Ajv development-only and records its actual resolution", () => scenario("lib-prod"));
