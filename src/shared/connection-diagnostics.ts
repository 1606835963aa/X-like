import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactDiagnostic } from './diagnostics';

const maximumSize = 1024 * 1024;
const prepared = new Set<string>();

function sanitizeExisting(filename: string) {
  if (!existsSync(filename)) return;
  const size = statSync(filename).size;
  const offset = Math.max(0, size - maximumSize);
  const buffer = Buffer.alloc(Math.min(size, maximumSize));
  const descriptor = openSync(filename, 'r');
  let length: number;
  try { length = readSync(descriptor, buffer, 0, buffer.length, offset); }
  finally { closeSync(descriptor); }
  let contents = buffer.subarray(0, length);
  if (offset) {
    const newline = contents.indexOf(10);
    contents = newline === -1 ? Buffer.alloc(0) : contents.subarray(newline + 1);
  }
  writeFileSync(filename, redactDiagnostic(contents.toString('utf8')), { mode: 0o600 });
  chmodSync(filename, 0o600);
}

export function writeConnectionDiagnostic(directory: string, message: string): string | null {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filename = join(directory, 'connection.log');
    const previous = join(directory, 'connection.previous.log');
    if (!prepared.has(filename)) {
      sanitizeExisting(filename);
      sanitizeExisting(previous);
      prepared.add(filename);
    }
    if (existsSync(filename) && statSync(filename).size >= maximumSize) renameSync(filename, previous);
    appendFileSync(filename, `${new Date().toISOString()} ${redactDiagnostic(message).slice(0, 20000)}\n`, { mode: 0o600 });
    return filename;
  } catch { return null; }
}
