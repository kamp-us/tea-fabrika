// next/, S1. Faults run in CI after build, once each, then restore.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Match, Schema } from "effect";
import { roles } from "../roles.ts";
import { paint, shown } from "./screen.ts";

// L5 fault: drop SGR 4 while retaining the error's palette color.
it.prop(
  "L5 the error text is underlined and uses the terminal palette",
  { text: Schema.String },
  ({ text }) => {
    const name = `absent${Array.from(text, (c) => (c.codePointAt(0) ?? 0).toString(16)).join("")}`;
    const line = `${name} `;
    const spans = roles(line, new Map());
    expect(
      spans.some((span) =>
        Match.value(span.role).pipe(
          Match.tag("error", () => true),
          Match.orElse(() => false),
        ),
      ),
    ).toBe(true);
    const bytes = paint(line, spans);
    let underline = false;
    let color = false;
    let at = 0;
    let painted = "";
    const sgr = /\x1b\[([0-9;]*)m/g;

    for (const match of bytes.matchAll(sgr)) {
      const plain = bytes.slice(at, match.index);

      if (plain.includes(name)) {
        expect(underline).toBe(true);
        expect(color).toBe(true);
        painted += plain;
      }

      for (const code of (match[1] || "0").split(";").map(Number)) {
        if (code === 0) {
          underline = false;
          color = false;
        } else if (code === 4) {
          underline = true;
        } else if (code === 24) {
          underline = false;
        } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
          color = true;
        } else if (code === 39) {
          color = false;
        }
      }

      at = match.index + match[0].length;
    }

    expect(painted).toContain(name);
    expect(bytes).not.toMatch(/\x1b\[(?:[^m]*;)?(?:38|48);2;/);
    expect(bytes.replace(sgr, "")).toBe(line);
  },
  { arbitrary: { runs: runsFor({ fast: 100, full: 100 }) } },
);

// L15 fault: pass OSC through shown rather than rendering its controls visibly.
it.prop(
  "L15 program text cannot send cursor, title, erase or terminal-control sequences",
  {
    text: Schema.String,
    number: Schema.Int,
  },
  ({ text, number }) => {
    const payloads = [
      text,
      `before\x1b]0;${text}\x07after`,
      `\x1b]2;${text}\x1b\\`,
      `\x1b[${Math.abs(number)}A${text}\x1b[2J`,
      `\x9d2;${text}\x9c`,
      `\x1bP${text}\x1b\\`,
    ];

    for (const payload of payloads) {
      const safe = shown(payload);
      expect(safe).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/);
      expect(safe.replaceAll("\r\n", "")).not.toContain("\r");
      const printable = [...payload].filter((c) => {
        const cp = c.codePointAt(0) ?? 0;
        return cp >= 0x20 && cp !== 0x7f && (cp < 0x80 || cp > 0x9f);
      });
      let at = 0;

      for (const char of printable) {
        at = safe.indexOf(char, at);
        expect(at).toBeGreaterThanOrEqual(0);
        at += char.length;
      }
    }
  },
  { arbitrary: { runs: runsFor({ fast: 300, full: 300 }) } },
);
