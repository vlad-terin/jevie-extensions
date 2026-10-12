// GitHub trending repositories, ranked by how well they fit your project.
// github.com/trending has no API, so this reads the public page - once for
// all languages and once per language weighted - and scores each repo in code
// against terms, read on every run. No model call. The terms are, each over
// the last: terms.json beside this file (defaults), what the project folder
// set in "settings for github trending" says it is about (its package.json
// keywords, description and dependencies; Package.swift, pyproject.toml,
// Cargo.toml and go.mod for its languages), and ~/.jevie/trending-terms.json,
// the person's own, which never leaves their Mac. With none of them it is
// GitHub's trending list as it is.
//
// Left out before scoring, whatever they score: what the project already
// uses (terms.uses, and its package.json), what does something the project
// will not build on (terms.avoid: getting past bot detection), and - checked
// on GitHub's API for what is shown, kept a day - archived repos, repos with
// no licence, and repos not pushed to in terms.staleDays (90).
//
// "trending repos" is today's, "trending repos weekly" / "monthly" the
// longer windows; "trending repos all" also lists what scored below minScore.

import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const SINCE = { today: 'daily', daily: 'daily', week: 'weekly', weekly: 'weekly', month: 'monthly', monthly: 'monthly' };
const SINCE_SAID = { daily: 'today', weekly: 'this week', monthly: 'this month' };

const decode = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const text = html => decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const short = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n);
const count = s => Number(String(s).replace(/[^\d]/g, '')) || 0;

