import {
  backendLatest,
  exportSettings,
  getAppInfo,
  getBackendStatus,
  getChangelog,
  getSettings,
  importSettings,
  installBackend,
  onBackendProgress,
  openDevTools,
  patchSettings,
  setFullscreen,
  startBackend,
  stopBackend
} from '../api';
import { getDebugEntries, reportDebug, setDebugEnabled } from '../core/debug';
import { byId, escapeHtml } from '../core/dom';
import { fileName } from '../core/format';
import { icon } from '../core/icons';
import { renderMarkdown } from '../core/markdown';
import { onTabOpen } from '../core/tabs';
import { applyFontScale, applyTheme } from '../core/theme';

const IDLE_OPTIONS = [0, 5, 10, 15];

const BACKEND_BUILDS: { id: LmBackendBuild; label: string; hint: string }[] = [
  { id: 'vulkan', label: 'Vulkan', hint: 'GPU — works on most cards' },
  { id: 'cuda-13.4', label: 'CUDA 13.4', hint: 'NVIDIA GPU, newer driver' },
  { id: 'cuda-12.4', label: 'CUDA 12.4', hint: 'NVIDIA GPU, older driver' },
  { id: 'cpu', label: 'CPU only', hint: 'No GPU acceleration' }
];

const TEXT_SIZES: { value: number; label: string; hint: string }[] = [
  { value: 0.85, label: 'Compact', hint: 'Denser UI' },
  { value: 1, label: 'Default', hint: 'Standard size' },
  { value: 1.15, label: 'Large', hint: 'Easier to read' },
  { value: 1.3, label: 'XL', hint: 'Biggest text' }
];

const THEMES: { id: LmTheme; label: string; hint: string }[] = [
  { id: 'dark', label: 'Dark', hint: 'Warm grey, low light' },
  { id: 'light', label: 'Light', hint: 'Warm paper, daytime' },
  { id: 'midnight', label: 'Midnight', hint: 'Cool near-black' },
  { id: 'sand', label: 'Sand', hint: 'Warm cream' },
  { id: 'forest', label: 'Forest', hint: 'Dark green tint' }
];

const initMenu = (): void => {
  const items = document.querySelectorAll<HTMLButtonElement>('.settings-item[data-settings]');
  const pages = document.querySelectorAll<HTMLElement>('.settings-page');
  items.forEach((item) => {
    item.addEventListener('click', () => {
      items.forEach((n) => n.classList.toggle('is-active', n === item));
      pages.forEach((p) =>
        p.classList.toggle('is-visible', p.id === `settings-${item.dataset.settings}`)
      );
    });
  });
};

