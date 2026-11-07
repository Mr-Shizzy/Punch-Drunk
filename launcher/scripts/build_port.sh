#!/usr/bin/env bash
# POW: Recompiled!! (Punch-Out!! Wii): builds one of the ports on this computer (run by the launcher; also works by hand).
#   PO_GAME  punchout (default) or doclouis
#   PO_SRC   the port's files: punchout_region.patch (both games), projects/<game>/{recomp.yml,MAP.txt}
#   PO_WORK  workspace (WiiCompiled is cloned into PO_WORK/wiicompiled; one per game, so each keeps its build)
#   PO_DATA  Punch-Out!!: the extracted disc (sys/main.dol, files/...)
#            Doc Louis's: the title's contents (title.tmd and <content id>.app, assembled by the launcher)
#   PO_PORT  where the playable port goes
#   PO_LOGS  logs folder
#   PO_SEED  optional: another game's WiiCompiled clone, copied instead of downloading it again
# Prints "@@STEP n/7 description" between steps (the launcher's progress bar) and ninja's "[n/total]".
set -uo pipefail

: "${PO_SRC:?}" "${PO_WORK:?}" "${PO_DATA:?}" "${PO_PORT:?}" "${PO_LOGS:?}"
GAME=${PO_GAME:-punchout}
BASE_COMMIT=0d5c402
case "$GAME" in
    punchout) DOL=$PO_DATA/sys/main.dol; BIN=POWRecompiled; OLD_BINS="RePunched PunchOut FistIn" ;;
    # Doc Louis's game code is the title's content 1 (content 7 is only the loader that boots it).
    doclouis) DOL=$PO_DATA/00000001.app; BIN=DocLouis; OLD_BINS=""
              DOL_SHA256=3ea93aaa347414c4cd81891f4d13d605b2316abb53f1bc511d036122ea5c37eb ;;
    *) echo "BUILD FAILED: unknown game $GAME"; exit 1 ;;
esac
WC=$PO_WORK/wiicompiled
mkdir -p "$PO_WORK" "$PO_PORT/UserData" "$PO_LOGS"
exec > >(tee "$PO_LOGS/build.log") 2>&1

step() { echo "@@STEP $1/7 $2"; }
fail() { echo "BUILD FAILED: $*"; exit 1; }

for tool in git dotnet cmake ninja clang clang++; do
    command -v "$tool" > /dev/null || fail "$tool is not installed"
done
if [[ $GAME == doclouis ]]; then
    [[ -f "$DOL" ]] || fail "Doc Louis's Punch-Out!! is missing ($PO_DATA)"
    [[ "$(sha256sum "$DOL" | cut -c1-64)" == "$DOL_SHA256" ]] || fail "that isn't the supported Doc Louis's Punch-Out!! (USA)"
else
    [[ -f "$DOL" ]] || fail "the extracted disc is missing ($PO_DATA)"
fi
[[ -f "$PO_SRC/punchout_region.patch" ]] || fail "the port's patch is missing ($PO_SRC)"
[[ -f "$PO_SRC/projects/$GAME/MAP.txt" ]] || fail "the port's $GAME project is missing ($PO_SRC/projects/$GAME)"

step 1 "Getting WiiCompiled"
if [[ ! -d "$WC/.git" && -n "${PO_SEED:-}" && -d "$PO_SEED/.git" && -d "$PO_SEED/aurora-main" ]]; then
    # The other game's clone, copied locally (no download); git refuses local submodule sources unless allowed.
    git clone -q "$PO_SEED" "$WC" && git -C "$WC" remote set-url origin https://github.com/patchzyy/wiicompiled &&
        git -C "$WC" config submodule.aurora-main.url "$PO_SEED/aurora-main" || rm -rf "$WC"
fi
if [[ ! -d "$WC/.git" ]]; then
    git clone --recursive https://github.com/patchzyy/wiicompiled "$WC" || fail "could not download WiiCompiled"
fi
git -C "$WC" fetch -q origin 2>/dev/null
git -C "$WC" reset -q --hard "$BASE_COMMIT" || fail "could not reset WiiCompiled to $BASE_COMMIT"
git -c protocol.file.allow=always -C "$WC" submodule update --init --recursive || fail "submodule update failed"

step 2 "Applying the POW: Recompiled!! changes"
# Aurora's per-frame GPU buffers are fixed-size; some Punch-Out!! scenes overflow the defaults.
RES="$WC/aurora-main/lib/gfx/resources.hpp"
# The patch also changes some of Aurora's files, so all of Aurora goes back to its own version first.
git -C "$WC/aurora-main" checkout -q -- . || fail "could not reset Aurora"
sed -i -E 's/(VertexBufferSize = )5242880;/\120971520;/; s/(IndexBufferSize = )2097152;/\18388608;/' "$RES"
grep -q "IndexBufferSize = 8388608;" "$RES" || fail "could not enlarge Aurora's GPU buffers"
# reset --hard keeps untracked files, so files the patch creates are removed first.
git -C "$WC" apply --numstat --summary "$PO_SRC/punchout_region.patch" | awk '$1 == "create" {print $4}' |
    while IFS= read -r created; do rm -f "$WC/$created"; done
git -C "$WC" apply --whitespace=nowarn "$PO_SRC/punchout_region.patch" || fail "the patch did not apply"
mkdir -p "$WC/projects/$GAME" "$WC/Assets"
cp -f "$PO_SRC/projects/$GAME/recomp.yml" "$PO_SRC/projects/$GAME/MAP.txt" "$WC/projects/$GAME/"
cp -f "$DOL" "$WC/Assets/main.dol"
PROJECT=$WC/projects/$GAME/recomp.yml
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
    -DMKW_X86_CPU_PROFILE=$CPU -DMKW_SETUP_VERSION=$GAME-launcher || fail "cmake configure failed"

step 7 "Compiling (the long one)"
cmake --build "$NB" --target WiiCompiled --parallel "$(nproc)" || fail "compile failed"

# Install as a portable folder: its Config.toml, saves and logs stay inside it.
cp -f "$NB/WiiCompiled" "$PO_PORT/$BIN"
for old in $OLD_BINS; do rm -f "$PO_PORT/$old"; done   # the game's earlier names
for f in dsp_coef.bin cacert.pem; do [[ -f "$NB/$f" ]] && cp -f "$NB/$f" "$PO_PORT/"; done
rm -f "$PO_PORT/initial_pipeline_cache.db"   # Mario Kart Wii's shader list; the game builds its own
[[ -d "$NB/wii_bootstrap" ]] && cp -rf "$NB/wii_bootstrap" "$PO_PORT/"
if [[ -d "$WC/runtime/assets" ]]; then rm -rf "$PO_PORT/assets"; cp -rf "$WC/runtime/assets" "$PO_PORT/assets"; fi
touch "$PO_PORT/portable.txt"
echo "BUILD OK: $PO_PORT/$BIN"
