import backend from '../icons/backend.svg';
import bug from '../icons/bug.svg';
import caret from '../icons/caret.svg';
import changelog from '../icons/changelog.svg';
import chat from '../icons/chat.svg';
import check from '../icons/check.svg';
import copy from '../icons/copy.svg';
import desktop from '../icons/desktop.svg';
import download from '../icons/download.svg';
import edit from '../icons/edit.svg';
import export_ from '../icons/export.svg';
import file from '../icons/file.svg';
import finetune from '../icons/finetune.svg';
import heart from '../icons/heart.svg';
import home from '../icons/home.svg';
import info from '../icons/info.svg';
import library from '../icons/library.svg';
import models from '../icons/models.svg';
import more from '../icons/more.svg';
import retry from '../icons/retry.svg';
import send from '../icons/send.svg';
import settings from '../icons/settings.svg';
import stop from '../icons/stop.svg';
import theme from '../icons/theme.svg';
import trash from '../icons/trash.svg';
import tune from '../icons/tune.svg';

const ICONS: Record<string, string> = {
  backend,
  bug,
  caret,
  changelog,
  chat,
  check,
  copy,
  desktop,
  download,
  edit,
  export: export_,
  file,
  finetune,
  heart,
  home,
  info,
  library,
  models,
  more,
  retry,
  send,
  settings,
  stop,
  theme,
  trash,
  tune
};

export const icon = (name: string): string =>
  (ICONS[name] ?? '').replace('<svg', '<svg class="icon" aria-hidden="true"');

export const fillIcons = (root: ParentNode): void => {
  root.querySelectorAll<HTMLElement>('[data-ico]').forEach((el) => {
    el.innerHTML = icon(el.dataset.ico ?? '');
  });
};
