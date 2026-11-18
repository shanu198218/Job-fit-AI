import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()], css: { postcss: { plugins: [] } } }),
  webExt: { disabled: true },
  manifest: {
    name: 'JobFit AI',
    description: 'Compare job vacancies with your CV.',
    permissions: ['activeTab', 'scripting', 'storage'],
    host_permissions: ['http://127.0.0.1/*'],
  },
});

