import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
export const runtime = path.join(root, '.local-runtime');
