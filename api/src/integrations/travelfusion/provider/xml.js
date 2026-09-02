import { parseStringPromise } from 'xml2js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * Serializa um objeto JS em XML cru. A Travelfusion não aceita JSON em lugar nenhum.
 *
 * Arrays viram elementos repetidos com o mesmo nome; `null`/`undefined` são
 * omitidos (elemento vazio muda o significado em vários comandos).
 */
export function toXml(nodeName, value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => toXml(nodeName, item)).join('');
  if (typeof value !== 'object') return `<${nodeName}>${escape(value)}</${nodeName}>`;

  const inner = Object.entries(value)
    .map(([key, child]) => toXml(key, child))
    .join('');
  return `<${nodeName}>${inner}</${nodeName}>`;
}

export function buildCommand(command, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>${toXml(command, body)}`;
}

/**
 * xml2js com explicitArray:false colapsa lista de 1 item em objeto — origem clássica
 * de bug quando o fornecedor devolve 1 rota. Mantemos explicitArray e normalizamos
 * com `asList` onde a cardinalidade importa.
 */
export async function parseXml(xml) {
  return parseStringPromise(xml, {
    explicitArray: false,
    explicitRoot: true,
    trim: true,
    ignoreAttrs: false,
  });
}

export function asList(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function text(node) {
  if (node === null || node === undefined) return null;
  if (typeof node === 'object') return node._ ?? null;
  const value = String(node).trim();
  return value === '' ? null : value;
}

export function num(node) {
  const value = text(node);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function bool(node) {
  const value = text(node);
  return value === null ? null : value.toLowerCase() === 'true';
}