const initGeneral = (): void => {
  getAppInfo()
    .then((info) => {
      byId('set-version').textContent = info.appVersion;
      byId('set-electron').textContent = info.versions.electron ?? '—';
      byId('set-chrome').textContent = info.versions.chrome ?? '—';
      byId('set-platform').textContent = info.platform;
    })
    .catch((err: unknown) => console.error('Failed to load app info:', err));

  const fsBox = byId('opt-fullscreen') as HTMLInputElement;
  const confirmBox = byId('opt-confirm-dl') as HTMLInputElement;
  const streamBox = byId('opt-stream') as HTMLInputElement;
  const thinkBox = byId('opt-thinking') as HTMLInputElement;
  const notifyBox = byId('opt-notify') as HTMLInputElement;
  const contextBox = byId('opt-context') as HTMLInputElement;
  const confirmCloseBox = byId('opt-confirm-close') as HTMLInputElement;
  getSettings()
    .then((s) => {
      fsBox.checked = s.fullscreen;
      confirmBox.checked = s.confirmDownload;
      streamBox.checked = s.streamReplies;
      thinkBox.checked = s.showThinking;
      notifyBox.checked = s.notifyOnReply;
      contextBox.value = String(s.contextMessages);
      confirmCloseBox.checked = s.confirmOnClose;
      document.querySelectorAll<HTMLInputElement>('input[name="defsort"]').forEach((r) => {
        r.checked = r.value === s.defaultModelSort;
      });
    })
    .catch((err: unknown) => console.error('Failed to load settings:', err));

  const patchBool = (box: HTMLInputElement, key: keyof LmSettings): void => {
    box.addEventListener('change', () => {
      patchSettings({ [key]: box.checked }).catch((err: unknown) =>
        console.error(`Failed to save ${key}:`, err)
      );
    });
  };
  patchBool(streamBox, 'streamReplies');
  patchBool(thinkBox, 'showThinking');
  patchBool(notifyBox, 'notifyOnReply');
  patchBool(confirmCloseBox, 'confirmOnClose');

  contextBox.addEventListener('change', () => {
    const n = Math.round(Number(contextBox.value));
    if (!Number.isInteger(n) || n < 1 || n > 100) return;
    contextBox.value = String(n);
    patchSettings({ contextMessages: n }).catch((err: unknown) =>
      console.error('Failed to save context size:', err)
    );
  });

  document.querySelectorAll<HTMLInputElement>('input[name="defsort"]').forEach((r) => {
    r.addEventListener('change', () => {
      patchSettings({ defaultModelSort: r.value as LmModelSort }).catch((err: unknown) =>
        console.error('Failed to save default sort:', err)
      );
    });
  });

  confirmBox.addEventListener('change', () => {
    patchSettings({ confirmDownload: confirmBox.checked }).catch((err: unknown) =>
      console.error('Failed to save confirm-download:', err)
    );
  });

  fsBox.addEventListener('change', () => {
    const on = fsBox.checked;
    patchSettings({ fullscreen: on }).catch((err: unknown) =>
      console.error('Failed to save fullscreen:', err)
    );
    setFullscreen(on).catch((err: unknown) =>
      console.error('Failed to set fullscreen:', err)
    );
  });

  const ioNote = byId('set-io-note');
  byId('btn-set-export').addEventListener('click', () => {
    exportSettings()
      .then((res) => {
        if (res) ioNote.textContent = `Exported to ${res.path}`;
      })
      .catch((err: unknown) => {
        ioNote.textContent = err instanceof Error ? err.message : String(err);
        reportDebug('settings.export', err);
      });
  });
  byId('btn-set-import').addEventListener('click', () => {
    importSettings()
      .then((s) => {
        if (!s) return;
        applyTheme(s.theme);
        applyFontScale(s.fontScale);
        setDebugEnabled(s.debug);
        mountSettings(byId('tab-settings'));
      })
      .catch((err: unknown) => {
        ioNote.textContent = err instanceof Error ? err.message : String(err);
        reportDebug('settings.import', err);
      });
  });
};

let latestBackendTag: string | null = null;
let backendInstalling = false;
let backendProgressOff: (() => void) | null = null;

const refreshBackendStatus = (): void => {
  getBackendStatus()
    .then((s) => {
      byId('be-binary').textContent = s.binary ?? 'not found';
      byId('be-version').textContent = s.version ?? '—';
      byId('be-latest').textContent = latestBackendTag ?? '—';
      byId('be-running').textContent = s.running ? (s.ready ? 'yes (ready)' : 'starting…') : 'no';
      byId('be-model').textContent = s.model ? fileName(s.model) : '—';
      byId('be-port').textContent = String(s.port);
      byId('be-error').textContent = s.lastError ?? '';

      const installBtn = byId('btn-be-install') as HTMLButtonElement;
      const update = Boolean(
        s.binary && s.version && latestBackendTag && s.version !== latestBackendTag
      );
      installBtn.textContent = !s.binary
        ? 'Install llama.cpp'
        : update
          ? `Update to ${latestBackendTag}`
          : 'Reinstall llama.cpp';
      if (!backendInstalling) {
        const note = byId('be-install-note');
        note.textContent = !s.binary
          ? 'llama.cpp is required to run models locally.'
          : update
            ? 'Update available'
            : s.version && latestBackendTag
              ? 'Up to date'
              : 'Installed';
      }
    })
    .catch((err: unknown) => console.error('Failed to load backend status:', err));
};

