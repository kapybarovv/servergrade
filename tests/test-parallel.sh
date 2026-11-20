#!/usr/bin/env bash
# Offline scheduler regression tests. No packages, network calls or benchmarks.
set -o pipefail

TEST_SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TEST_REPO_DIR=$(cd -- "$TEST_SCRIPT_DIR/.." && pwd)
TEST_BASH=$BASH
export MULTITEST_TEST=1 SERVERGRADE_PUBLISH=0
source "$TEST_REPO_DIR/servergrade.sh" test-functions || exit 1

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

fixture_job() {
    local fn="$1" child pgid
    printf '%s\n' "$PWD" > "$TEST_DATA/$fn.cwd"
    printf '%s\n' "${TMPDIR:-}" > "$TEST_DATA/$fn.tmp"
    printf '%s\n' "$BASHPID" > "$TEST_DATA/$fn.pid"
    pgid=$(ps -o pgid= -p "$BASHPID" | tr -d '[:space:]')
    printf '%s\n' "$pgid" > "$TEST_DATA/$fn.pgid"
    printf '%s\n' "$fn" > runner-cwd-fixture
    printf '%s\n' "$fn" > "$TMPDIR/runner-tmp-fixture"
    printf 'start\t%s\n' "$fn" >> "$TEST_DATA/events"
    printf 'OUTPUT %s\n' "$fn"
    if [[ ( "$fn" == run_ip_region || "$fn" == run_censorcheck_geoblock ) && ( "$TEST_CASE" == interrupt || "$TEST_CASE" == terminate ) ]]; then
        TEST_GRANDCHILD_FILE="$TEST_DATA/$fn.grandchild.pid" bash -c '
            sleep 30 &
            printf "%s\n" "$!" > "$TEST_GRANDCHILD_FILE"
            wait
        ' &
        child=$!
        printf '%s\n' "$child" > "$TEST_DATA/$fn.child.pid"
        wait "$child"
    else
        sleep .8
    fi
    [[ $(<runner-cwd-fixture) == "$fn" ]] || return 97
    [[ $(<"$TMPDIR/runner-tmp-fixture") == "$fn" ]] || return 98
    printf 'RESULT %s\n' "$fn"
    printf 'stop\t%s\n' "$fn" >> "$TEST_DATA/events"
    [[ "$TEST_CASE" == failure && "$fn" == run_censorcheck_geoblock ]] && return 7
    return 0
}

run_ip_region() { fixture_job run_ip_region; }
run_censorcheck_geoblock() { fixture_job run_censorcheck_geoblock; }
run_censorcheck_dpi() { fixture_job run_censorcheck_dpi; }
run_censorcheck_tlab() { fixture_job run_censorcheck_tlab; }
run_yabs() { fixture_job run_yabs; }
run_sysbench_cpu() { fixture_job run_sysbench_cpu; }
export -f fixture_job run_ip_region run_censorcheck_geoblock run_censorcheck_dpi
export -f run_censorcheck_tlab run_yabs run_sysbench_cpu

parse_test_output() {
    printf '%s\n' "$1" >> "$TEST_DATA/parsed"
    printf 'metric %s\n' "$1" > "$3"
    printf 'service %s\n' "$1" > "$4"
}

mt_run_activity() { printf '%s\n' "$1" >> "$TEST_DATA/activity"; }

