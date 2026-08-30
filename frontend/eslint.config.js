// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  // Ignore built artefacts
  { ignores: ['dist/**', 'node_modules/**', '*.config.*'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React
  {
    plugins: { react: reactPlugin },
    rules: {
      'react/jsx-key':              'warn',
      'react/no-array-index-key':   'warn',
      'react/self-closing-comp':    'warn',
    },
    settings: { react: { version: 'detect' } },
  },

  // React Hooks — häufigste versteckte Bugs
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks':  'error',   // Hooks dürfen nicht bedingt aufgerufen werden
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Accessibility (jsx-a11y) — nur die wichtigsten, als warn
  {
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      'jsx-a11y/alt-text':                  'warn',
      'jsx-a11y/anchor-is-valid':           'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
    },
  },

  // TypeScript-Strenge — warn statt error für graduelle Adoption
  {
    rules: {
      '@typescript-eslint/no-explicit-any':    'warn',
      '@typescript-eslint/no-unused-vars':     ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'warn',
      'no-console':                            'warn',
    },
  },
);
