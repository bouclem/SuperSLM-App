const requireApi = (): LmApi => {
  const api = window.lmsuperapp;
  if (!api) throw new Error('Preload bridge unavailable');
  return api;
};

export const getAppInfo = (): Promise<LmAppInfo> => requireApi().getAppInfo();

export const getChangelog = (): Promise<string> => requireApi().getChangelog();

export const getSettings = (): Promise<LmSettings> => requireApi().getSettings();

export const patchSettings = (patch: Partial<LmSettings>): Promise<LmSettings> =>
  requireApi().patchSettings(patch);

export const exportSettings = (): Promise<{ path: string } | null> =>
  requireApi().exportSettings();

export const importSettings = (): Promise<LmSettings | null> =>
  requireApi().importSettings();

export const pickGguf = (): Promise<string[] | null> => requireApi().pickGguf();

export const setFullscreen = (on: boolean): Promise<void> => requireApi().setFullscreen(on);

export const openDevTools = (): Promise<void> => requireApi().openDevTools();

export const listModels = (
  search: string,
  sort: LmModelSort
): Promise<LmModelSummary[]> => requireApi().listModels(search, sort);

export const getModelDetail = (id: string): Promise<LmModelDetail> =>
  requireApi().getModelDetail(id);

export const downloadModel = (
  id: string,
  repo: string,
  file: string
): Promise<{ path?: string; cancelled?: boolean }> =>
  requireApi().downloadModel(id, repo, file);

export const openExternal = (url: string): Promise<unknown> =>
  requireApi().openExternal(url);

export const onModelProgress = (
  cb: (p: LmDownloadProgress) => void
): (() => void) => requireApi().onModelProgress(cb);

export const getBackendStatus = (): Promise<LmBackendStatus> =>
  requireApi().getBackendStatus();

export const startBackend = (modelPath: string): Promise<LmBackendStatus> =>
  requireApi().startBackend(modelPath);

export const stopBackend = (): Promise<LmBackendStatus> => requireApi().stopBackend();

export const localModels = (): Promise<LmLocalModel[]> => requireApi().localModels();

export const chatsList = (): Promise<LmChatMeta[]> => requireApi().chatsList();

export const chatsSave = (
  id: string,
  title: string,
  messages: LmStoredMessage[],
  sampling?: LmSampling
): Promise<{ title: string; updated: number; messages: LmStoredMessage[] }> =>
  requireApi().chatsSave(id, title, messages, sampling);

export const chatsLoad = (
  id: string
): Promise<{
  title: string;
  updated: number;
  messages: LmStoredMessage[];
  sampling?: LmSampling;
}> => requireApi().chatsLoad(id);

export const chatsRename = (id: string, title: string): Promise<{ id: string; title: string }> =>
  requireApi().chatsRename(id, title);

export const chatsDelete = (id: string): Promise<void> => requireApi().chatsDelete(id);

export const chatSend = (
  messages: LmChatMessage[],
  stream: boolean,
  sampling?: LmSampling
): Promise<LmChatResult> => requireApi().chatSend(messages, stream, sampling);

export const chatStop = (): Promise<void> => requireApi().chatStop();

export const onChatChunk = (cb: (chunk: LmChatChunk) => void): (() => void) =>
  requireApi().onChatChunk(cb);

export const installBackend = (): Promise<{ path: string; tag?: string }> =>
  requireApi().installBackend();

export const backendLatest = (): Promise<{ tag: string }> => requireApi().backendLatest();

export const onBackendProgress = (
  cb: (p: LmInstallProgress) => void
): (() => void) => requireApi().onBackendProgress(cb);

export const setZoom = (factor: number): void => requireApi().setZoom(factor);
