import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist/analyzers/python', { recursive: true });
await copyFile('src/analyzers/python/parse_fastapi.py', 'dist/analyzers/python/parse_fastapi.py');
