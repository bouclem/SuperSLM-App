# Threat model — Sqersters apps (vdx, SuperSLM-App, Void-SuperCode, Fake-Stock-market-Generator)

## System overview
All four repositories are end-user software run on users' own machines; there is no server side and no infrastructure-as-code (user confirmed: no infrastructure repository exists).

| Component | Code | What it is |
|---|---|---|
| **SuperSLM-Main** | `SuperSLM-App/src/main.ts`, `src/preload.ts`, `src/llamacpp.ts`, `src/settings.ts`, `src/backend/` | Electron main process: IPC (`app:*`, `models:*`, `chats:*`, `settings:*`, `backend:*`), Hugging Face API browsing + GGUF downloads to `~/.lmsuperapp/models`, spawns llama.cpp, self-update via GitHub release assets + PowerShell. |
| **SuperSLM-Renderer** | `SuperSLM-App/src/renderer/**` | Sandboxed renderer (`contextIsolation`, `sandbox: true`, no nodeIntegration). Renders model READMEs, LLM output (custom markdown, KaTeX, highlight.js) via `innerHTML` with `escapeHtml`. |
| **VoidCode-Main** | `Void-SuperCode/src/main/**` | Electron main: fs IPC (read/save/delete/rename), git via `exec` (`main/git.ts`), pty terminal, `run-file`, search, extensions in `~/.voidscode/extensions`, auto-update downloading GitHub release archives and extracting/executing them (`main/auto-update.ts`). |
| **VoidCode-Renderer** | `Void-SuperCode/src/renderer/**`, `src/AI/**`, `src/lang/**` | Renderer (`contextIsolation: true`, no explicit `sandbox`): Monaco editor, markdown preview (`innerHTML`), HTML preview iframe (`allow-scripts allow-same-origin`), AI chat/autocomplete via Ollama/API with file tools. |
| **VDX-Interpreter** | `vdx/vdx/src/**`, `vdx/installer/**`, `vdx/build-release.ps1` | C++ interpreter for the VDX language: lexer/parser/interpreter, `import`, `fs` module (unrestricted unless `fs.setRoot`), loop protection, `@unsafe`. |
| **VDX-Website** | `vdx/website/**` | Static Next.js docs site. |
| **StockGen-Library** | `Fake-Stock-market-Generator/src/**` | Zero-dependency npm library (`stock-market-gen`) generating data, SVG charts and standalone HTML pages (`src/html.js`, `src/svg.js`). |
| **Release-CI** | `SuperSLM-App/.github/workflows/nightly.yml`, build scripts | Release/nightly pipelines producing installers (unsigned) and npm publish. |

## Trust boundaries and entry points
- **Renderer → main IPC** (both Electron apps): any script running in a renderer (e.g. via XSS from rendered content) can call every exposed IPC handler; for VoidCode-Main that includes file read/write/delete, git, terminal and `run-file`, i.e. code execution.
- **Remote content → app**: Hugging Face model metadata/READMEs/files (SuperSLM), LLM output (both apps), GitHub release API/assets (both self-updaters), Ollama/AI API responses (Void).
- **Opened project → Void SuperCode**: files rendered in markdown/HTML preview, AI tools reading project files.
- **.vdx scripts → VDX-Interpreter**: scripts and their imports.
- **Library callers → StockGen-Library**: options/symbol/name/title strings embedded into SVG/HTML output.

## Assets (user-stated priorities)
1. **Users' machines** — no code execution triggered by content (user: most important).
2. **Users' files, chats and projects** (chat history, settings, opened projects, downloaded models).
3. **Users' API keys / tokens / git credentials** stored or used by the apps.
4. Integrity of release artifacts and the npm package.

## Attackers that matter (user-confirmed)
- **Malicious content**: a crafted HF model card/repo or GGUF metadata, LLM output (including prompt-injected output), a malicious website the apps fetch from, data passed to the library, a crafted .vdx script.
- **Supply chain / update tampering**: tampered GitHub release assets or update metadata, compromised CI, dependency compromise.
- Out of scope: a local attacker already on the user's PC (draft assumption, not contradicted).

## Accepted risk / out of scope (user-stated)
- **Opening a folder in Void SuperCode means trusting it**: running files, the terminal, git hooks and other behaviour that executes code from an opened project are by design. (Content that is *not* the opened project — LLM output, remote responses, update payloads — is still in scope; an issue requiring a malicious opened project is accepted risk.)
- **VDX-Website is low priority** (static content).
- VDX scripts were *not* declared trusted: interpreter memory-safety, sandbox (`fs.setRoot`) escapes and import-path issues remain in scope.

## Existing controls
- SuperSLM renderer: `contextIsolation`, `sandbox: true`, `nodeIntegration: false`; `app:openExternal` only allows `https://` URLs; `escapeHtml` in markdown/highlight paths.
- Void renderer: `contextIsolation: true`, `nodeIntegration: false`; HTML preview in an iframe (but `allow-scripts allow-same-origin`).
- VDX: `fs.setRoot` canonicalizing sandbox (opt-in), loop safety limits, canonicalized import dedup.
- StockGen: `escapeHtml` in `src/html.js`.
- Downloads/updates over HTTPS from GitHub/Hugging Face; no signature or sha256 verification (TODO in code).

## Open questions
- Does Void SuperCode store remote AI API keys, and where (plaintext config vs `safeStorage`)?
- Is the vdx interpreter ever run on scripts from others (shared scripts, website examples), or only the author's own?
