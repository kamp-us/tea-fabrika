/**
 * Reading the body of a Markdown file into a document: mdast's tree of its parts.
 */
import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

// GitHub's Markdown, less the task-list check. For an empty list item followed by a line that starts with `[ ]`, that part
// throws in micromark's development build and, in its default build, drops the `[ ]` and puts a `checked` field on the
// root. With it off, `- [ ] a` is an item whose text is `[ ] a`, and nothing is lost. The options hold no state, so one
// object serves every call.
const READ = {
  extensions: [gfm(), { disable: { null: ["tasklistCheck"] } }],
  mdastExtensions: [gfmFromMarkdown()],
};

/**
 * A body read into a tree of its parts: mdast's `Root`.
 *
 * @category models
 */
export type Document = Root;

/**
 * Reads a body into its document.
 *
 * **Details**
 *
 * Any text is a document, so this cannot fail, runs no Effect and makes no span. It reads CommonMark with GitHub's Markdown
 * (tables, strikethrough, footnotes and link literals), except the task-list check. Two bodies that differ only in how they
 * are typed (`**x**` and `__x__`, `-` and `*`) give the same document once every `position` is left out. Every position
 * counts from the start of the body, so a caller with a whole file passes `Frontmatter.split(text).body`.
 *
 * @category constructors
 */
export const parse = (body: string): Document => fromMarkdown(body, READ);
