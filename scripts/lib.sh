# Shared helpers for scripts/setup, scripts/doctor and scripts/check. Source it; do not run it.
# LKM-648. See AGENTS.md for the toolchain these pin.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/exact-app"

# The Exact source checkout the app builds against, and the commit it must be at (exact.pin).
EXACT_REPO_URL="https://github.com/expo/exact"
EXACT_DIR="${EXACT_DIR:-$HOME/dev/exact}"
EXACT_PIN="$(tr -d '[:space:]' <"$ROOT/exact.pin")"
# exact-app/exact.mjs finds the checkout through EXACT2 (else its committed relative path, ../../exact from the
# main checkout). Naming it makes the scripts work from any worktree location.
export EXACT2="$EXACT_DIR"

# The iOS build's Cargo target, shared by every worktree so only the first iOS build on this Mac is cold.
IOS_TARGET_DIR="${GOOD_TIME_IOS_TARGET:-$HOME/.cache/good-time/exact-target}"

# Bun 1.4.2, installed beside the default Bun (~/.bun stays as it is). Exact's package.json pins it.
BUN_VERSION="1.4.2"
BUN_HOME="${EXACT_BUN_HOME:-$HOME/.bun-$BUN_VERSION}"
BUN="$BUN_HOME/bin/bun"

# Pinned Bun and rustup's Cargo first, for this process and every child (Exact's scripts spawn `bun` and `cargo`).
export PATH="$BUN_HOME/bin:$HOME/.cargo/bin:$PATH"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
# Never send Exact's usage diary anywhere from automation.
export EXACT_FEEDBACK=0

fail() {
  echo "error: $*" >&2
  exit 1
}

step() {
  echo "==> $*"
}

# require <command> <how to get it>
require() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is missing. $2"
}

exact_head() {
  git -C "$EXACT_DIR" rev-parse HEAD 2>/dev/null || true
}

# Elapsed seconds since $1 (an epoch second).
since() {
  echo $(($(date +%s) - $1))
}
