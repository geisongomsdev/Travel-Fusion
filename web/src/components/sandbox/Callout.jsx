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
  advice: 'border-l-warning bg-warning/[0.07]',
  note: 'border-l-primary bg-accent/60',
  error: 'border-l-destructive bg-destructive/[0.06]',
  success: 'border-l-success bg-success/[0.07]',
};

export function Callout({ tone = 'note', title, children, className }) {
  return (
    <div className={cn('rounded-r-lg border-l-[3px] px-4 py-3', TONES[tone], className)}>
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
