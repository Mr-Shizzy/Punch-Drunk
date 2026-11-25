'use strict';

// Everything the Windows build is pinned to, in one place: the launcher (main.js) checks its files against these, and the
// release script (packaging/fetch_buildkit.js) downloads exactly these into the build kit that goes inside the zip.

// nodtool (encounter/nod, MIT / Apache-2.0): the same pinned release WiiCompiled's own setup uses.
const NODTOOL = {
  version: 'v2.0.0-alpha.10',
  'linux-x64': { asset: 'nodtool-linux-x86_64', sha256: 'f853b83268b9542faf0d28815bc3a23c090ae28ebf397e46f99cbb08122c8307' },
  'win32-x64': { asset: 'nodtool-windows-x86_64.exe', sha256: '1e150e33b88157527f96caea89ad12267aed8b117180c9ebaa89ebe89c1d948d' }
};

// Windows: Git (MinGit, GPL-2.0) and the .NET 8 SDK (MIT), both pinned. The .NET SDK has to be 8.0.200 or newer
// (the translator's TOML library needs its C# compiler); the hash is Microsoft's own, from its release list.
const MINGIT = {
  version: '2.53.0',
  url: 'https://github.com/git-for-windows/git/releases/download/v2.53.0.windows.1/MinGit-2.53.0-64-bit.zip',
  sha256: '82b562c918ec87b2ef5316ed79bb199e3a25719bb871a0f10294acf21ebd08cd'
};
const DOTNET = {
  version: '8.0.428',
  url: 'https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.428/dotnet-sdk-8.0.428-win-x64.zip',
  sha512: 'cce1dc5cfb2c5b73ddd9d3658f6009deb85be3a58dbec44a6dfe3910bb32b044ad2fc6bb28c77aded70c73270a204d207fe790dcb82ffca6c7b42c1335b51c21'
};

// WiiCompiled and its renderer (Aurora, a submodule), both from patchzyy on GitHub, at the exact commits the port's patch
// applies to. (scripts/build_port.ps1 names the same WiiCompiled commit.)
const WIICOMPILED = {
  repo: 'https://github.com/patchzyy/wiicompiled',
  commit: '0d5c402d0366640a294bf9c699068299591f7eff',
  aurora: { repo: 'https://github.com/patchzyy/aurora-wiicompiled', commit: '33067e34a17ca680eb961d9e0f3d48ddb22a7d7f' }
};

// Steam Deck: what its build tools start from, downloaded on the Deck during setup (scripts/setup_steamdeck_tools.sh).
// Canonical's official Ubuntu Base, with the checksum from the SHA256SUMS file beside it, and Microsoft's Linux .NET 8
// SDK, with the hash from Microsoft's release list.
const DECK_UBUNTU = {
  version: '24.04.5',
  url: 'https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.5-base-amd64.tar.gz',
  sha256: 'e77b6f10c2590cef872b33ee9f635a0e3fd1f57fb074c0e52b5c7f56147a0c86'
};
const DECK_DOTNET = {
  version: '8.0.428',
  url: 'https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.428/dotnet-sdk-8.0.428-linux-x64.tar.gz',
  sha512: '33212bb99a2bf003973d41106c7e8fe94208a12958ff601d4a476be379403c85a7dc9183a6ec64dfb44ded7102965be09f35add1758e68e9251bae7891d7b7bf'
};

module.exports = { NODTOOL, MINGIT, DOTNET, WIICOMPILED, DECK_UBUNTU, DECK_DOTNET };
