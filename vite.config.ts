import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rolldownOptions: {
      // tests/parity.html: page used by the backend parity e2e tests
      input: { main: 'index.html', parity: 'tests/parity.html' },
    },
  },
});
