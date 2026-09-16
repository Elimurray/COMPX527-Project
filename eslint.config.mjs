import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/cdk.out/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS build scripts run in Node. TypeScript files do not need this —
    // typescript-eslint disables no-undef for them, since tsc already checks it.
    files: ['scripts/**/*.mjs', '**/*.config.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
  {
    rules: {
      // Unused args are fine when prefixed with _ (common in Lambda handlers).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Lambdas log to CloudWatch via console — that is the intended transport.
      'no-console': 'off',
    },
  },
  prettier,
);
