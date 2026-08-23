import esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes('--prod');

const sharedConfig = {
  entryPoints: [resolve(__dirname, 'src/main.js')],
  bundle: true,
  // Obsidian 和 Node.js 内置模块不打包进去
  external: ['obsidian', 'electron', 'codemirror', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: !isProd ? 'inline' : false,
  // 打包输出到插件根目录 main.js
  outfile: resolve(__dirname, 'main.js'),
  // 将 require('obsidian') 保留为外部引用
  platform: 'browser',
  // 允许 top-level await
  supported: { 'top-level-await': false },
  // 去除所有 console/debug 语句（仅生产构建）
  drop: isProd ? ['console', 'debugger'] : [],
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(sharedConfig);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(sharedConfig);
  console.log('Build complete →', sharedConfig.outfile);
}
