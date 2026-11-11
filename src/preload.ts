import { contextBridge, ipcRenderer, webFrame } from 'electron';

contextBridge.exposeInMainWorld('lmsuperapp', {
  getAppInfo: (): Promise<unknown> => ipcRenderer.invoke('app:info'),
  getChangelog: (): Promise<unknown> => ipcRenderer.invoke('app:changelog'),
  getSettings: (): Promise<unknown> => ipcRenderer.invoke('settings:get'),
  patchSettings: (patch: unknown): Promise<unknown> =>
    ipcRenderer.invoke('settings:patch', patch),
  exportSettings: (): Promise<unknown> => ipcRenderer.invoke('settings:export'),
  importSettings: (): Promise<unknown> => ipcRenderer.invoke('settings:import'),
  pickGguf: (): Promise<unknown> => ipcRenderer.invoke('dialog:pickGguf'),
  setFullscreen: (on: boolean): Promise<unknown> =>
    ipcRenderer.invoke('window:fullscreen', on),
  openDevTools: (): Promise<unknown> => ipcRenderer.invoke('window:devtools'),
  listModels: (search: string, sort: string): Promise<unknown> =>
    ipcRenderer.invoke('models:list', search, sort),
  getModelDetail: (id: string): Promise<unknown> => ipcRenderer.invoke('models:detail', id),
  downloadModel: (id: string, repo: string, file: string): Promise<unknown> =>
    ipcRenderer.invoke('models:download', id, repo, file),
  openExternal: (url: string): Promise<unknown> =>
    ipcRenderer.invoke('app:openExternal', url),
  onModelProgress: (cb: (p: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on('models:progress', listener);
    return () => ipcRenderer.removeListener('models:progress', listener);
  },
  localModels: (): Promise<unknown> => ipcRenderer.invoke('models:local'),
  chatsList: (): Promise<unknown> => ipcRenderer.invoke('chats:list'),
  chatsSave: (id: string, title: string, messages: unknown, sampling: unknown): Promise<unknown> =>
    ipcRenderer.invoke('chats:save', id, title, messages, sampling),
  chatsLoad: (id: string): Promise<unknown> => ipcRenderer.invoke('chats:load', id),
  chatsRename: (id: string, title: string): Promise<unknown> =>
    ipcRenderer.invoke('chats:rename', id, title),
  chatsDelete: (id: string): Promise<unknown> => ipcRenderer.invoke('chats:delete', id),
  getBackendStatus: (): Promise<unknown> => ipcRenderer.invoke('backend:status'),
  startBackend: (modelPath: string): Promise<unknown> =>
    ipcRenderer.invoke('backend:start', modelPath),
  stopBackend: (): Promise<unknown> => ipcRenderer.invoke('backend:stop'),
  chatSend: (messages: unknown, stream: boolean, sampling: unknown): Promise<unknown> =>
    ipcRenderer.invoke('backend:chat', messages, stream, sampling),
  chatStop: (): Promise<unknown> => ipcRenderer.invoke('backend:chatStop'),
  onChatChunk: (cb: (chunk: unknown) => void) => {
    const listener = (_event: unknown, chunk: unknown): void => cb(chunk);
    ipcRenderer.on('chat:chunk', listener);
    return () => ipcRenderer.removeListener('chat:chunk', listener);
  },
  installBackend: (): Promise<unknown> => ipcRenderer.invoke('backend:install'),
  backendLatest: (): Promise<unknown> => ipcRenderer.invoke('backend:latest'),
  onBackendProgress: (cb: (p: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on('backend:progress', listener);
    return () => ipcRenderer.removeListener('backend:progress', listener);
  },
  setZoom: (factor: number): void => webFrame.setZoomFactor(factor)
});
