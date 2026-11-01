import { readFile, access, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../extension/', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3');
if (manifest.permissions.some(permission => !['storage', 'alarms'].includes(permission))) throw new Error('Unexpected permissions');
for (const file of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(item => item.js),
  ...manifest.web_accessible_resources.flatMap(item => item.resources), 'panel.js', 'panel.css', 'core.js']) await access(join(root, file));
for (const file of await readdir(root)) if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', join(root, file)]);
console.log('Manifest, resources, permissions and JavaScript syntax OK.');
