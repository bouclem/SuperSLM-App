# Changelog

## 0.2.4 - 2026-11-11

- Settings import/export (Settings > General > Settings file): Export writes `settings.json` via a save dialog, Import loads one back — every field validated by the normal settings rules and applied live (theme, text size, fullscreen, backend launch params)
- Markdown upgrades in replies, descriptions and the changelog: nested lists (mixed `ul`/`ol` by indent), task lists (`- [ ]` / `- [x]` with checkboxes), footnotes (`[^id]` refs scroll to the definition and back), and syntax highlighting in fenced code blocks via highlight.js (language taken from the fence, e.g. ` ```python `)
- Custom dropdowns are keyboard-driven now: open with ↓/Enter/Space, ↑/↓ moves the highlight (wraps), Home/End jumps, Enter/Space picks, Esc closes, Tab dismisses
- Fixed llama.cpp "Update to bXXXX" staying after a successful update — the installed-version cache only keyed on the binary path, not its mtime, so a replaced binary kept reporting the old version
- Nightly installer is versioned from `package.json` (`<version>-nightly.<sha>`) instead of the hardcoded `0.2.0`, so the exe name tracks the real version
- Installer no longer force-creates a desktop shortcut (`createDesktopShortcut: false`); start-menu entry stays

## 0.2.3 - 2026-11-10

- Stop generation: while a reply is generating, the send button becomes a stop square — stopping aborts the request and keeps the partial reply (works streamed or not)
- New setting: Show model thinking (Settings > General > Chat, on by default) — reasoning models (`reasoning_content` or `<think>` tags) get a collapsible thinking block, live while generating and saved with each reply
- Backend page shows the installed llama.cpp version and the latest GitHub release; the button now reads Install / Update / Reinstall instead of always "Install llama.cpp"
- Fixed cramped spacing between the theme list and the Text size section in Settings
- Installer: settings in `~/.lmsuperapp/` survive updates (they live outside the install dir), and a desktop shortcut the user deleted is no longer recreated on update

## 0.2.2 - 2026-10-28

- Backend port is now a setting (Settings > Backend > Launch parameters, default 8391) — llama-server no longer hardcodes 8391
- Launch parameters in Settings > Backend: port, context size (`--ctx-size`), GPU layers (`--n-gpu-layers`, -1 = auto), threads (`--threads`, 0 = auto); changing them stops a running backend so the next start picks them up
- Per-chat sampling: an openable panel on the right of the chat view with temperature, top-p, top-k and a system prompt — saved inside each chat's JSON and sent with every request
- Graceful backend shutdown: stop sends SIGTERM first, force-kills only after a 3s timeout, and quitting the app now stops a running llama-server instead of orphaning it
- Sidebar chats get hover actions: rename (inline edit) and delete (two-click confirm); deleting the open chat starts a fresh one, and renamed titles survive later auto-saves

## 0.2.1 - 2026-10-05

- Chat replies stream live — tokens appear as the model writes (SSE via llama-server)
- New settings: Stream replies, Notify on reply (desktop notification when a reply lands while unfocused), Messages in context (1–100, was fixed at 20), Confirm on close while generating, Default model sort
- UI feedback pass: send button spins while generating, all copy buttons flash a check, buttons press in, tabs/dropdowns animate in, thinking bubble pulses
- Renamed internals SLM → LM: bridge `window.lmsuperapp`, `Lm*` types, data dir `~/.lmsuperapp` (auto-migrates `~/.superslm` and remaps stored model paths)
- Fixed Settings: a missing `</div>` nested the Theme/Backend/Changelog/Debug pages inside General so only General worked
- TODO comments planted across the codebase marking planned work

## 0.2.0 - 2026-10-03

- New Export tab in the `+` More menu (placeholder — later: publish to Hugging Face, convert to GGUF)
- The app can now be packaged to a Windows installer: `npm run dist` produces `dist/LM SuperApp Setup 0.2.0.exe` — run LM SuperApp directly, no `npm start` needed
- Nightly builds on GitHub Actions: every night it checks for new commits (skips if none), builds the `.exe` on Windows, and publishes a prerelease named `nightly-<commit>` (e.g. `nightly-2225b90`), versioned `0.2.0-nightly.<commit>`

## 0.1.10 - 2026-10-03

- Downloads actually show: model detail now lists GGUFs in subfolders AND the companion `*-GGUF` repo (was empty for most models)
- Quant badges on downloadable files (Q4_K_M, Q8_0, IQ4_XS, F16…)
- LaTeX math in replies & descriptions renders as real formulas via KaTeX (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`)
- PDF links (`.pdf`, arXiv `/pdf/`) open in your browser
- Copy button on every code block; copy button next to the model name in detail
- Model description is centered (760px column)
- Fixed weird descriptions: 4-space indented code blocks and `~~~` fences now render as code
- New `src/backend/` folder — future home for Python-powered features (finetune & co)
- All UI icons now load from `src/renderer/icons/` (esbuild text imports) instead of duplicated inline SVGs; app icon moved to root `icons/`
- MIT license (Sqersters)

