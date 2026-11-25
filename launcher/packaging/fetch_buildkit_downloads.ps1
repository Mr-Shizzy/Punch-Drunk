# Part of packaging\fetch_buildkit.js: downloads the compiler, CMake, Ninja and every library archive the build uses, by
# running WiiCompiled's own pinned scripts (which check each file against its checksum), then copies the archives to -Out.
# -Source   the unpacked WiiCompiled source (its Launcher\ scripts do the work)
# -Out      where the archives go (the build kit's downloads folder)
# -Scratch  a throwaway folder for the unpacked results (not kept)
param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Out,
    [Parameter(Mandatory)][string]$Scratch
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 3.0

$launcher = Join-Path $Source 'Launcher'
$downloads = Join-Path $launcher 'artifacts\downloads'
[IO.Directory]::CreateDirectory($downloads) | Out-Null
[IO.Directory]::CreateDirectory($Scratch) | Out-Null

& (Join-Path $launcher 'Prepare-PortableTools.ps1') -Destination (Join-Path $Scratch 'toolchain')
& (Join-Path $launcher 'Prepare-Dependencies.ps1') -Destination (Join-Path $Scratch 'deps')

# mbed TLS (the Archipelago client's wss://): the version and checksum the runtime pins, as scripts\build_port.ps1 reads them.
$pin = [IO.File]::ReadAllText((Join-Path $Source 'runtime\cmake\MbedTLSPin.cmake'))
$version = [regex]::Match($pin, 'MKW_MBEDTLS_VERSION "([^"]+)"').Groups[1].Value
$sha = [regex]::Match($pin, 'MKW_MBEDTLS_SHA256 "([0-9a-f]+)"').Groups[1].Value
if (-not $version -or -not $sha) { throw 'could not read the mbed TLS pin' }
$file = "mbedtls-$version.tar.bz2"
$archive = Join-Path $downloads $file
if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-$version/$file" -OutFile "$archive.partial"
    if ((Get-FileHash -LiteralPath "$archive.partial" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha) { throw "$file has the wrong checksum" }
    Move-Item -LiteralPath "$archive.partial" -Destination $archive -Force
}

[IO.Directory]::CreateDirectory($Out) | Out-Null
Get-ChildItem -LiteralPath $downloads -File | Where-Object { $_.Name -notmatch '\.(partial|part)$' } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Out -Force }
Write-Host "Archives in the kit: $((Get-ChildItem -LiteralPath $Out -File).Count)"
