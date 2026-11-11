import { escapeHtml } from './dom';
import { highlightCode } from './highlight';
import { icon } from './icons';

interface Stashed {
  tex: string;
  display: boolean;
}

interface MdCtx {
  math: Stashed[];
  footDefs: Map<string, string>;
  footOrder: string[];
  uid: number;
}

const mathHtml = (tex: string, display: boolean): string =>
  `<span class="md-math" data-tex="${escapeHtml(tex)}" data-display="${display ? '1' : ''}"></span>`;

const inlineMd = (s: string, ctx: MdCtx): string => {
  const codes: string[] = [];
  let t = s.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c);
    return ` CD${codes.length - 1} `;
  });
  t = t
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, x: string) => {
      ctx.math.push({ tex: x, display: true });
      return ` MT${ctx.math.length - 1} `;
    })
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, x: string) => {
      ctx.math.push({ tex: x, display: true });
      return ` MT${ctx.math.length - 1} `;
    })
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, x: string) => {
      ctx.math.push({ tex: x, display: false });
      return ` MT${ctx.math.length - 1} `;
    })
    .replace(/\$([^$\n]+?)\$/g, (_m, x: string) => {
      ctx.math.push({ tex: x, display: false });
      return ` MT${ctx.math.length - 1} `;
    });
  t = escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s"'<>]+)\)/g,
      (_m, text: string, url: string) =>
        `<a class="md-link" data-url="${url}">${text}</a>`
    )
    .replace(/\[\^([\w-]+)\]/g, (_m, id: string) => {
      let n = ctx.footOrder.indexOf(id);
      if (n < 0) {
        ctx.footOrder.push(id);
        n = ctx.footOrder.length - 1;
      }
      return `<sup class="md-fn"><a class="md-fnref" id="fnref-${ctx.uid}-${n}" data-target="fn-${ctx.uid}-${n}">${n + 1}</a></sup>`;
    })
    .replace(/ CD(\d+) /g, (_m, i: string) => `<code>${escapeHtml(codes[Number(i)])}</code>`)
    .replace(/ MT(\d+) /g, (_m, i: string) => {
      const st = ctx.math[Number(i)];
      return st ? mathHtml(st.tex, st.display) : '';
    });
  return t;
};

const splitRow = (line: string): string[] =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());

const isTableSep = (line: string): boolean =>
  /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');

