#!/usr/bin/env bash
# Re-Punched!!: builds the Punch-Out!! port on this computer (run by the launcher; also works by hand).
#   PO_SRC   the port's files: punchout_region.patch, projects/punchout/{recomp.yml,MAP.txt}
#   PO_WORK  workspace (WiiCompiled is cloned into PO_WORK/wiicompiled)
#   PO_DATA  the extracted disc (sys/main.dol, files/...)
#   PO_PORT  where the playable port goes
#   PO_LOGS  logs folder
# Prints "@@STEP n/7 description" between steps (the launcher's progress bar) and ninja's "[n/total]".
set -uo pipefail

: "${PO_SRC:?}" "${PO_WORK:?}" "${PO_DATA:?}" "${PO_PORT:?}" "${PO_LOGS:?}"
BASE_COMMIT=0d5c402
WC=$PO_WORK/wiicompiled
mkdir -p "$PO_WORK" "$PO_PORT/UserData" "$PO_LOGS"
exec > >(tee "$PO_LOGS/build.log") 2>&1

step() { echo "@@STEP $1/7 $2"; }
fail() { echo "BUILD FAILED: $*"; exit 1; }

for tool in git dotnet cmake ninja clang clang++; do
    command -v "$tool" > /dev/null || fail "$tool is not installed"
done
[[ -f "$PO_DATA/sys/main.dol" ]] || fail "the extracted disc is missing ($PO_DATA)"
[[ -f "$PO_SRC/punchout_region.patch" ]] || fail "the port's patch is missing ($PO_SRC)"

step 1 "Getting WiiCompiled"
if [[ ! -d "$WC/.git" ]]; then
    git clone --recursive https://github.com/patchzyy/wiicompiled "$WC" || fail "could not download WiiCompiled"
fi
git -C "$WC" fetch -q origin 2>/dev/null
git -C "$WC" reset -q --hard "$BASE_COMMIT" || fail "could not reset WiiCompiled to $BASE_COMMIT"
git -C "$WC" submodule update --init --recursive || fail "submodule update failed"

step 2 "Applying the Re-Punched!! changes"
# Aurora's per-frame GPU buffers are fixed-size; some Punch-Out!! scenes overflow the defaults.
RES="$WC/aurora-main/lib/gfx/resources.hpp"
git -C "$WC/aurora-main" checkout -q -- lib/gfx/resources.hpp
sed -i -E 's/(VertexBufferSize = )5242880;/\120971520;/; s/(IndexBufferSize = )2097152;/\18388608;/' "$RES"
grep -q "IndexBufferSize = 8388608;" "$RES" || fail "could not enlarge Aurora's GPU buffers"
# reset --hard keeps untracked files, so files the patch creates are removed first.
git -C "$WC" apply --numstat --summary "$PO_SRC/punchout_region.patch" | awk '$1 == "create" {print $4}' |
    while IFS= read -r created; do rm -f "$WC/$created"; done
git -C "$WC" apply --whitespace=nowarn "$PO_SRC/punchout_region.patch" || fail "the patch did not apply"
mkdir -p "$WC/projects/punchout" "$WC/Assets"
cp -f "$PO_SRC/projects/punchout/recomp.yml" "$PO_SRC/projects/punchout/MAP.txt" "$WC/projects/punchout/"
cp -f "$PO_DATA/sys/main.dol" "$WC/Assets/main.dol"
PROJECT=$WC/projects/punchout/recomp.yml
GEN=$WC/generated

step 3 "Building the translator"
dotnet build "$WC/translator/src/Translator.Cli/Translator.Cli.csproj" -c Release -v quiet || fail "translator build failed"
DLL=$WC/translator/src/Translator.Cli/bin/Release/net8.0/Translator.Cli.dll
xlate() { (cd "$WC" && dotnet "$DLL" "$@"); }

step 4 "Translating the game code"
THREADS=$(nproc); (( THREADS > 16 )) && THREADS=16
xlate translate-recursive 0x80006124 --project "$PROJECT" --outdir "$GEN/functions" \
    --output-metadata "$GEN/base_translation_output.json" --prune-stale --threads "$THREADS" || fail "translation failed"

step 5 "Preparing the build"
xlate generate-data-init --project "$PROJECT" || fail "generate-data-init failed"
export WIICOMPILED_DEV_ALLOW_UNSUPPORTED=1
xlate emit-build-shards --project "$PROJECT" --base-metadata "$GEN/base_translation_output.json" \
    --base-functions-dir "$GEN/functions" --native-source-dir "$WC/runtime/src" --out "$GEN/build_shards" ||
    fail "emit-build-shards failed"

step 6 "Configuring"
MEM_GIB=$(( $(awk '/^MemTotal:/{print $2}' /proc/meminfo) / 1024 / 1024 ))
JOBS=$(( MEM_GIB / 2 )); (( JOBS > $(nproc) )) && JOBS=$(nproc); (( JOBS < 1 )) && JOBS=1
CPU=v2
clang -march=native -dM -E -x c /dev/null 2>/dev/null | grep -q '__AVX2__' && CPU=v3
NB=$WC/native-build
cmake -S "$WC/runtime" -B "$NB" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=clang \
    -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_ASM_COMPILER=clang -DMKW_TRANSLATED_COMPILE_JOBS=$JOBS \
    -DMKW_X86_CPU_PROFILE=$CPU -DMKW_SETUP_VERSION=punchout-launcher || fail "cmake configure failed"

step 7 "Compiling (the long one)"
cmake --build "$NB" --target WiiCompiled --parallel "$(nproc)" || fail "compile failed"

# Install as a portable folder: its Config.toml, saves and logs stay inside it.
cp -f "$NB/WiiCompiled" "$PO_PORT/RePunched"
rm -f "$PO_PORT/PunchOut" "$PO_PORT/FistIn"   # the game's earlier names
for f in dsp_coef.bin cacert.pem; do [[ -f "$NB/$f" ]] && cp -f "$NB/$f" "$PO_PORT/"; done
rm -f "$PO_PORT/initial_pipeline_cache.db"   # Mario Kart Wii's shader list; Punch-Out!! builds its own
[[ -d "$NB/wii_bootstrap" ]] && cp -rf "$NB/wii_bootstrap" "$PO_PORT/"
if [[ -d "$WC/runtime/assets" ]]; then rm -rf "$PO_PORT/assets"; cp -rf "$WC/runtime/assets" "$PO_PORT/assets"; fi
touch "$PO_PORT/portable.txt"
echo "BUILD OK: $PO_PORT/RePunched"
