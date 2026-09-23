import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const noComments = {
  meta: {
    name: 'no-comments',
    version: '0.0.0',
  },
  rules: {
    'no-comments': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow every comment in source files.',
        },
        schema: [],
        messages: {
          unexpected: 'Comments are not allowed.',
        },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              context.report({ loc: comment.loc, messageId: 'unexpected' });
            }
          },
        };
      },
    },
  },
};

export default defineConfig({
  files: ['**/*.{ts,tsx,mts,cts}'],
  extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
  plugins: {
    'no-comments': noComments,
  },
  languageOptions: {
    parserOptions: {
      projectService: true,
    },
  },
  rules: {
    '@typescript-eslint/switch-exhaustiveness-check': 'error',
    '@typescript-eslint/no-unsafe-type-assertion': 'error',
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
    'no-comments/no-comments': 'error',
  },
});
