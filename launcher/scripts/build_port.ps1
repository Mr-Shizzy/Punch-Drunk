# POW: Recompiled!! (Punch-Out!! Wii): builds one of the ports on Windows (run by the launcher; the Windows twin of build_port.sh).
#   PO_GAME    punchout (default) or doclouis
#   PO_SRC     the port's files: punchout_region.patch (both games), projects/<game>/{recomp.yml,MAP.txt}
#   PO_WORK    workspace (WiiCompiled is cloned into PO_WORK\wiicompiled; one per game, so each keeps its build)
#   PO_DATA    Punch-Out!!: the extracted disc (sys\main.dol, files\...)
#              Doc Louis's: the title's contents (title.tmd and <content id>.app, collected by the launcher)
#   PO_PORT    where the playable port goes
#   PO_TOOLCHAIN  optional: where the compiler, CMake and Ninja go (default PO_WORK\toolchain; the launcher shares
#              one between the games)
#   PO_SEED    optional: another game's WiiCompiled clone, copied instead of downloading it again
#   PO_GIT     git.exe (the launcher's portable MinGit)
#   PO_DOTNET  dotnet.exe (the launcher's portable .NET SDK)
# Prints "@@STEP n/8 description" between steps (the launcher's progress bar) and ninja's "[n/total]". The compiler,
# CMake, Ninja and the renderer's libraries come from WiiCompiled's own pinned Windows scripts
# (Launcher\Prepare-PortableTools.ps1, Prepare-Dependencies.ps1, NativeBuildFlags.ps1): the same toolchain and
# configure flags its Windows installer builds with.
$ErrorActionPreference = 'Stop'
# Windows PowerShell's download progress bar slows Invoke-WebRequest to a crawl (also for WiiCompiled's scripts).
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 3.0

$BaseCommit = '0d5c402'
$Steps = 8

function Say([string]$Text) { [Console]::Out.WriteLine($Text); [Console]::Out.Flush() }
function Step([int]$Number, [string]$Text) { Say "@@STEP $Number/$Steps $Text" }
function Fail([string]$Text) { Say "BUILD FAILED: $Text"; exit 1 }
# Runs a program with its output going straight to the launcher; fails the build on a non-zero exit code.
function Run([string]$Exe, [string[]]$Arguments, [string]$What) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "$What (exit code $LASTEXITCODE)" }
}
function Need([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) { Fail "$Name is not set" }
    return $value
}