## 0.1.9 - 2026-10-03

- Assistant replies render markdown (bold, lists, code, tables) instead of raw `**`
- Hover actions under each bubble: copy, retry (assistant), edit & resend (user)
- Message versions: retry/edit keep the old answer/input — browse them with the ‹ n/m › arrows; versions persist in the saved chat
- Generation speed shown under assistant replies (tok/s, always visible; `~` when estimated)
- Message timestamps under each bubble (shown on hover)

## 0.1.8 - 2026-10-03

- Renamed the app to LM SuperApp (window title, sidebar, package name)
- Chat: custom styled model dropdown replacing the ugly native select
- Chat history: conversations auto-save to `~/.superslm/chats/`; sidebar lists them under the nav with a "+ New chat" button — click one to reload it
- Chat layout: centered 960px conversation column, larger 16px bubbles, input and controls scaled up
- Home is now a small dashboard: greeting + tiles for library count, active model, backend status (clickable shortcuts)
- Fixed the "+" More menu vanishing before you can reach it (hover bridge)
- Removed the Models settings page (duplicated by Library); "Ask before downloading" moved to Settings > General

## 0.1.7 - 2026-10-03

- Added Library tab: picked local files (with a `file` badge) + downloaded models, each with size and "Use in chat" / Remove; placeholder sections for finetuned models and generated media
- Local .gguf picking is now multi-select and saves to a `localFiles` list — add from Library, the Models toolbar, or Settings > Models (which manages the list: per-file Remove, Clear all)
- Chat's model selector lists every picked file and downloaded model
- Added a "+" More button in the sidebar — hover or click reveals extra tabs; Finetune is the first (placeholder, not working yet)
- Added backend build choice in Settings > Backend: Vulkan (default, GPU), CUDA 13.4, CUDA 12.4, or CPU — Install downloads that build
- Fixed install assuming CPU: llama.cpp build is now a real setting (`backendBuild`)

## 0.1.6 - 2026-09-27

- Chat works for real: pick a model (downloaded GGUFs + local files) in the Chat tab and send a message — it starts the llama.cpp backend and replies
- Added Backend settings page: llama-server status, start/stop, one-click install (downloads latest llama.cpp Windows release to `~/.superslm/bin`)
- Added Idle shutdown setting: backend stops after 5/10/15 min of inactivity, or never
- Chat keeps conversation history (last 20 messages) per session
- Backend auto-restarts when the selected model changes

## 0.1.5 - 2026-09-27

- Added local GGUF picker (Models toolbar + Settings > Models), saved as `modelFile`
- Added model detail panel: click a model to see metadata, full README description, and GGUF file list with sizes
- Added real downloads: GGUF files save to `~/.superslm/models/<org>/<name>/` with progress bars
- Added "Ask before downloading" setting (`confirmDownload`) — native confirm dialog before saving
- Added Models settings page (local model + download options)
- Added Text size setting under Settings > Theme: Compact / Default / Large / XL (zooms the whole UI, persisted as `fontScale`)
- Started llama.cpp backend: finds `llama-server` in `~/.superslm/bin` or PATH, start/stop/status in Settings > Debug
- Chat shows the currently selected local model
- Upgraded the markdown renderer: tables, code blocks, inline code, italics, numbered lists, blockquotes — used for both model descriptions and the changelog
- README cleaning: strips front-matter, comments, HTML tags, badges, hr lines; truncates long cards at paragraph boundaries
- Fixed Models toolbar wrapping/clipping at all window sizes

## 0.1.4 - 2026-09-27

- Added Chat tab (UI only — sending shows a "not implemented" error, no model yet)
- Added Debug settings page: debug output toggle, DevTools controls, recent error list
- Debug mode shows error codes/details in the UI, including chat errors
- Added `debug` and `devtools` persisted settings; DevTools can open detached on launch

## 0.1.3 - 2026-09-27

- Fixed missing app icon: generated `assets/icon.ico`/`icon.png` (amber mark, pixel "S")
- Added custom themed scrollbars
- Added three new themes: Midnight, Sand, Forest
- Added fullscreen option in Settings > General (applies now and on launch)
- Made the layout adaptive: icon-only sidebar, horizontal settings menu, and wrapped toolbars on small windows

## 0.1.2 - 2026-09-27

- Added theme settings (dark/light) under Settings > Theme
- Added `~/.superslm/` user folder with `settings.json` as a generic settings store
- Enabled Models tab: most liked / most downloaded sorting + search via the Hugging Face API (listing only, no downloads yet)
- Added theme, download, and heart icons
- Restructured the renderer into modules (api, core, views) bundled by esbuild; split styles per view

## 0.1.1 - 2026-09-27

- Added settings menu, opened from a gear button in the bottom-left
- Added changelog view inside settings (rendered from this file)
- Added SVG icon set for navigation and future surfaces
- Added README

## 0.1.0 - 2026-09-27

- Initial scaffold: Electron + TypeScript, vanilla HTML/CSS renderer
- Home tab with sidebar shell, dark grey minimal theme