run_fixture_case() {
    TEST_CASE=$1
    TEST_DATA=$2
    export TEST_CASE TEST_DATA
    SUMMARY_DIR="$TEST_DATA/summary"
    mkdir -p "$SUMMARY_DIR"
    SCRIPT_CAPTURE=plain
    declare -ga test_funcs=() test_names=() test_secs=() test_log=() test_status=()
    declare -gA MT_STATUS=()
    local jobs=2 fn i rc
    case "$TEST_CASE" in
        pool2|pool3)
            [[ "$TEST_CASE" == pool3 ]] && jobs=3
            test_funcs=(run_ip_region run_censorcheck_geoblock run_censorcheck_dpi run_censorcheck_tlab run_yabs run_sysbench_cpu)
            ;;
        failure) test_funcs=(run_ip_region run_censorcheck_geoblock) ;;
        interrupt|terminate)
            test_funcs=(run_ip_region run_censorcheck_geoblock run_yabs)
            ;;
        *) fail "Unknown fixture case $TEST_CASE" ;;
    esac
    for i in "${!test_funcs[@]}"; do
        fn=${test_funcs[$i]}
        test_names[$i]="Fixture $fn"
        test_secs[$i]=1
        test_log[$i]="$SUMMARY_DIR/test-$((i+1)).log"
        test_status[$i]="пропущен"
        MT_STATUS[$fn]="пропущен"
    done
    [[ "$TEST_CASE" == pool3 ]] && set -m
    mt_run_parallel_tests "$jobs"
    rc=$?
    if [[ "$TEST_CASE" == pool3 ]]; then
        [[ $- == *m* ]] || fail 'Scheduler did not restore monitor mode'
        set +m
    fi
    printf '%s\n' "$rc" > "$TEST_DATA/scheduler.rc"
    for i in "${!test_funcs[@]}"; do
        fn=${test_funcs[$i]}
        printf '%s\t%s\t%s\n' "$fn" "${test_status[$i]:-missing}" "${MT_STATUS[$fn]:-missing}" >> "$TEST_DATA/statuses"
    done
    return "$rc"
}

if [[ "${1:-}" == --case ]]; then
    run_fixture_case "$2" "$3"
    exit $?
fi

(( BASH_VERSINFO[0] >= 4 )) || fail 'Bash 4+ is required by the runner'
command -v python3 >/dev/null || fail 'python3 is required for isolated signal fixtures'
declare -F mt_run_parallel_tests >/dev/null || fail 'mt_run_parallel_tests is missing'

TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/servergrade-parallel-test.XXXXXXXX") || exit 1
TEST_CASE_PID=""

running() {
    local state
    kill -0 "$1" 2>/dev/null || return 1
    state=$(ps -o stat= -p "$1" 2>/dev/null)
    [[ "$state" != Z* ]]
}

cleanup() {
    local file group
    if [[ -n "$TEST_CASE_PID" ]] && running "$TEST_CASE_PID"; then
        kill -TERM "$TEST_CASE_PID" 2>/dev/null || true
    fi
    for file in "$TEST_ROOT"/*/*.pgid; do
        [[ -f "$file" ]] || continue
        group=$(<"$file")
        [[ "$group" =~ ^[0-9]+$ && "$group" != "$$" ]] || continue
        kill -TERM -- "-$group" 2>/dev/null || true
    done
    [[ -n "$TEST_ROOT" && "$TEST_ROOT" == */servergrade-parallel-test.* ]] && rm -r -- "$TEST_ROOT"
}
trap cleanup EXIT

# macOS has no built-in setsid. This test-only wrapper provides the Linux
# process-group behavior used by the runner without changing the system.
if ! command -v setsid >/dev/null; then
    mkdir -p "$TEST_ROOT/bin"
    printf '%s\n' '#!/bin/sh' 'exec python3 -c '\''import os,sys; args=sys.argv[1:]; args=[arg for arg in args if arg not in ("--wait","-w","--")]; os.setsid(); os.execvp(args[0],args)'\'' "$@"' > "$TEST_ROOT/bin/setsid"
    chmod +x "$TEST_ROOT/bin/setsid"
    export PATH="$TEST_ROOT/bin:$PATH"
fi

start_case() {
    local name="$1"
    mkdir -p "$TEST_ROOT/$name"
    # Non-interactive background shells inherit SIGINT ignored. Restore the
    # default before exec so kill -INT models a real Ctrl+C in the runner.
    python3 -c 'import os,signal,sys; signal.signal(signal.SIGINT,signal.SIG_DFL); os.setsid(); os.execv(sys.argv[1],sys.argv[1:])' \
        "$TEST_BASH" "$TEST_SCRIPT_DIR/test-parallel.sh" --case "$name" "$TEST_ROOT/$name" \
        > "$TEST_ROOT/$name/console" 2>&1 &
    TEST_CASE_PID=$!
}

