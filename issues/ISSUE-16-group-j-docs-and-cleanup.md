# ISSUE-16: Group J docs + cleanup

## Parent

PRD-group-j-tycoon-formula.md

## What to build

Document Group J's shipped state now that both legs (ISSUE-13, ISSUE-15) and badge propagation (ISSUE-14) are live, then delete the throwaway search artifacts that produced the bottom2 leg's finalist formula.

Update `CLAUDE.md`'s Formula Groups section to add a Group J entry alongside A–I, noting both legs' ทดลอง status and the one-line reason for each (bottom2: failed holdout gate, train +0.0072 / validation +0.0167 / holdout −0.0021; pool6: ungateable by design per ADR-0003 at current sample size). Update `DEVELOPMENT_PLAN.md` to record Group J's shipped status, linking back to ADR-0003 and the finalist formula/numeric result (since the source notes file is being deleted, this becomes the permanent record). Add a standard `CHANGELOG.md` entry per existing project convention.

Delete `scripts/proto_group_j_bottom2_search.py` and `scripts/NOTES-group-j-bottom2-search.md` — both are throwaway per the prototype-skill convention, and their result is now permanently captured in `CLAUDE.md`/`DEVELOPMENT_PLAN.md`/`CHANGELOG.md` above (and in `PRD-group-j-tycoon-formula.md` itself).

## Acceptance criteria

- [ ] `CLAUDE.md` Formula Groups section lists Group J with both legs' ทดลอง status and reason
- [ ] `DEVELOPMENT_PLAN.md` records Group J as shipped, with the finalist formula and train/validation/holdout Edge numbers captured in prose
- [ ] `CHANGELOG.md` has a new entry for Group J following the existing entry format/convention
- [ ] `scripts/proto_group_j_bottom2_search.py` and `scripts/NOTES-group-j-bottom2-search.md` are deleted; no remaining file in the repo references them
- [ ] Manual check: `main.py` still imports cleanly and the app still starts (deleting the scripts doesn't touch any import path, but confirm regardless per project convention)

## Blocked by

- ISSUE-13, ISSUE-14, ISSUE-15 (needs the final shipped state — both legs live, badge propagation live — to document accurately)
