import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/.wxt/**', '**/.output/**', '**/dist/**'] },
  ...tseslint.configs.recommended,
];
