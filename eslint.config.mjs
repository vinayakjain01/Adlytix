import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

/**
 * ESLint flat config.
 *
 * eslint-config-next 16 ships flat configs directly, so these are imported
 * rather than wrapped in FlatCompat — the compat layer fails to validate them
 * and reports it as an unrelated circular-JSON error.
 */
const config = [
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'backend/**', 'next-env.d.ts'],
  },

  // Next.js's own rules: hooks correctness, plus the App Router constraints
  // that matter under `output: 'export'`.
  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      // TypeScript already fails the build on unused values via noUnusedLocals,
      // so the lint copy would only double-report them.
      '@typescript-eslint/no-unused-vars': 'off',

      // `any` is deliberate at the API boundary, where the response really is
      // untyped until it is normalised. Worth seeing, not worth blocking.
      '@typescript-eslint/no-explicit-any': 'warn',

      eqeqeq: ['error', 'smart'],

      // The two mistakes this codebase is actually prone to: a stray console.log
      // left inside a data path, and a forgotten debugger.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
    },
  },
]

export default config
