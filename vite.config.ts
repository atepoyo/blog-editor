import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { offlineCache } from './offline-plugin.ts';

export default defineConfig({
  plugins: [react(), offlineCache()],
  test: { include: ['src/**/*.test.ts', 'worker/**/*.test.ts'] },
});