const initBackend = (): void => {
  const installBtn = byId('btn-be-install') as HTMLButtonElement;
  const installNote = byId('be-install-note');

  byId('btn-be-start').addEventListener('click', () => {
    getSettings()
      .then((s) => startBackend(s.modelFile))
      .then(() => refreshBackendStatus())
      .catch((err: unknown) => {
        reportDebug('backend.start', err);
        refreshBackendStatus();
      });
  });
  byId('btn-be-stop').addEventListener('click', () => {
    stopBackend()
      .then(() => refreshBackendStatus())
      .catch((err: unknown) => console.error('Failed to stop backend:', err));
  });

  installBtn.addEventListener('click', () => {
    installBtn.disabled = true;
    backendInstalling = true;
    installNote.textContent = 'Fetching latest llama.cpp release…';
    installBackend()
      .then((res) => {
        latestBackendTag = res.tag ?? latestBackendTag;
        installNote.textContent = `Installed: ${res.path}`;
      })
      .catch((err: unknown) => {
        installNote.textContent = err instanceof Error ? err.message : String(err);
        reportDebug('backend.install', err);
      })
      .finally(() => {
        installBtn.disabled = false;
        backendInstalling = false;
        refreshBackendStatus();
      });
  });

  backendProgressOff?.();
  backendProgressOff = onBackendProgress((p) => {
    if (p.stage === 'download' && p.total > 0) {
      installNote.textContent = `Downloading… ${Math.round((p.received / p.total) * 100)}%`;
    } else if (p.stage === 'extract') {
      installNote.textContent = 'Extracting…';
    }
  });

  document.querySelectorAll<HTMLInputElement>('input[name="idletime"]').forEach((r) => {
    r.addEventListener('change', () => {
      patchSettings({ idleStopMinutes: Number(r.value) }).catch((err: unknown) =>
        console.error('Failed to save idle setting:', err)
      );
    });
  });

  document.querySelectorAll<HTMLInputElement>('input[name="bebuild"]').forEach((r) => {
    r.addEventListener('change', () => {
      patchSettings({ backendBuild: r.value as LmBackendBuild }).catch((err: unknown) =>
        console.error('Failed to save backend build:', err)
      );
    });
  });

  const patchInt = (
    box: HTMLInputElement,
    key: 'backendPort' | 'ctxSize' | 'gpuLayers' | 'threads',
    min: number,
    max: number
  ): void => {
    box.addEventListener('change', () => {
      const n = Math.round(Number(box.value));
      if (!Number.isInteger(n) || n < min || n > max) return;
      box.value = String(n);
      patchSettings({ [key]: n })
        .then(() => refreshBackendStatus())
        .catch((err: unknown) => console.error(`Failed to save ${key}:`, err));
    });
  };
  patchInt(byId('opt-port') as HTMLInputElement, 'backendPort', 1024, 65535);
  patchInt(byId('opt-ctx') as HTMLInputElement, 'ctxSize', 256, 262144);
  patchInt(byId('opt-ngl') as HTMLInputElement, 'gpuLayers', -1, 999);
  patchInt(byId('opt-threads') as HTMLInputElement, 'threads', 0, 256);

  getSettings()
    .then((s) => {
      document.querySelectorAll<HTMLInputElement>('input[name="idletime"]').forEach((r) => {
        r.checked = Number(r.value) === s.idleStopMinutes;
      });
      document.querySelectorAll<HTMLInputElement>('input[name="bebuild"]').forEach((r) => {
        r.checked = r.value === s.backendBuild;
      });
      (byId('opt-port') as HTMLInputElement).value = String(s.backendPort);
      (byId('opt-ctx') as HTMLInputElement).value = String(s.ctxSize);
      (byId('opt-ngl') as HTMLInputElement).value = String(s.gpuLayers);
      (byId('opt-threads') as HTMLInputElement).value = String(s.threads);
    })
    .catch((err: unknown) => console.error('Failed to load settings:', err));

  backendLatest()
    .then((r) => {
      latestBackendTag = r.tag || null;
      refreshBackendStatus();
    })
    .catch((err: unknown) => {
      byId('be-latest').textContent = 'check failed';
      reportDebug('backend.latest', err);
    });

  refreshBackendStatus();
};

