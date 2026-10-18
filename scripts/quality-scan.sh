#!/usr/bin/env bash
# Quality scan: tests with coverage, dependency vulnerabilities (OSV-Scanner
# over pnpm-lock.yaml), StrykerJS mutation testing (the files changed since
# main on a branch, every file on main), then a SonarQube analysis that imports
# all of it.
#
# Reporting only: findings never fail the run, and an unreachable SonarQube
# server or missing SONAR_TOKEN prints a "skipped" line and exits 0. The only
# non-zero exit is a failing test suite. Arguments are ignored, so the script
# also works as a git pre-push hook.
#
# Environment:
#   SONAR_TOKEN        analysis token; handed to sonar-scanner only, never
#                      printed and never inherited by the tests or tools
#   SONAR_REQUIRED     set to 1 to exit 1 before anything runs when SONAR_TOKEN
#                      is empty, for unattended runs (cron) whose only purpose
#                      is the upload and whose secret lookup can come back empty
#   SONAR_HOST_URL     default http://192.168.42.33:9001
#   SONAR_BRANCH       branch to analyse; default: the checked-out branch.
#                      A detached HEAD is not uploaded unless this is set.
#   STRYKER_MODE       diff, full, or off. Default: full on main, because
#                      SonarQube closes every mutant a main analysis does not
#                      report again (--incremental keeps reruns cheap after
#                      the first run, which takes hours); diff elsewhere
#   STRYKER_DIFF_REF   base for diff mode; default: merge-base with main
set -uo pipefail

# Only sonar-scanner needs the token: keep it out of every other process.
sonar_token=${SONAR_TOKEN:-}
unset SONAR_TOKEN

if [ "${SONAR_REQUIRED:-}" = 1 ] && [ -z "$sonar_token" ]; then
  printf '==> quality scan: aborted (SONAR_REQUIRED=1 and SONAR_TOKEN is empty)\n' >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)" || exit 1

