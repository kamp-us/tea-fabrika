#!/bin/sh
# runplan.sh <name> <brief-file>: run a read-only plan writer in the main checkout.
# The plan is Codex's last message, saved as $BOXES/<name>-plan.md; its events and requested profile
# go to <name>-plan.jsonl and <name>-plan.jsonl.profile.
# Run it in the background: a plan takes 10 to 30 minutes.
set -eu
. "$(dirname "$0")/env.sh"
name=$1; brief=$2
mkdir -p "$BOXES"
printf 'model\t%s\neffort\t%s\n' "$CODEX_PLAN_MODEL" "$CODEX_PLAN_EFFORT" > "$BOXES/$name-plan.jsonl.profile"
exec sh "$(dirname "$0")/redact.sh" --run "$MAIN" "$brief" "$BOXES/$name-plan.md" "$BOXES/$name-plan.jsonl" \
	nice -n 15 codex exec --ignore-user-config -m "$CODEX_PLAN_MODEL" -c model_reasoning_effort="$CODEX_PLAN_EFFORT" \
	-s read-only -C "$MAIN" --json -o "$BOXES/$name-plan.md" -