$Src = Need 'PO_SRC'; $Work = Need 'PO_WORK'; $Data = Need 'PO_DATA'; $Port = Need 'PO_PORT'
$GitExe = Need 'PO_GIT'; $DotnetExe = Need 'PO_DOTNET'
# (PowerShell names are case-insensitive: $GameExe, not $Bin, which the toolchain's $bin below would overwrite.)
$Game = if ($env:PO_GAME) { $env:PO_GAME } else { 'punchout' }
switch ($Game) {
    'punchout' { $Dol = Join-Path $Data 'sys\main.dol'; $GameExe = 'POWRecompiled.exe'; $OldBins = @('RePunched.exe', 'FistIn.exe') }
    # Doc Louis's game code is the title's content 1 (content 7 is only the loader that boots it).
    'doclouis' { $Dol = Join-Path $Data '00000001.app'; $GameExe = 'DocLouis.exe'; $OldBins = @() }
    default { Fail "unknown game $Game" }
}
$WC = Join-Path $Work 'wiicompiled'
$Toolchain = if ($env:PO_TOOLCHAIN) { $env:PO_TOOLCHAIN } else { Join-Path $Work 'toolchain' }
foreach ($dir in @($Work, (Join-Path $Port 'UserData'))) { [IO.Directory]::CreateDirectory($dir) | Out-Null }
if ($Game -eq 'doclouis') {
    if (-not (Test-Path -LiteralPath $Dol -PathType Leaf)) { Fail "Doc Louis's Punch-Out!! is missing ($Data)" }
    $dolSha = (Get-FileHash -LiteralPath $Dol -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($dolSha -ne '3ea93aaa347414c4cd81891f4d13d605b2316abb53f1bc511d036122ea5c37eb') { Fail "that isn't the supported Doc Louis's Punch-Out!! (USA)" }
} elseif (-not (Test-Path -LiteralPath $Dol -PathType Leaf)) { Fail "the extracted disc is missing ($Data)" }
if (-not (Test-Path -LiteralPath (Join-Path $Src 'punchout_region.patch') -PathType Leaf)) { Fail "the port's patch is missing ($Src)" }
if (-not (Test-Path -LiteralPath (Join-Path $Src "projects\$Game\MAP.txt") -PathType Leaf)) { Fail "the port's $Game project is missing ($Src)" }

# Git for Windows turns LF into CRLF on checkout by default, which would stop the patch applying; long paths
# because the translated sources nest deeply.
$env:GIT_CONFIG_NOSYSTEM = '1'
$GitFlags = @('-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', '-c', 'advice.detachedHead=false')
function Git([string[]]$Arguments, [string]$What) { Run $GitExe ($GitFlags + $Arguments) $What }

$env:DOTNET_ROOT = Split-Path -Parent $DotnetExe
$env:DOTNET_MULTILEVEL_LOOKUP = '0'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'

# ---------------------------------------------------------------------------------------------------------------
Step 1 'Getting WiiCompiled'
$Seed = $env:PO_SEED
if (-not (Test-Path -LiteralPath (Join-Path $WC '.git')) -and $Seed -and (Test-Path -LiteralPath (Join-Path $Seed '.git')) -and
    (Test-Path -LiteralPath (Join-Path $Seed 'aurora-main'))) {
    # The other game's clone, copied locally (no download); git refuses local submodule sources unless allowed.
    & $GitExe @GitFlags clone -q $Seed $WC
    if ($LASTEXITCODE -eq 0) {
        & $GitExe @GitFlags -C $WC remote set-url origin https://github.com/patchzyy/wiicompiled
        & $GitExe @GitFlags -C $WC config submodule.aurora-main.url (Join-Path $Seed 'aurora-main')
    } elseif (Test-Path -LiteralPath $WC) { Remove-Item -LiteralPath $WC -Recurse -Force }
}
if (-not (Test-Path -LiteralPath (Join-Path $WC '.git'))) {
    Git @('clone', '--recursive', 'https://github.com/patchzyy/wiicompiled', $WC) 'could not download WiiCompiled'
}
& $GitExe @GitFlags -C $WC fetch -q origin
Git @('-C', $WC, 'reset', '-q', '--hard', $BaseCommit) "could not reset WiiCompiled to $BaseCommit"
Git @('-c', 'protocol.file.allow=always', '-C', $WC, 'submodule', 'update', '--init', '--recursive', '--force') 'submodule update failed'

# ---------------------------------------------------------------------------------------------------------------
Step 2 'Applying the POW: Recompiled!! changes'
# Aurora's per-frame GPU buffers are fixed-size; some Punch-Out!! scenes overflow the defaults.
# The patch also changes some of Aurora's files, so all of Aurora goes back to its own version first.
Git @('-C', (Join-Path $WC 'aurora-main'), 'checkout', '-q', '--', '.') 'could not reset Aurora'
$res = Join-Path $WC 'aurora-main\lib\gfx\resources.hpp'
$text = [IO.File]::ReadAllText($res)
$text = $text.Replace('VertexBufferSize = 5242880;', 'VertexBufferSize = 20971520;').Replace('IndexBufferSize = 2097152;', 'IndexBufferSize = 8388608;')
if (-not $text.Contains('IndexBufferSize = 8388608;')) { Fail "could not enlarge Aurora's GPU buffers" }
[IO.File]::WriteAllText($res, $text)
# reset --hard keeps untracked files, so files the patch creates are removed first.
$patch = Join-Path $Src 'punchout_region.patch'
$summary = & $GitExe @GitFlags -C $WC apply --numstat --summary $patch
if ($LASTEXITCODE -ne 0) { Fail 'could not read the patch' }
foreach ($line in $summary) {
    if ($line -match '^\s*create mode \d+ (.+)$') {
        $created = Join-Path $WC ($Matches[1].Trim().Replace('/', '\'))
        if (Test-Path -LiteralPath $created -PathType Leaf) { Remove-Item -LiteralPath $created -Force }
    }
}
Git @('-C', $WC, 'apply', '--whitespace=nowarn', $patch) 'the patch did not apply'
$projectDir = Join-Path $WC "projects\$Game"
foreach ($dir in @($projectDir, (Join-Path $WC 'Assets'))) { [IO.Directory]::CreateDirectory($dir) | Out-Null }
foreach ($name in @('recomp.yml', 'MAP.txt')) {
    Copy-Item -LiteralPath (Join-Path $Src "projects\$Game\$name") -Destination $projectDir -Force
}
Copy-Item -LiteralPath $Dol -Destination (Join-Path $WC 'Assets\main.dol') -Force

# ---------------------------------------------------------------------------------------------------------------
Step 3 'Getting the compiler and libraries'
$launcherScripts = Join-Path $WC 'Launcher'
$deps = Join-Path $WC 'Dependencies'
$downloads = Join-Path $launcherScripts 'artifacts\downloads'
[IO.Directory]::CreateDirectory($downloads) | Out-Null
try {
    & (Join-Path $launcherScripts 'Prepare-PortableTools.ps1') -Destination $Toolchain
} catch {
    Fail "could not get the compiler: $($_.Exception.Message)"
}
$cmakeTool = Join-Path $Toolchain 'CMake\bin\cmake.exe'
if (-not (Test-Path -LiteralPath $cmakeTool -PathType Leaf)) { Fail "CMake is missing ($cmakeTool)" }

# A pinned download in WiiCompiled's download cache, fetched again if it's missing or its checksum is off.
function Get-Pinned([string]$File, [string]$Sha256, [string]$Uri) {
    $archive = Join-Path $downloads $File
    if ((Test-Path -LiteralPath $archive) -and
        ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Sha256)) { return $archive }
    Say "Downloading $File..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $partial = "$archive.partial"
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $partial
    $actual = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256) { Remove-Item -LiteralPath $partial -Force; Fail "$File downloaded with the wrong checksum ($actual)" }
    Move-Item -LiteralPath $partial -Destination $archive -Force
    return $archive
}
# Windows 10's tar.exe can't read .bz2 archives (Windows 11's can), and Prepare-Dependencies.ps1 unpacks with it.
# CMake's own unpacker can, so .tar.bz2 packages are unpacked here first, in the layout Prepare-Dependencies.ps1
# uses (one top folder moved to Dependencies\<name>) and with the same "<file> <sha256>" stamp beside it; it then
# finds them ready and skips them.
function Expand-WithCMake([string]$Archive, [string]$Target, [string]$Stamp) {
    if ((Test-Path -LiteralPath $Target -PathType Container) -and (Test-Path -LiteralPath "$Target.source") -and
        ([IO.File]::ReadAllText("$Target.source") -eq $Stamp)) { return }
    $extract = Join-Path (Split-Path -Parent $Target) ('.extract-' + (Split-Path -Leaf $Target))
    if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
    [IO.Directory]::CreateDirectory($extract) | Out-Null
    Push-Location $extract
    try { & $cmakeTool -E tar xf $Archive; $code = $LASTEXITCODE } finally { Pop-Location }
    if ($code -ne 0) { Fail "could not unpack $(Split-Path -Leaf $Archive) (exit code $code)" }
    $entries = @(Get-ChildItem -LiteralPath $extract -Force)
    $source = $extract
    if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) { $source = $entries[0].FullName }
    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
    Move-Item -LiteralPath $source -Destination $Target
    if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
    [IO.File]::WriteAllText("$Target.source", $Stamp)
}
[IO.Directory]::CreateDirectory($deps) | Out-Null
# The .tar.bz2 packages, read from Prepare-Dependencies.ps1's own pinned list (today: libusb).
$depList = [IO.File]::ReadAllText((Join-Path $launcherScripts 'Prepare-Dependencies.ps1'))
$bz2 = [regex]::Matches($depList, "Name = '([^']+)'; File = '([^']+\.tar\.bz2)'\s+Sha256 = '([0-9a-f]{64})'\s+Uris = @\('([^']+)'")
foreach ($m in $bz2) {
    $name = $m.Groups[1].Value; $file = $m.Groups[2].Value; $sha = $m.Groups[3].Value; $uri = $m.Groups[4].Value
    Expand-WithCMake (Get-Pinned $file $sha $uri) (Join-Path $deps $name) "$file $sha"
}
try {
    & (Join-Path $launcherScripts 'Prepare-Dependencies.ps1') -Destination $deps
} catch {
    Fail "could not get the build libraries: $($_.Exception.Message)"
}
# mbed TLS for the Archipelago client's wss:// (runtime\CMakeLists.txt): the version and checksum it pins.
$pin = [IO.File]::ReadAllText((Join-Path $WC 'runtime\cmake\MbedTLSPin.cmake'))
$mbedVersion = [regex]::Match($pin, 'MKW_MBEDTLS_VERSION "([^"]+)"').Groups[1].Value
$mbedSha = [regex]::Match($pin, 'MKW_MBEDTLS_SHA256 "([0-9a-f]+)"').Groups[1].Value
if (-not $mbedVersion -or -not $mbedSha) { Fail 'could not read the mbed TLS pin' }
$mbedFile = "mbedtls-$mbedVersion.tar.bz2"
$mbedArchive = Get-Pinned $mbedFile $mbedSha "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-$mbedVersion/$mbedFile"
Expand-WithCMake $mbedArchive (Join-Path $deps 'mkw_mbedtls_upstream') "$mbedFile $mbedSha"

