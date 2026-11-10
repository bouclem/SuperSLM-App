import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
  abortChat,
  chatCompletion,
  getBackendStatus,
  setIdleMinutes,
  setLaunchParams,
  startBackend,
  stopBackend,
  waitReady
} from './llamacpp';
import type { ChatChunk, ChatMessage, SamplingParams } from './llamacpp';
import type { LmSettings } from './settings';
import { ensureStorage, loadSettings, patchSettings, THEME_BG } from './settings';

const HF_API = 'https://huggingface.co/api/models';
const HF_LIMIT = '24';
const HF_MAX_SEARCH_LEN = 200;
const HF_README_MAX = 60000;
const MODEL_SORTS = new Set(['likes', 'downloads']);
const PROGRESS_STEP = 1024 * 1024;

let chatInFlight = 0;
let confirmOnClose = false;

interface HfModel {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
  siblings?: { rfilename: string }[];
}

async function createWindow(): Promise<void> {
  const settings = await loadSettings();
  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    fullscreen: settings.fullscreen,
    backgroundColor: THEME_BG[settings.theme] ?? THEME_BG.dark,
    icon: path.join(app.getAppPath(), 'icons', 'icon.ico'),
    title: 'LM SuperApp',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.on('close', (e) => {
    if (!confirmOnClose || chatInFlight === 0) return;
    e.preventDefault();
    void dialog
      .showMessageBox(win, {
        type: 'question',
        buttons: ['Keep waiting', 'Close anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Reply in progress',
        message: 'The model is still generating a reply. Close anyway?'
      })
      .then((r) => {
        if (r.response === 1) win.destroy();
      });
  });

  void win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  if (settings.devtools) win.webContents.openDevTools({ mode: 'detach' });
  win.once('ready-to-show', () => win.show());
}

ipcMain.handle('app:info', () => ({
  appVersion: app.getVersion(),
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
}));

ipcMain.handle('app:changelog', () =>
  readFile(path.join(app.getAppPath(), 'docs', 'CHANGELOG.md'), 'utf8')
);

ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:patch', async (_event, patch: Partial<LmSettings>) => {
  const prev = await loadSettings();
  const next = await patchSettings(patch);
  if (typeof patch?.idleStopMinutes === 'number') setIdleMinutes(next.idleStopMinutes);
  if (typeof patch?.confirmOnClose === 'boolean') confirmOnClose = next.confirmOnClose;
  const launchChanged =
    next.backendPort !== prev.backendPort ||
    next.ctxSize !== prev.ctxSize ||
    next.gpuLayers !== prev.gpuLayers ||
    next.threads !== prev.threads;
  if (launchChanged) {
    setLaunchParams({
      port: next.backendPort,
      ctxSize: next.ctxSize,
      gpuLayers: next.gpuLayers,
      threads: next.threads
    });
    if (getBackendStatus().running) void stopBackend();
  }
  if (
    typeof patch?.modelFile === 'string' &&
    getBackendStatus().running &&
    getBackendStatus().model !== next.modelFile
  ) {
    void stopBackend();
  }
  return next;
});

ipcMain.handle('dialog:pickGguf', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose GGUF models',
    filters: [{ name: 'GGUF model', extensions: ['gguf'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (res.canceled || !res.filePaths.length) return null;
  const settings = await loadSettings();
  const localFiles = [...new Set([...settings.localFiles, ...res.filePaths])];
  await patchSettings({
    localFiles,
    modelFile: settings.modelFile || res.filePaths[0]
  });
  return res.filePaths;
});

ipcMain.handle('window:fullscreen', (event, flag: unknown) => {
  BrowserWindow.fromWebContents(event.sender)?.setFullScreen(flag === true);
});

ipcMain.handle('window:devtools', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: 'detach' });
});

const hfJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hugging Face request failed: ${res.status}`);
  return res.json();
};

ipcMain.handle('models:list', async (_event, search: unknown, sort: unknown) => {
  const params = new URLSearchParams({
    filter: 'text-generation',
    sort: typeof sort === 'string' && MODEL_SORTS.has(sort) ? sort : 'likes',
    direction: '-1',
    limit: HF_LIMIT
  });
  if (typeof search === 'string' && search.trim()) {
    params.set('search', search.trim().slice(0, HF_MAX_SEARCH_LEN));
  }
  const models = (await hfJson(`${HF_API}?${params}`)) as HfModel[];
  return models.map((m) => ({
    id: m.id,
    downloads: m.downloads ?? 0,
    likes: m.likes ?? 0,
    pipeline: m.pipeline_tag ?? '',
    updated: m.lastModified ?? ''
  }));
});

ipcMain.handle('models:detail', async (_event, id: unknown) => {
  if (typeof id !== 'string' || !id.includes('/') || id.includes('..')) {
    throw new Error('Invalid model id');
  }
  const m = (await hfJson(`${HF_API}/${id}`)) as HfModel;

  let readme: string | null = null;
  let readmeTruncated = false;
  const res = await fetch(`https://huggingface.co/${id}/raw/main/README.md`);
  if (res.ok) {
    const raw = await res.text();
    if (raw.length > HF_README_MAX) {
      const cut = raw.lastIndexOf('\n\n', HF_README_MAX);
      readme = raw.slice(0, cut > HF_README_MAX / 2 ? cut : HF_README_MAX).trimEnd();
      readmeTruncated = true;
    } else {
      readme = raw;
    }
  }

  const ggufs = (m.siblings ?? [])
    .map((s) => s.rfilename)
    .filter((f) => f.toLowerCase().endsWith('.gguf'));

  try {
    const sibling = (await hfJson(`${HF_API}/${id}-GGUF`)) as HfModel;
    for (const s of sibling.siblings ?? []) {
      if (s.rfilename.toLowerCase().endsWith('.gguf')) {
        ggufs.push(`${id}-GGUF:${s.rfilename}`);
      }
    }
  } catch {
    // no companion -GGUF repo
  }

  const files = await Promise.all(
    ggufs.slice(0, 40).map(async (name) => {
      const repo = name.startsWith(`${id}-GGUF:`) ? `${id}-GGUF` : id;
      const file = name.startsWith(`${id}-GGUF:`) ? name.slice(id.length + 6) : name;
      try {
        const head = await fetch(
          `https://huggingface.co/${repo}/resolve/main/${file}`,
          { method: 'HEAD' }
        );
        const size = Number(head.headers.get('x-linked-size') ?? head.headers.get('content-length'));
        return { repo, name: file, size: Number.isFinite(size) && size > 0 ? size : null };
      } catch {
        return { repo, name: file, size: null };
      }
    })
  );

  return {
    id: m.id,
    author: m.author ?? id.split('/')[0],
    pipeline: m.pipeline_tag ?? '',
    library: m.library_name ?? '',
    downloads: m.downloads ?? 0,
    likes: m.likes ?? 0,
    updated: m.lastModified ?? '',
    tags: (m.tags ?? []).slice(0, 8),
    readme,
    readmeTruncated,
    files
  };
});

//TODO(downloads): pause/cancel + resume (HF supports Range), sha256 verify, download queue
ipcMain.handle('models:download', async (event, modelId: unknown, repo: unknown, file: unknown) => {
  if (
    typeof modelId !== 'string' ||
    !modelId.includes('/') ||
    modelId.includes('..') ||
    typeof repo !== 'string' ||
    (repo !== modelId && repo !== `${modelId}-GGUF`) ||
    typeof file !== 'string' ||
    file.includes('..') ||
    file.startsWith('/')
  ) {
    throw new Error('Bad download request');
  }

  const base = path.basename(file);
  const settings = await loadSettings();
  const win = BrowserWindow.fromWebContents(event.sender);
  if (settings.confirmDownload && win) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Cancel', 'Download'],
      defaultId: 1,
      cancelId: 0,
      title: 'Download model',
      message: `Download ${base}?`,
      detail: `${repo} → ~/.lmsuperapp/models/${modelId}/`
    });
    if (response !== 1) return { cancelled: true };
  }

  const destDir = path.join(homedir(), '.lmsuperapp', 'models', modelId);
  await mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, base);

  const res = await fetch(`https://huggingface.co/${repo}/resolve/main/${file}`);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  const total = Number(res.headers.get('x-linked-size') ?? res.headers.get('content-length') ?? 0);

  let received = 0;
  let lastSent = 0;
  const counter = new PassThrough();
  counter.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received - lastSent >= PROGRESS_STEP) {
      lastSent = received;
      event.sender.send('models:progress', { file, received, total });
    }
  });

  try {
    await pipeline(
      Readable.fromWeb(res.body as unknown as ReadableStream),
      counter,
      createWriteStream(dest)
    );
  } catch (err) {
    event.sender.send('models:progress', { file, received, total, error: String(err) });
    throw err;
  }
  event.sender.send('models:progress', { file, received, total, done: true, path: dest });
  return { path: dest };
});

ipcMain.handle('app:openExternal', (_e, url: unknown) => {
  if (typeof url !== 'string' || !/^https:\/\/[\w.-]+/.test(url)) {
    throw new Error('Bad URL');
  }
  return shell.openExternal(url);
});

