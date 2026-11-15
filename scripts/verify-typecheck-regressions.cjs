#!/usr/bin/env node
/**
 * Compare the repository's current TypeScript diagnostics with the unchanged
 * master baseline. The older codebase has existing type errors, so a raw tsc
 * exit code does not identify whether Digit Analyzer introduced regressions.
 *
 * This check FAILS if any new path/code/message diagnostic appears. It does
 * not suppress or fix the existing errors: counts are printed explicitly.
 *
 * CI prerequisites: Node dependencies installed, origin/master fetched.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const project = process.cwd();
const baseline = fs.mkdtempSync(path.join(os.tmpdir(), 'digit-analyzer-ts-baseline-'));
const compiler = path.join(project, 'node_modules', '.bin', 'tsc');

const run = (command, args, cwd = project) => {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: process.env,
    });
    if (result.error) throw result.error;
    return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
};

const normalizedDiagnostics = (output, directory) =>
    output
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /error TS\d+:/.test(line))
        .map(line => {
            // Ignore line/column changes caused by inserting the new tab.
            // Replace worktree paths before comparing type error descriptions.
            return line
                .replaceAll(directory.replace(/\\/g, '/'), '<workspace>')
                .replace(/\(\d+,\d+\)(?=: error TS\d+:)/, '');
        })
        .sort();

const getAdded = (current, old) => {
    const previousCounts = new Map();
    for (const item of old) previousCounts.set(item, (previousCounts.get(item) || 0) + 1);
    return current.filter(item => {
        const remaining = previousCounts.get(item) || 0;
        if (remaining === 0) return true;
        previousCounts.set(item, remaining - 1);
        return false;
    });
};

try {
    if (!fs.existsSync(compiler)) throw new Error('Install npm dependencies before running type-check comparison.');

    const master = run('git', ['rev-parse', '--verify', 'origin/master']);
    if (master.code !== 0) throw new Error('origin/master not available. Checkout with fetch-depth: 0.');
    const checkout = run('git', ['worktree', 'add', '--detach', '--quiet', baseline, 'origin/master']);
    if (checkout.code !== 0) throw new Error(`Unable to create master baseline: ${checkout.stderr}`);

    fs.symlinkSync(path.join(project, 'node_modules'), path.join(baseline, 'node_modules'), 'dir');

    const currentRun = run(compiler, ['--noEmit', '--pretty', 'false'], project);
    const baselineRun = run(compiler, ['--noEmit', '--pretty', 'false'], baseline);

    const current = normalizedDiagnostics(currentRun.stdout + currentRun.stderr, project);
    const old = normalizedDiagnostics(baselineRun.stdout + baselineRun.stderr, baseline);
    const added = getAdded(current, old);

    console.log(`TypeScript master baseline: ${old.length} diagnostics (exit ${baselineRun.code}).`);
    console.log(`TypeScript feature branch: ${current.length} diagnostics (exit ${currentRun.code}).`);
    console.log(`New diagnostics relative to master: ${added.length}.`);

    if (added.length > 0) {
        for (const error of added.slice(0, 60)) console.error(`NEW: ${error}`);
        process.exitCode = 1;
    } else if (currentRun.code !== 0 && old.length > 0) {
        console.log('No new TypeScript errors. The repository-wide baseline remains to be fixed separately.');
    } else if (currentRun.code !== 0) {
        console.error(currentRun.stderr || currentRun.stdout);
        process.exitCode = 1;
    }
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    // Remove the ephemeral baseline worktree even when diagnostics differ.
    run('git', ['worktree', 'remove', '--force', baseline]);
    try { fs.rmSync(baseline, { recursive: true, force: true }); } catch { /* already cleaned */ }
}
