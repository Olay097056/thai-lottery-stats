# AGENTS.md

See [CLAUDE.md](CLAUDE.md) — single source of truth for architecture, files, and conventions.

## Git

- **This repo is PUBLIC on GitHub** (`origin` → `github.com/Olay097056/thai-lottery-stats`). Anything pushed is visible to the world immediately.
- **Never `git push` unless the human explicitly asks for it in that message.** Committing locally is fine and expected; publishing is a separate decision that is always theirs.
- **Never `git add -A` / `git add .` blindly.** Stage named paths, and run `git status` first if a bulk add seems unavoidable.
- Do not commit `.env`, API keys, `.superpowers/`, `.scratch/`, or `.ml_cache/`. `lottery_cache.csv` stays ignored — it is regenerable scraped data.
- Commit author identity comes from global git config (`NW <olay097056@gmail.com>`). Do not override it per-repo or per-commit.
- Do not rewrite history that already exists on `origin/main`.

## Statistical integrity — the point of this project

- **Never spend the holdout.** The newest tail of draw history is evaluated exactly once, to decide a Promotion Gate. Do not peek at it during formula search, do not re-run a formula against it to get a better number.
- **Never re-tune a formula until its Edge looks good.** A formula that fails its gate ships under ทดลอง with its real numbers on display. That is the designed outcome, not a bug to fix.
- **Edge is baseline-adjusted.** Never report a raw hit rate as if it were an edge, and never compare formulas across different field types on raw hit rate.
- If a result is within noise, say so. n=2 is not evidence.

## Docs

- `README.md` and `README.th.md` are kept in sync. Updating one means updating the other.
