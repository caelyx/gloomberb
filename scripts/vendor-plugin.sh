#!/usr/bin/env bash
# Downstream: copies a private plugin repository into vendor/<name> with
# `git subtree --squash`, leaving out paths that must not become public.
#
#   scripts/vendor-plugin.sh <name> <git-url> <commit-or-ref>
#   scripts/vendor-plugin.sh gloom-asx https://github.com/caelyx/gloom-asx.git main
#
# The plugin's history never enters this repository: git subtree --squash
# imports only the filtered tree. The first run adds vendor/<name>; later runs
# merge the new version into it. The filtered commit is rebuilt from the source
# commit with fixed metadata, so its id is the same on every run and machine.
#
# Needs read access to the plugin repository (your own git credentials) and a
# clean working tree. Afterwards: bun install, bun run web:proxy-hosts if the
# plugin's hosts changed, and the checks in docs/private-web-deployment.md.
set -euo pipefail

# Never copied into this (public) repository.
EXCLUDED_PATHS=(CLAUDE.md AGENTS.md .claude docs/research)

name="${1:?usage: $0 <name> <git-url> <commit-or-ref>}"
url="${2:?usage: $0 <name> <git-url> <commit-or-ref>}"
ref="${3:?usage: $0 <name> <git-url> <commit-or-ref>}"
prefix="vendor/${name}"
root="$(git rev-parse --show-toplevel)"

if [ -n "$(git -C "$root" status --porcelain)" ]; then
  echo "The working tree has changes; commit or stash them first." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone --quiet --no-checkout "$url" "$work/src"
source_commit="$(git -C "$work/src" rev-parse --verify "${ref}^{commit}")"

# A parentless commit holding the source commit's tree minus EXCLUDED_PATHS.
# Its id depends only on the source commit and the filter, so a later update
# can rebuild the commit the previous import recorded (subtree needs it, and a
# squashed import does not carry it into this repository).
filtered_commit() {
  local source="$1" tree date
  GIT_INDEX_FILE="$work/index" git -C "$work/src" read-tree "$source"
  GIT_INDEX_FILE="$work/index" git -C "$work/src" rm --cached -r --quiet --ignore-unmatch -- "${EXCLUDED_PATHS[@]}"
  tree="$(GIT_INDEX_FILE="$work/index" git -C "$work/src" write-tree)"
  date="$(git -C "$work/src" show -s --format=%cI "$source")"
  GIT_AUTHOR_NAME=vendor-plugin GIT_AUTHOR_EMAIL=vendor-plugin@invalid GIT_AUTHOR_DATE="$date" \
  GIT_COMMITTER_NAME=vendor-plugin GIT_COMMITTER_EMAIL=vendor-plugin@invalid GIT_COMMITTER_DATE="$date" \
    git -C "$work/src" commit-tree "$tree" -m "${name} ${source} without ${EXCLUDED_PATHS[*]}"
}

filtered="$(filtered_commit "$source_commit")"
git -C "$work/src" update-ref refs/vendor/export "$filtered"
git -C "$root" fetch --quiet "$work/src" refs/vendor/export

if [ -d "$root/$prefix" ]; then
  previous_source="$(git -C "$root" log -1 --format=%B --grep='^vendor-plugin-source: ' -- "$prefix" \
    | sed -n 's/^vendor-plugin-source: //p' | head -1)"
  if [ -z "$previous_source" ]; then
    echo "No vendor-plugin-source line found for ${prefix}; cannot update it with this script." >&2
    exit 1
  fi
  git -C "$work/src" update-ref refs/vendor/previous "$(filtered_commit "$previous_source")"
  git -C "$root" fetch --quiet "$work/src" refs/vendor/previous
fi

message="Vendor ${name} at ${source_commit}

From ${url}, without: ${EXCLUDED_PATHS[*]}.

vendor-plugin-source: ${source_commit}"

if [ -d "$root/$prefix" ]; then
  git -C "$root" subtree merge --prefix="$prefix" --squash -m "$message" "$filtered"
else
  git -C "$root" subtree add --prefix="$prefix" --squash -m "$message" "$filtered"
fi
echo "Vendored ${name} at ${source_commit} into ${prefix} (filtered commit ${filtered})."
