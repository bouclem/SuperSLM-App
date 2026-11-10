# LM SuperApp

A desktop superapp for language models (LMs), built with Electron.

## Status

v0.2.3 — LM SuperApp. Home dashboard (stat tiles), Models (HF sort + search, detail panel, GGUF downloads to
`~/.lmsuperapp/models/`, local .gguf picker), Chat (custom model select,
chat history in `~/.lmsuperapp/chats/` with rename/delete hover actions,
per-chat sampling params + system prompt, streaming replies with a stop
button and a collapsible model-thinking block, real inference via llama.cpp
backend), Library (local files + downloads), Finetune and Export
(placeholders via "+" menu), and Settings (General, Backend, Theme, Changelog, Debug) via the
sidebar gear. Five themes, text size, fullscreen, debug, devtools,
modelFile, localFiles, confirmDownload, idleStopMinutes, backendBuild,
streamReplies, showThinking, notifyOnReply, contextMessages,
confirmOnClose, defaultModelSort,
backendPort, ctxSize, gpuLayers and threads
persist to `~/.lmsuperapp/settings.json`. App icon in
`icons/` (regenerate via `node scripts/gen-icon.mjs`). `src/backend/` holds the
Python side for future features. `src/llamacpp.ts`
manages `llama-server` on a configurable port (default 8391): spawn with
launch params (--ctx-size/--n-gpu-layers/--threads), /health polling,
OpenAI-style /v1/chat/completions with per-chat sampling, idle auto-stop,
graceful SIGTERM-then-SIGKILL shutdown (also on app quit),
status/start/stop IPC. Install
button pulls the latest llama.cpp Windows release from GitHub into
`~/.lmsuperapp/bin`. Renderer is modular: core/api/views.

## Stack

- Electron + TypeScript, no framework
- `src/*.ts` (main, preload, settings) compile to `out/` via `tsc` (CommonJS)
- `src/renderer/**/*.ts` is type-checked by `tsc` then bundled by **esbuild**
  into `src/renderer/app.js` (IIFE) — ES modules in source, one file served
- `src/renderer/index.html` is the shell; views render their own markup

## Architecture

- `src/main.ts` — `BrowserWindow` (sandboxed, context isolation on, node
  integration off); IPC: `app:info`, `app:changelog`, `settings:get`,
  `settings:patch`, `dialog:pickGguf`, `window:fullscreen`, `window:devtools`,
  `models:list` / `models:detail` / `models:download` (proxies Hugging Face,
  streams files to disk, `models:progress` events), `backend:*`
- `src/llamacpp.ts` — llama.cpp backend: locates `llama-server`, spawns it
  with the selected model on port 8391, reports status
- `src/settings.ts` — `~/.lmsuperapp/` init, `settings.json` load/patch
- `src/preload.ts` — exposes `window.lmsuperapp` via `contextBridge`
- `src/renderer/api.ts` — typed wrappers over `window.lmsuperapp`
- `src/renderer/core/` — `dom.ts` (byId, escapeHtml), `tabs.ts` (router +
  `onTabOpen` lazy hooks), `markdown.ts`, `theme.ts` (apply + persist),
  `debug.ts` (debug flag + recent-error log emitting `lmsuperapp:debug`)
- `src/renderer/views/` — `home.ts`, `models.ts`, `chat.ts`, `settings.ts` — each
  `mount(root)` renders markup into its tab section and wires its own events
- `src/renderer/styles/` — `base.css` (theme vars, shell, sidebar, shared),
  `home.css`, `models.css`, `settings.css`
- `src/renderer/icons/` — shared SVG icon set (stroke style, 24x24)
- `src/renderer/global.d.ts` — ambient types: `window.lmsuperapp`, settings, models
- `src/renderer/app.ts` — bootstrap: mounts views, initTabs/initTheme, applies
  saved theme, fills footer version

## User storage

`~/.lmsuperapp/settings.json` — `{"theme", "fullscreen", "debug", "devtools",
"modelFile", "confirmDownload"}`, created on first run.
`~/.lmsuperapp/models/<org>/<name>/` — downloaded GGUF files.
`~/.lmsuperapp/bin/` — optional place for `llama-server` binary.

## Run

```
npm install
npm start    # tsc (main) + tsc typecheck (renderer) + esbuild bundle + electron
npm run dist # same build, then electron-builder → dist/LM SuperApp Setup <ver>.exe
```

## Packaging & nightly

electron-builder (config in `package.json` → `build`) packages `out/`,
`src/renderer/`, `src/backend/`, `docs/CHANGELOG.md` and the app icon into a
NSIS installer. `.github/workflows/nightly.yml` runs nightly (cron + manual):
skips when HEAD equals the last `nightly-*` tag, otherwise versions the build
`0.2.0-nightly.<sha>`, builds the `.exe`, and publishes a GitHub prerelease
tagged `nightly-<sha>`.

## Direction

New tab: add an empty `<section class="tab" id="tab-name">`, a `data-tab="name"`
nav button, a `views/name.ts` with `mount(root)`, and mount it in `app.ts`.
New settings page: menu item + page inside `views/settings.ts`. New persisted
setting: extend `LmSettings` in `src/settings.ts` and patch via
`settings:patch`.
