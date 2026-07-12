import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js';

const renderer = new marked.Renderer();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

renderer.code = function (code: string, lang?: string) {
  const normalizedCode = code.replace(/\n$/, '');
  if (lang === 'mermaid') {
    return `
      <div class="mermaid-block">
        <pre class="mermaid-source hidden">${escapeHtml(normalizedCode)}</pre>
        <div class="mermaid-loading">正在渲染流程图...</div>
      </div>
    `;
  }

  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(normalizedCode, { language }).value;
  const languageLabel = language === 'plaintext' ? 'text' : language;

  return `
    <div class="code-block">
      <div class="code-header">
        <span class="code-lang">${escapeHtml(languageLabel)}</span>
        <button type="button" class="copy-btn" data-copy-code="true">Copy</button>
      </div>
      <pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>
    </div>
  `;
};

renderer.heading = function (text: string, level: number) {
  const sizes: Record<number, string> = {
    1: 'text-2xl font-bold',
    2: 'text-xl font-bold',
    3: 'text-lg font-semibold',
    4: 'text-base font-semibold',
    5: 'text-sm font-semibold',
    6: 'text-xs font-semibold',
  };
  return `<h${level} class="${sizes[level] || 'text-base'} mt-4 mb-2 first:mt-0">${text}</h${level}>`;
};

renderer.paragraph = function (text: string) {
  return `<p class="mb-4 last:mb-0 leading-relaxed">${text}</p>`;
};

renderer.list = function (body: string, ordered: boolean) {
  const tag = ordered ? 'ol' : 'ul';
  const listClass = ordered ? 'list-decimal' : 'list-disc';
  return `<${tag} class="${listClass} pl-5 mb-4 space-y-1">${body}</${tag}>`;
};

renderer.listitem = function (text: string) {
  return `<li class="leading-relaxed">${text}</li>`;
};

renderer.table = function (header: string, body: string) {
  return `
    <div class="table-wrap">
      <table>
        <thead>${header}</thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
};

renderer.tablerow = function (content: string) {
  return `<tr>${content}</tr>`;
};

renderer.tablecell = function (content: string, flags: { header?: boolean; align?: 'center' | 'left' | 'right' | null }) {
  const tag = flags.header ? 'th' : 'td';
  const align = flags.align ? ` style="text-align:${flags.align}"` : '';
  return `<${tag}${align}>${content}</${tag}>`;
};

renderer.blockquote = function (text: string) {
  return `<blockquote class="my-4 rounded-r-2xl border-l-4 border-pink-300 bg-pink-50 py-2 pr-3 pl-4 text-gray-700 italic">${text}</blockquote>`;
};

renderer.strong = function (text: string) {
  return `<strong class="font-semibold text-gray-900">${text}</strong>`;
};

renderer.em = function (text: string) {
  return `<em class="italic">${text}</em>`;
};

renderer.codespan = function (text: string) {
  return `<code class="inline-code">${text}</code>`;
};

renderer.link = function (href: string, _title: string, text: string) {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-pink-500 hover:underline">${text}</a>`;
};

renderer.hr = function () {
  return '<hr class="my-5 border-gray-200" />';
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
});

marked.use(markedKatex({
  throwOnError: false,
  displayMode: false,
  nonStandard: true,
}));

export function renderMarkdown(content: string): string {
  try {
    const normalizedContent = String(content || '')
      .replace(/\\\[((?:.|\n|\r)*?)\\\]/g, (_, formula) => `$$${formula.trim()}$$`)
      .replace(/\\\(((?:.|\n|\r)*?)\\\)/g, (_, formula) => `$${formula.trim()}$`);

    return marked.parse(normalizedContent) as string;
  } catch {
    return content;
  }
}

export function escapeTextAsHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export { escapeTextAsHtml as escapeHtml };
