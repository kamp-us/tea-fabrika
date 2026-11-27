// Today's lead tooling. Sections' laws (a pull request's description is the pr skill's template, never the draft placeholder): pure; nothing here asks GitHub.
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Sections from "./Sections.ts";

const Section = Schema.Literals(["Summary", "Evidence", "Merge Danger"]);

/** A description with these sections, each under its own heading, and prose beside them. */
const body = (names: ReadonlyArray<string>) =>
  ["T1: a title", "", ...names.flatMap((name) => [`## ${name}`, "", "Words.", ""])].join("\n");

const all = ["Summary", "Evidence", "Merge Danger"];

describe("Sections: a description is the pr skill's template, not the draft placeholder", () => {
  // Plants: let the placeholder pass, or check it only when the whole body is the placeholder.
  it.prop(
    "property: a description that still holds the draft placeholder is refused, whatever else it holds and however its lines wrap",
    { around: Schema.String.check(Schema.isMaxLength(20)), wrap: Schema.Boolean, full: Schema.Boolean },
    ({ around, wrap, full }) => {
      const placeholder = wrap ? Sections.DRAFT_BODY.replaceAll(" ", "\n") : Sections.DRAFT_BODY;
      const said = Sections.refusal(`${around}\n${placeholder}\n${full ? body(all) : ""}`);

      expect(said).toContain("still the draft placeholder sentence");
      expect(said).toContain(".agents/skills/pr/SKILL.md");
    },
  );

  // Plants: require nothing, or name the wrong section.
  it.prop(
    "property: each required section left out is refused by its name, and one present is not named",
    { left: Schema.Array(Section) },
    ({ left }) => {
      const kept = all.filter((name) => !left.some((l) => l === name));
      const said = Sections.refusal(body(kept));

      if (left.length === 0) {
        expect(said).toBeNull();

        return;
      }

      for (const name of all) {
        expect(said?.includes(`## ${name}`)).toBe(left.some((l) => l === name));
      }

      expect(said).toContain("the pr skill");
    },
  );

  // Plant: a heading match that is case-sensitive, or one that takes `## Summary of it` for the section.
  it("scenario: a full body passes, a `###` heading counts as a quest brief writes it, and a longer heading does not count", () => {
    expect(Sections.refusal(body(all))).toBeNull();
    expect(Sections.refusal("### Summary\n\nx\n\n### Evidence\n\nx\n\n## merge danger\n\nx")).toBeNull();
    expect(Sections.refusal("## Summary of it\n\nx\n\n## Evidence\n\nx\n\n## Merge Danger\n\nx")).toContain(
      "## Summary",
    );
  });

  // Plant: match a prefix of the placeholder (`includes(squash(DRAFT_BODY).slice(0, 30))`), so a body that quotes part of the sentence is refused.
  it.prop(
    "property: a full body that quotes a prefix of the placeholder, or a changed form of it, passes",
    {
      cut: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Sections.DRAFT_BODY.length - 1 })),
      word: Schema.Literals(["draft", "branch", "pushed", "ready", "steps"]),
    },
    ({ cut, word }) => {
      const changed = Sections.DRAFT_BODY.replace(word, `${word}x`);

      expect(Sections.refusal(`${body(all)}\n> ${Sections.DRAFT_BODY.slice(0, cut)}\n`)).toBeNull();
      expect(Sections.refusal(`${body(all)}\n> ${changed}\n`)).toBeNull();
    },
  );

  // Plants: read headings inside a fenced code block or an HTML comment as sections.
  it.prop(
    "property: a heading inside a fenced code block or an HTML comment is no section; one outside both still is",
    { hidden: Schema.Literals(["```", "~~~", "comment"]), left: Section },
    ({ hidden, left }) => {
      const kept = all.filter((name) => name !== left);
      const inside = `## ${left}\n\nWords.`;
      const wrapped = hidden === "comment" ? `<!--\n${inside}\n-->` : `${hidden}md\n${inside}\n${hidden}`;
      const said = Sections.refusal(`${body(kept)}\n${wrapped}\n`);

      expect(said).toContain(`## ${left}`);
      expect(said?.includes("## Summary") && left !== "Summary").toBeFalsy();
      expect(Sections.refusal(`${wrapped}\n${body(all)}`)).toBeNull();
    },
  );

  it("scenario: a one-line comment and a fence that closes do not hide the headings after them", () => {
    expect(Sections.refusal(`<!-- a note -->\n\`\`\`text\n## Summary\n\`\`\`\n${body(all)}`)).toBeNull();
    expect(Sections.refusal(`\`\`\`text\n## Summary\n## Evidence\n## Merge Danger\n\`\`\`\n`)).toContain("## Summary");
  });

  // Plants: strip comments before reading code, so a lone `<!--` in inline code or a fence swallows the rest of the body; keep a real comment from hiding its headings.
  it.prop(
    "property: a lone `<!--` in inline code or a fenced block hides nothing, and a comment that closes hides exactly what it holds",
    { place: Schema.Literals(["inline", "fence", "tilde"]), left: Section },
    ({ place, left }) => {
      const lone =
        place === "inline"
          ? "Open one with `<!--` in a page."
          : `${place === "fence" ? "```" : "~~~"}html\n<!--\n${place === "fence" ? "```" : "~~~"}`;

      expect(Sections.refusal(`${lone}\n${body(all)}`)).toBeNull();
      expect(Sections.refusal(`${body(all)}\n${lone}\n`)).toBeNull();

      const kept = all.filter((name) => name !== left);
      const said = Sections.refusal(`${lone}\n${body(kept)}\n<!--\n## ${left}\n-->\n`);

      expect(said).toContain(`## ${left}`);
      expect(Sections.refusal(`<!-- one -->\n${body(all)}\n<!--\n## ${left}\n-->`)).toBeNull();
    },
  );

  // Plant: let an unclosed `<!--` hide the lines after its own.
  it("scenario: a comment that never closes ends at its own line", () => {
    expect(Sections.refusal(`<!-- a note with no end\n${body(all)}`)).toBeNull();
    expect(Sections.refusal(`${body(["Summary", "Evidence"])}\n<!-- never closed\n## Merge Danger\n`)).toBeNull();
  });

  it("scenario: the body that merged as pull request 2320, the placeholder and a New names section, is refused for both", () => {
    const said = Sections.refusal(`${Sections.DRAFT_BODY}\n\n## New names\n\n- \`X\`: the industry's word.\n`);

    expect(said).toContain("still the draft placeholder sentence");
    expect(said).toContain("## Summary, ## Evidence, ## Merge Danger");
  });
});
