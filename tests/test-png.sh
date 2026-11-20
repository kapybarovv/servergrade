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

# Terminal publication also prepares images, then publishes the completed report.
gather_system_facts() { :; }
print_separator() { :; }
step_render_deps() { printf 'dependencies\n' >> "$TEST_DATA/steps"; }
build_report_pages() { printf 'pages\n' >> "$TEST_DATA/steps"; }
step_build_preview_png() { printf 'preview\n' >> "$TEST_DATA/steps"; }
publish_result_page() { printf 'publish\n' >> "$TEST_DATA/steps"; }
upload_result_assets() { printf 'assets\n' >> "$TEST_DATA/steps"; }
print_report_link() { :; }
spin_run() { shift; "$@"; }
render_and_upload_summary || fail 'terminal publication failed'
[[ $(cat "$TEST_DATA/steps") == $'dependencies\npages\npreview\npublish\nassets' ]] || fail 'publication skipped or reordered raster preparation'
printf 'PASS: PNG rendering bounds, upload fields and terminal publication\n'
