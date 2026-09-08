import { cn } from '@/lib/utils';

/**
 * Os dois avisos que as páginas do sandbox repetem em toda operação:
 *
 *   ### Advice  ![warning_sign]  → triângulo amarelo, o que pode dar errado
 *   **Note:** …                  → nota lateral, informativa
 */

/** O mesmo triângulo de `assets/warning-sign-…jpg`, em SVG para escalar. */
function WarningSign({ className }) {
  return (
    <svg viewBox="0 0 24 22" className={className} aria-hidden>
      <path d="M12 1.5 22.5 20.5H1.5z" fill="#F5C518" stroke="#3A3000" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M12 7.5v6" stroke="#1A1500" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.2" fill="#1A1500" />
    </svg>
  );
}

const TONES = {
  advice: 'border-amber-500/25 bg-amber-500/5',
  note: 'border-border bg-muted/50',
  error: 'border-destructive/25 bg-destructive/5',
  success: 'border-emerald-500/25 bg-emerald-500/5',
};

export function Callout({ tone = 'note', title, children, className }) {
  return (
    <div className={cn('rounded-lg border px-3.5 py-2.5', TONES[tone], className)}>
      <div className="flex gap-3">
        {tone === 'advice' && <WarningSign className="mt-0.5 h-5 w-5 shrink-0" />}
        <div className="min-w-0 flex-1 text-sm leading-relaxed">
          {title && (
            <p className="mb-1 font-semibold">
              {title}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
