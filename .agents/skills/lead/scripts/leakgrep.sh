#!/bin/sh
# Today's tooling. Check a unified diff on stdin, a whole draft with --text <file>, or each commit
# `git rev-list <rev>...` names with --commits <rev>... (decision 0048: a push reads each commit it
# sends on its own). A commit is read as its diff from its parent, a first commit as all it holds,
# and a merge as the lines that are new against every parent.
# Private words are literal, case-insensitive strings, one per line, outside the Git tree.
# Diagnostics name only the kind, the added-line number and the commit, never matched text or
# private words.
# In a diff, an added line that only respaces a line the same diff removes, from any file, is old text:
# a line moved between files was already in the tree the diff starts from (0047, amended 2026-11-14).
# In a pnpm patch under patches/, the removed, context and added lines inside its hunks skip only the
# style shapes.
# A line is read the way git writes it: up to the newline, and nothing else ends one.
# In a shallow clone a range may list a commit at the shallow boundary, which git shows as a root
# holding everything: the check deepens the fetch (50, 200, then 1000 commits) until the range lists
# none, and refuses with exit 2 when it still does.
set -eu
# Only deliberate diagnostics use fd 3. Shell and tool failures may contain private paths.
exec 3>&2 2>/dev/null
input=$(mktemp "${TMPDIR:-/tmp}/lg.XXXXXX" 2>/dev/null) || {
    echo 'leakgrep: cannot create check input' >&3; exit 2;
}
trap 'rm -f "$input" 2>/dev/null || :' EXIT HUP INT TERM
usage() { echo 'leakgrep: usage: leakgrep.sh [--text file | --commits rev...]' >&3; exit 2; }
if [ "$#" = 0 ]; then
    cat > "$input" || { echo 'leakgrep: cannot read check input' >&3; exit 2; }; mode=diff
elif [ "$#" = 2 ] && [ "$1" = --text ]; then
    cat -- "$2" > "$input" || { echo 'leakgrep: cannot read check input' >&3; exit 2; }; mode=text
    set -- "$2"
elif [ "$#" -ge 2 ] && [ "$1" = --commits ]; then
    shift; mode=commits
else
    usage
fi
python3 - "$input" "$mode" "$@" <<'PY'
from pathlib import Path
import functools, os, re, subprocess, sys
diagnostics = os.fdopen(3, 'w')

def refuse(why):
    print('leakgrep: ' + why, file=diagnostics)
    sys.exit(2)

where = Path(os.environ.get('FABRIKA_LEAK_WORDS', str(Path.home() / '.fabrika/leak-words')))
tree = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
if tree.returncode:
    refuse('cannot find repository')
try:
    words_path = where.resolve()
    if words_path.is_relative_to(Path(tree.stdout.strip()).resolve()):
        refuse('private words must stay outside the repo')
    try:
        words = [w.strip().casefold() for w in words_path.read_text().splitlines() if w.strip()]
    except FileNotFoundError:
        words = []
        print('leakgrep: private word list is missing; checking built-in shapes only', file=diagnostics)
    # Bytes, then UTF-8: reading as text would rewrite the line ends before the check saw them.
    text = '' if sys.argv[2] == 'commits' else Path(sys.argv[1]).read_bytes().decode('utf-8')
except (OSError, UnicodeError):
    refuse('cannot read check input')

# Only this repository's exact GitHub URL may contain a private account or repo name. The repo moved
# to the kamp-us org; old docs and history keep the old address, so both pass.
repo_urls = ['https://github.com/kamp-us/tea-fabrika', 'https://github.com/usirin/tea-fabrika']
own_url = re.compile('(?:' + '|'.join(map(re.escape, repo_urls)) + ')' + r'(?:\.git)?(?=$|[\s/#?)>]|\.(?=$|[\s)>]))')
# Provider lengths from https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
# npm/GitHub: 36; fine-grained GitHub: 82; OpenAI: 48 legacy, 124 project/service/admin.
# Keep the provider alphabets and minimum lengths, without relying on embedded brand markers.
# OpenSSH's short sk- type names contain punctuation outside these key payloads.
patterns = [
    # Decision 0011: a plain path under /tmp passes; a first part ending in -<number> may hold a user id.
    # Home folders match in their real case (/Users on a Mac, /home on Linux), so a lowercase API
    # path such as GitHub's /users/<name>/keys passes. The temp folders and C:\Users match in any case.
    ('machine_path', re.compile(r'/(?:Users|home)/|(?i:/(?:private/tmp|private/var/folders|var/folders)/|/tmp/[^/\s]*-[0-9]+(?![^/\s"\'`)\]>,;:])|[A-Za-z]:[\\/]Users[\\/])')),
    ('key', re.compile(r'\b(?:npm_[A-Za-z0-9]{36,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{82,}|sk-(?:[A-Za-z0-9]{48,}|(?:proj|svcacct|admin)-[A-Za-z0-9_-]{124,}))|-----BEGIN (?:[A-Z ]*PRIVATE )?KEY-----')),
    ('em_dash', re.compile(chr(0x2014))),
    ('canvas', re.compile(r'https?://(?:claude\.ai/(?:design|artifacts)|[^/\s]*\.claude\.site)(?:[/?#]|$)', re.I)),
]
def kinds_of(line):
    public = own_url.sub('', line).casefold()
    kinds = ['private_word'] if any(w in public for w in words) else []
    return kinds + [kind for kind, pattern in patterns if pattern.search(line)]

