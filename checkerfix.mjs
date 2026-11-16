// Applies the Effect checker's own quick fix for one check, through its language server.
// Usage: node checkerfix.mjs <check> <project dir with tsconfig.json> <file>...
// The check must already be on (at error) for the files in that project's tsconfig.
// Prints, per file, how many hits were fixed and which hits had no quick fix (left as they are).
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
const [check, rootArg, ...files] = process.argv.slice(2);
if (!check || !rootArg || files.length === 0) { console.error("usage: checkerfix.mjs <check> <project dir> <file>..."); process.exit(2); }
const root = resolve(rootArg);
const p = spawn("pnpm", ["exec", "effect-tsgo", "tsc", "--lsp", "--stdio"], { cwd: root });
let buf = Buffer.alloc(0), id = 0; const waits = new Map();
p.stderr.on("data", () => {});
p.stdout.on("data", (d) => { buf = Buffer.concat([buf, d]);
  for (;;) { const h = buf.indexOf("\r\n\r\n"); if (h < 0) break;
    const len = +/Content-Length: (\d+)/i.exec(buf.subarray(0, h).toString())[1];
    if (buf.length < h + 4 + len) break;
    const m = JSON.parse(buf.subarray(h + 4, h + 4 + len).toString()); buf = buf.subarray(h + 4 + len);
    if (m.id != null && !m.method && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); }
    else if (m.id != null && m.method) send({ jsonrpc: "2.0", id: m.id, result: null });
  } });
const send = (o) => { const s = JSON.stringify(o); p.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); };
const req = (method, params) => new Promise((r) => { const i = ++id; waits.set(i, r); send({ jsonrpc: "2.0", id: i, method, params }); });
const offsetAt = (text, pos) => { let o = 0; for (let l = 0; l < pos.line; l++) o = text.indexOf("\n", o) + 1; return o + pos.character; };
// LSP edits all refer to the text before any of them; at the same start they apply in array order.
const applyEdits = (text, edits) => {
  const spans = edits.map((e, i) => ({ i, s: offsetAt(text, e.range.start), e: offsetAt(text, e.range.end), t: e.newText }))
    .sort((a, b) => a.s - b.s || a.i - b.i);
  let out = "", at = 0;
  for (const x of spans) { if (x.s < at) throw new Error("overlapping edits"); out += text.slice(at, x.s) + x.t; at = x.e; }
  return out + text.slice(at);
};
const init = await req("initialize", { processId: process.pid, rootUri: pathToFileURL(root).href,
  capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: {}, codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } } } } } });
if ((init.result?.capabilities?.positionEncoding ?? "utf-16") !== "utf-16") { console.error("server does not speak utf-16 positions"); process.exit(2); }
send({ jsonrpc: "2.0", method: "initialized", params: {} });
const tag = `effect(${check})`;
let total = 0, unfixed = 0;
for (const f of files) {
  const path = resolve(f), uri = pathToFileURL(path).href;
  let text = readFileSync(path, "utf8"), version = 1, fixed = 0; const skipped = [];
  send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: path.endsWith("x") ? "typescriptreact" : "typescript", version, text } } });
  for (let round = 0; round < 500; round++) {
    const d = await req("textDocument/diagnostic", { textDocument: { uri } });
    const key = (x) => `${x.range.start.line}:${x.range.start.character}:${x.message}`;
    const hit = (d.result?.items ?? []).find((x) => x.message.includes(tag) && !skipped.some((s) => s.key === key(x)));
    if (!hit) break;
    const ca = await req("textDocument/codeAction", { textDocument: { uri }, range: hit.range, context: { diagnostics: [hit], only: ["quickfix"] } });
    const fix = (ca.result ?? []).find((a) => a.kind === "quickfix" && a.edit && !/^Disable /.test(a.title));
    const edits = fix && [...Object.entries(fix.edit.changes ?? {}), ...(fix.edit.documentChanges ?? []).map((c) => [c.textDocument.uri, c.edits])];
    if (!fix || edits.some(([u]) => u !== uri)) { skipped.push({ key: key(hit), line: hit.range.start.line + 1, why: fix ? "fix edits another file" : "no quick fix" }); continue; }
    text = applyEdits(text, edits.flatMap(([, e]) => e)); version++; fixed++;
    send({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri, version }, contentChanges: [{ text }] } });
  }
  if (fixed > 0) writeFileSync(path, text);
  send({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } });
  total += fixed; unfixed += skipped.length;
  console.log(`${f}: fixed ${fixed}${skipped.length ? `, left ${skipped.map((s) => `line ${s.line} (${s.why})`).join(", ")}` : ""}`);
}
console.log(`checkerfix ${check}: fixed ${total}, left ${unfixed}`);
p.kill(); process.exit(0);
