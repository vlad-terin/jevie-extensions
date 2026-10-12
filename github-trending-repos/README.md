# GitHub Trending

GitHub's trending repositories (today, this week or this month), as cards
with each repository's README beside them. Name your project and the list is
ranked for it, without what it already uses.

## Say

- “trending repos”: today's
- “trending repos weekly”, “trending repos monthly”
- “github trending swift”: one language
- “trending repos all”: everything, including what was left out

## Ranked for your project

Set your project's folder with **settings for github trending**. Its
`package.json` keywords and description become the terms a repository is
scored by. Its language comes from the files it has (`tsconfig.json`,
`Package.swift`, `pyproject.toml`, `Cargo.toml`, `go.mod`). Its dependencies
are left out as already used. Archived repositories, ones with no licence, and
ones not pushed to in 90 days are left out too. "trending repos all" shows
them anyway.

For finer control, write `~/.jevie/trending-terms.json`. It wins over
everything and never leaves your Mac:

```json
{
  "project": "my app",
  "minScore": 5,
  "terms": { "browser automation": 6, "mcp": 6, "crypto": -3 },
  "languages": { "TypeScript": 2, "Swift": 2 },
  "uses": ["microsoft/playwright"],
  "avoid": ["captcha"],
  "staleDays": 90
}
```

A term matches whole words in a repository's name and description, with
hyphens, slashes and dots counted as spaces. A negative weight pushes a
subject down. With no terms at all, the list is GitHub's own.

The order is always GitHub's. The fit only decides what is shown.

## Reaches

github.com (the trending page), api.github.com (archived, licence, last push;
`GITHUB_TOKEN` is used when set), raw.githubusercontent.com (READMEs). It
changes nothing.
