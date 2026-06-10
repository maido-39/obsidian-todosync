// Bundles src/main.ts → main.js (single CommonJS file beside manifest.json, as
// Obsidian loads plugins). The `obsidian`/`electron` APIs are provided by the
// host at runtime, so they stay external.
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2018',
  external: ['obsidian', 'electron'],
  outfile: 'main.js',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(options);
}