OUT=.cache/quality
TOOLS=.cache/quality-tools
HOST=${SONAR_HOST_URL:-http://192.168.42.33:9001}
HOST=${HOST%/}
PROJECT_KEY=zakna_backpass
BRANCH=${SONAR_BRANCH:-$(git symbolic-ref --short -q HEAD || true)}
if [ "$BRANCH" = main ]; then
  MODE=${STRYKER_MODE:-full}
else
  MODE=${STRYKER_MODE:-diff}
fi

rm -rf "$OUT"
mkdir -p "$OUT" "$TOOLS"

say() { printf '==> %s\n' "$*"; }

# SonarQube closes every external issue an analysis does not report again, so
# a scan missing the OSV or the mutation report is never uploaded: that would
# mark the previous findings fixed. `incomplete` names what is missing.
incomplete=

# tool NAME PACKAGE VERSION: print the path of a pinned Go tool, building it
# into .cache/quality-tools on first use.
tool() {
  local bin="$PWD/$TOOLS/$1@$3"
  if [ ! -x "$bin" ]; then
    command -v go >/dev/null || return 1
    local tmp
    tmp=$(mktemp -d) || return 1
    if ! GOBIN="$tmp" go install "$2@$3" >&2; then
      rm -rf "$tmp"
      return 1
    fi
    mv "$tmp/$1" "$bin" && rm -rf "$tmp"
  fi
  printf '%s\n' "$bin"
}

# --- 1. tests + coverage ----------------------------------------------------
# Same isolation as `pnpm test`; coverage goes to lcov for SonarQube.
say "node --test with coverage"
node --import ./test/helpers/isolate-config.js --test --experimental-test-coverage \
  --test-coverage-include='src/**' --test-coverage-include='bin/**' \
  --test-coverage-include='scripts/**' \
  --test-reporter=tap --test-reporter-destination="$OUT/test.tap" \
  --test-reporter=lcov --test-reporter-destination="$OUT/lcov.info" \
  "test/**/*.test.js" >/dev/null 2>"$OUT/test.log"
test_status=$?
if [ "$test_status" -eq 0 ]; then
  say "tests: passed"
else
  say "tests: FAILED (details in $OUT/test.tap)"
fi
if [ -s "$OUT/lcov.info" ]; then
  say "line coverage: $(awk -F: '/^LF:/ {f += $2} /^LH:/ {h += $2} END {if (f) printf "%.1f%%", 100 * h / f}' "$OUT/lcov.info")"
fi

# --- 2. dependency vulnerabilities ------------------------------------------
if osv=$(tool osv-scanner github.com/google/osv-scanner/v2/cmd/osv-scanner v2.7.0); then
  say "OSV-Scanner"
  # Offline mode downloads the npm database and sends no package list to
  # osv.dev. Exit 1 only means vulnerabilities were found.
  "$osv" scan source --offline-vulnerabilities --download-offline-databases \
    -L pnpm-lock.yaml --format sarif --output-file "$OUT/osv.sarif" >"$OUT/osv.log" 2>&1
  osv_status=$?
  if [ "$osv_status" -gt 1 ]; then
    say "OSV-Scanner: error $osv_status, see $OUT/osv.log"
    rm -f "$OUT/osv.sarif"
  fi
else
  say "OSV-Scanner: skipped (could not build it; needs Go)"
fi
[ -s "$OUT/osv.sarif" ] || incomplete="no OSV-Scanner report"


# --- 3. mutation testing ----------------------------------------------------
stryker() {
  local args=()
  if [ "$MODE" = off ]; then
    say "Stryker: skipped (STRYKER_MODE=off)"
    incomplete="STRYKER_MODE=off"
    return
  elif ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit((a === 22 && b >= 18) || (a === 24 && b >= 11) || a > 24 ? 0 : 1)'; then
    # StrykerJS's Babel 8 dependencies declare node ^22.18.0 || >=24.11.0, above
    # the CLI's own >=22.5.0 floor; on an older runtime it is not run at all.
    say "Stryker: skipped (needs Node 22.18+ or 24.11+, found $(node -v))"
    incomplete="Node $(node -v) is below StrykerJS's floor"
    return
  elif [ "$MODE" = full ]; then
    # Incremental: a rerun only retests mutants whose code or test file
    # changed. Stryker cannot see any other input, so the results file is
    # keyed by a hash of the config, test helpers, fixtures and dependencies;
    # changing any of them starts a fresh full run.
    local key
    key=$(git ls-files -z -co --exclude-standard -- stryker.config.mjs package.json pnpm-lock.yaml \
      test/helpers test/fixtures | sort -z | xargs -0 cat | git hash-object --stdin | cut -c1-12)
    find .cache/stryker -name 'incremental-*.json' ! -name "incremental-$key.json" -delete 2>/dev/null
    args=(--incremental --incrementalFile ".cache/stryker/incremental-$key.json")
    say "Stryker (full run of src/, bin/ and scripts/)"
  else
    local ref=${STRYKER_DIFF_REF:-} base files
    if [ -z "$ref" ]; then
      for base in origin/main main; do
        ref=$(git merge-base HEAD "$base" 2>/dev/null) && break
      done
      [ -n "$ref" ] || ref=HEAD~1
    fi
    files=$(git diff --name-only --diff-filter=d "$ref" -- 'src/*.js' 'bin/*.js' 'scripts/*.js' | paste -sd, -)
    if [ -z "$files" ]; then
      say "Stryker: skipped (no src/, bin/ or scripts/ file changed since $ref)"
      # Nothing to mutate is a complete result: no mutant issues.
      printf '{"rules":[],"issues":[]}\n' >"$OUT/sonar-mutants.json"
      return
    fi
    args=(--mutate "$files")
    say "Stryker (files changed since $ref: ${files//,/ })"
  fi
  # Half the cores: with every core busy, test files time out and the score
  # means nothing.
  local workers=$(($(getconf _NPROCESSORS_ONLN) / 2))
  [ "$workers" -ge 1 ] || workers=1
  pnpm exec stryker run --concurrency "$workers" "${args[@]}" >"$OUT/stryker.log" 2>&1
  grep -E '^All files' "$OUT/stryker.log" | sed 's/^/    /'
  if [ -s "$OUT/stryker/mutation.json" ]; then
    node scripts/stryker-sonar.js "$OUT/stryker/mutation.json" "$OUT/sonar-mutants.json" ||
      say "Stryker: could not convert the report for SonarQube"
  else
    say "Stryker: no report, see $OUT/stryker.log"
  fi
  [ -s "$OUT/sonar-mutants.json" ] || incomplete="no Stryker report"

}
stryker

# --- 4. SonarQube -----------------------------------------------------------
sonar() {
  if [ -z "$sonar_token" ]; then
    say "SonarQube: skipped (SONAR_TOKEN is not set)"
    return
  fi
  if ! command -v sonar-scanner >/dev/null; then
    say "SonarQube: skipped (sonar-scanner is not installed)"
    return
  fi
  if [ -n "$incomplete" ]; then
    say "SonarQube: skipped ($incomplete; uploading would close the issues it last reported)"
    return
  fi
  if [ -z "$BRANCH" ]; then
    say "SonarQube: skipped (detached HEAD; set SONAR_BRANCH to name the branch)"
    return
  fi
  if ! curl -fsS -m 5 "$HOST/api/system/status" 2>/dev/null | grep -q '"status":"UP"'; then
    say "SonarQube: skipped (server $HOST is unreachable or not UP)"
    return
  fi

  local props=(
    "-Dsonar.sarifReportPaths=$OUT/osv.sarif"
    "-Dsonar.externalIssuesReportPaths=$OUT/sonar-mutants.json"
  )
  local query="id=$PROJECT_KEY"
  if [ "$BRANCH" != main ]; then
    props+=("-Dsonar.branch.name=$BRANCH")
    query="$query&branch=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$BRANCH")"
  fi

  say "SonarQube scan on $HOST"
  # The scanner reads SONAR_TOKEN from its own environment; it is never passed
  # on the command line, so it does not show up in ps or in the log.
  if SONAR_TOKEN=$sonar_token sonar-scanner -Dsonar.host.url="$HOST" -Dsonar.qualitygate.wait=true \
    "${props[@]}" >"$OUT/sonar-scanner.log" 2>&1; then
    say "SonarQube: quality gate passed"
  elif grep -q 'QUALITY GATE STATUS: FAILED' "$OUT/sonar-scanner.log"; then
    say "SonarQube: quality gate FAILED (reporting only, not blocking)"
  else
    say "SonarQube: scan failed, see $OUT/sonar-scanner.log"
    return
  fi
  say "dashboard: $HOST/dashboard?$query"
}
sonar

exit "$test_status"
