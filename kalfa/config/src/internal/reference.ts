/**
 * The settings reference as Markdown, made from the declarations alone: one section per setting with its description, files, variable and flag, default and when a change applies.
 */
import * as Function from "effect/Function";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { encodedDefault, type Group } from "./check.ts";
import { variable } from "./names.ts";
import { shown } from "./place.ts";
import { toml } from "./toml.ts";

/** Words as Markdown shows them as written: every character Markdown reads is escaped, and a line that starts a list as `1.` or `1)` has its marker escaped. */
export const escape = (text: string) =>
  Function.pipe(text, Str.replace(/[\\`*_[\]<>#|&~+!=-]/g, "\\$&"), Str.replace(/^(\s*\d+)([.)])/gm, "$1\\$2"));

/** A code span: a fence one backtick longer than the longest run inside it, a space inside when the text starts or ends with a backtick, and each `|` written `\|`, as a table cell asks. */
export const code = (text: string) => {
  const fence = "`".repeat(Math.max(0, ...Array.from(text.matchAll(/`+/g), (run) => run[0].length)) + 1);
  const pad = Str.startsWith("`")(text) || Str.endsWith("`")(text) ? " " : "";

  return Str.replaceAll("|", "\\|")(`${fence}${pad}${text}${pad}${fence}`);
};

const none = (reason: string) => `none: ${reason}`;

/** The reference of a group, the quiet window included: sections by name, one blank line between, one final line break. */
export const text = (group: Group): string => {
  const names = shown(group.app, toml);

  return `${[...group.settings]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((s) =>
      [
        `### ${code(s.name)}`,
        "",
        escape(s.description ?? ""),
        "",
        "| Field | Value |",
        "|---|---|",
        `| Files | ${s.files.map((file) => code(names[file])).join(", ")} |`,
        `| Environment | ${s.fileOnly ? none("file-only") : code(variable(group.app, s.name))} |`,
        `| Flag | ${s.fileOnly ? none("file-only") : code(`--${s.name}`)} |`,
        `| Default | ${Option.match(encodedDefault(s), { onNone: () => none("required"), onSome: (value) => code(JSON.stringify(value)) })} |`,
        `| Applies | ${s.live ? "live" : "restart"} |`,
      ].join("\n"),
    )
    .join("\n\n")}\n`;
};
