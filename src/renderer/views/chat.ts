import {
  chatSend,
  chatStop,
  chatsLoad,
  chatsSave,
  getSettings,
  localModels,
  onChatChunk,
  openExternal,
  patchSettings
} from '../api';
import {
  refreshSideChats,
  setActiveSideChat,
  setChatOpener,
  setChatRenameHandler,
  setNewChatHandler
} from '../core/chats';
import { isDebugEnabled, reportDebug } from '../core/debug';
import { byId, escapeHtml } from '../core/dom';
import { fileName } from '../core/format';
import { icon } from '../core/icons';
import { initMdClicks, renderMarkdown, renderMath } from '../core/markdown';
import { mountSelect } from '../core/select';
import { onTabOpen } from '../core/tabs';

const ICON_SEND = icon('send');
const ICON_STOP = icon('stop');
const ICON_COPY = icon('copy');
const ICON_RETRY = icon('retry');
const ICON_EDIT = icon('edit');
const ICON_CHECK = icon('check');
const ICON_TUNE = icon('tune');

const DEFAULT_SAMPLING: LmSampling = {
  temperature: 0.8,
  topP: 0.95,
  topK: 40,
  systemPrompt: ''
};

interface MsgStat {
  tps?: number;
  approx?: boolean;
}

interface UIMsg {
  role: 'user' | 'assistant';
  versions: string[];
  thinking?: (string | null)[];
  vi: number;
  ts?: number;
  stats?: MsgStat[];
}

const newChatId = (): string => `c${Date.now().toString(36)}`;

const toUIMsg = (m: LmStoredMessage): UIMsg => {
  const versions =
    Array.isArray(m.versions) && m.versions.length ? m.versions : [m.content];
  return {
    role: m.role === 'user' ? 'user' : 'assistant',
    versions,
    thinking: m.thinking,
    vi: Math.min(Math.max(m.vi ?? versions.length - 1, 0), versions.length - 1),
    ts: m.ts,
    stats: m.stats
  };
};

const toFlat = (m: UIMsg): LmChatMessage => ({
  role: m.role,
  content: m.versions[m.vi]
});

const toStored = (m: UIMsg): LmStoredMessage => ({
  role: m.role,
  content: m.versions[m.vi],
  versions: m.versions,
  thinking: m.thinking,
  vi: m.vi,
  ts: m.ts,
  stats: m.stats
});

