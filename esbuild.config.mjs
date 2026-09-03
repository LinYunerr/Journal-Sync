import esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes('--watch') ? false : process.argv.includes('--prod');

// 读取 manifest.json 版本号，注入构建产物头部注释
const manifest = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'));
const buildDate = new Date().toISOString().slice(0, 10);
const banner = `/*!\n * Journal Sync v${manifest.version}\n * Build: ${buildDate} (${isProd ? 'production' : 'dev'})\n * https://github.com/LinYunerr/Journal-Sync\n */`;

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
  // 禁用 top-level await（target ES2018 不支持）
  supported: { 'top-level-await': false },
  // 去除所有 console/debug 语句（仅生产构建）
  drop: isProd ? ['console', 'debugger'] : [],
  // 构建产物头部注释（版本号 + 构建日期）
  banner: { js: banner },
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(sharedConfig);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(sharedConfig);
  console.log(`Build complete → ${sharedConfig.outfile} (v${manifest.version}, ${isProd ? 'production' : 'dev'})`);
}