wait_for_file() {
    local file="$1" started=$SECONDS
    while [[ ! -s "$file" ]]; do
        if ! running "$TEST_CASE_PID"; then
            sed -n '1,100p' "$(dirname -- "$file")/console" >&2
            fail "Fixture exited before creating $file"
        fi
        (( SECONDS-started < 10 )) || fail "Timed out waiting for $file"
        sleep .05
    done
}

finish_case() {
    local name="$1" expected="${2:-0}" started=$SECONDS rc
    while running "$TEST_CASE_PID"; do
        (( SECONDS-started < 15 )) || fail "Scheduler $name did not terminate"
        sleep .05
    done
    wait "$TEST_CASE_PID"; rc=$?
    TEST_CASE_PID=""
    if (( rc != expected )); then
        sed -n '1,120p' "$TEST_ROOT/$name/console" >&2
        fail "$name exited $rc, expected $expected"
    fi
}

assert_dead() {
    local file="$1" pid started=$SECONDS
    pid=$(<"$file")
    while running "$pid"; do
        (( SECONDS-started < 3 )) || fail "Orphaned fixture process $pid from $file"
        sleep .05
    done
}

assert_completed() {
    local name="$1" fn i=0 line status mapped
    while IFS=$'\t' read -r fn status mapped; do
        i=$((i+1))
        [[ "$status" == выполнен && "$mapped" == выполнен ]] || fail "$name: incorrect status for $fn"
        grep -Fq "RESULT $fn" "$TEST_ROOT/$name/summary/test-$i.log" || fail "$name: missing result log for $fn"
        grep -Fq "metric $fn" "$TEST_ROOT/$name/summary/$fn.metrics" || fail "$name: missing metrics for $fn"
        grep -Fq "service $fn" "$TEST_ROOT/$name/summary/$fn.services" || fail "$name: missing services for $fn"
    done < "$TEST_ROOT/$name/statuses"
    (( i > 0 )) || fail "$name: no completed status records"
}

for jobs in 2 3; do
    name="pool$jobs"
    start_case "$name"
    finish_case "$name"
    assert_completed "$name"
    awk -F '\t' -v cap="$jobs" '
        $1=="start" {
            isheavy=($2=="run_yabs" || $2=="run_sysbench_cpu")
            if (isheavy && active!=0 || !isheavy && heavy) exit 1
            active++; if(isheavy) heavy=1
            if(active>maximum) maximum=active
            if(active>cap) exit 1
        }
        $1=="stop" {active--; if($2=="run_yabs" || $2=="run_sysbench_cpu") heavy=0}
        END {if(active!=0 || maximum<cap) exit 1}
    ' "$TEST_ROOT/$name/events" || fail "$name: overlap, concurrency limit or heavy exclusion failed"
    [[ $(sort -u "$TEST_ROOT/$name/"*.cwd | wc -l | tr -d '[:space:]') == 6 ]] || fail "$name: working directories are shared"
    [[ $(sort -u "$TEST_ROOT/$name/"*.tmp | wc -l | tr -d '[:space:]') == 6 ]] || fail "$name: TMPDIR directories are shared"
    printf 'PASS: %s probes overlap, capacity is enforced, heavy tests run alone, logs and metrics stay isolated\n' "$name"
done

start_case failure
finish_case failure
grep -Fq $'run_ip_region\tвыполнен\tвыполнен' "$TEST_ROOT/failure/statuses" || fail 'Successful job lost its status'
grep -Fq $'run_censorcheck_geoblock\tошибка\tошибка' "$TEST_ROOT/failure/statuses" || fail 'Nonzero exit with nonempty log was marked successful'
printf 'PASS: nonzero test exit remains an error with a nonempty log\n'

start_case interrupt
wait_for_file "$TEST_ROOT/interrupt/run_ip_region.grandchild.pid"
wait_for_file "$TEST_ROOT/interrupt/run_censorcheck_geoblock.grandchild.pid"
kill -INT "$TEST_CASE_PID"
finish_case interrupt
grep -Fq $'run_ip_region\tпропущен\tпропущен' "$TEST_ROOT/interrupt/statuses" || fail 'Interrupted active job was not skipped'
grep -Fq $'run_censorcheck_geoblock\tпропущен\tпропущен' "$TEST_ROOT/interrupt/statuses" || fail 'Second interrupted active job was not skipped'
grep -Fq $'run_yabs\tвыполнен\tвыполнен' "$TEST_ROOT/interrupt/statuses" || fail 'Queued job did not run after Ctrl+C'
for fn in run_ip_region run_censorcheck_geoblock; do
    assert_dead "$TEST_ROOT/interrupt/$fn.child.pid"
    assert_dead "$TEST_ROOT/interrupt/$fn.grandchild.pid"