const FENCE_RE = /^(`{3,}|~{3,})\s*([\w#+.-]*)/;
const isFence = (line: string): boolean => FENCE_RE.test(line.trim());

const codeBlock = (buf: string[], lang: string): string =>
  `<pre class="md-code"><button class="code-copy" type="button" title="Copy code">${icon('copy')}</button><code${
    lang ? ` class="language-${escapeHtml(lang)}"` : ''
  }>${highlightCode(buf.join('\n'), lang)}</code></pre>`;

const indentWidth = (line: string): number =>
  (/^[ \t]*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;

let mdUid = 0;

export const renderMarkdown = (md: string): string => {
  const ctx: MdCtx = { math: [], footDefs: new Map(), footOrder: [], uid: ++mdUid };

  // footnote definitions ([^id]: text) are lifted out first so refs can point
  // at them from anywhere in the document
  const lines = md.split('\n').filter((line) => {
    const def = /^\[\^([\w-]+)\]:\s*(.*)$/.exec(line.trim());
    if (def) ctx.footDefs.set(def[1], def[2]);
    return !def;
  });

  let html = '';
  let i = 0;
  const listStack: { indent: number; kind: 'ul' | 'ol' }[] = [];
  let inIndent = false;

  const closeLists = (): void => {
    while (listStack.length) html += `</${listStack.pop()!.kind}>`;
  };

  const closeIndent = (): void => {
    if (inIndent) {
      html += '</code></pre>';
      inIndent = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (isFence(line)) {
      closeLists();
      closeIndent();
      const m = FENCE_RE.exec(trimmed)!;
      const marker = m[1];
      const lang = m[2].toLowerCase();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      html += codeBlock(buf, lang);
      continue;
    }

    if (/^\$\$/.test(trimmed)) {
      closeLists();
      closeIndent();
      const buf: string[] = [];
      const rest = trimmed.slice(2);
      if (rest.endsWith('$$')) {
        buf.push(rest.slice(0, -2));
      } else {
        if (rest) buf.push(rest);
        i += 1;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) {
          buf.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) buf.push(lines[i].trim().slice(0, -2));
        i += 1;
      }
      html += mathHtml(buf.join('\n'), true);
      continue;
    }

    const indent = indentWidth(line);
    const indented = indent >= 4 && trimmed !== '';
    if (indented && listStack.length === 0) {
      if (!inIndent) {
        closeLists();
        html += `<pre class="md-code"><button class="code-copy" type="button" title="Copy code">${icon('copy')}</button><code>`;
        inIndent = true;
      } else {
        html += '\n';
      }
      html += escapeHtml(line.replace(/^( {4}|\t)/, ''));
      i += 1;
      continue;
    }
    closeIndent();

    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      closeLists();
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      html += `<table class="md-table"><thead><tr>${header
        .map((c) => `<th>${inlineMd(c, ctx)}</th>`)
        .join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c, ctx)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
      continue;
    }

    const item = /^([-+*]|\d+[.)])\s+(.*)$/.exec(trimmed);
    if (item) {
      const kind = /^\d/.test(item[1]) ? 'ol' : 'ul';
      // pop deeper levels and same-level lists of a different kind, then open
      // a new (possibly nested) list when this item sits deeper than the top
      while (
        listStack.length &&
        listStack[listStack.length - 1].indent >= indent
      ) {
        const top = listStack[listStack.length - 1];
        if (top.indent === indent && top.kind === kind) break;
        html += `</${listStack.pop()!.kind}>`;
      }
      if (!listStack.length || listStack[listStack.length - 1].indent < indent) {
        html += `<${kind}>`;
        listStack.push({ indent, kind });
      }
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(item[2]);
      html += task
        ? `<li class="md-task"><input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'} /> <span>${inlineMd(task[2], ctx)}</span></li>`
        : `<li>${inlineMd(item[2], ctx)}</li>`;
      i += 1;
      continue;
    }

    closeLists();

    const head = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (head) {
      const tag = head[1].length <= 2 ? 'h3' : 'h4';
      if (head[1].length > 1) html += `<${tag}>${inlineMd(head[2], ctx)}</${tag}>`;
    } else if (trimmed.startsWith('>')) {
      html += `<blockquote>${inlineMd(trimmed.slice(1).trim(), ctx)}</blockquote>`;
    } else if (trimmed !== '') {
      html += `<p>${inlineMd(trimmed, ctx)}</p>`;
    }
    i += 1;
  }

  closeLists();
  closeIndent();

  if (ctx.footOrder.length) {
    html += `<section class="md-footnotes"><ol>${ctx.footOrder
      .map(
        (id, n) =>
          `<li id="fn-${ctx.uid}-${n}">${inlineMd(ctx.footDefs.get(id) ?? id, ctx)}<a class="md-fnback" data-target="fnref-${ctx.uid}-${n}" title="Back to reference">↩</a></li>`
      )
      .join('')}</ol></section>`;
  }
  return html;
};

declare global {
  interface Window {
    katex?: {
      render: (tex: string, el: HTMLElement, opts: { displayMode: boolean; throwOnError: boolean }) => void;
    };
  }
}

export const initMdClicks = (host: HTMLElement, openUrl: (url: string) => void): void => {
  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.code-copy')) {
      const btn = t.closest<HTMLButtonElement>('.code-copy');
      const code = btn?.closest('.md-code')?.querySelector('code');
      if (code) void navigator.clipboard.writeText(code.textContent ?? '');
      if (btn) {
        btn.innerHTML = icon('check');
        btn.classList.add('is-done');
        setTimeout(() => {
          btn.innerHTML = icon('copy');
          btn.classList.remove('is-done');
        }, 1200);
      }
      return;
    }
    const fnLink = t.closest<HTMLElement>('a.md-fnref, a.md-fnback');
    if (fnLink?.dataset.target) {
      document
        .getElementById(fnLink.dataset.target)
        ?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const link = t.closest<HTMLElement>('a.md-link');
    if (link?.dataset.url) openUrl(link.dataset.url);
  });
};

export const renderMath = (root: ParentNode): void => {
  const katex = window.katex;
  if (!katex) return;
  root.querySelectorAll<HTMLElement>('.md-math').forEach((el) => {
    try {
      katex.render(el.dataset.tex ?? '', el, {
        displayMode: el.dataset.display === '1',
        throwOnError: false
      });
    } catch {
      el.textContent = el.dataset.tex ?? '';
    }
  });
};