const chatTitle = (messages: UIMsg[]): string => {
  const first = messages.find((m) => m.role === 'user');
  return first ? first.versions[first.vi].slice(0, 60) : 'Chat';
};

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${time}`;
};

export const mountChat = (root: HTMLElement): void => {
  root.innerHTML = `
    <div class="chat">
      <div class="chat-main">
        <div class="chat-top">
          <div id="chat-model-sel"></div>
          <button class="icon-btn" id="chat-params" type="button" aria-label="Chat settings" title="Chat settings">${ICON_TUNE}</button>
        </div>
        <div class="chat-scroll" id="chat-scroll">
          <p class="chat-empty" id="chat-empty">Pick a model above, then send a message.</p>
        </div>
        <form class="chat-bar" id="chat-form">
          <input
            id="chat-input"
            class="chat-input"
            type="text"
            placeholder="Message…"
            autocomplete="off"
          />
          <button class="chat-send" type="submit" aria-label="Send">${ICON_SEND}</button>
        </form>
      </div>
      <aside class="chat-side" id="chat-side" hidden>
        <h3 class="chat-side-title">This chat</h3>
        <label class="chat-side-row">
          <span>Temperature</span>
          <input type="number" id="cs-temp" min="0" max="2" step="0.05" />
          <small>0–2, higher is wilder</small>
        </label>
        <label class="chat-side-row">
          <span>Top-p</span>
          <input type="number" id="cs-topp" min="0" max="1" step="0.01" />
          <small>Nucleus sampling (0–1)</small>
        </label>
        <label class="chat-side-row">
          <span>Top-k</span>
          <input type="number" id="cs-topk" min="0" max="500" step="1" />
          <small>Candidate pool, 0 disables</small>
        </label>
        <label class="chat-side-row">
          <span>System prompt</span>
          <textarea id="cs-sys" rows="5" placeholder="Optional system prompt…"></textarea>
        </label>
        <p class="chat-side-note">Saved with this conversation.</p>
      </aside>
    </div>`;

  //TODO(chat): Ctrl+Up edit-last-message shortcut

  const scroll = byId('chat-scroll');
  let empty = byId('chat-empty');
  const form = byId('chat-form') as HTMLFormElement;
  const input = byId('chat-input') as HTMLInputElement;
  const sendBtn = form.querySelector<HTMLButtonElement>('.chat-send')!;
  const modelSel = mountSelect(byId('chat-model-sel'), 'Pick a model…');
  initMdClicks(scroll, (url) =>
    void openExternal(url).catch((err: unknown) => reportDebug('chat.link', err))
  );

  let history: UIMsg[] = [];
  let chatId = newChatId();
  let pending = false;
  let chatCfg = { streamReplies: true, notifyOnReply: false, showThinking: true };
  let sampling: LmSampling = { ...DEFAULT_SAMPLING };
  let chatTitleOverride: string | null = null;

  const side = byId('chat-side');
  const paramsBtn = byId('chat-params');
  const tempIn = byId('cs-temp') as HTMLInputElement;
  const topPIn = byId('cs-topp') as HTMLInputElement;
  const topKIn = byId('cs-topk') as HTMLInputElement;
  const sysIn = byId('cs-sys') as HTMLTextAreaElement;

  paramsBtn.addEventListener('click', () => {
    side.hidden = !side.hidden;
    paramsBtn.classList.toggle('is-active', !side.hidden);
  });

  const fillPanel = (): void => {
    tempIn.value = String(sampling.temperature);
    topPIn.value = String(sampling.topP);
    topKIn.value = String(sampling.topK);
    sysIn.value = sampling.systemPrompt;
  };

  const setBusy = (on: boolean): void => {
    pending = on;
    sendBtn.classList.toggle('is-busy', on);
    sendBtn.innerHTML = on ? ICON_STOP : ICON_SEND;
    sendBtn.setAttribute('aria-label', on ? 'Stop generating' : 'Send');
    input.disabled = on;
  };

  // streamed tokens land in liveBody while a reply is generating
  let liveBody: HTMLElement | null = null;
  let liveText = '';
  let liveThink = '';
  let liveQueued = false;

  const thinkBlock = (text: string, open: boolean): string =>
    text && chatCfg.showThinking
      ? `<details class="msg-think"${open ? ' open' : ''}><summary>${
          open ? 'Thinking…' : 'Thought process'
        }</summary><div class="msg-think-text">${escapeHtml(text)}</div></details>`
      : '';

  const liveHtml = (): string =>
    thinkBlock(liveThink, true) + (liveText ? renderMarkdown(liveText) : '');

  onChatChunk((chunk) => {
    if (!liveBody) return;
    if (chunk.kind === 'thinking') liveThink += chunk.text;
    else liveText += chunk.text;
    if (liveQueued) return;
    liveQueued = true;
    requestAnimationFrame(() => {
      liveQueued = false;
      if (!liveBody) return;
      liveBody.innerHTML = liveHtml();
      scroll.scrollTop = scroll.scrollHeight;
    });
  });

  const notifyReply = (content: string): void => {
    if (!chatCfg.notifyOnReply || document.hasFocus()) return;
    try {
      new Notification('LM SuperApp', { body: content.slice(0, 120) || 'Reply ready' });
    } catch (err) {
      reportDebug('chat.notify', err);
    }
  };

  const save = (): void => {
    void chatsSave(
      chatId,
      chatTitleOverride ?? chatTitle(history),
      history.map(toStored),
      sampling
    ).then(() => {
      setActiveSideChat(chatId);
      refreshSideChats();
    });
  };

  const bindNum = (
    el: HTMLInputElement,
    key: 'temperature' | 'topP' | 'topK',
    min: number,
    max: number
  ): void => {
    el.addEventListener('change', () => {
      const n = Number(el.value);
      if (!Number.isFinite(n) || n < min || n > max) {
        el.value = String(sampling[key]);
        return;
      }
      sampling[key] = key === 'topK' ? Math.round(n) : n;
      el.value = String(sampling[key]);
      if (history.length) save();
    });
  };
  bindNum(tempIn, 'temperature', 0, 2);
  bindNum(topPIn, 'topP', 0, 1);
  bindNum(topKIn, 'topK', 0, 500);
  sysIn.addEventListener('change', () => {
    sampling.systemPrompt = sysIn.value;
    if (history.length) save();
  });

  const addMsg = (kind: string, html: string): HTMLElement => {
    empty.hidden = true;
    const div = document.createElement('div');
    div.className = `msg msg-${kind}`;
    div.innerHTML = `<div class="msg-body">${html}</div>`;
    scroll.appendChild(div);
    scroll.scrollTop = scroll.scrollHeight;
    return div;
  };

  const msgEl = (m: UIMsg, index: number): HTMLElement => {
    const div = document.createElement('div');
    div.className = `msg msg-${m.role}`;
    div.dataset.index = String(index);
    const body =
      m.role === 'assistant'
        ? renderMarkdown(m.versions[m.vi])
        : escapeHtml(m.versions[m.vi]);
    const think =
      m.role === 'assistant' ? thinkBlock(m.thinking?.[m.vi] ?? '', false) : '';
    const nav =
      m.versions.length > 1
        ? `<span class="msg-ver"><button class="msg-act" data-act="prev" type="button" aria-label="Older version">‹</button><span>${
            m.vi + 1
          }/${m.versions.length}</span><button class="msg-act" data-act="next" type="button" aria-label="Newer version">›</button></span>`
        : '';
    div.innerHTML = `<div class="msg-body">${think}${body}</div>
      <div class="msg-acts">
        <button class="msg-act" data-act="copy" type="button" aria-label="Copy" title="Copy">${ICON_COPY}</button>
        ${
          m.role === 'assistant'
            ? `<button class="msg-act" data-act="retry" type="button" aria-label="Retry" title="Retry">${ICON_RETRY}</button>`
            : `<button class="msg-act" data-act="edit" type="button" aria-label="Edit" title="Edit">${ICON_EDIT}</button>`
        }
        ${nav}
      </div>
      ${statsRow(m)}`;
    return div;
  };

  const statsRow = (m: UIMsg): string => {
    const stat = m.stats?.[m.vi];
    const parts: string[] = [];
    if (m.role === 'assistant' && stat?.tps !== undefined) {
      parts.push(
        `<span class="msg-tok">${stat.approx ? '~' : ''}${stat.tps.toFixed(1)} tok/s</span>`
      );
    }
    if (m.ts) parts.push(`<span class="msg-time">${fmtTime(m.ts)}</span>`);
    return parts.length ? `<div class="msg-stats">${parts.join('')}</div>` : '';
  };

  const renderAll = (toBottom = true): void => {
    const atBottom =
      scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 40;
    scroll.innerHTML = '';
    if (!history.length) {
      const p = document.createElement('p');
      p.className = 'chat-empty';
      p.id = 'chat-empty';
      p.textContent = 'Pick a model above, then send a message.';
      scroll.appendChild(p);
      empty = p;
      return;
    }
    history.forEach((m, i) => scroll.appendChild(msgEl(m, i)));
    renderMath(scroll);
    if (toBottom || atBottom) scroll.scrollTop = scroll.scrollHeight;
  };

  const debugBlock = (err: unknown): string =>
    isDebugEnabled()
      ? `<pre class="debug-block">${escapeHtml(String(err))}\n${new Date().toISOString()}</pre>`
      : '';

  const runCompletion = (popOnError: boolean): void => {
    setBusy(true);
    liveText = '';
    liveThink = '';
    const thinking = addMsg('thinking', '<em>Starting model / thinking…</em>');
    liveBody = thinking.querySelector<HTMLElement>('.msg-body');
    chatSend(history.map(toFlat), chatCfg.streamReplies, sampling)
      .then((res) => {
        liveBody = null;
        if (res.stopped && !res.content && !res.thinking) {
          thinking.remove();
          return;
        }
        thinking.remove();
        history.push({
          role: 'assistant',
          versions: [res.content],
          thinking: res.thinking ? [res.thinking] : undefined,
          vi: 0,
          ts: Date.now(),
          stats: [{ tps: res.tokPerSec, approx: res.approx }]
        });
        renderAll();
        save();
        if (!res.stopped) notifyReply(res.content);
      })
      .catch((err: unknown) => {
        liveBody = null;
        reportDebug('chat.send', err);
        thinking.className = 'msg msg-error';
        thinking.innerHTML = `<div class="msg-body"><p>Chat failed — ${escapeHtml(
          err instanceof Error ? err.message : String(err)
        )}</p>${debugBlock(err)}</div>`;
        if (popOnError) history.pop();
      })
      .finally(() => {
        setBusy(false);
        scroll.scrollTop = scroll.scrollHeight;
        input.focus();
      });
  };

  const retryAt = (index: number): void => {
    const m = history[index];
    if (!m || m.role !== 'assistant' || pending || !modelSel.getValue()) return;
    setBusy(true);
    const context = history.slice(0, index).map(toFlat);
    const body = scroll
      .querySelector(`.msg[data-index="${index}"]`)
      ?.querySelector<HTMLElement>('.msg-body');
    if (body) body.innerHTML = '<em>Thinking…</em>';
    liveText = '';
    liveThink = '';
    liveBody = body ?? null;
    chatSend(context, chatCfg.streamReplies, sampling)
      .then((res) => {
        liveBody = null;
        m.versions.push(res.content);
        m.vi = m.versions.length - 1;
        m.thinking = m.thinking ?? [];
        m.thinking[m.vi] = res.thinking ?? null;
        m.ts = Date.now();
        m.stats = m.stats ?? [];
        m.stats[m.vi] = { tps: res.tokPerSec, approx: res.approx };
        save();
      })
      .catch((err: unknown) => {
        liveBody = null;
        reportDebug('chat.retry', err);
      })
      .finally(() => {
        setBusy(false);
        liveBody = null;
        renderAll(false);
        input.focus();
      });
  };

  const editAt = (index: number): void => {
    const m = history[index];
    const body = scroll
      .querySelector(`.msg[data-index="${index}"]`)
      ?.querySelector('.msg-body');
    if (!m || !body) return;
    body.innerHTML = `<textarea class="msg-edit" rows="3"></textarea>
      <span class="msg-edit-btns">
        <button class="action-btn" data-act="save-edit" type="button">Save &amp; resend</button>
        <button class="action-btn" data-act="cancel-edit" type="button">Cancel</button>
      </span>`;
    const ta = body.querySelector('textarea');
    if (ta) {
      ta.value = m.versions[m.vi];
      ta.focus();
    }
  };

  const saveEdit = (index: number, msgEl_: HTMLElement): void => {
    const m = history[index];
    const ta = msgEl_.querySelector<HTMLTextAreaElement>('.msg-edit');
    const text = ta?.value.trim() ?? '';
    if (!m || !text) {
      renderAll(false);
      return;
    }
    if (text !== m.versions[m.vi]) {
      m.versions.push(text);
      m.vi = m.versions.length - 1;
    }
    history = history.slice(0, index + 1);
    renderAll();
    runCompletion(false);
  };

  scroll.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-act]');
    const msgDiv = target.closest<HTMLElement>('.msg[data-index]');
    if (!btn || !msgDiv) return;
    const index = Number(msgDiv.dataset.index);
    const m = history[index];
    if (!m) return;
    switch (btn.dataset.act) {
      case 'copy':
        void navigator.clipboard.writeText(m.versions[m.vi]);
        btn.innerHTML = ICON_CHECK;
        btn.classList.add('is-done');
        setTimeout(() => {
          btn.innerHTML = ICON_COPY;
          btn.classList.remove('is-done');
        }, 1200);
        break;
      case 'prev':
        if (m.vi > 0) {
          m.vi -= 1;
          renderAll(false);
        }
        break;
      case 'next':
        if (m.vi < m.versions.length - 1) {
          m.vi += 1;
          renderAll(false);
        }
        break;
      case 'retry':
        retryAt(index);
        break;
      case 'edit':
        editAt(index);
        break;
      case 'save-edit':
        saveEdit(index, msgDiv);
        break;
      case 'cancel-edit':
        renderAll(false);
        break;
      default:
        break;
    }
  });

  const refreshModels = (): void => {
    void Promise.all([localModels(), getSettings()])
      .then(([list, s]) => {
        chatCfg = {
          streamReplies: s.streamReplies,
          notifyOnReply: s.notifyOnReply,
          showThinking: s.showThinking
        };
        if (!pending && history.length) renderAll(false);
        modelSel.setOptions([
          ...s.localFiles
            .filter((p) => !list.some((m) => m.path === p))
            .map((p) => ({ value: p, label: fileName(p), hint: 'file' })),
          ...list.map((m) => ({ value: m.path, label: m.name }))
        ]);
        modelSel.setValue(s.modelFile);
      })
      .catch((err: unknown) => console.error('Failed to load models:', err));
  };

  modelSel.onChange((value) => {
    patchSettings({ modelFile: value }).catch((err: unknown) =>
      console.error('Failed to save model:', err)
    );
  });

  setChatOpener((id) => {
    chatsLoad(id)
      .then((chat) => {
        chatId = id;
        chatTitleOverride = chat.title;
        sampling = { ...DEFAULT_SAMPLING, ...chat.sampling };
        fillPanel();
        history = chat.messages.map(toUIMsg);
        renderAll();
      })
      .catch((err: unknown) => reportDebug('chat.load', err));
  });

  setChatRenameHandler((id, title) => {
    if (id === chatId) chatTitleOverride = title;
  });

  setNewChatHandler(() => {
    history = [];
    chatId = newChatId();
    chatTitleOverride = null;
    sampling = { ...DEFAULT_SAMPLING };
    fillPanel();
    setActiveSideChat(chatId);
    refreshSideChats();
    renderAll();
    input.focus();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (pending) {
      chatStop().catch((err: unknown) => reportDebug('chat.stop', err));
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    if (!modelSel.getValue()) {
      addMsg('error', '<p>Pick a model above first — a downloaded one or a local .gguf.</p>');
      return;
    }
    history.push({ role: 'user', versions: [text], vi: 0, ts: Date.now() });
    input.value = '';
    renderAll();
    runCompletion(true);
  });

  refreshModels();
  fillPanel();
  onTabOpen('chat', () => {
    refreshModels();
    refreshSideChats();
  });
};
