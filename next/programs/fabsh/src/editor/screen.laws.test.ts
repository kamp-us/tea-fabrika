// next/, S1. Faults run in CI after build, once each, then restore.
import { expect, it } from "@effect/vitest";
import { runsFor } from "@kampus/vitest";
import { Match, Schema } from "effect";
import { roles } from "../roles.ts";
import { paint, shown } from "./screen.ts";

const sgrMatches = (text: string) => {
  const matches: Array<{ index: number; end: number; parameters: string }> = [];

  for (let start = 0; start < text.length;) {
    const index = text.indexOf("\x1b[", start);

    if (index < 0) {
      break;
    }

    let end = index + 2;

    while (end < text.length) {
      const code = text.charCodeAt(end);

      if ((code >= 0x30 && code <= 0x39) || code === 0x3b) {
        end += 1;
      } else {
        break;
      }
    }

    if (text.charAt(end) === "m") {
      matches.push({ index, end: end + 1, parameters: text.slice(index + 2, end) });
      start = end + 1;
    } else {
      start = index + 1;
    }
  }

  return matches;
};

const withoutSgr = (text: string) => {
  let result = "";
  let end = 0;

  for (const match of sgrMatches(text)) {
    result += text.slice(end, match.index);
    end = match.end;
  }

  return `${result}${text.slice(end)}`;
};

const hasTruecolorSgr = (text: string) => {
  for (let start = 0; start < text.length;) {
    const index = text.indexOf("\x1b[", start);

    if (index < 0) {
      return false;
    }

    const end = text.indexOf("m", index + 2);
    const stop = end < 0 ? text.length : end;

    for (let at = index + 2; at < stop; at += 1) {
      if (
        (at === index + 2 || text.charAt(at - 1) === ";") &&
        (text.startsWith("38;2;", at) || text.startsWith("48;2;", at))
      ) {
        return true;
      }
    }

    start = index + 2;
  }

  return false;
};

const hasRenderedControl = (text: string) =>
  [...text].some((char) => {
    const codepoint = char.codePointAt(0) ?? 0;
    return (
      codepoint <= 0x08 ||
      (codepoint >= 0x0b && codepoint <= 0x0c) ||
      (codepoint >= 0x0e && codepoint <= 0x1f) ||
      (codepoint >= 0x7f && codepoint <= 0x9f)
    );
  });

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
    for (const match of sgrMatches(bytes)) {
      const plain = bytes.slice(at, match.index);

      if (plain.includes(name)) {
        expect(underline).toBe(true);
        expect(color).toBe(true);
        painted += plain;
      }

      for (const code of (match.parameters || "0").split(";").map(Number)) {
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

      at = match.end;
    }

    expect(painted).toContain(name);
    expect(hasTruecolorSgr(bytes)).toBe(false);
    expect(withoutSgr(bytes)).toBe(line);
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
      expect(hasRenderedControl(safe)).toBe(false);
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
