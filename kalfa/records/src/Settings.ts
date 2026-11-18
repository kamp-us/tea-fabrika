/**
 * The one setting of the checks (decisions 0069 and 0086, on `@kalfa/config`): the most bytes of
 * instruction files an agent reads in one chain. Nothing else here is a setting: the folders the link
 * check reads and the phrasings the patch check finds are the rules themselves (0605, 0607), and a new
 * phrasing is a pull request.
 */
import * as App from "@kalfa/config/App";
import { Schema } from "effect";

const app = App.make({ name: "kalfa", list: "kalfa config get" });

/**
 * `records.map.max-bytes`, the limit the map size check reads. Environment: `KALFA_RECORDS_MAP_MAX_BYTES`; the repo's file: `.kalfa/kalfa.toml`, `[records.map] max-bytes`.
 *
 * @category settings
 */
export const maxBytes = app.Setting.make("records.map.max-bytes", {
  schema: Schema.Int.check(Schema.isGreaterThan(0)),
  default: 32_768,
  doc:
    "The most bytes of AGENTS.md an agent reads in one chain, root first (0608). Codex's " +
    "project_doc_max_bytes default, https://developers.openai.com/codex/guides/agents-md.",
  scope: ["repo"],
  reload: "restart",
  since: "0.0.0",
});
