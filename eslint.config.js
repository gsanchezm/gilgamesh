import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Architecture-boundaries lint gate (Clean Architecture dependency rule). Style is handled by
 * Prettier and general correctness by tsc; this config ONLY enforces import direction, so it can
 * never flood on the existing (clean) code. It complements the domain/application fitness tests by
 * also covering the `ui` layer and giving editor-time feedback.
 */
const FRAMEWORKS = [
  '@nestjs/*',
  'react',
  'react-dom',
  'react-router-dom',
  'express',
  '@prisma/*',
  'argon2',
  '@node-rs/*',
];

const deny = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'] },
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
  // domain: innermost ring — no framework, no outer layer.
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: deny(...FRAMEWORKS, '@gilgamesh/application', '@gilgamesh/ui', '@gilgamesh/api', '@gilgamesh/web'),
  },
  // application: may use @gilgamesh/domain only — no framework, no ui/apps.
  {
    files: ['packages/application/src/**/*.ts'],
    rules: deny(...FRAMEWORKS, '@gilgamesh/ui', '@gilgamesh/api', '@gilgamesh/web'),
  },
  // ui: a React design system — may use react + domain types, never a backend/app ring.
  {
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    rules: deny('@nestjs/*', '@prisma/*', 'express', '@gilgamesh/api', '@gilgamesh/web'),
  },
  // React hooks correctness for the UI + web (rules-of-hooks is a real bug catcher; deps as advisory).
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