# A `pnpm patch` file under the repo's patches/ quotes upstream's removed and context lines byte for
# byte: the patch stops applying if anyone rewords them. Its added lines are often upstream's too: a
# patch built from an upstream pull request carries that pull request's own text, which must stay
# upstream's exact output. So every removed, context and added line inside a patch's hunk skips only
# the shapes here, which are about how our own prose reads. Every secret, path, name and private-word
# shape still reads those lines, and a patch's headers and every other file keep every shape.
style_only = {'em_dash'}

# Whether a file is a pnpm patch, by its path from the repo root.
def is_patch(path):
    return path is not None and path.startswith('patches/')

# Reads the lines of one patch file in order, and says which are a removed, context or added line
# inside one of its hunks.
class Quotes:
    def __init__(self):
        self.in_hunk = False
    def quoted(self, line):
        if line.startswith('diff '): self.in_hunk = False
        if line.startswith('@@ '): self.in_hunk = True; return False
        return self.in_hunk and line.startswith(('-', ' ', '+'))

# The lines inside a patch file's hunks, by their line number in the file as one commit holds it. When
# the file cannot be read or is not UTF-8 there are none, so every shape reads its lines.
@functools.cache
def quoted_lines(commit, path):
    ran = subprocess.run(['git', 'cat-file', 'blob', f'{commit}:{path}'], capture_output=True, stdin=subprocess.DEVNULL)
    try:
        lines = [] if ran.returncode else ran.stdout.decode('utf-8').split('\n')
    except UnicodeError:
        lines = []
    quotes = Quotes()
    return {number: line for number, line in enumerate(lines, 1) if quotes.quoted(line)}

# Ticket 500 (owner, 2026-11-09): a line that only changes spacing is old text. Two lines hold the
# same text when they are equal after each run of spaces and tabs becomes one space, the ends are
# trimmed and one last ; or , is dropped. Runs are collapsed, never deleted, so two words never join.
# A carriage return before the newline is part of the line end here, as it always was. The scan
# itself still reads it.
def same_text(line):
    text = re.sub(r'[ \t]+', ' ', line.removesuffix('\r')).strip(' ')
    return text[:-1].rstrip(' ') if text.endswith((';', ',')) else text

# The hits of one diff or one draft, as (line number in the input, place, kind), and how many flagged
# lines were read as old text. A place is the new file's header and the line's number in that file.
# A commit's diff names that commit, which holds the new side of every file in it.
def scan(text, mode, clears=True, draft=None, commit=None):
    added = []
    # The hits of each removed line, by text. Only a hunk under git's own `diff --git` header counts, so
    # a removal clears a line in any file of the same diff, never another commit's diff or a diff git did
    # not write.
    removed = {}
    # Which diff a line belongs to. Git names each file once per diff, so a file named again starts a
    # new one: diffs read back to back never clear each other.
    part = 0
    named = set()
    file = None
    in_hunk = False
    old_header = False
    path = None
    # A commit's diff often starts a hunk inside one of the patch's own hunks, so each of its lines is
    # quoted only when the patch file the commit holds has that same line inside a hunk at that same
    # number. A diff on stdin names no commit: a patch file's lines are read from the top of each hunk
    # git wrote for it, and a hunk that starts inside one of the patch's own hunks has no `@@` to start
    # from, so all its lines keep every shape. A draft is read from its first line.
    quotes = Quotes() if mode != 'diff' and is_patch(draft) else None
    new = 0
    for number, line in enumerate(text.split('\n'), 1):
        if mode == 'diff':
            if line.startswith('diff '): file = number if line.startswith('diff --git ') else None; quotes = None
            if line.startswith('diff --git '):
                in_hunk = False; path = None
                if line in named: part += 1; named = set()
                named.add(line)
            if line.startswith('@@ '):
                in_hunk = True
                start = re.match(r'@@ -\S+ \+(\d+)', line)
                new = int(start.group(1)) if start else 0
                patch = start and path and path.startswith('+++ b/') and is_patch(path[6:])
                quotes = (quoted_lines(commit, path[6:]) if commit else Quotes()) if patch else None
            header = line.startswith('+++ ') and not in_hunk and old_header
            old_header = line.startswith('--- ') and not in_hunk
            if header: path = line
            if line.startswith('-') and in_hunk and file is not None:
                removed.setdefault((part, same_text(line[1:])), []).append(kinds_of(line[1:]))
            if in_hunk and line.startswith((' ', '+')): new += 1
            quoted = in_hunk and line.startswith((' ', '+')) and quotes is not None and (
                quotes.get(new - 1) == line[1:] if commit else quotes.quoted(line[1:]))
            if not line.startswith('+') or header:
                continue
            added.append((number, part if in_hunk and file is not None else None, (path, new - 1) if in_hunk else (None, number), line[1:], quoted))
        else:
            added.append((number, None, (None, number), line, quotes is not None and quotes.quoted(line)))
    hits = []
    respaced = 0
    for number, file, place, line, quoted in added:
        kinds = [kind for kind in kinds_of(line) if not (quoted and kind in style_only)]
        # One removed line clears one added line, and only the kinds of hit it had itself.
        old = removed.get((file, same_text(line))) if kinds and clears and file is not None else None
        if old:
            cleared = old.pop(0)
            respaced += all(kind in cleared for kind in kinds)
            kinds = [kind for kind in kinds if kind not in cleared]
        hits += [(number, place, kind) for kind in kinds]
    return hits, respaced

