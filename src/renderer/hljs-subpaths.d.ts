// highlight.js only ships types for the package root — declare the lib/*
// subpaths we import so registerLanguage stays typed
declare module 'highlight.js/lib/core' {
  import type { HLJSApi } from 'highlight.js';
  const hljs: HLJSApi;
  export default hljs;
}

declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js';
  const lang: LanguageFn;
  export default lang;
}