// remounting the settings view (e.g. after settings import) must not stack
// document listeners pointing at detached elements
let debugListener: (() => void) | null = null;

const initDebug = (): void => {
  const dbg = byId('opt-debug') as HTMLInputElement;
  const dt = byId('opt-devtools') as HTMLInputElement;
  const openBtn = byId('btn-devtools') as HTMLButtonElement;
  const listEl = byId('debug-list');

  getSettings()
    .then((s) => {
      dbg.checked = s.debug;
      dt.checked = s.devtools;
    })
    .catch((err: unknown) => console.error('Failed to load settings:', err));

  dbg.addEventListener('change', () => {
    setDebugEnabled(dbg.checked);
    patchSettings({ debug: dbg.checked }).catch((err: unknown) =>
      console.error('Failed to save debug:', err)
    );
  });

  dt.addEventListener('change', () => {
    patchSettings({ devtools: dt.checked }).catch((err: unknown) =>
      console.error('Failed to save devtools:', err)
    );
  });

  openBtn.addEventListener('click', () => {
    openDevTools().catch((err: unknown) => console.error('Failed to open DevTools:', err));
  });

  const renderEntries = (): void => {
    const items = getDebugEntries();
    listEl.innerHTML = items.length
      ? items
          .map(
            (e) => `
        <div class="debug-entry">
          <div class="debug-entry-head">
            <span class="debug-label">${escapeHtml(e.label)}</span>
            <span class="debug-time">${e.time}</span>
          </div>
          <div class="debug-detail">${escapeHtml(e.detail)}</div>
        </div>`
          )
          .join('')
      : '<p class="debug-none">No errors captured yet.</p>';
  };

  if (debugListener) document.removeEventListener('lmsuperapp:debug', debugListener);
  debugListener = renderEntries;
  document.addEventListener('lmsuperapp:debug', debugListener);
  renderEntries();
};

let changelogLoaded = false;
const loadChangelog = (): void => {
  if (changelogLoaded) return;
  getChangelog()
    .then((md) => {
      byId('changelog-body').innerHTML = renderMarkdown(md);
      changelogLoaded = true;
    })
    .catch((err: unknown) => {
      console.error('Failed to load changelog:', err);
      byId('changelog-body').textContent = 'Could not load changelog.';
    });
};