def git(*args):
    ran = subprocess.run(['git', *args], capture_output=True, stdin=subprocess.DEVNULL)
    if ran.returncode:
        refuse('cannot read the commits')
    try:
        return ran.stdout.decode('utf-8')
    except UnicodeError:
        refuse('cannot read check input')

# The hits of one commit, as (line number in its diff from its first parent, kind).
def commit_hits(commit, parents):
    # The diff flags are the ones the bot's push reads its net diff with.
    # Decision 0047: a merge clears nothing, so a respaced line in a merge is new text.
    read = [scan(git('diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=0', parent, commit, '--'), 'diff', len(parents) < 2, commit=commit)
            for parent in parents or [git('hash-object', '-t', 'tree', '--stdin').strip()]]
    hits, respaced = read[0]
    # A merge: a line is new only when it is new against every parent. What one parent already
    # held was read with that parent's own commits, or is already on the remote.
    for other, _ in read[1:]:
        places = {(place, kind) for _, place, kind in other}
        hits = [hit for hit in hits if hit[1:] in places]
    return [(number, kind) for number, _, kind in hits], respaced

def asks(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True, stdin=subprocess.DEVNULL,
                          env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})

def is_shallow():
    return asks('rev-parse', '--is-shallow-repository').stdout.strip() == 'true'

# Fetches `more` commits of history past the shallow boundary of every ref the clone follows.
def deepen(more):
    asks('fetch', f'--deepen={more}')

# The commits in .git/shallow are grafted roots: git shows them with no parents, though they are old.
def boundary():
    if not is_shallow():
        return set()
    return set(Path(asks('rev-parse', '--git-path', 'shallow').stdout.strip()).read_text().split())

def listed(revs):
    return [line.split() for line in asks('rev-list', '--parents', *revs, '--').stdout.split('\n') if line]

# A shallow clone cuts the history of the base as well as the branch: git then lists commits as the
# branch's own that the base already holds, ending in a grafted commit or in a root with no parents.
# Deepen while the range lists either, until the clone is whole, and refuse when the steps run out.
# Stopping at the first merge base is not enough: a branch that merged main in has older parents of
# its own.
def reach_bases(revs):
    steps = iter((50, 200, 1000))
    def unsure():
        grafted = boundary()
        return is_shallow() and any(commit[0] in grafted or len(commit) == 1 for commit in listed(revs))
    while unsure():
        more = next(steps, None)
        if more is None:
            refuse('a commit at this shallow clone\'s boundary is still in the range after deepening; fetch more history')
        deepen(more)

bad = 0
respaced = 0
if sys.argv[2] == 'commits':
    if is_shallow():
        reach_bases(sys.argv[3:])
    # The commits in .git/shallow are grafted roots: git shows them with no parents, though they are
    # old, so they are never read as new.
    grafted = boundary()
    # Oldest first, each with its parents. No path limits, so the parents are the real ones.
    commits = [line.split() for line in git('rev-list', '--reverse', '--parents', *sys.argv[3:], '--').split('\n') if line]
    # A boundary commit still in the list was not reached past by a range: reading it would scan old
    # history as new, and skipping it could miss the branch's own text, so refuse.
    if any(commit[0] in grafted for commit in commits):
        refuse('a commit at this shallow clone\'s boundary is in the range; give a base..head range or fetch more history')
    for commit, *parents in commits:
        hits, old = commit_hits(commit, parents)
        respaced += old
        for number, kind in hits:
            print(f'leakgrep: leak {kind} at added line {number} of commit {commit[:12]}', file=diagnostics)
            bad += 1
    clean = f'leakgrep: {len(commits)} commits read, added text clean'
else:
    # A draft's path from the repo root, when it is a file inside the repo. Stdin has none.
    draft = None
    if sys.argv[2] == 'text' and sys.argv[3] != '-':
        try:
            draft = Path(sys.argv[3]).resolve().relative_to(Path(tree.stdout.strip()).resolve()).as_posix()
        except (OSError, RuntimeError, ValueError):
            draft = None
    hits, respaced = scan(text, sys.argv[2], draft=draft)
    for number, _, kind in hits:
        print(f'leakgrep: leak {kind} at added line {number}', file=diagnostics)
        bad += 1
    clean = 'leakgrep: added text clean'
if respaced:
    print(f'leakgrep: {respaced} flagged lines only respace or move a removed line of the same diff; read as old text', file=diagnostics)
if not bad:
    print(clean)
sys.exit(1 if bad else 0)
PY
