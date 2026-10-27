# Swarm

A desktop workspace where Product, Developers and QA plan, build and test
software cooperatively with AI — Product / Develop / Test / Admin in one
window, with the debt an agent declares filed as work somebody owns.

Swarm is built with the
[CooperativeAICoding](https://github.com/PeterPartridge/CooperativeAICoding)
framework. If you want the way of working without the app, that is the
repository you want, and it needs no download.

---

## Download the app

Every release carries **six assets, built from one commit by the same
pipeline** ([`release.yml`](.github/workflows/release.yml)) — the Windows and
Linux builds are never a version apart.

| Platform | Asset | What it is |
|---|---|---|
| Windows | `Swarm_<version>_x64_en-US.msi` | The installer most people want (~18 MB). |
| Windows | `Swarm_<version>_x64-setup.exe` | NSIS installer — same app, smaller download (~13 MB). |
| Windows | `swarm.exe` (lower case — it is named after the crate, not the product) | Portable, ~47 MB. No installer; run it where it lands. |
| Linux | `*_amd64.deb` | Debian, Ubuntu, Mint and derivatives (~19 MB). |
| Linux | `*.x86_64.rpm` | Fedora, RHEL, openSUSE (~19 MB). |
| Linux | `*.AppImage` | Any distribution, nothing installed (~91 MB — it carries what the packages ask your package manager for). |

**[→ Latest release](https://github.com/PeterPartridge/Swarm/releases/latest)**

**x86-64 only, and no macOS build.** Neither is a technical wall — Tauri
targets both — but no machine here has ever produced one, and an untested
binary is worse than a missing one. Said here rather than left to be discovered
on the releases page.

**Nothing is signed.** Windows SmartScreen will warn about the installers and
the portable binary, and it is right to: the certificate that would silence it
is not something this project has. The honest check is the one you can actually
make — every asset is built in public from a named commit, and the run that
produced it is linked from the release.

---

## Windows

1. Download the `.msi` (or the `-setup.exe` — either is fine; the `.msi` is the
   conventional one).
2. Run it. On the SmartScreen warning: **More info → Run anyway**.
3. Launch **Swarm** from the Start menu.

**Portable instead:** download `swarm.exe`, put it anywhere, run it.
Be aware that portable means "no installer", **not** "no footprint" — it reads
and writes the same per-user data folder as an installed copy
(`%APPDATA%\com.swarm.app`), so the two share one database rather than
living separate lives.

---

## Linux

```bash
# Debian / Ubuntu
sudo apt install ./Swarm_*_amd64.deb

# Fedora / RHEL / openSUSE
sudo dnf install ./Swarm-*.x86_64.rpm

# Anywhere — nothing installed
chmod +x Swarm_*.AppImage
./Swarm_*.AppImage
```

Two things are worth knowing before you pick:

- **The app renders in a web view, so it needs WebKitGTK 4.1 and GTK 3.** The
  `.deb` and `.rpm` declare that, so your package manager installs it for you —
  and, on a distribution that does not package WebKitGTK **4.1**, refuses the
  install rather than giving you an app that opens to a blank window. The
  AppImage declares nothing, so on a minimal system it is the one that fails
  confusingly. Prefer the packages; reach for the AppImage when you cannot
  install.
- **API keys go to the system keyring**, over secret-service. That means a
  keyring daemon must be running (GNOME Keyring, KWallet) or saving a key will
  fail — on a bare window manager, this is the thing that catches people out.

Your data lives in `~/.local/share/com.swarm.app/`. Setting
`SWARM_DATA_DIR` moves it, on every platform.

---

## What the app still needs after installing

It is a workspace for agents; it does not ship one. In **Admin** you point it at:

- **An AI provider** — an Anthropic API key, a local [Ollama](https://ollama.com)
  (no key, no cost), or the **Claude Code** CLI if you already subscribe. The
  subscription route deliberately records **no spend**, because the app cannot
  see what a subscription costs and will not print a number it cannot source.
- **Somewhere for agents to run**, if you want them bounded — a WSL
  distribution the app creates and owns, or a container per run. The
  **where agents run** table says what this machine can actually offer, which
  verdicts are *enforced* by the operating system, and which are merely
  *asked* for. Where it cannot prove containment it says so instead of showing
  you a padlock.

There are no accounts and no server of its own: the app talks to the provider
you configure and to the repositories and policies you point it at, and
nothing else.

---

## Build it from source

Needed: **Node 24** ([`.nvmrc`](app/Swarm/.nvmrc)) and the Rust in
[`rust-toolchain.toml`](rust-toolchain.toml) — `rustup` reads that file and
installs the right one, so don't pick a version yourself.

```bash
git clone https://github.com/PeterPartridge/Swarm
cd Swarm/app/Swarm
npm ci                 # on Linux, see the note below
npx tauri dev          # run it
npx tauri build        # or produce the installers/packages for this platform
```

On **Linux** you also need Tauri's build dependencies present:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev \
  libdbus-1-dev patchelf build-essential file
```

…and `npm ci` will refuse the lockfile. `package.json` pins the **Windows**
native binaries for rollup and the Tauri CLI — itself a workaround for
[npm/cli#4828](https://github.com/npm/cli/issues/4828), without which npm
installs neither platform's binary and the build dies on a missing module. So
on Linux: drop those two pins, add their `-linux-x64-gnu` equivalents, delete
`package-lock.json`, and `npm install` to resolve fresh. The Linux job in
[`release.yml`](.github/workflows/release.yml) does exactly that and is the
authoritative copy of the steps — read it there rather than trusting this
paragraph to have kept up.

The gates the pipeline runs, if you want them locally:

```bash
cargo clippy --manifest-path app/Swarm/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test  --manifest-path app/Swarm/src-tauri/Cargo.toml
cd app/Swarm && npx tsc --noEmit && npm test
```
