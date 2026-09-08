import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * O bloco de código das páginas do sandbox — o print em
 * `docs-api/latam/latam/assets/aishopping-airshoppingrs-base-png-…png` é
 * exatamente este componente, no tema Material Oceanic.
 *
 * O realce é por regex de propósito: são só XML e JSON, e uma dependência de
 * highlight custaria mais bytes que o resto do bundle junto.
 */

/** Cada regra devolve o texto casado já embrulhado no seu <span>. */
const XML_RULES = [
  [/(&lt;\?[\s\S]*?\?&gt;)/g, 'prolog'],
  [/(&lt;!--[\s\S]*?--&gt;)/g, 'comment'],
  [/(&lt;\/?)([\w:.-]+)/g, 'tag'],
  [/([\w:.-]+)(=)(&quot;[^&]*?&quot;)/g, 'attr'],
  [/(\/?&gt;)/g, 'punct'],
];

const escape = (raw) => raw
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function highlightXml(raw) {
  let html = escape(raw);

  html = html.replace(XML_RULES[0][0], '<span class="c-prolog">$1</span>');
  html = html.replace(XML_RULES[1][0], '<span class="c-comment">$1</span>');
  html = html.replace(XML_RULES[2][0], '<span class="c-punct">$1</span><span class="c-tag">$2</span>');
  html = html.replace(XML_RULES[3][0], '<span class="c-attr">$1</span><span class="c-punct">$2</span><span class="c-string">$3</span>');
  html = html.replace(XML_RULES[4][0], '<span class="c-punct">$1</span>');

  return html;
}

function highlightJson(raw) {
  return escape(raw)
    .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="c-tag">$1</span><span class="c-punct">$2</span>')
    .replace(/:\s*(&quot;[^&]*?&quot;)/g, ': <span class="c-attr">$1</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="c-prolog">$1</span>')
    .replace(/\b(-?\d+\.?\d*)\b/g, '<span class="c-string">$1</span>');
}

export function CodeBlock({ code, language = 'xml', title, maxHeight = '20rem', className }) {
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  const html = language === 'json' ? highlightJson(code) : highlightXml(code);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard bloqueado (http, permissão): o texto continua selecionável.
    }
  };

  return (
    <div className={cn('overflow-hidden rounded-lg', className)} style={{ background: 'var(--code-bg)' }}>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-white/45">
          {title || language}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-white/55 transition-colors hover:bg-white/10 hover:text-white/90"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'copiado' : 'copiar'}
        </button>
      </div>

      {/* Bloco largo rola dentro de si; a página nunca rola na horizontal. */}
      <pre
        className="code-surface overflow-auto p-3 font-mono text-[12px] leading-[1.65]"
        style={{ color: 'var(--code-fg)', maxHeight }}
      >
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>

      <style>{`
        .code-surface .c-tag     { color: var(--code-tag); }
        .code-surface .c-attr    { color: var(--code-attr); }
        .code-surface .c-string  { color: var(--code-string); }
        .code-surface .c-punct   { color: var(--code-punct); }
        .code-surface .c-prolog  { color: var(--code-prolog); }
        .code-surface .c-comment { color: var(--code-comment); font-style: italic; }
      `}</style>
    </div>
  );
}
