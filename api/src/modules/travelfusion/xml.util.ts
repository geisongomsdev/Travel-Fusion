import { parseStringPromise } from 'xml2js';

export type XmlNode = Record<string, any> | string | null | undefined;

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

  const inner = Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => toXml(key, child))
    .join('');
  return `<${nodeName}>${inner}</${nodeName}>`;
}

export function buildCommand(command: string, body: unknown): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${toXml(command, body)}`;
}

export async function parseXml(xml: string): Promise<Record<string, any>> {
  return parseStringPromise(xml, {
    explicitArray: false,
    explicitRoot: true,
    trim: true,
    ignoreAttrs: false,
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
