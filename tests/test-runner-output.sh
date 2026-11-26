#!/usr/bin/env bash
# Synthetic commands only: no upstream scripts, network calls or benchmarks.
set -o pipefail
TEST_REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export MULTITEST_TEST=1 SERVERGRADE_PUBLISH=1
source "$TEST_REPO_DIR/servergrade.sh" test-functions || exit 1
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
TEST_DATA=$(mktemp -d "${TMPDIR:-/tmp}/servergrade-output-test.XXXXXXXX") || exit 1
trap 'rm -rf "$TEST_DATA"' EXIT
export TEST_DATA
mkdir "$TEST_DATA/bin"
if ! command -v setsid >/dev/null; then
    cat > "$TEST_DATA/bin/setsid" <<'SH'
#!/bin/sh
exec python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1],sys.argv[1:])' "$@"
SH
    chmod +x "$TEST_DATA/bin/setsid"
fi
export PATH="$TEST_DATA/bin:$PATH"

run_output_fixture() {
    printf '\033[32mРезультаты CPU\033[0m\nCPU speed:\n    events per second: 1234.56\n'
    sleep 1
    printf 'IPv4: 203.0.113.7 IPv6: [2001:db8::7] remote: 203.0.113.77\n'
    printf 'Claim URL: https://browser.geekbench.com/v4/cpu/claim/private-token\n'
    printf '\033]0;private title\007Финальные результаты\nLAST-WITHOUT-NEWLINE'
}
run_failing_fixture() { printf 'FAILURE DETAIL\n'; return 7; }
run_hup_fixture() { sleep 30 & printf '%s\n' "$!" > "$TEST_DATA/hup-child.pid"; printf 'PARTIAL BEFORE HUP\n'; wait; }
export -f run_output_fixture run_failing_fixture run_hup_fixture

# Byte-only ANSI filters must remain valid in Russian collation and preserve UTF-8.
printf '\033[32mКириллица\033[0m\n\033]8;;https://example.test\033\\ссылка\033]8;;\033\\\nстарое\rновое\n' |
    LC_ALL=ru_RU.UTF-8 strip_ansi > "$TEST_DATA/clean" 2> "$TEST_DATA/filter-errors"
[[ ! -s "$TEST_DATA/filter-errors" ]] || fail 'locale-sensitive filter emitted an error'
[[ $(cat "$TEST_DATA/clean") == $'Кириллица\nссылка\nновое' ]] || fail 'sanitizer corrupted Cyrillic, OSC or carriage returns'
printf 'PASS: ANSI filtering is locale-safe and keeps Cyrillic\n'

SCRIPT_CAPTURE=plain
capture_test run_output_fixture "$TEST_DATA/raw.log" > "$TEST_DATA/live.log" & capture_pid=$!
start=$SECONDS
until grep -q 'Результаты CPU' "$TEST_DATA/live.log"; do
    (( SECONDS-start < 3 )) || fail 'first output was not streamed while test ran'
    sleep .05
done
kill -0 "$capture_pid" || fail 'live output appeared only after the test ended'
wait "$capture_pid" || fail 'successful producer reported failure'
grep -q 'private-token' "$TEST_DATA/raw.log" || fail 'private raw log was modified'
grep -q 'LAST-WITHOUT-NEWLINE' "$TEST_DATA/live.log" || fail 'last partial output was lost'
capture_test run_output_fixture "$TEST_DATA/closed-reader.log" | head -n 1 >/dev/null
grep -q 'LAST-WITHOUT-NEWLINE' "$TEST_DATA/closed-reader.log" || fail 'closed stdout reader stopped raw recording'
capture_test run_failing_fixture "$TEST_DATA/failure.log" > /dev/null; rc=$?
[[ "$rc" == 7 ]] || fail 'producer exit status was hidden by output forwarding'
printf 'PASS: output is live, raw logs survive closed readers and failures retain status\n'

