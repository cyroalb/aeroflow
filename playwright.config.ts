import { defineConfig } from '@playwright/test';

// Headless Chromium on Windows only exposes a WebGPU adapter with the D3D11 ANGLE backend
// (with --enable-features=Vulkan requestAdapter() returns null), and requestDevice() fails
// loading dxcompiler.dll unless Dawn falls back to FXC (use_dxc disabled). Other platforms keep Vulkan.
const gpuArgs =
  (globalThis as unknown as { process: { platform: string } }).process.platform === 'win32'
    ? ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--disable-dawn-features=use_dxc']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan'];

export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      args: gpuArgs,
    },
  },
});
