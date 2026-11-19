# env.sh: shared paths for the lead's scripts. Sourced, never run. Every value can be set from outside.
#   MAIN    the main checkout, found from this script's own repo (a worktree finds its main checkout)
#   BOXES   where the boxes and saved plans live, beside the main checkout by default
#   REMOTE  the clone URL, read from the main checkout's origin
#   GH_REPO owner/name on GitHub, read from REMOTE
lead_here=$(cd "$(dirname "$0")" && pwd -P)
MAIN=${MAIN:-$(dirname "$(git -C "$lead_here" rev-parse --path-format=absolute --git-common-dir)")}
BOXES=${BOXES:-$(dirname "$MAIN")/boxes}
REMOTE=${REMOTE:-$(git -C "$MAIN" remote get-url origin)}
GH_REPO=${GH_REPO:-$(printf '%s\n' "$REMOTE" | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')}
# The person rides as Co-authored-by on the bot's commits.
FABRIKA_COAUTHOR=${FABRIKA_COAUTHOR:-"$(git config --global user.name) <$(git config --global user.email)>"}
# Coordination and judgment keep local.env's existing CODEX_MODEL/EFFORT behavior and defaults.
# Explicit launch values override the matching field for each role independently; coordination
# values from local.env or defaults are never role fallbacks.
# These settings live beside the lead skill in the main checkout, in ignored local.env.
#   CODEX_MODEL=gpt-6.2-sol
#   CODEX_EFFORT=high
# Save launch overrides before local.env supplies coordination values. Keep the marker so a child
# that sources env.sh again does not mistake resolved coordination values for new launch overrides.
if [ "${FABRIKA_CODEX_LAUNCH_CAPTURED:-}" = 1 ]; then
	launch_model=${FABRIKA_CODEX_LAUNCH_MODEL:-}
	launch_effort=${FABRIKA_CODEX_LAUNCH_EFFORT:-}
	[ "${CODEX_MODEL+x}" != x ] || launch_model=$CODEX_MODEL
	[ "${CODEX_EFFORT+x}" != x ] || launch_effort=$CODEX_EFFORT
else
	launch_model=${CODEX_MODEL:-}
	launch_effort=${CODEX_EFFORT:-}
	FABRIKA_CODEX_LAUNCH_MODEL=$launch_model
	FABRIKA_CODEX_LAUNCH_EFFORT=$launch_effort
	FABRIKA_CODEX_LAUNCH_CAPTURED=1
fi
# A saved launch choice still feeds local.env's conditional coordination defaults on child runs.
if [ "${CODEX_MODEL+x}" != x ] && [ -n "$launch_model" ]; then CODEX_MODEL=$launch_model; fi
if [ "${CODEX_EFFORT+x}" != x ] && [ -n "$launch_effort" ]; then CODEX_EFFORT=$launch_effort; fi
# shellcheck disable=SC1091
[ -f "$MAIN/.agents/skills/lead/local.env" ] && . "$MAIN/.agents/skills/lead/local.env"
CODEX_MODEL=${CODEX_MODEL:-gpt-6.2-sol}
CODEX_EFFORT=${CODEX_EFFORT:-high}
CODEX_PLAN_MODEL=${CODEX_PLAN_MODEL:-gpt-6.2-astra}
CODEX_PLAN_EFFORT=${CODEX_PLAN_EFFORT:-high}
CODEX_BUILD_MODEL=${CODEX_BUILD_MODEL:-gpt-6-luna}
CODEX_BUILD_EFFORT=${CODEX_BUILD_EFFORT:-max}
CODEX_REVIEW_MODEL=${CODEX_REVIEW_MODEL:-gpt-6.2-sol}
CODEX_REVIEW_EFFORT=${CODEX_REVIEW_EFFORT:-xhigh}
if [ -n "$launch_model" ]; then
	CODEX_PLAN_MODEL=$launch_model
	CODEX_BUILD_MODEL=$launch_model
	CODEX_REVIEW_MODEL=$launch_model
fi
if [ -n "$launch_effort" ]; then
	CODEX_PLAN_EFFORT=$launch_effort
	CODEX_BUILD_EFFORT=$launch_effort
	CODEX_REVIEW_EFFORT=$launch_effort
fi
FABRIKA_CODEX_LAUNCH_MODEL=$launch_model
FABRIKA_CODEX_LAUNCH_EFFORT=$launch_effort
FABRIKA_COORD_MODEL=$CODEX_MODEL
FABRIKA_COORD_EFFORT=$CODEX_EFFORT
unset CODEX_MODEL CODEX_EFFORT
export MAIN BOXES REMOTE GH_REPO FABRIKA_COAUTHOR FABRIKA_COORD_MODEL FABRIKA_COORD_EFFORT
export FABRIKA_CODEX_LAUNCH_CAPTURED FABRIKA_CODEX_LAUNCH_MODEL FABRIKA_CODEX_LAUNCH_EFFORT
export CODEX_PLAN_MODEL CODEX_PLAN_EFFORT CODEX_BUILD_MODEL CODEX_BUILD_EFFORT CODEX_REVIEW_MODEL CODEX_REVIEW_EFFORT
