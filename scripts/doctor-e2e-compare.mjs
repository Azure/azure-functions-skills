#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateDoctorExpectation } from '../lib/doctor/e2e-summary.js';

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function parseArgs(argv) {
  const args = { deep: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--deep') args.deep = true;
    else if (arg === '--expectations') args.expectations = argv[++index];
    else if (arg === '--fixture') args.fixture = argv[++index];
    else if (arg === '--report') args.report = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.expectations || !args.fixture || !args.report) {
  throw new Error('Usage: doctor-e2e-compare.mjs --expectations <path> --fixture <name> --report <path> [--deep]');
}

const expectations = readJson(args.expectations);
const report = readJson(args.report);
const result = evaluateDoctorExpectation(expectations[args.fixture], report, args.deep);
process.stdout.write(JSON.stringify(result));
