#!/usr/bin/env bash
# Offline raster/upload checks: no package installs or network requests.
set -o pipefail
TEST_REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
export MULTITEST_TEST=1 SERVERGRADE_PUBLISH=1
source "$TEST_REPO_DIR/servergrade.sh" test-functions || exit 1
TEST_DATA=$(mktemp -d "${TMPDIR:-/tmp}/servergrade-png-test.XXXXXX") || exit 1
trap 'rm -rf "$TEST_DATA"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
SUMMARY_DIR="$TEST_DATA"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII=' | base64 --decode > "$TEST_DATA/pixel.png" 2>/dev/null ||
    printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII=' | base64 -D > "$TEST_DATA/pixel.png" || exit 1

# Keep the geometry tests deterministic while exercising the real renderer argv.
timeout() {
    [[ "$1" == -k && "$2" == 1 && "$3" =~ ^[1-4]$ ]] || fail 'renderer called without a deadline'
    shift 3
    "$@"
}

# The first large raster must be retried at a smaller height as well as width.
rsvg-convert() {
    printf '%s %s\n' "$1" "$2" >> "$TEST_DATA/render-args"
    local output="$4"
    if [[ ! -e "$TEST_DATA/render-first" ]]; then
        : > "$TEST_DATA/render-first"
        head -c 1800001 /dev/zero > "$output"
    else
        cp "$TEST_DATA/pixel.png" "$output"
    fi
}
printf '<svg viewBox="0 0 1100 20000"></svg>\n' > "$TEST_DATA/report.svg"
mt_render_png_file "$TEST_DATA/report.svg" "$TEST_DATA/report.png" || fail 'raster fallback failed'
[[ $(sed -n '1p' "$TEST_DATA/render-args") == '-h 4800' ]] || fail 'initial geometry exceeds bounds'
[[ $(sed -n '2p' "$TEST_DATA/render-args") == '-h 3840' ]] || fail 'height did not shrink on retry'
cmp -s "$TEST_DATA/pixel.png" "$TEST_DATA/report.png" || fail 'rendered bytes changed'

# Dedicated social cards keep their required size, rather than silently shrinking.
rm -f "$TEST_DATA/render-first" "$TEST_DATA/render-args"
printf '<svg viewBox="0 0 1200 630"></svg>\n' > "$TEST_DATA/preview.svg"
if mt_render_png_file "$TEST_DATA/preview.svg" "$TEST_DATA/preview.png" 1200 630 1; then
    fail 'an oversized exact-size card was accepted'
fi
[[ $(wc -l < "$TEST_DATA/render-args") -eq 1 ]] || fail 'exact-size card was resized'

# Both PNGs share one authenticated asset upload; preview is sent once.
printf '12345678' > "$SUMMARY_DIR/public-id.txt"
printf 'test-token' > "$SUMMARY_DIR/upload-token.txt"
printf '%s\n' "$TEST_DATA/report.svg" "$TEST_DATA/second.svg" > "$SUMMARY_DIR/pages.list"
cp "$TEST_DATA/report.svg" "$TEST_DATA/second.svg"
cp "$TEST_DATA/pixel.png" "$TEST_DATA/second.png"
cp "$TEST_DATA/pixel.png" "$TEST_DATA/preview.png"
SERVERGRADE_PUBLISH_URL='https://servergrade.test/api/results'
curl() { printf '%s\n' "$*" >> "$TEST_DATA/uploads"; }
upload_result_assets || fail 'upload failed'
[[ $(wc -l < "$TEST_DATA/uploads") -eq 2 ]] || fail 'a page was uploaded more than once'
[[ $(sed -n '1p' "$TEST_DATA/uploads") == *'png@'*'preview_png@'* ]] || fail 'PNG or social card missing from first upload'
[[ $(sed -n '2p' "$TEST_DATA/uploads") == *'png@'* ]] || fail 'second raster missing'
[[ $(sed -n '2p' "$TEST_DATA/uploads") != *'preview_png@'* ]] || fail 'social card uploaded twice'
[[ $(cat "$SUMMARY_DIR/asset-1.png.base64") == $(base64 < "$TEST_DATA/report.png" | tr -d '\r\n') ]] || fail 'PNG base64 changed'

# An unavailable or hung converter can never prevent using its SVG source.
unset -f timeout rsvg-convert
if command -v timeout >/dev/null; then
    mkdir "$TEST_DATA/bin" || exit 1
    cat > "$TEST_DATA/bin/rsvg-convert" <<'SH'
#!/bin/sh
# Model a renderer which ignores graceful termination.
trap '' TERM
exec sleep 60
SH
    chmod +x "$TEST_DATA/bin/rsvg-convert"
    start=$SECONDS
    if PATH="$TEST_DATA/bin:$PATH" MT_PNG_DEADLINE=$((SECONDS + 1)) \
        mt_render_png_file "$TEST_DATA/report.svg" "$TEST_DATA/report.png"; then
        fail 'a hung renderer reported success'
    fi
    (( SECONDS - start < 5 )) || fail 'a hung renderer exceeded its time budget'
    [[ -s "$TEST_DATA/report.svg" && -s "$TEST_DATA/report.png" ]] || fail 'a raster timeout destroyed a completed file'
fi

# The report link is available before optional rendering and image uploads.
# Absence of a renderer still publishes and uploads the SVG.
gather_system_facts() { SYS_COUNTRY=NL; }
mt_apple_flag_b64() { printf 'flag\n' >> "$TEST_DATA/steps"; }
print_separator() { :; }
install_package() { fail 'report preparation invoked a package manager'; }
build_report_pages() { printf 'pages\n' >> "$TEST_DATA/steps"; }
step_build_report_pngs() { printf 'png:%s\n' "$1" >> "$TEST_DATA/steps"; return 1; }
publish_result_page() { printf 'publish\n' >> "$TEST_DATA/steps"; }
upload_result_assets() { printf 'assets\n' >> "$TEST_DATA/steps"; }
print_report_link() { printf 'link\n' >> "$TEST_DATA/steps"; }
mt_has_png_renderer() { [[ "$TEST_RENDERER" == 1 ]]; }
spin_run() { shift; "$@"; }

TEST_RENDERER=0 render_and_upload_summary || fail 'SVG-only publication failed'
[[ $(cat "$TEST_DATA/steps") == $'flag\npages\npublish\nlink\nassets' ]] || fail 'publication depends on PNG preparation'
: > "$TEST_DATA/steps"
TEST_RENDERER=1 render_and_upload_summary || fail 'raster failure blocked the report'
[[ $(cat "$TEST_DATA/steps") == $'flag\npages\npublish\nlink\npng:1\nassets' ]] || fail 'PNG attempt delayed the link or blocked SVG upload'
: > "$TEST_DATA/steps"
SERVERGRADE_PUBLISH=0 TEST_RENDERER=1 render_and_upload_summary >/dev/null || fail 'local report failed'
[[ $(cat "$TEST_DATA/steps") == $'flag\npages\npng:0' ]] || fail 'local mode attempted to publish or failed to try a local raster'
printf 'PASS: raster bounds, renderer timeout, PNG upload fields and SVG-first publication\n'
