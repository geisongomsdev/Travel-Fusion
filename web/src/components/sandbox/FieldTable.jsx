import { cn } from '@/lib/utils';

/**
 * A tabela que toda página de operação do sandbox usa para descrever a
 * mensagem: `Field Name | Type | Accepted Values/Example | Required`.
 *
 * Aqui ela descreve os `requiredParameters` que o /quote declarou — mesma
 * função, mesma leitura.
 */
export function FieldTable({ rows, className }) {
  if (!rows || rows.length === 0) return null;

  return (
    // Tabela larga rola dentro do próprio contêiner, nunca empurra a página.
    <div className={cn('overflow-x-auto rounded-lg border border-border', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted text-left">
            <Th>Field Name</Th>
            <Th>Type</Th>
            <Th>Accepted Values / Example</Th>
            <Th className="whitespace-nowrap">Required</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-border align-top">
              <Td>
                <code className="font-mono text-[12px] text-primary">{row.name}</code>
              </Td>
              <Td className="text-muted-foreground">{row.type}</Td>
              <Td className="text-muted-foreground">{row.example}</Td>
              <Td>
                <span
                  className={cn(
                    'font-mono text-[12px]',
                    row.required ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {String(Boolean(row.required))}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Th = ({ children, className }) => (
  <th className={cn('px-3 py-2 text-xs font-semibold text-muted-foreground', className)}>{children}</th>
);

const Td = ({ children, className }) => (
  <td className={cn('px-3 py-2', className)}>{children}</td>
);
