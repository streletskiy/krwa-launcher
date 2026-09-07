import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import stylistic from '@stylistic/eslint-plugin';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default defineConfig(
  {
    ignores: ['**/dist/**', 'node_modules', 'eslint.config.mjs'],
  },
  js.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 2024
    }
  },
  {
    files: ['**/*.js'],
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/indent': ['error', 4],
      '@stylistic/member-delimiter-style': ['error', {
        multiline: {
          delimiter: 'none',
          requireLast: false
        },
        singleline: {
          delimiter: 'comma',
          requireLast: false
        }
      }],
      '@stylistic/linebreak-style': ['error', 'unix'],
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-possible-timing-attacks': 'off',
      'no-var': ['error'],
      'no-control-regex': 'off',
      'no-unused-vars': ['error', {
        vars: 'all',
        args: 'after-used',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: false,
        argsIgnorePattern: '^_|^reject$'
      }],
    }
  },
  {
    files: ['tests/**/*.cjs'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off'
    }
  },
  {
    files: ['app/assets/js/scripts/*.js'],
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off'
    }
  }
);
