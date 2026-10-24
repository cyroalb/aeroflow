import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
        {
          extends: true,
          test: { name: 'physics', include: ['tests/physics/**/*.test.ts'], testTimeout: 600_000 },
        },
      ],
    },
  }),
);
