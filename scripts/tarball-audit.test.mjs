import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { withUncompressedTarball } from './tarball-audit.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tarball-audit-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'package'));
  writeFileSync(path.join(root, 'package', 'value.bin'), Buffer.from([0, 255, 17, 128]));
  writeFileSync(path.join(root, 'package', 'value.js'), 'export const value = 42;');
  const archive = path.join(root, 'package.tgz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'package']);
  return { archive, root };
}

test('all members and binary contents match the original compressed archive', (t) => {
  const { archive } = fixture(t);
  const original = readFileSync(archive);
  const list = (file) => execFileSync('tar', ['-tf', file]);
  const read = (file, entry) => execFileSync('tar', ['-xOf', file, entry]);
  let temporary;
  const result = withUncompressedTarball(archive, (file) => {
    temporary = file;
    assert.notDeepEqual(readFileSync(file).subarray(0, 2), original.subarray(0, 2));
    assert.deepEqual(list(file), list(archive));
    for (const entry of ['package/value.bin', 'package/value.js']) {
      assert.deepEqual(read(file, entry), read(archive, entry));
    }
    return { ok: true };
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(readFileSync(archive), original);
  assert.equal(existsSync(temporary), false);
});

test('an audit failure is preserved and its temporary archive is removed', (t) => {
  const { archive } = fixture(t);
  let temporary;
  const failure = new Error('artifact rejected');
  assert.throws(() => withUncompressedTarball(archive, (file) => {
    temporary = file;
    throw failure;
  }), (error) => error === failure);
  assert.equal(existsSync(temporary), false);
  assert.equal(existsSync(archive), true);
});

test('corrupt gzip fails before invoking the artifact audit', (t) => {
  const { archive } = fixture(t);
  writeFileSync(archive, gzipSync('invalid').subarray(0, 12));
  let called = false;
  assert.throws(() => withUncompressedTarball(archive, () => { called = true; }));
  assert.equal(called, false);
});

test('an original archive changed during validation cannot inherit the snapshot verdict', (t) => {
  const { archive } = fixture(t);
  let temporary;
  assert.throws(() => withUncompressedTarball(archive, (file) => {
    temporary = file;
    writeFileSync(archive, gzipSync('different archive'));
    return { ok: true };
  }), /changed during its audit/);
  assert.equal(existsSync(temporary), false);
});

test('uncompressed input keeps the existing tar parser path', (t) => {
  const { archive, root } = fixture(t);
  const plain = path.join(root, 'package.tar');
  execFileSync('tar', ['-cf', plain, '-C', root, 'package']);
  withUncompressedTarball(plain, (file) => assert.equal(file, plain));
  assert.equal(existsSync(plain), true);
  assert.equal(existsSync(archive), true);
});
