import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readlinkSync, statSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const plugin = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const workspace = path.resolve(plugin, '../..');
const rawVault = process.env.VAULT?.trim();
const configuredVault =
  rawVault?.startsWith('"') && rawVault.endsWith('"') ? rawVault.slice(1, -1) : rawVault;
if (!configuredVault) throw new Error('VAULT is unset. Configure it in the root .env file.');

const vault = path.resolve(workspace, configuredVault);
if (!statSync(vault, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`VAULT is not an existing directory: ${vault}`);
}

const plugins = path.join(vault, '.obsidian', 'plugins');
const destination = path.join(plugins, 'agent');
const existing = lstatSync(destination, { throwIfNoEntry: false });
const alreadyLinked =
  existing?.isSymbolicLink() && path.resolve(plugins, readlinkSync(destination)) === plugin;
if (existing && !alreadyLinked) {
  throw new Error(`Refusing to replace an existing plugin at ${destination}`);
}

const build = spawnSync('pnpm', ['run', 'build'], { cwd: plugin, stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

if (!alreadyLinked) {
  mkdirSync(plugins, { recursive: true });
  symlinkSync(plugin, destination, 'dir');
}
console.log(`Built and linked ${plugin} at ${destination}`);
