import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import { readFile } from 'node:fs/promises';

const production = process.argv.includes('production');
const external = [
  'obsidian',
  'electron',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  '@codemirror/*',
  '@lezer/*',
  '@marijn/*',
];
const electronNodeImports = {
  name: 'electron-node-imports',
  setup(build) {
    build.onLoad({ filter: /node_modules\/.*\.[cm]?js$/ }, async ({ path }) => {
      if (
        ![
          '/@earendil-works/pi-ai/',
          '/pkce-challenge/',
          '/@smithy/core/',
          '/@smithy/node-http-handler/',
          '/@aws/lambda-invoke-store/',
        ].some((part) => path.includes(part))
      )
        return;
      let source = await readFile(path, 'utf8');
      // Electron exposes Node's require to Obsidian plugins, while dynamic
      // import('node:...') is handled as a renderer URL and fails with CORS.
      source = source.replace(
        /import\((['"])(node:[^'"]+)\1\)/g,
        'Promise.resolve().then(() => require("$2"))',
      );
      if (path.endsWith('/auth/context.js') || path.endsWith('/env-api-keys.js')) {
        source = source.replace(
          'import(__rewriteRelativeImportExtension(specifier))',
          'Promise.resolve().then(() => require(specifier))',
        );
      }
      return { contents: source, loader: 'js' };
    });
  },
};
const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'main.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  external,
  plugins: [electronNodeImports],
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'info',
};

if (production) {
  await esbuild.build(options);
} else {
  const context = await esbuild.context(options);
  await context.watch();
}