//TODO(library): models:delete IPC to remove downloaded models from disk
ipcMain.handle('models:local', async () => {
  const base = path.join(homedir(), '.lmsuperapp', 'models');
  const out: { name: string; path: string; size: number }[] = [];
  try {
    for (const org of await readdir(base)) {
      const orgDir = path.join(base, org);
      if (!(await stat(orgDir)).isDirectory()) continue;
      for (const name of await readdir(orgDir)) {
        const dir = path.join(orgDir, name);
        if (!(await stat(dir)).isDirectory()) continue;
        for (const file of await readdir(dir)) {
          if (file.toLowerCase().endsWith('.gguf')) {
            const fp = path.join(dir, file);
            out.push({
              name: `${org}/${name} — ${file}`,
              path: fp,
              size: (await stat(fp)).size
            });
          }
        }
      }
    }
  } catch {
    // no models dir yet
  }
  return out;
});

ipcMain.handle('backend:status', () => getBackendStatus());
ipcMain.handle('backend:start', (_event, modelPath: unknown) =>
  startBackend(typeof modelPath === 'string' ? modelPath : '')
);
ipcMain.handle('backend:stop', () => stopBackend());

const cleanSampling = (raw: unknown): SamplingParams => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
  return {
    temperature: num(o.temperature, 0, 2),
    topP: num(o.topP, 0, 1),
    topK: num(o.topK, 0, 500),
    systemPrompt:
      typeof o.systemPrompt === 'string' ? o.systemPrompt.slice(0, 4000) : undefined
  };
};

ipcMain.handle('backend:chat', async (event, messages: unknown, stream: unknown, sampling: unknown) => {
  if (!Array.isArray(messages)) throw new Error('Bad messages');
  const settings = await loadSettings();
  const msgs = cleanMsgs(messages)
    .slice(-settings.contextMessages)
    .map(({ role, content }) => ({ role, content }));
  if (!msgs.length) throw new Error('Empty conversation');
  if (!settings.modelFile) throw new Error('NO_MODEL: pick a model first');
  if (!getBackendStatus().running) startBackend(settings.modelFile);
  await waitReady();
  const sender = event.sender;
  const onChunk =
    stream === true
      ? (chunk: ChatChunk): void => {
          if (!sender.isDestroyed()) sender.send('chat:chunk', chunk);
        }
      : undefined;
  chatInFlight += 1;
  try {
    const t0 = Date.now();
    const { content, thinking, tokens, stopped } = await chatCompletion(
      msgs,
      onChunk,
      cleanSampling(sampling)
    );
    const secs = (Date.now() - t0) / 1000;
    const approx = tokens === undefined;
    const n = tokens ?? Math.max(1, Math.round(content.length / 4));
    const tokPerSec = secs > 0.05 ? Math.round((n / secs) * 10) / 10 : undefined;
    return { content, thinking, tokPerSec, approx, stopped };
  } finally {
    chatInFlight -= 1;
  }
});

ipcMain.handle('backend:chatStop', () => abortChat());

const CHATS_DIR = (): string => path.join(homedir(), '.lmsuperapp', 'chats');

interface StoredMessage extends ChatMessage {
  versions?: string[];
  thinking?: (string | null)[];
  vi?: number;
  ts?: number;
  stats?: { tps?: number; approx?: boolean }[];
}

const cleanMsgs = (messages: unknown): StoredMessage[] =>
  Array.isArray(messages)
    ? messages
        .filter(
          (m): m is StoredMessage =>
            !!m && typeof m.role === 'string' && typeof m.content === 'string'
        )
        .map((m) => ({
          role: m.role,
          content: m.content,
          ...(Array.isArray(m.versions)
            ? {
                versions: m.versions
                  .filter((v): v is string => typeof v === 'string')
                  .slice(0, 10)
              }
            : {}),
          ...(Array.isArray(m.thinking)
            ? {
                thinking: m.thinking
                  .map((t) => (typeof t === 'string' ? t : null))
                  .slice(0, 10)
              }
            : {}),
          ...(typeof m.vi === 'number' ? { vi: m.vi } : {}),
          ...(typeof m.ts === 'number' ? { ts: m.ts } : {}),
          ...(Array.isArray(m.stats)
            ? {
                stats: m.stats
                  .filter((s): s is { tps?: number; approx?: boolean } => !!s)
                  .map((s) => ({
                    ...(typeof s.tps === 'number' ? { tps: s.tps } : {}),
                    ...(s.approx === true ? { approx: true } : {})
                  }))
                  .slice(0, 10)
              }
            : {})
        }))
        .slice(-100)
    : [];

ipcMain.handle('chats:list', async () => {
  try {
    const files = (await readdir(CHATS_DIR())).filter((f) => f.endsWith('.json'));
    const items = await Promise.all(
      files.map(async (f) => {
        try {
          const data = JSON.parse(
            await readFile(path.join(CHATS_DIR(), f), 'utf8')
          ) as { title?: string; updated?: number };
          return {
            id: f.replace(/\.json$/, ''),
            title: data.title ?? 'Chat',
            updated: data.updated ?? 0
          };
        } catch {
          return null;
        }
      })
    );
    return items
      .filter((i): i is { id: string; title: string; updated: number } => i !== null)
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 20);
  } catch {
    return [];
  }
});

