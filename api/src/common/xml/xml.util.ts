import { parseStringPromise, processors } from 'xml2js';

/**
 * A forma REAL do que o xml2js devolve com `explicitArray:false` e
 * `ignoreAttrs:false`:
 *
 *  - elemento com filhos           → objeto indexado pelo nome do filho;
 *  - elemento com texto e atributo → `{ _: texto, $: { attr: valor } }`;
 *  - elemento só com texto         → a própria string;
 *  - elemento repetido             → array.
 *
 * 🔴 Tipar isso em vez de `any` é o que faz o compilador cobrar `text()`/`num()`
 * no lugar de acesso direto — a travessia crua é onde nascem os `undefined` que
 * só aparecem em produção, com o payload da companhia diferente do exemplo.
 */
export interface XmlElement {
  /** Texto do elemento, quando ele TAMBEM tem atributo. */
  _?: string;
  /** Atributos. E aqui que a LATAM poe CurCode e TimeZoneCode. */
  $?: Record<string, string>;
  [child: string]: XmlValue | Record<string, string> | undefined;
}

export type XmlValue = string | XmlElement | Array<string | XmlElement> | null | undefined;

/** Compatibilidade: era o nome antigo, mais frouxo. */
export type XmlNode = XmlValue;

/** Estreita para elemento navegável. `null` quando é texto, lista ou ausência. */
export function element(value: XmlValue): XmlElement | null {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlElement)
    : null;
}

/** Desce por nomes de filho. Qualquer degrau ausente encerra em `undefined`. */
export function child(value: XmlValue, ...path: string[]): XmlValue {
  let current: XmlValue = value;
  for (const name of path) {
    const node = element(current);
    if (!node) return undefined;
    current = node[name] as XmlValue;
  }
  return current;
}

/** Lê um atributo. `null` quando o elemento não tem atributo nenhum. */
export function attr(value: XmlValue, name: string): string | null {
  return element(value)?.$?.[name] ?? null;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * Serializa um objeto em XML cru. A Travelfusion não aceita JSON em lugar nenhum.
 *
 * Arrays viram elementos repetidos com o mesmo nome; `null`/`undefined` são
 * OMITIDOS — elemento vazio muda o significado em vários comandos.
 */
export function toXml(nodeName: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => toXml(nodeName, item)).join('');
  if (typeof value !== 'object') return `<${nodeName}>${escape(value)}</${nodeName}>`;

  /**
   * Atributos e texto no mesmo nó, na convenção do fast-xml-parser: chave com
   * `@_` vira atributo, `#text` vira o conteúdo. Existe porque a NDC tem nós
   * como `<Amount CurCode="BRL">1023.18</Amount>` — sem isso, a moeda teria de
   * ser montada como string solta no comando, e uma concatenação de XML no
   * meio de um objeto é onde escape se perde.
   */
  const entries = Object.entries(value as Record<string, unknown>);

  const attributes = entries
    .filter(([key]) => key.startsWith('@_'))
    .map(([key, attribute]) => ` ${key.slice(2)}="${escape(attribute)}"`)
    .join('');

  const text = (value as Record<string, unknown>)['#text'];
  if (text !== undefined) return `<${nodeName}${attributes}>${escape(text)}</${nodeName}>`;

  const inner = entries
    .filter(([key]) => !key.startsWith('@_'))
    .map(([key, child]) => toXml(key, child))
    .join('');

  return `<${nodeName}${attributes}>${inner}</${nodeName}>`;
}

/** Nome do envelope obrigatório da Travelfusion, em request e response. */
export const ENVELOPE = 'CommandList';

/**
 * 🔴 Todo request vai dentro de `<CommandList>`, mesmo com um comando só.
 * Sem o envelope a Travelfusion responde HTTP 400 com
 * `ecode="1-1043" etext="Invalid request:Missing <CommandList> tag"` — antes
 * de olhar a credencial, o que faz o erro parecer problema de login.
 */
export function buildCommand(command: string, body: unknown): string {
  return `<?xml version="1.0" encoding="UTF-8"?><${ENVELOPE}>${toXml(command, body)}</${ENVELOPE}>`;
}

/**
 * Desembrulha `<CommandList><Comando>…</Comando></CommandList>` e devolve o nó
 * do comando. A resposta espelha o nome do comando enviado; aceitamos também o
 * sufixo `Response` porque parte da spec documenta assim.
 */
export function unwrapCommand(parsed: Record<string, any> | null, command: string): Record<string, any> {
  const envelope = parsed?.[ENVELOPE] ?? (parsed ? Object.values(parsed)[0] : null);
  if (!envelope || typeof envelope !== 'object') return {};
  const node = envelope[command] ?? envelope[`${command}Response`];
  return node && typeof node === 'object' ? (node as Record<string, any>) : {};
}

export async function parseXml(xml: string): Promise<Record<string, any>> {
  return parseStringPromise(xml, {
    explicitArray: false,
    explicitRoot: true,
    trim: true,
    ignoreAttrs: false,
    /**
     * 🔴 O prefixo de namespace é jogado fora na LEITURA.
     *
     * A NDC 24.1 responde `<ns2:IATA_OrderViewRS><ns2:Error>`, e a 19.2
     * responde `<Error>` — mesma informação, chave diferente. Sem isto,
     * `child(payload, 'Order')` só enxerga metade das mensagens e um erro do
     * 24.1 chega como "conflito genérico" em vez do que realmente é.
     *
     * Na ESCRITA o prefixo continua importando e é montado à mão: o gateway
     * recusa a mensagem 24.1 sem ele.
     */
    tagNameProcessors: [processors.stripPrefix],
  }) as Promise<Record<string, any>>;
}

/**
 * xml2js com explicitArray:false colapsa lista de 1 item em objeto — origem
 * clássica de bug quando o fornecedor devolve uma rota só.
 */
export function asList<T = any>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function text(node: XmlNode): string | null {
  if (node === null || node === undefined) return null;
  if (typeof node === 'object') return (node as { _?: string })._ ?? null;
  const value = String(node).trim();
  return value === '' ? null : value;
}

export function num(node: XmlNode): number | null {
  const value = text(node);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function bool(node: XmlNode): boolean | null {
  const value = text(node);
  return value === null ? null : value.toLowerCase() === 'true';
}
