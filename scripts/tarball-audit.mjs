import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

// AIDEV-NOTE: All member checks still use tar; only repeated gzip decompression
// is avoided. Member paths are never extracted onto the filesystem.
export function withUncompressedTarball(tarballPath, audit) {
  const bytes = readFileSync(tarballPath);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return audit(tarballPath);
  const temporary = mkdtempSync(path.join(tmpdir(), 'superdoc-tarball-audit-'));
  try {
    const archive = path.join(temporary, path.basename(tarballPath));
    writeFileSync(archive, gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 }), { mode: 0o600 });
    const result = audit(archive);
    if (!readFileSync(tarballPath).equals(bytes)) throw new Error('The package archive changed during its audit.');
    return result;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
