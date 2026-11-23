// The real routes the laws of this package are written over. Each is a route of GitHub's REST description as
// `@octokit/openapi-types` 29.0.1 types it, written in GitHub's own route text. A law reads its vectors by name here, so
// a route is spelled once.

/** The routes the plan names as vectors, one for each kind of shape a route can have. */
export const CANCEL = "POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel"; // path names, a bare 202, no body

export const CHECK_RUNS = "GET /repos/{owner}/{repo}/commits/{ref}/check-runs"; // optional query, a closed 200

export const CREATE_ISSUE = "POST /repos/{owner}/{repo}/issues"; // a required body, a 201

export const INSTALLATION_TOKEN = "POST /app/installations/{installation_id}/access_tokens"; // an optional body, nested keys

export const DISPATCH = "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"; // a 200 and a 204, free keys

export const GET_BRANCH = "GET /repos/{owner}/{repo}/branches/{branch}"; // a name that holds slashes

export const GET_PULL = "GET /repos/{owner}/{repo}/pulls/{pull_number}";

export const ZEN = "GET /zen"; // answers text, no path name

export const LANGUAGES = "GET /repos/{owner}/{repo}/languages"; // answers an open object

export const DELETE_ORG = "DELETE /orgs/{org}"; // a 202 whose schema is a bare object

export const DELETE_COMMENT = "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}"; // a 204, no body at all

/** The other two methods of the description, each with a route of its own, so a method left out of the `Method` Schema shows. */
export const STAR = "PUT /user/starred/{owner}/{repo}"; // a 204, no body

export const UPDATE_ISSUE = "PATCH /repos/{owner}/{repo}/issues/{issue_number}"; // an optional body

/** More real routes the type laws need: a required query parameter, an answer that is a `OneOf`, and a 200 beside a 204 with no body. */
export const SEARCH_ISSUES = "GET /search/issues"; // `q` is required

export const CONTRIBUTORS = "GET /repos/{owner}/{repo}/contributors"; // a 200 with a body beside a 204 with none, and no payload

export const MERGE_RESULT = "GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}"; // `details` is a `OneOf` of three objects

/** The routes the laws of 1945's first slice call: a plain JSON read, and a read whose answer a media type changes to text. */
export const GET_REPO = "GET /repos/{owner}/{repo}";

export const README = "GET /repos/{owner}/{repo}/readme";

/** Every vector, with the method and the path template its route text holds. */
export const VECTORS = [
  { route: CANCEL, method: "POST", path: "/repos/{owner}/{repo}/actions/runs/{run_id}/cancel" },
  { route: CHECK_RUNS, method: "GET", path: "/repos/{owner}/{repo}/commits/{ref}/check-runs" },
  { route: CREATE_ISSUE, method: "POST", path: "/repos/{owner}/{repo}/issues" },
  { route: INSTALLATION_TOKEN, method: "POST", path: "/app/installations/{installation_id}/access_tokens" },
  { route: DISPATCH, method: "POST", path: "/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches" },
  { route: GET_BRANCH, method: "GET", path: "/repos/{owner}/{repo}/branches/{branch}" },
  { route: GET_PULL, method: "GET", path: "/repos/{owner}/{repo}/pulls/{pull_number}" },
  { route: ZEN, method: "GET", path: "/zen" },
  { route: LANGUAGES, method: "GET", path: "/repos/{owner}/{repo}/languages" },
  { route: DELETE_ORG, method: "DELETE", path: "/orgs/{org}" },
  { route: STAR, method: "PUT", path: "/user/starred/{owner}/{repo}" },
  { route: UPDATE_ISSUE, method: "PATCH", path: "/repos/{owner}/{repo}/issues/{issue_number}" },
  { route: DELETE_COMMENT, method: "DELETE", path: "/repos/{owner}/{repo}/issues/comments/{comment_id}" },
] as const;

/**
 * R1: the routes whose answer `route` can check only at run time, read from the types of Octokit 29.0.1 (made from
 * the release 23.0.1 of GitHub's description). Eight have no success status (the logs and archive routes, the two
 * source archives), four answer something other than JSON, and five answer a JSON object that has an index signature,
 * so the walk over the answer stops there.
 */
export const RUN_TIME_ONLY = [
  // no success status
  "GET /orgs/{org}/migrations/{migration_id}/archive",
  "GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}",
  "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
  "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/logs",
  "GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs",
  "GET /repos/{owner}/{repo}/tarball/{ref}",
  "GET /repos/{owner}/{repo}/zipball/{ref}",
  "GET /user/migrations/{migration_id}/archive",
  // an answer that is not JSON
  "GET /octocat",
  "GET /zen",
  "POST /markdown",
  "POST /markdown/raw",
  // a JSON answer that is an open object
  "GET /emojis",
  "GET /orgs/{org}/copilot/billing",
  "GET /orgs/{org}/copilot/content_exclusion",
  "GET /repos/{owner}/{repo}/languages",
  "POST /app-manifests/{code}/conversions",
] as const;
