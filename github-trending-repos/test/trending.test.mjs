// Offline: a saved github.com/trending page, parsed and ranked against terms.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTrending, score, rank, askedFor } from '../index.mjs';

const html = await readFile(new URL('./fixtures/trending.html', import.meta.url), 'utf8');
const terms = JSON.parse(await readFile(new URL('./fixtures/terms.json', import.meta.url), 'utf8'));

test('parses each row of the trending page', () => {
  const repos = parseTrending(html);
  assert.equal(repos.length, 3);
  assert.deepEqual(repos[0], {
    name: 'browser-use/browser-use',
    place: 0,
    forks: 8312,
    url: 'https://github.com/browser-use/browser-use',
    description: 'Make websites accessible for AI agents. Automate tasks online with ease & an MCP server.',
    language: 'Python',
    stars: 71204,
    gained: 2941
  });
  assert.equal(repos[1].description, 'A crypto trading bot 🚀');
  assert.equal(repos[2].language, 'Swift');
});

test('scores by whole terms, hyphens as spaces, and language', () => {
  const [browserUse, coinBot, raycast] = parseTrending(html);
  const fit = score(browserUse, terms);
  assert.ok(fit.matched.includes('browser use'));
  assert.ok(fit.matched.includes('mcp'));
  assert.ok(score(coinBot, terms).score < 0);
  assert.ok(score(raycast, terms).matched.includes('raycast'));
  assert.deepEqual(score({ name: 'a/b', description: 'macintosh', language: '' }, { terms: { mac: 1 } }).matched, []);
});

test('ranks best fit first, drops poor fits unless all', () => {
  const repos = parseTrending(html);
  const ranked = rank([repos, repos.slice(2)], terms);
  assert.deepEqual(ranked.map(r => r.name), ['browser-use/browser-use', 'raycast/script-commands']);
  assert.equal(rank([repos], terms, { all: true }).length, 3);
  assert.equal(rank([], terms).length, 0);
});

test('reads the window, a language and all from the words', () => {
  assert.deepEqual(askedFor('', ['Swift']), { since: 'daily', language: '', all: false });
  assert.deepEqual(askedFor('weekly swift all', ['Swift']), { since: 'weekly', language: 'Swift', all: true });
  assert.deepEqual(askedFor('this month', []), { since: 'monthly', language: '', all: false });
});

import { alreadyUsed, avoided, unhealthy } from '../index.mjs';

test('what the project already uses, avoids, or GitHub shows as unkept is left out', () => {
  assert.ok(alreadyUsed({ name: 'anthropics/claude-code' }, ['anthropics/claude-code']));
  assert.ok(alreadyUsed({ name: 'microsoft/playwright' }, [], ['playwright']));
  assert.ok(!alreadyUsed({ name: 'modelcontextprotocol/python-sdk' }, [], ['@modelcontextprotocol/sdk']), 'not by a shared word');
  assert.ok(!alreadyUsed({ name: 'ChromeDevTools/chrome-devtools-mcp' }, [], ['playwright']));
  assert.equal(avoided({ name: 'jo-inc/camofox-browser', description: 'Stealth headless browser for AI agents' }, ['stealth']), 'stealth');
  const now = Date.parse('2026-10-03');
  assert.equal(unhealthy({ license: null, pushed: '2026-09-30' }, { now }), 'no licence');
  assert.match(unhealthy({ license: 'MIT', pushed: '2026-01-23T00:00:00Z' }, { now }), /no push since 2026-01-23/);
  assert.equal(unhealthy({ license: 'NOASSERTION', pushed: '2026-10-01' }, { now }), null, 'a licence GitHub cannot name is still one');
  assert.equal(unhealthy(null), null, 'unknown is kept');
});

import { projectTerms, mergeTerms } from '../index.mjs';
import { mkdtemp, writeFile as write } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a project folder says what it is about; the person\'s own terms win', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trending-'));
  await write(join(dir, 'package.json'), JSON.stringify({ name: 'kite', description: 'A terminal launcher for the web', keywords: ['launcher', 'cli'], dependencies: { zod: '3.0.0' } }));
  await write(join(dir, 'tsconfig.json'), '{}');
  const found = await projectTerms(dir);
  assert.equal(found.project, 'kite');
  assert.equal(found.terms.launcher, 3);
  assert.equal(found.terms.terminal, 1);
  assert.equal(found.terms.the, undefined);
  assert.equal(found.languages.TypeScript, 1);
  assert.deepEqual(found.dependencies, ['zod']);
  assert.equal(await projectTerms(''), null);
  const merged = mergeTerms({ minScore: 0, avoid: ['stealth'] }, found, { minScore: 5, terms: { launcher: 9 }, avoid: ['captcha'] });
  assert.equal(merged.minScore, 5);
  assert.equal(merged.terms.launcher, 9);
  assert.equal(merged.terms.terminal, 1);
  assert.deepEqual(merged.avoid, ['stealth', 'captcha']);
});
