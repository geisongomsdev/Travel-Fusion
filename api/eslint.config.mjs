import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * O `npm run lint` existia no package.json e não rodava — o eslint nunca tinha
 * sido instalado nem configurado. Esta config é deliberadamente curta: liga as
 * recomendadas e desliga só o que briga com o desenho do projeto.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test/fixtures/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      /**
       * A travessia de XML devolve `any` por natureza — o `xml.util` existe
       * justamente para concentrar isso num lugar só. Proibir aqui empurraria
       * `as unknown as T` para todo normalizador, o que é pior.
       */
      '@typescript-eslint/no-explicit-any': 'off',

      // `_` como argumento ignorado é intencional (assinaturas de interface).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],

      // DTOs e decorators do Nest usam classes vazias e namespaces de tipo.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