# Exercise real parsers and the actual publish form builder, not a parsing stub.
SUMMARY_DIR="$TEST_DATA"
SYS_IP4=203.0.113.7; SYS_IP6=2001:db8::7
parse_test_output run_sysbench_cpu "$TEST_DATA/raw.log" "$SUMMARY_DIR/run_sysbench_cpu.metrics" "$SUMMARY_DIR/run_sysbench_cpu.services"
grep -q '1234.56' "$SUMMARY_DIR/run_sysbench_cpu.metrics" || fail 'real CPU parser lost result'
MT_CAT_FUNCS=(run_sysbench_cpu); MT_CAT_NAMES=('Процессор')
declare -A MT_STATUS=([run_sysbench_cpu]='выполнен')
test_log=("$TEST_DATA/raw.log"); test_names=('Процессор')
curl() {
    local response="" previous="" argument
    for argument in "$@"; do
        [[ "$previous" == -o ]] && response="$argument"
        [[ "$argument" == terminal_report@* ]] && cp "${argument#terminal_report@}" "$TEST_DATA/submitted-terminal"
        previous="$argument"
    done
    printf '{"id":"12345678","url":"https://servergrade.test/test/12345678","upload_token":"abc"}' > "$response"
    printf '201'
}
SERVERGRADE_PUBLISH_URL=https://servergrade.test/api/results
publish_result_page || fail 'real publish builder failed'
grep -q 'Финальные результаты' "$TEST_DATA/submitted-terminal" || fail 'terminal form contains only headings'
grep -q '1234.56' "$TEST_DATA/submitted-terminal" || fail 'terminal form lost measured values'
grep -q '203.0.\*.\*' "$TEST_DATA/submitted-terminal" || fail 'known host IPv4 was not masked'
grep -q '2001:db8::\*' "$TEST_DATA/submitted-terminal" || fail 'known host IPv6 was not masked'
grep -q '203.0.113.77' "$TEST_DATA/submitted-terminal" || fail 'unrelated probe address was altered'
if grep -qE 'private-token|203\.0\.113\.7([^0-9]|$)|2001:db8::7|Claim URL' "$TEST_DATA/submitted-terminal"; then fail 'public terminal leaked a host IP or claim link'; fi
printf 'PASS: real capture → parser → sanitized publication retains results and privacy\n'

# Test util-linux script flags even on macOS, whose script implementation differs.
cat > "$TEST_DATA/bin/script" <<'SH'
#!/bin/bash
[[ "$1" == -q && "$2" == -f && "$3" == -e && "$4" == -c ]] || exit 98
printf '%s\n' "$*" > "$TEST_DATA/script-args"
bash -c "$5" > "$6" 2>&1
SH
chmod +x "$TEST_DATA/bin/script"
SCRIPT_CAPTURE=util
capture_test run_failing_fixture "$TEST_DATA/util.log" > "$TEST_DATA/util-live"; rc=$?
[[ "$rc" == 7 ]] && grep -q 'FAILURE DETAIL' "$TEST_DATA/util-live" || fail 'script flush/exit-status contract failed'
printf 'PASS: PTY capture requests immediate flushing and preserves failure status\n'

# Hangup stops the isolated producer group but keeps already-recorded output.
SCRIPT_CAPTURE=plain
capture_test run_hup_fixture "$TEST_DATA/hup.log" > "$TEST_DATA/hup-live" & capture_pid=$!
start=$SECONDS
until [[ -s "$TEST_DATA/hup-child.pid" && -s "$TEST_DATA/hup.log.capture.pgid" ]]; do
    (( SECONDS-start < 3 )) || fail 'hangup fixture did not start'
    sleep .05
done
kill -HUP "$capture_pid"
wait "$capture_pid"; rc=$?
[[ "$rc" == 129 ]] || fail 'hangup status was not propagated'
child=$(cat "$TEST_DATA/hup-child.pid")
state=$(ps -o stat= -p "$child" 2>/dev/null)
[[ -z "$state" || "$state" == Z* ]] || fail 'hangup left a test descendant running'
grep -q 'PARTIAL BEFORE HUP' "$TEST_DATA/hup.log" || fail 'hangup removed partial raw results'
printf 'PASS: hangup cleans descendants and retains partial raw logs\n'

# The downloaded fixture is a shell mock, not YABS or any benchmark binary.
curl() {
    local destination="" previous="" argument
    for argument in "$@"; do [[ "$previous" == -o ]] && destination="$argument"; previous="$argument"; done
    cat > "$destination" <<'SH'
printf '%s\n' "$*" > "$TEST_DATA/yabs-args"
if [[ ${TEST_YABS_HANG:-0} == 1 ]]; then
    trap '' TERM
    sleep 30 & printf '%s\n' "$!" > "$TEST_DATA/yabs-child.pid"
    wait
fi
printf 'SYNTHETIC YABS OUTPUT\n'
SH
}
check_and_install() { return 0; }
SERVERGRADE_YABS_TIMEOUT=20
run_yabs > "$TEST_DATA/yabs.log" || fail 'YABS launch contract failed'
[[ $(cat "$TEST_DATA/yabs-args") == '-4 -i' ]] || fail 'YABS flags silently changed measurements'
SERVERGRADE_YABS_TIMEOUT=1; export TEST_YABS_HANG=1
start=$SECONDS
run_yabs > "$TEST_DATA/yabs-timeout.log" 2>&1; rc=$?
[[ "$rc" == 124 || "$rc" == 137 ]] || fail 'YABS timeout reported success'
(( SECONDS-start < 10 )) || fail 'YABS deadline did not bound a TERM-resistant child'
child=$(cat "$TEST_DATA/yabs-child.pid")
state=$(ps -o stat= -p "$child" 2>/dev/null)
[[ -z "$state" || "$state" == Z* ]] || fail 'YABS timeout leaked a descendant'
grep -q 'незавершённые замеры' "$TEST_DATA/yabs-timeout.log" || fail 'YABS timeout was not explained'
printf 'PASS: YABS keeps CPU/disk, omits duplicate network and cleans up on deadline\n'
