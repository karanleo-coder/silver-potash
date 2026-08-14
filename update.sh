#!/usr/bin/env bash
#
# update.sh — push WheelHost changes to GitHub, and optionally cut a release.
#
# Pushing a commit just updates the repo. Pushing a version TAG is what actually
# triggers .github/workflows/release.yml, which builds the Windows installer
# (WheelHost-Setup.exe) and attaches it to a GitHub Release — that's the "build
# the Windows exe" step, and it only happens on Windows via GitHub Actions
# (there's no way to build/sign a Windows .exe from this machine directly).
#
# Usage:
#   ./update.sh                              Commit any pending changes and push to GitHub.
#   ./update.sh "fix steering deadzone"      Same, with a specific commit message.
#   ./update.sh --release 1.0.1              Commit + push, then tag v1.0.1 and push the tag
#                                             (this is what kicks off the installer build).
#   ./update.sh "message" --release 1.0.1    Both at once.
#
# First run: if this repo has no GitHub remote yet, you'll be prompted for the
# repo URL (e.g. https://github.com/you/wheelhost.git) — create the (empty) repo
# on GitHub first, then run this script and paste its URL when asked.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

BRANCH="main"
RELEASE_VERSION=""
COMMIT_MESSAGE=""

# ---------------------------------------------------------------- arg parsing
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      RELEASE_VERSION="${2:-}"
      if [[ -z "$RELEASE_VERSION" ]]; then
        echo "error: --release needs a version, e.g. --release 1.0.1" >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^#//; s/^ //'
      exit 0
      ;;
    *)
      if [[ -n "$COMMIT_MESSAGE" ]]; then
        echo "error: unexpected extra argument: $1" >&2
        exit 1
      fi
      COMMIT_MESSAGE="$1"
      shift
      ;;
  esac
done

if [[ -n "$RELEASE_VERSION" && ! "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must look like X.Y.Z (e.g. 1.0.1), got: $RELEASE_VERSION" >&2
  exit 1
fi

# ---------------------------------------------------------------- helpers
info()  { echo "==> $*"; }
warn()  { echo "!!  $*" >&2; }

# ---------------------------------------------------------------- ensure repo + remote
if [[ ! -d .git ]]; then
  info "No git repository here yet — initializing one."
  git init -b "$BRANCH"
fi

current_branch="$(git symbolic-ref --short -q HEAD || echo "")"
if [[ -z "$current_branch" ]]; then
  git checkout -b "$BRANCH"
elif [[ "$current_branch" != "$BRANCH" ]]; then
  warn "Currently on branch '$current_branch', not '$BRANCH'. Continuing on '$current_branch'."
  BRANCH="$current_branch"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo
  echo "This repo has no GitHub remote configured yet."
  echo "Create an empty repository on GitHub first (don't initialize it with a"
  echo "README/license — this project already has its own), then paste its URL below."
  echo "Example: https://github.com/yourname/wheelhost.git"
  read -rp "GitHub repo URL: " remote_url
  if [[ -z "$remote_url" ]]; then
    echo "error: no URL entered, aborting." >&2
    exit 1
  fi
  git remote add origin "$remote_url"
  info "Added remote 'origin' -> $remote_url"
fi

# ---------------------------------------------------------------- commit
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  if [[ -z "$COMMIT_MESSAGE" ]]; then
    COMMIT_MESSAGE="Update $(date '+%Y-%m-%d %H:%M')"
  fi
  info "Committing: $COMMIT_MESSAGE"
  git commit -m "$COMMIT_MESSAGE"
else
  info "No local changes to commit."
fi

# ---------------------------------------------------------------- push
info "Pushing '$BRANCH' to origin..."
git push -u origin "$BRANCH"

# ---------------------------------------------------------------- optional release tag
if [[ -n "$RELEASE_VERSION" ]]; then
  tag="v$RELEASE_VERSION"

  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "error: tag $tag already exists locally. Bump the version or delete the tag first." >&2
    exit 1
  fi

  info "Tagging $tag and pushing it — this triggers the Windows installer build on GitHub Actions."
  git tag -a "$tag" -m "WheelHost $tag"
  git push origin "$tag"

  origin_url="$(git remote get-url origin)"
  repo_path="$(echo "$origin_url" | sed -E 's#(git@github\.com:|https://github\.com/)##; s#\.git$##')"

  echo
  info "Done. GitHub Actions is now building WheelHost-Setup.exe for $tag."
  echo "     Watch progress:  https://github.com/$repo_path/actions"
  echo "     Release page:    https://github.com/$repo_path/releases/tag/$tag"
else
  echo
  info "Done. Changes are pushed."
  echo "     To build a new Windows installer release, run:  ./update.sh --release X.Y.Z"
fi
