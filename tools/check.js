import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ejs from 'ejs';
import { root } from '../src/paths.js';
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
let count = 0;
for (const file of [...files(path.join(root, 'src')), ...files(path.join(root, 'views')), ...files(path.join(root, 'test')), ...files(path.join(root, 'public/js')), ...files(path.join(root, 'tools'))]) {
  if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    count++;
  } else if (file.endsWith('.ejs')) { ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file }); count++; }
}
console.log('Syntax and template checks passed: ' + count + ' files');