export const mountSettings = (root: HTMLElement): void => {
  root.innerHTML = `
    <div class="settings">
      <nav class="settings-menu" aria-label="Settings">
        <p class="settings-heading">Settings</p>
        <button class="settings-item is-active" data-settings="general" type="button">
          ${icon('desktop')} <span class="nav-text">General</span>
        </button>
        <button class="settings-item" data-settings="theme" type="button">
          ${icon('theme')} <span class="nav-text">Theme</span>
        </button>
        <button class="settings-item" data-settings="backend" type="button">
          ${icon('backend')} <span class="nav-text">Backend</span>
        </button>
        <button class="settings-item" data-settings="changelog" type="button">
          ${icon('changelog')} <span class="nav-text">Changelog</span>
        </button>
        <button class="settings-item" data-settings="debug" type="button">
          ${icon('bug')} <span class="nav-text">Debug</span>
        </button>
      </nav>

      <div class="settings-pane">
        <div class="settings-page is-visible" id="settings-general">
          <h2 class="page-title">General</h2>

          <div class="section-group">
            <h3 class="section-title">Window</h3>
            <label class="setting-row">
              <input type="checkbox" id="opt-fullscreen" />
              <span>Fullscreen</span>
              <small>Applies now and on launch</small>
            </label>
          </div>

          <div class="section-group">
            <h3 class="section-title">Chat</h3>
            <label class="setting-row">
              <input type="checkbox" id="opt-stream" />
              <span>Stream replies</span>
              <small>Tokens appear live as the model writes</small>
            </label>
            <label class="setting-row">
              <input type="checkbox" id="opt-thinking" />
              <span>Show model thinking</span>
              <small>Collapsible block with the model's reasoning</small>
            </label>
            <label class="setting-row">
              <input type="checkbox" id="opt-notify" />
              <span>Notify on reply</span>
              <small>Desktop notification when a reply finishes while unfocused</small>
            </label>
            <label class="setting-row">
              <input type="number" id="opt-context" min="1" max="100" step="1" />
              <span>Messages in context</span>
              <small>Past messages sent to the model (1–100)</small>
            </label>
            <label class="setting-row">
              <input type="checkbox" id="opt-confirm-close" />
              <span>Confirm on close</span>
              <small>Ask before closing while a reply is generating</small>
            </label>
          </div>

          <div class="section-group">
            <h3 class="section-title">Models</h3>
            <p class="settings-note">Default sort on the Models page</p>
            <label class="setting-row">
              <input type="radio" name="defsort" value="likes" />
              <span>Most liked</span>
            </label>
            <label class="setting-row">
              <input type="radio" name="defsort" value="downloads" />
              <span>Most downloaded</span>
            </label>
          </div>

          <div class="section-group">
            <h3 class="section-title">Downloads</h3>
            <label class="setting-row">
              <input type="checkbox" id="opt-confirm-dl" checked />
              <span>Ask before downloading</span>
              <small>Confirm dialog before saving a file</small>
            </label>
          </div>

          <div class="section-group">
            <h3 class="section-title">Settings file</h3>
            <div class="be-btns">
              <button class="action-btn" id="btn-set-export" type="button">Export…</button>
              <button class="action-btn" id="btn-set-import" type="button">Import…</button>
            </div>
            <p class="settings-note" id="set-io-note">Saved to ~/.lmsuperapp/settings.json</p>
          </div>

          <div class="section-group">
            <h3 class="section-title">About</h3>
            <dl class="about-list">
              <div class="about-row"><dt>Version</dt><dd id="set-version">—</dd></div>
              <div class="about-row"><dt>Electron</dt><dd id="set-electron">—</dd></div>
              <div class="about-row"><dt>Chromium</dt><dd id="set-chrome">—</dd></div>
              <div class="about-row"><dt>Platform</dt><dd id="set-platform">—</dd></div>
            </dl>
          </div>
        </div>

        <div class="settings-page" id="settings-theme">
          <h2 class="page-title">Theme</h2>
          <div class="section-group">
            <div class="theme-options" role="radiogroup" aria-label="Theme">
              ${THEMES.map(
                (t) => `
              <label class="theme-option">
                <input type="radio" name="theme" value="${t.id}" />
                <span>${t.label}</span>
                <small>${t.hint}</small>
              </label>`
              ).join('')}
            </div>
          </div>

          <div class="section-group">
            <h3 class="section-title">Text size</h3>
            <div class="theme-options" role="radiogroup" aria-label="Text size">
              ${TEXT_SIZES.map(
                (s) => `
              <label class="theme-option">
                <input type="radio" name="textsize" value="${s.value}" />
                <span>${s.label}</span>
                <small>${s.hint}</small>
              </label>`
              ).join('')}
            </div>
          </div>

          <p class="settings-note">Saved to ~/.lmsuperapp/settings.json</p>
        </div>

        <div class="settings-page" id="settings-backend">
          <h2 class="page-title">Backend</h2>

          <div class="section-group">
            <h3 class="section-title">llama.cpp</h3>
            <dl class="about-list">
              <div class="about-row"><dt>Binary</dt><dd id="be-binary">—</dd></div>
              <div class="about-row"><dt>Version</dt><dd id="be-version">—</dd></div>
              <div class="about-row"><dt>Latest</dt><dd id="be-latest">—</dd></div>
              <div class="about-row"><dt>Running</dt><dd id="be-running">—</dd></div>
              <div class="about-row"><dt>Model</dt><dd id="be-model">—</dd></div>
              <div class="about-row"><dt>Port</dt><dd id="be-port">—</dd></div>
            </dl>
            <p class="debug-none" id="be-error"></p>
            <div class="be-btns">
              <button class="action-btn" id="btn-be-install" type="button">Install llama.cpp</button>
              <button class="action-btn" id="btn-be-start" type="button">Start backend</button>
              <button class="action-btn" id="btn-be-stop" type="button">Stop</button>
            </div>
            <p class="settings-note" id="be-install-note"></p>
          </div>

          <div class="section-group">
            <h3 class="section-title">Engine</h3>
            <dl class="about-list">
              <div class="about-row"><dt>Engine</dt><dd>llama.cpp</dd></div>
            </dl>
            <p class="settings-note">More engines may come later.</p>
          </div>

          <div class="section-group">
            <h3 class="section-title">Launch parameters</h3>
            <label class="setting-row">
              <input type="number" id="opt-port" min="1024" max="65535" step="1" />
              <span>Port</span>
              <small>llama-server listens on 127.0.0.1</small>
            </label>
            <label class="setting-row">
              <input type="number" id="opt-ctx" min="256" max="262144" step="256" />
              <span>Context size</span>
              <small>--ctx-size, in tokens</small>
            </label>
            <label class="setting-row">
              <input type="number" id="opt-ngl" min="-1" max="999" step="1" />
              <span>GPU layers</span>
              <small>--n-gpu-layers, -1 = auto</small>
            </label>
            <label class="setting-row">
              <input type="number" id="opt-threads" min="0" max="256" step="1" />
              <span>Threads</span>
              <small>--threads, 0 = auto</small>
            </label>
            <p class="settings-note">Applied on (re)start — changing these stops a running backend.</p>
          </div>

          <div class="section-group">
            <h3 class="section-title">Build</h3>
            <div class="theme-options" role="radiogroup" aria-label="Backend build">
              ${BACKEND_BUILDS.map(
                (b) => `
              <label class="theme-option">
                <input type="radio" name="bebuild" value="${b.id}" />
                <span>${b.label}</span>
                <small>${b.hint}</small>
              </label>`
              ).join('')}
            </div>
            <p class="settings-note">Which llama.cpp build Install downloads.</p>
          </div>

          <div class="section-group">
            <h3 class="section-title">Idle shutdown</h3>
            <div class="theme-options" role="radiogroup" aria-label="Idle shutdown">
              ${IDLE_OPTIONS.map(
                (m) => `
              <label class="theme-option">
                <input type="radio" name="idletime" value="${m}" />
                <span>${m === 0 ? 'Never' : `${m} min`}</span>
                <small>${m === 0 ? 'Keep running' : 'Stop if unused'}</small>
              </label>`
              ).join('')}
            </div>
          </div>
        </div>

        <div class="settings-page" id="settings-changelog">
          <h2 class="page-title">Changelog</h2>
          <div class="changelog" id="changelog-body"></div>
        </div>

        <div class="settings-page" id="settings-debug">
          <h2 class="page-title">Debug</h2>

          <div class="section-group">
            <h3 class="section-title">Debug output</h3>
            <label class="setting-row">
              <input type="checkbox" id="opt-debug" />
              <span>Enable debug output</span>
              <small>Error codes and details in the UI</small>
            </label>
          </div>

          <div class="section-group">
            <h3 class="section-title">DevTools</h3>
            <label class="setting-row">
              <input type="checkbox" id="opt-devtools" />
              <span>Open DevTools on launch</span>
              <small>Detached window</small>
            </label>
            <button class="action-btn" id="btn-devtools" type="button">Open DevTools now</button>
          </div>

          <div class="section-group">
            <h3 class="section-title">Recent errors</h3>
            <div class="debug-list" id="debug-list"></div>
          </div>
        </div>
      </div>
    </div>`;

  initMenu();
  initGeneral();
  initDebug();
  initBackend();
  onTabOpen('settings', loadChangelog);
};