# CMake, Ninja and clang don't all quote paths the same way; WiiCompiled's helper gives them a plain spelling
# (a junction under ProgramData) when the real path has unusual characters.
. (Join-Path $launcherScripts 'NativeBuildFlags.ps1')
$WS = Get-MkwBuildSafePath $WC 'workspace' 'runtime\CMakeLists.txt'
$TC = Get-MkwBuildSafePath $Toolchain 'toolchain' 'CMake\bin\cmake.exe'
$cmake = Join-Path $TC 'CMake\bin\cmake.exe'
$ninja = Join-Path $TC 'Ninja\ninja.exe'
$bin = Join-Path $TC 'llvm-mingw\bin'
$cc = Join-Path $bin 'x86_64-w64-mingw32-clang.exe'
$cxx = Join-Path $bin 'x86_64-w64-mingw32-clang++.exe'
$windres = Join-Path $bin 'x86_64-w64-mingw32-windres.exe'
foreach ($tool in @($cmake, $ninja, $cc, $cxx, $windres)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { Fail "a build tool is missing: $tool" }
}
$project = Join-Path $WS "projects\$Game\recomp.yml"
$gen = Join-Path $WS 'generated'

# ---------------------------------------------------------------------------------------------------------------
Step 4 'Building the translator'
# Portable: no build servers left running afterwards, and NuGet reads the launcher's own config (PO_NUGET_CONFIG)
# instead of creating one in AppData.
$dotnetBuild = @('build', (Join-Path $WS 'translator\src\Translator.Cli\Translator.Cli.csproj'), '-c', 'Release', '-v', 'quiet',
    '--disable-build-servers', '-nodeReuse:false', '-p:UseSharedCompilation=false')
