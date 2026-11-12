// The skill installer, run as a program against a temporary --dest (never the real home folder).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.mjs';

const toolDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(toolDir, 'bin', 'install-skill.mjs');
const source = path.join(toolDir, 'skill', 'review-board');

function run(...args) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function files(dir, rel = '') {
  return fs
    .readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((e) => {
      const r = rel ? path.join(rel, e.name) : e.name;
      return e.isDirectory() ? files(dir, r) : [r];
    })
    .sort();
}
const skillFiles = () => files(source);
const fresh = () => path.join(tmpDir('rb-skill-'), 'review-board');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

test('a fresh install copies every file of the skill and writes tool-path.txt', () => {
  const dest = fresh();
  const r = run('--dest', dest);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(files(dest), [...skillFiles(), 'tool-path.txt'].sort());
  for (const f of skillFiles()) assert.equal(read(dest, f), read(source, f));
  assert.equal(read(dest, 'tool-path.txt'), toolDir + '\n');
});

test("an existing copy is overwritten, and files that are not the skill's own stay", () => {
  const dest = fresh();
  assert.equal(run('--dest', dest).code, 0);
  fs.writeFileSync(path.join(dest, 'SKILL.md'), '---\nname: review-board\n---\nold text\n');
  fs.writeFileSync(path.join(dest, 'my-notes.txt'), 'mine');
  fs.mkdirSync(path.join(dest, 'extras'));
  fs.writeFileSync(path.join(dest, 'extras', 'more.txt'), 'also mine');
  fs.writeFileSync(path.join(dest, 'tool-path.txt'), 'stale\n');
  const r = run('--dest', dest);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(dest, 'SKILL.md'), read(source, 'SKILL.md'));
  assert.equal(read(dest, 'my-notes.txt'), 'mine');
  assert.equal(read(dest, 'extras', 'more.txt'), 'also mine');
  assert.equal(read(dest, 'tool-path.txt'), toolDir + '\n');
});

test('an existing empty folder is a valid destination', () => {
  const dest = fresh();
  fs.mkdirSync(dest, { recursive: true });
  const r = run('--dest', dest);
  assert.equal(r.code, 0, r.err);
  assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')));
});

test('a folder that holds a different skill is refused and left as it was', () => {
  const dest = fresh();
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'SKILL.md'), '---\nname: something-else\n---\nnot ours\n');
  const r = run('--dest', dest);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /different skill/);
  assert.deepEqual(files(dest), ['SKILL.md']);
  assert.match(read(dest, 'SKILL.md'), /not ours/);
});

test('a non-empty folder without a copy of the skill is refused', () => {
  const dest = fresh();
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'holiday.txt'), 'photos');
  const r = run('--dest', dest);
  assert.notEqual(r.code, 0);
  assert.deepEqual(files(dest), ['holiday.txt']);
});

test('--dry-run says what would be done and writes nothing', () => {
  const dest = fresh();
  const r = run('--dest', dest, '--dry-run');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Dry run/);
  assert.match(r.out, /would write .*SKILL\.md/);
  assert.match(r.out, /would write .*tool-path\.txt/);
  assert.equal(fs.existsSync(dest), false);
  // onto an existing copy too: nothing changes
  assert.equal(run('--dest', dest).code, 0);
  fs.writeFileSync(path.join(dest, 'tool-path.txt'), 'kept\n');
  assert.equal(run('--dest', dest, '--dry-run').code, 0);
  assert.equal(read(dest, 'tool-path.txt'), 'kept\n');
});

test("tool-path.txt holds the tool's absolute folder and one newline", () => {
  const dest = fresh();
  run('--dest', dest);
  const text = read(dest, 'tool-path.txt');
  assert.equal(text, toolDir + '\n');
  assert.ok(path.isAbsolute(text.trim()));
  assert.ok(fs.existsSync(path.join(text.trim(), 'server.mjs')));
});

test('--dest=<folder> works; a missing value, an unknown option and the skill folder itself are refused', () => {
  const dest = fresh();
  assert.equal(run(`--dest=${dest}`).code, 0);
  assert.notEqual(run('--dest').code, 0);
  assert.notEqual(run('--nope').code, 0);
  assert.notEqual(run('--dest', source).code, 0);
});
