import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isWebview = process.argv.includes('--webview');

const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
});

const webviewCtx = await esbuild.context({
  entryPoints: ['webview-ui/src/main.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

if (isWatch) {
  if (!isWebview) await extensionCtx.watch();
  await webviewCtx.watch();
  console.log('Watching...');
} else {
  if (!isWebview) await extensionCtx.rebuild();
  await webviewCtx.rebuild();
  await extensionCtx.dispose();
  await webviewCtx.dispose();
}