if ($env:PO_NUGET_CONFIG) { $dotnetBuild += "-p:RestoreConfigFile=$($env:PO_NUGET_CONFIG)" }
Run $DotnetExe $dotnetBuild 'translator build failed'
$dll = Join-Path $WS 'translator\src\Translator.Cli\bin\Release\net8.0\Translator.Cli.dll'
if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) { Fail "the translator wasn't built ($dll)" }
function Xlate([string[]]$Arguments, [string]$What) { Run $DotnetExe (@($dll) + $Arguments) $What }

Push-Location $WS
try {
    # -----------------------------------------------------------------------------------------------------------
    Step 5 'Translating the game code'
    $threads = [Math]::Max(1, [Math]::Min([Environment]::ProcessorCount, 16))
    Xlate @('translate-recursive', '0x80006124', '--project', $project, '--outdir', (Join-Path $gen 'functions'),
        '--output-metadata', (Join-Path $gen 'base_translation_output.json'), '--prune-stale', '--threads', "$threads") 'translation failed'

    # -----------------------------------------------------------------------------------------------------------
    Step 6 'Preparing the build'
    Xlate @('generate-data-init', '--project', $project) 'generate-data-init failed'
    $env:WIICOMPILED_DEV_ALLOW_UNSUPPORTED = '1'
    Xlate @('emit-build-shards', '--project', $project, '--base-metadata', (Join-Path $gen 'base_translation_output.json'),
        '--base-functions-dir', (Join-Path $gen 'functions'), '--native-source-dir', (Join-Path $WS 'runtime\src'),
        '--out', (Join-Path $gen 'build_shards')) 'emit-build-shards failed'

    # -----------------------------------------------------------------------------------------------------------
    Step 7 'Configuring'
    # Files dated in the future (written while the PC's clock was ahead, e.g. a Linux dual boot leaving the hardware
    # clock in UTC) stay newer than everything Ninja writes: it then re-runs CMake 100 times and gives up ("manifest
    # 'build.ninja' still dirty"). Such files get the current time.
    $now = Get-Date
    $future = @(Get-ChildItem -LiteralPath $WS -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt $now.AddMinutes(1) })
    if ($future.Count -gt 0) {
        Say "Fixing $($future.Count) file(s) dated in the future (the PC's clock was ahead when they were written)"
        foreach ($file in $future) { try { $file.LastWriteTime = $now } catch { } }
    }
    # Only the bundled toolchain may be visible, or another compiler on PATH could leak in (as LocalBuild.ps1 does).
    $env:PATH = Get-MkwToolchainPath $TC
    $memoryGiB = [Math]::Max(1, [Math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB))
    $jobs = [Math]::Max(1, [Math]::Min([Environment]::ProcessorCount, [Math]::Floor(($memoryGiB - 2) / 0.5)))
    $parallel = [Math]::Max($jobs, [Environment]::ProcessorCount)
    $cpu = 'v2'
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $defines = & $cc -march=native -dM -E -x c NUL 2>$null
    $ErrorActionPreference = $previous
    if ($defines -match '__AVX2__') { $cpu = 'v3' }
    $build = Join-Path $WS 'native-build'
    $configure = Get-MkwNativeConfigureArguments -SourceDirectory (Join-Path $WS 'runtime') -BuildDirectory $build `
        -Ninja $ninja -CCompiler $cc -CxxCompiler $cxx -ResourceCompiler $windres `
        -DependenciesDirectory (Join-Path $WS 'Dependencies') -NativePrebuiltDirectory '' `
        -AdditionalArguments @("-DMKW_TRANSLATED_COMPILE_JOBS=$jobs", "-DMKW_X86_CPU_PROFILE=$cpu", "-DMKW_SETUP_VERSION=$Game-launcher")
    & $cmake @configure
    if ($LASTEXITCODE -ne 0) {
        # A build folder from an older layout or toolchain can refuse to reconfigure: start it fresh once.
        Say 'Configuring again from a clean build folder...'
        if (Test-Path -LiteralPath $build) { Remove-Item -LiteralPath $build -Recurse -Force }
        Run $cmake $configure 'cmake configure failed'
    }

    # -----------------------------------------------------------------------------------------------------------
    Step 8 'Compiling (the long one)'
    Run $cmake @('--build', $build, '--target', 'WiiCompiled', '--parallel', "$parallel") 'compile failed'
} finally {
    Pop-Location
}

# Install as a portable folder: its Config.toml, saves and logs stay inside it.
$exe = Join-Path $build 'WiiCompiled.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Fail "the game wasn't built ($exe)" }
Copy-Item -LiteralPath $exe -Destination (Join-Path $Port $GameExe) -Force
foreach ($old in $OldBins) {   # the game's earlier names
    $oldExe = Join-Path $Port $old
    if (Test-Path -LiteralPath $oldExe) { Remove-Item -LiteralPath $oldExe -Force }
}
# The DLLs and data LocalBuild.ps1 ships beside the game, plus the CA bundle the Archipelago client verifies with.
# initial_pipeline_cache.db is Mario Kart Wii's shader list; the game builds its own.
foreach ($name in @('dxcompiler.dll', 'dxil.dll', 'libc++.dll', 'libpng16.dll', 'libunwind.dll', 'libz.dll', 'libzlib1.dll',
        'SDL3.dll', 'sqlite3.dll', 'webgpu_dawn.dll', 'z.dll', 'noshaders.zip', 'dsp_coef.bin', 'cacert.pem')) {
    $file = Join-Path $build $name
    if (Test-Path -LiteralPath $file -PathType Leaf) { Copy-Item -LiteralPath $file -Destination $Port -Force }
}
$stale = Join-Path $Port 'initial_pipeline_cache.db'
if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Force }
foreach ($name in @('config', 'wii_bootstrap')) {
    $dir = Join-Path $build $name
    $target = Join-Path $Port $name
    if (Test-Path -LiteralPath $dir -PathType Container) {
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        Copy-Item -LiteralPath $dir -Destination $target -Recurse
    }
}
$assets = Join-Path $WS 'runtime\assets'
$portAssets = Join-Path $Port 'assets'
if (Test-Path -LiteralPath $portAssets) { Remove-Item -LiteralPath $portAssets -Recurse -Force }
Copy-Item -LiteralPath $assets -Destination $portAssets -Recurse
[IO.File]::WriteAllText((Join-Path $Port 'portable.txt'), '')
Say "BUILD OK: $(Join-Path $Port $GameExe)"
exit 0
