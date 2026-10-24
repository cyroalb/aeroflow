import { defineConfig } from '@playwright/test';
import base, { gpuArgs } from './playwright.config';

// Long-running acceptance checks against spec §7 on the Alta preset (WebGPU).
//   npm run e2e:acceptance   (set GPU_RUNNER=1 on a machine with a hardware GPU to assert fps)
//   npm run e2e:soak         (10-minute stability soak, tagged @soak)
export default defineConfig({
  ...base,
  workers: 1, // the cases measure fps and wall-clock timing: never share the GPU
  projects: [
    {
      name: 'acceptance',
      testMatch: /acceptance\.spec\.ts/,
      grepInvert: /@soak/,
      use: { launchOptions: { args: gpuArgs } },
    },
    {
      name: 'soak',
      testMatch: /acceptance\.spec\.ts/,
      grep: /@soak/,
      use: { launchOptions: { args: gpuArgs } },
    },
  ],
});