/// github.com/trending's page as repos.
export function parseTrending(html) {
  return String(html).split(/<article[^>]*class="[^"]*Box-row/).slice(1).map(block => {
    const name = block.match(/<h2[\s\S]*?<a[^>]*href="\/([^/"?#]+\/[^/"?#]+)"/)?.[1] ?? '';
    return {
      name,
      url: `https://github.com/${name}`,
      description: text(block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''),
      language: text(block.match(/itemprop="programmingLanguage"[^>]*>([^<]*)</)?.[1] ?? ''),
      stars: count(text(block.match(/\/stargazers"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '')),
      forks: count(text(block.match(/\/forks"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '')),
      gained: count(block.match(/([\d,]+)\s+stars?\s+(?:today|this week|this month)/)?.[1] ?? '')
    };
  }).filter(repo => /^[\w.-]+\/[\w.-]+$/.test(repo.name)).map((repo, place) => ({ ...repo, place }));
}

const words = s => ` ${String(s).toLowerCase().replace(/[-_/.]+/g, ' ').replace(/[^\p{L}\p{N}#+ ]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;

/// How well one repo fits: the terms found in its name and description, and its language.
export function score(repo, terms) {
  const haystack = words(`${repo.name} ${repo.description}`);
  const matched = Object.entries(terms.terms ?? {})
    .filter(([term, weight]) => weight && haystack.includes(words(term)))
    .map(([term, weight]) => ({ term, weight }));
  const language = Object.entries(terms.languages ?? {}).find(([name]) => name.toLowerCase() === repo.language.toLowerCase())?.[1] ?? 0;
  return { score: matched.reduce((sum, m) => sum + m.weight, 0) + language, matched: matched.filter(m => m.weight > 0).map(m => m.term) };
}

/// Whether the project already uses a repo: named in terms.uses, or its
/// name a dependency in the project's package.json ("@owner/name" or "name").
export function alreadyUsed(repo, uses = [], dependencies = []) {
  const name = repo.name.toLowerCase();
  const [owner, short] = name.split('/');
  if (uses.some(u => String(u).toLowerCase() === name)) return true;
  return dependencies.some(d => { d = d.toLowerCase(); return d === short || d === `@${owner}/${short}`; });
}

/// Whether a repo does what the project will not build on (terms.avoid).
export const avoided = (repo, avoid = []) => { const haystack = words(`${repo.name} ${repo.description}`); return avoid.find(term => haystack.includes(words(term))) ?? null; };

/// Why GitHub's own record leaves a repo out - archived, no licence, not
/// pushed to in `staleDays` - or null. Unknown (no answer) is kept.
export function unhealthy(info, { staleDays = 90, now = Date.now() } = {}) {
  if (!info) return null;
  if (info.archived) return 'archived';
  if (!info.license) return 'no licence';
  if (info.pushed && now - Date.parse(info.pushed) > staleDays * 864e5) return `no push since ${info.pushed.slice(0, 10)}`;
  return null;
}

/// GitHub's record of each repo (archived, licence, last push), kept a day.
async function health(names, state) {
  const kept = (await state?.get('health').catch(() => null)) ?? {};
  const fresh = name => kept[name] && Date.now() - kept[name].at < 864e5;
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  await Promise.all(names.filter(n => !fresh(n)).map(async name => {
    const r = await fetch(`https://api.github.com/repos/${name}`, { signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Jevie/1.0', ...(token ? { authorization: `Bearer ${token}` } : {}) } }).catch(() => null);
    if (!r?.ok) return;
    const d = await r.json().catch(() => null);
    if (d) kept[name] = { at: Date.now(), archived: !!d.archived, license: d.license?.spdx_id ?? null, pushed: d.pushed_at ?? null };
  }));
  await state?.set('health', Object.fromEntries(Object.entries(kept).filter(([, v]) => Date.now() - v.at < 3 * 864e5))).catch(() => {});
  return kept;
}

/// Repos from several pages, once each, best fit first; ties go to the one gaining more stars.
export function rank(lists, terms, { all = false } = {}) {
  const seen = new Map();
  for (const repo of lists.flat()) if (!seen.has(repo.name) || seen.get(repo.name).gained < repo.gained) seen.set(repo.name, { ...seen.get(repo.name), ...repo });
  // Where each stands on the main page (the first list read), when it is there.
  for (const repo of lists[0] ?? []) if (seen.has(repo.name)) seen.get(repo.name).main = repo.place;
  const floor = Number.isFinite(terms.minScore) ? terms.minScore : 1;
  return [...seen.values()].map(repo => ({ ...repo, ...score(repo, terms) }))
    .filter(repo => all || repo.score >= floor)
    // GitHub's own trending order: the main page's first (lists[0]), then
    // what only a language page has, by stars gained. The fit to the
    // project decides only what is shown, never the order.
    .sort((a, b) => (a.main ?? 1e9) - (b.main ?? 1e9) || b.gained - a.gained);
}

/// "weekly swift all" as the window, a language, and whether to keep poor fits.
export function askedFor(said, languages = []) {
  const list = String(said).toLowerCase().split(/\s+/).filter(Boolean);
  const since = SINCE[list.find(w => SINCE[w])] ?? 'daily';
  const language = languages.find(l => list.includes(l.toLowerCase())) ?? '';
  return { since, language, all: list.includes('all') };
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'into', 'over', 'what', 'when', 'where', 'which', 'tool', 'tools', 'app', 'apps', 'library', 'based', 'using', 'simple', 'fast', 'small', 'make', 'makes', 'more', 'than', 'like', 'just', 'also', 'their', 'them', 'they', 'you', 'are', 'was', 'its']);

/// What a project folder says it is about: terms from its package.json
/// (keywords 3, description words 1), its languages from the files it has (1),
/// and its dependencies as already used. Nothing found: null.
export async function projectTerms(folder) {
  if (!folder || !existsSync(folder)) return null;
  const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8').catch(() => 'null'));
  const terms = {}, languages = {};
  for (const k of pkg?.keywords ?? []) if (String(k).length > 1) terms[String(k).toLowerCase()] = 3;
  for (const w of String(pkg?.description ?? '').toLowerCase().match(/[a-z][a-z0-9+#-]{3,}/g) ?? []) if (!STOP.has(w) && !terms[w]) terms[w] = 1;
  if (pkg) languages[existsSync(join(folder, 'tsconfig.json')) ? 'TypeScript' : 'JavaScript'] = 1;
  for (const [file, language] of [['Package.swift', 'Swift'], ['pyproject.toml', 'Python'], ['requirements.txt', 'Python'], ['Cargo.toml', 'Rust'], ['go.mod', 'Go']]) if (existsSync(join(folder, file))) languages[language] = 1;
  const dependencies = Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.optionalDependencies });
  if (!Object.keys(terms).length && !Object.keys(languages).length) return null;
  // A keyword, or two of its words and its language: one word alone is chance.
  return { project: pkg?.name ?? basename(folder), terms, languages, dependencies, minScore: 3 };
}

/// The terms in force: defaults, the project's, the person's own - each over the last.
export function mergeTerms(...layers) {
  const out = { terms: {}, languages: {}, uses: [], avoid: [], dependencies: [] };
  for (const layer of layers.filter(Boolean)) {
    for (const key of ['project', 'minScore', 'staleDays']) if (layer[key] !== undefined) out[key] = layer[key];
    Object.assign(out.terms, layer.terms ?? {}); Object.assign(out.languages, layer.languages ?? {});
    for (const key of ['uses', 'avoid', 'dependencies']) out[key] = [...new Set([...out[key], ...(layer[key] ?? [])])];
  }
  return out;
}

const slug = language => encodeURIComponent(language.toLowerCase().replace(/\s+/g, '-'));

async function page(language, since, signal) {
  const response = await fetch(`https://github.com/trending${language ? `/${slug(language)}` : ''}?since=${since}`,
    { signal, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Jevie/1.0', accept: 'text/html' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseTrending(await response.text());
}

export default function githubTrendingRepos(jevie, context) {
  const { Cards, command } = jevie;
  const termsFile = join(context.directory, 'terms.json');
  const ownFile = join(homedir(), '.jevie', 'trending-terms.json');
  const folder = String(context.preferences?.folder ?? '').trim().replace(/^~(?=\/|$)/, homedir());
  jevie.registerSurface(command({
    names: ['trending repos', 'github trending', 'trending repositories'],
    what: 'GitHub trending repositories, ranked for your project when its folder is set',
    examples: ['trending repos', 'trending repos weekly', 'github trending swift'],
    reversible: true,   // it only reads
    async run(said) {
      let terms;
      let own = null;
      try {
        const defaults = JSON.parse(await readFile(termsFile, 'utf8'));
        own = existsSync(ownFile) ? JSON.parse(await readFile(ownFile, 'utf8')) : null;
        terms = mergeTerms(defaults, await projectTerms(folder), own);
      } catch (error) {
        return { status: 'needs-help', spoken: 'The terms could not be read.', lines: [{ title: 'The terms could not be read', subtitle: `${own === null && existsSync(ownFile) ? ownFile : termsFile} · ${error.message}`, says: `open ${existsSync(ownFile) ? ownFile : termsFile}` }] };
      }
      const languages = Object.keys(terms.languages ?? {});
      // Weights to rank by, from any layer; none: GitHub's list as it is.
      const ranked = Object.keys(terms.terms).length > 0;
      const { since, language, all } = askedFor(said, languages);
      const asked = language ? [language] : ['', ...languages.filter(l => terms.languages[l] > 0)];
      const signal = AbortSignal.timeout(10000);
      const pages = await Promise.allSettled(asked.map(l => page(l, since, signal)));
      const read = pages.filter(p => p.status === 'fulfilled').map(p => p.value);
      if (!read.length) {
        const reason = pages[0]?.reason?.message ?? 'no answer';
        return { status: 'needs-help', spoken: 'GitHub trending did not answer.', lines: [{ title: 'GitHub trending did not answer', subtitle: `${reason} · try again in a minute`, says: 'https://github.com/trending' }] };
      }
      // What the project already has, from its package.json.
      const dependencies = terms.dependencies ?? [];
      const left = [];
      let repos = rank(read, terms, { all }).filter(repo => {
        const why = alreadyUsed(repo, terms.uses, dependencies) ? 'already used' : avoided(repo, terms.avoid) ? `avoided: ${avoided(repo, terms.avoid)}` : null;
        if (why && !all) left.push({ name: repo.name, why });
        return all || !why;
      });
      // Archived, unlicensed or unkept repos are left out only when ranking for a
      // project (what it would build on); plain trending is GitHub's own list.
      const record = ranked ? await health(repos.slice(0, 30).map(r => r.name), context.state) : {};
      repos = repos.filter(repo => {
        const why = unhealthy(record[repo.name], { staleDays: terms.staleDays ?? 90 });
        if (why && !all) left.push({ name: repo.name, why });
        return all || !why;
      });
      // The README of the best twenty, for the pane beside the list: GitHub's
      // raw file at the default branch, a few seconds at most each.
      const readmes = await Promise.all(repos.slice(0, 20).map(repo => fetch(`https://raw.githubusercontent.com/${repo.name}/HEAD/README.md`, { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.text() : null).catch(() => null)));
      const preview = (repo, readme) => `# ${repo.name}\n\n${repo.description ?? ''}\n\n**${repo.language || '—'}** · ${repo.stars.toLocaleString('en-US')}★${repo.gained ? ` · +${repo.gained.toLocaleString('en-US')} ${window}` : ''} · fit ${repo.score}${repo.matched.length ? ` (${repo.matched.join(', ')})` : ''}\n\n${repo.url}\n\n---\n\n`
        + (readme ? readme.replace(/<img[^>]*>/gi, '').replace(/<\/?(?:p|div|a|picture|source|br|h\d)[^>]*>/gi, '').slice(0, 20000) : '_No README fetched._');
      const project = terms.project ?? null;
      const window = SINCE_SAID[since];
      // Cards, side by side: each repo's name, what it is, why it fits, and
      // its language and today's stars; a click opens it. Rows under them for
      // ⌘J ⌘K and voice (jevie.Cards).
      return Cards({
        label: 'Trending repo', icon: 'star',
        title: `GitHub trending ${window}${language ? ` · ${language}` : ''}${ranked ? ` · fit for ${project ?? 'your terms'}` : ''}`,
        spoken: !repos.length ? `Nothing trending ${window}${ranked ? ` fits ${project ?? 'your terms'}` : ''}.` : ranked ? `${repos.length} trending repos fit ${project ?? 'your terms'}; the best is ${repos[0].name}.` : `${repos.length} trending repos ${window}; the first is ${repos[0].name}.`,
        empty: read.flat().length ? `Nothing trending ${window} fits ${project ?? 'your terms'} - say "trending repos all" to see everything` : 'GitHub trending listed nothing - the page may have changed',
        // As GitHub lists them: owner / repo, what it is, then language,
        // stars and forks, and the stars gained at the row's end.
        items: [...repos.map(repo => ({
          title: repo.name.replace('/', ' / '),
          url: repo.url,
          note: repo.description || (repo.matched.length ? `fits: ${repo.matched.join(', ')}` : ''),
          tags: [repo.language, repo.gained ? `+${repo.gained.toLocaleString('en-US')}★ ${window}` : ''].filter(Boolean),
          preview: preview(repo, readmes[repos.indexOf(repo)] ?? null),
          subtitle: repo.description || '',
          accessory: [repo.language, `★ ${short(repo.stars)}`, `⑂ ${short(repo.forks ?? 0)}`, repo.gained ? `+${repo.gained.toLocaleString('en-US')} ${window === 'today' ? 'today' : window}` : ''].filter(Boolean).join('  ·  '),
          icon: 'star'
        })),
        // What was left out and why, last, so a surprise can be checked.
        ...(!ranked ? [{ title: 'Rank these for your project', subtitle: 'set its folder in "settings for github trending", or weights in ~/.jevie/trending-terms.json', says: 'settings for github-trending-repos', icon: 'slider.horizontal.3' }] : []),
        ...(left.length ? [{ title: `${left.length} left out`, subtitle: left.map(l => `${l.name} (${l.why})`).join(' · ').slice(0, 400), icon: 'eye.slash' }] : [])]
      });
    }
  }));
}