done
printf 'PASS: Ctrl+C kills the active job descendants and continues queued work\n'

start_case terminate
wait_for_file "$TEST_ROOT/terminate/run_ip_region.grandchild.pid"
wait_for_file "$TEST_ROOT/terminate/run_censorcheck_geoblock.grandchild.pid"
kill -TERM "$TEST_CASE_PID"
finish_case terminate 143
for fn in run_ip_region run_censorcheck_geoblock; do
    assert_dead "$TEST_ROOT/terminate/$fn.child.pid"
    assert_dead "$TEST_ROOT/terminate/$fn.grandchild.pid"
done
[[ ! -s "$TEST_ROOT/terminate/run_yabs.pid" ]] || fail 'Queued job started after parent termination'
printf 'PASS: parent TERM stops all descendants and never starts queued jobs\n'

# Exercise the normal menu entry point, with every external operation replaced
# by an offline fixture. Full and single runs must each publish exactly once.
integration_job() { printf 'INTEGRATION %s\n' "$1"; }
export -f integration_job
for fn in run_ip_region run_censorcheck_geoblock run_censorcheck_dpi run_censorcheck_tlab run_iperf3_ru run_iperf3_tlab run_yabs run_ip_check_place run_bench_sh run_ip_quality run_sysbench_cpu; do
    eval "$fn() { integration_job '$fn'; }"
    export -f "$fn"
done
install_deps_for() { printf 'install\n' >> "$TEST_DATA/install"; }
mt_request_challenge() { printf 'challenge\n' >> "$TEST_DATA/challenge"; }
detect_script_flavor() { SCRIPT_CAPTURE=plain; }
render_and_upload_summary() { printf 'publish\n' >> "$TEST_DATA/publish"; }

for name in full single; do
    TEST_DATA="$TEST_ROOT/integration-$name"
    export TEST_DATA
    mkdir -p "$TEST_DATA"
    export TMPDIR="$TEST_DATA"
    SERVERGRADE_JOBS=3
    if [[ "$name" == full ]]; then
        run_all < /dev/null > "$TEST_DATA/console" 2>&1 || fail 'Full run_all fixture failed'
        [[ ${#test_funcs[@]} == 11 ]] || fail 'Full run_all did not select the whole catalog'
    else
        run_all 11 < /dev/null > "$TEST_DATA/console" 2>&1 || fail 'Single run_all fixture failed'
        [[ ${#test_funcs[@]} == 1 && ${test_funcs[0]} == run_sysbench_cpu ]] || fail 'Single run selected incorrect tests'
        [[ ! -e "$SUMMARY_DIR/job-0.pgid" ]] || fail 'Single run incorrectly entered the parallel scheduler'
    fi
    for marker in install challenge publish; do
        [[ $(wc -l < "$TEST_DATA/$marker" | tr -d '[:space:]') == 1 ]] || fail "$name run did not call $marker exactly once"
    done
    [[ $(grep -c '^start$' "$TEST_DATA/activity") == 1 && $(grep -c '^end$' "$TEST_DATA/activity") == 1 ]] || fail "$name run activity was not completed exactly once"
    for i in "${!test_funcs[@]}"; do
        fn=${test_funcs[$i]}
        [[ ${test_status[$i]} == выполнен && ${MT_STATUS[$fn]} == выполнен ]] || fail "$name run lost status for $fn"
        grep -Fq "INTEGRATION $fn" "${test_log[$i]}" || fail "$name run lost output for $fn"
        grep -Fq "metric $fn" "$SUMMARY_DIR/$fn.metrics" || fail "$name run lost metrics for $fn"
    done
    printf 'PASS: %s run_all keeps test output and publishes exactly one report\n' "$name"
done