ipcMain.handle(
  'chats:save',
  async (_e, id: unknown, title: unknown, messages: unknown, sampling: unknown) => {
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Bad chat id');
    await mkdir(CHATS_DIR(), { recursive: true });
    const payload = {
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : 'Chat',
      updated: Date.now(),
      messages: cleanMsgs(messages),
      sampling: cleanSampling(sampling)
    };
    await writeFile(path.join(CHATS_DIR(), `${id}.json`), JSON.stringify(payload));
    return payload;
  }
);

ipcMain.handle('chats:rename', async (_e, id: unknown, title: unknown) => {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Bad chat id');
  const file = path.join(CHATS_DIR(), `${id}.json`);
  const data = JSON.parse(await readFile(file, 'utf8')) as { title?: string };
  data.title = typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : 'Chat';
  await writeFile(file, JSON.stringify(data));
  return { id, title: data.title };
});

ipcMain.handle('chats:delete', async (_e, id: unknown) => {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Bad chat id');
  await rm(path.join(CHATS_DIR(), `${id}.json`), { force: true });
});

ipcMain.handle('chats:load', async (_e, id: unknown) => {
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Bad chat id');
  return JSON.parse(await readFile(path.join(CHATS_DIR(), `${id}.json`), 'utf8')) as {
    title: string;
    updated: number;
    messages: ChatMessage[];
  };
});

const execFileAsync = promisify(execFile);

const BUILD_ASSET: Record<string, RegExp> = {
  cpu: /bin-win-cpu-x64\.zip$/i,
  vulkan: /bin-win-vulkan-x64\.zip$/i,
  'cuda-12.4': /bin-win-cuda-12\.4-x64\.zip$/i,
  'cuda-13.4': /bin-win-cuda-13\.4-x64\.zip$/i
};

interface LlamaRelease {
  tag_name?: string;
  assets?: { name: string; browser_download_url: string }[];
}

// newest release that ships a Windows build for the chosen backend build
const findLlamaRelease = async (
  build: string
): Promise<{ tag: string; asset: { name: string; browser_download_url: string } }> => {
  const releases = (await (
    await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10', {
      headers: { 'User-Agent': 'lmsuperapp' }
    })
  ).json()) as LlamaRelease[];
  const re = BUILD_ASSET[build] ?? BUILD_ASSET.vulkan;
  for (const rel of releases) {
    const found = (rel.assets ?? []).find((a) => re.test(a.name));
    if (found) return { tag: rel.tag_name ?? '', asset: found };
  }
  throw new Error(`No ${build} build found in recent llama.cpp releases`);
};

ipcMain.handle('backend:latest', async () => {
  const settings = await loadSettings();
  return { tag: (await findLlamaRelease(settings.backendBuild)).tag };
});

ipcMain.handle('backend:install', async (event) => {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(
      'Auto-install supports Windows x64 only — place llama-server in ~/.lmsuperapp/bin manually'
    );
  }
  const send = (stage: string, received = 0, total = 0): void => {
    event.sender.send('backend:progress', { stage, received, total });
  };

  send('fetch');
  const settings = await loadSettings();
  const { tag, asset } = await findLlamaRelease(settings.backendBuild);

  const binDir = path.join(homedir(), '.lmsuperapp', 'bin');
  await mkdir(binDir, { recursive: true });
  const zipPath = path.join(binDir, 'llamacpp.zip');

  const res = await fetch(asset.browser_download_url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  let lastSent = 0;
  const counter = new PassThrough();
  counter.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received - lastSent >= PROGRESS_STEP) {
      lastSent = received;
      send('download', received, total);
    }
  });
  await pipeline(
    Readable.fromWeb(res.body as unknown as ReadableStream),
    counter,
    createWriteStream(zipPath)
  );

  send('extract');
  await execFileAsync('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${binDir}' -Force`
  ]);
  await rm(zipPath, { force: true });
  const status = getBackendStatus();
  send('done');
  if (!status.binary) throw new Error('Extracted, but llama-server was not found');
  return { path: status.binary, tag };
});

void app.whenReady().then(async () => {
  app.setName('LM SuperApp');
  app.setAppUserModelId('com.lmsuperapp.app');
  await ensureStorage();
  const boot = await loadSettings();
  setIdleMinutes(boot.idleStopMinutes);
  setLaunchParams({
    port: boot.backendPort,
    ctxSize: boot.ctxSize,
    gpuLayers: boot.gpuLayers,
    threads: boot.threads
  });
  confirmOnClose = boot.confirmOnClose;
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// give llama-server a chance to shut down cleanly before the process exits
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !getBackendStatus().running) return;
  quitting = true;
  e.preventDefault();
  void stopBackend().finally(() => app.quit());
});
