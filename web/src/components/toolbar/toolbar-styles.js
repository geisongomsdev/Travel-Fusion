/**
 * Tokens do toolbar "flat", portados de
 * `Pass_projects/sandbox/src/components/global/toolbar/data-toolbar-styles.ts`.
 *
 * A ideia do design é tirar o peso visual da BARRA e passar pros CONTROLES: a
 * barra some (sem borda, sem sombra, sem padding) e cada controle vira um chip
 * de fundo tingido, sem outline.
 *
 * Ficam aqui, num arquivo só, para "chip" ser uma decisão única — no projeto
 * original cada toolbar repetia a string de classe e elas divergiam sozinhas.
 */

/** Fundo do chip. Sem borda e sem sombra: é o que define o design flat. */
export const TOOLBAR_SURFACE = 'border-0 shadow-none bg-primary/5 text-muted-foreground';

export const TOOLBAR_HOVER = 'hover:bg-primary/10 hover:text-muted-foreground';

export const TOOLBAR_CHIP = `${TOOLBAR_SURFACE} ${TOOLBAR_HOVER}`;

/** Chip selecionado: mesmo fundo do hover, mas com o texto em foreground. */
export const TOOLBAR_SELECTED = 'bg-primary/10 text-foreground';

/**
 * Tratamento de ícone do design — traço fino e esmaecido. Aplicado por SELETOR
 * porque a maioria dos controles renderiza o ícone internamente e não expõe
 * como estilizá-lo.
 */
export const TOOLBAR_ICON_SELECTOR =
  "[&_svg]:[stroke-width:1.5] [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:opacity-50";

/** Mesmo tratamento, aplicado direto num ícone que você controla. */
export const TOOLBAR_ICON = 'text-muted-foreground opacity-50';

export const TOOLBAR_ICON_STROKE_WIDTH = 1.5;

/** Botão quadrado de ícone da barra. */
export const TOOLBAR_ICON_BUTTON = 'h-9 w-9 shrink-0';

/** Controle de altura padrão da barra (select, date, busca). */
export const TOOLBAR_CONTROL = `h-9 shrink-0 overflow-hidden transition-all duration-300 ${TOOLBAR_CHIP} ${TOOLBAR_ICON_SELECTOR}`;

/** Campo de busca da barra: sem borda, mesmo fundo tingido dos chips. */
export const TOOLBAR_SEARCH =
  'border-0 bg-primary/5 text-foreground caret-foreground shadow-none placeholder:text-muted-foreground/50 hover:bg-primary/10';
