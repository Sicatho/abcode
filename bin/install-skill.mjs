#!/usr/bin/env node
// Installs the ABCode skill for an AI coding assistant: copies skill/abcode into the
// user's skills folder and writes tool-path.txt there, holding this tool's absolute folder.
// Plain Node 22, no dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolDir = path.resolve(here, '..');
const sourceDir = path.join(toolDir, 'skill', 'abcode');
const SKILL_NAME = 'abcode';
const OLD_SKILL_NAME = 'review-board';
const PATH_FILE = 'tool-path.txt';

const USAGE = `Usage: node bin/install-skill.mjs [--dest <folder>] [--dry-run]

Copies the ABCode skill into your assistant's skills folder and records where this tool is
(in ${PATH_FILE} beside SKILL.md), so the assistant can find the server and the wait command.

  --dest <folder>   where to install the skill
                    (default: ${path.join(os.homedir(), '.claude', 'skills', SKILL_NAME)})
  --dry-run         print what would be done, change nothing
  --help            this text

The skill's own files are overwritten. An older installer-managed review-board skill in the
same skills folder is removed so it cannot trigger alongside ABCode. A folder that holds a
different skill, or files and no copy of this skill, is left alone and the command stops.
`;

function parse(argv) {
  const opts = { dest: path.join(os.homedir(), '.claude', 'skills', SKILL_NAME), dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--dest') {
      const v = inline !== null ? inline : argv[++i];
      if (v === undefined || v === '') throw new Error('--dest needs a folder.');
      opts.dest = v;
    } else throw new Error(`Unknown option "${a}". Try --help.`);
  }
  opts.dest = path.resolve(opts.dest);
  return opts;
}

/** The `name:` in a SKILL.md's frontmatter, or null. */
function skillName(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {
    return null;
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const line = m[1].split(/\r?\n/).find((l) => /^name\s*:/.test(l));
  if (!line) return null;
  return line.replace(/^name\s*:\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** Every file under a folder, as paths relative to it, in a stable order. Links are refused. */
function listFiles(dir, rel = '') {
  const out = [];
  const entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isSymbolicLink()) throw new Error(`${path.join(dir, r)} is a link; the skill folder should hold plain files only.`);
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

function main() {
  let opts;
  try {
    opts = parse(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (skillName(path.join(sourceDir, 'SKILL.md')) !== SKILL_NAME) {
    console.error(`The skill to install is missing: expected ${path.join(sourceDir, 'SKILL.md')} with name "${SKILL_NAME}".`);
    return 1;
  }
  const inside = path.relative(sourceDir, opts.dest);
  if (!inside || (!inside.startsWith('..') && !path.isAbsolute(inside))) {
    console.error(`--dest must be outside the skill's own folder (${sourceDir}).`);
    return 1;
  }

  // Decide whether the destination may be written.
  let replacing = false;
  let stat = null;
  try {
    stat = fs.lstatSync(opts.dest);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Cannot look at ${opts.dest}: ${err.message}`);
      return 1;
    }
  }
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      console.error(`${opts.dest} exists and is not a folder. Nothing was changed. Choose another place with --dest.`);
      return 1;
    }
    let entries;
    try {
      entries = fs.readdirSync(opts.dest);
    } catch (err) {
      console.error(`Cannot look inside ${opts.dest}: ${err.message}`);
      return 1;
    }
    if (entries.length) {
      const name = skillName(path.join(opts.dest, 'SKILL.md'));
      if (name !== SKILL_NAME) {
        const other = name === null ? 'no SKILL.md with a name' : `a different skill (its SKILL.md is named "${name}")`;
        console.error(`${opts.dest} is not empty and holds ${other}. Nothing was changed. Choose another place with --dest.`);
        return 1;
      }
    }
    replacing = entries.length > 0;
  }

  const oldDir = path.join(path.dirname(opts.dest), OLD_SKILL_NAME);
  let removeOld = false;
  if (oldDir !== opts.dest) {
    try {
      const oldStat = fs.lstatSync(oldDir);
      if (oldStat.isDirectory() && skillName(path.join(oldDir, 'SKILL.md')) === OLD_SKILL_NAME) {
        const recordedPath = fs.readFileSync(path.join(oldDir, PATH_FILE), 'utf8').trim();
        removeOld = path.isAbsolute(recordedPath);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`Cannot inspect older skill in ${oldDir}: ${err.message}`);
        return 1;
      }
    }
  }

  let files;
  try {
    files = listFiles(sourceDir).filter((f) => f !== PATH_FILE);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  const verb = opts.dryRun ? 'would write' : 'wrote';
  if (opts.dryRun) console.log('Dry run: nothing is changed.');
  console.log(`Tool folder: ${toolDir}`);
  console.log(`${replacing ? 'Updating the skill in' : 'Installing the skill into'} ${opts.dest}${replacing ? ' (its own files are overwritten, nothing else is deleted)' : ''}`);

  try {
    for (const rel of files) {
      const to = path.join(opts.dest, rel);
      if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(sourceDir, rel), to);
      }
      console.log(`${verb} ${to}`);
    }
    const pathFile = path.join(opts.dest, PATH_FILE);
    if (!opts.dryRun) {
      fs.mkdirSync(opts.dest, { recursive: true });
      fs.writeFileSync(pathFile, toolDir + '\n', 'utf8');
    }
    console.log(`${verb} ${pathFile} (${toolDir})`);
    if (removeOld) {
      if (!opts.dryRun) fs.rmSync(oldDir, { recursive: true });
      console.log(`${opts.dryRun ? 'would remove' : 'removed'} older skill ${oldDir}`);
    }
  } catch (err) {
    console.error(`Installing failed: ${err.message}`);
    return 1;
  }

  if (!opts.dryRun) console.log(`Done. Start a new assistant session so that it sees the ${SKILL_NAME} skill.`);
  return 0;
}

process.exitCode = main();
