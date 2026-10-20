import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Fetching data in an effect is how every page in this app loads, and the
      // rule cannot distinguish that from a genuine cascading-render bug. Kept
      // as a warning so new instances stay visible, rather than off entirely or
      // suppressed line by line across a dozen files.
      'react-hooks/set-state-in-effect': 'warn',
      // Allow underscore-prefixed params/args to signal intentional non-use
      // (e.g. `sidebarOpen: _sidebarOpen` in destructured props).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    // A context module pairs its provider with the hook that reads it, and a
    // shared UI module pairs its components with the helpers they are built
    // from. Splitting either for Fast Refresh's benefit would scatter one
    // concern across two files.
    files: ['src/context/*.tsx', 'src/components/**/labelUi.tsx', 'src/components/**/hhUi.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
