import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 画面に表示する版（Netlify はビルド時に COMMIT_REF を設定する）
const version = `${new Date().toISOString().slice(0, 10)} ${(process.env.COMMIT_REF ?? 'local').slice(0, 7)}`;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: 'dist', sourcemap: false },
});
