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

  it("scenario: the body that merged as pull request 2320, the placeholder and a New names section, is refused for both", () => {
    const said = Sections.refusal(`${Sections.DRAFT_BODY}\n\n## New names\n\n- \`X\`: the industry's word.\n`);

    expect(said).toContain("still the draft placeholder sentence");
    expect(said).toContain("## Summary, ## Evidence, ## Merge Danger");
  });
});
