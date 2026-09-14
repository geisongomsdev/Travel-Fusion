import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatMoney(value, currency = 'BRL') {
  if (typeof value !== 'number') return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

/**
 * `2026-11-20T16:30:00-04:00` → `16:30`.
 *
 * 🔴 A hora é lida do TEXTO, não convertida: o horário de um voo é o local do
 * aeroporto, o que está no bilhete. Passar por `new Date()` mostraria a partida
 * de Lima no fuso do navegador — e um carimbo sem offset ou com rótulo
 * desconhecido virava `--:--`.
 */
export function formatTime(iso) {
  const match = /T(\d{2}):(\d{2})/.exec(iso ?? '');
  return match ? `${match[1]}:${match[2]}` : '--:--';
}
