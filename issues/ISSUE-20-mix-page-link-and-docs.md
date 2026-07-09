# ISSUE-20: ปุ่มเชื่อมจากหน้า Mix + เอกสารปิดงาน

## Parent

PRD-buy-plan-tab.md (governing ADR: docs/adr/0004-buy-plan-tab-dual-ev-and-honest-pnl.md)

## What to build

Connect the existing ไม่รู้ซื้ออะไรดี (Mix) page to the new จัดชุดซื้อ page, and close out the documentation for the whole Buy Plan arc.

**Mix link.** Add a "จัดชุดซื้อจากเลขชุดนี้ →" button on the Mix page that navigates to จัดชุดซื้อ in ลอตเตอรี่ใบ mode with Mix pre-selected/pre-filled as the source for the 6-digit list. The Mix page's own budget-cuts feature stays untouched (consolidating it is explicitly out of scope per the PRD). The pre-fill must survive the navigation (the target page loads its own data — the button conveys intent/source selection, not a data payload snapshot).

**Docs.** Update the project docs to reflect the finished feature, following the pattern ISSUE-16 set for Group J:

- CLAUDE.md: add จัดชุดซื้อ to the pages list (sidebar order), a short section describing the two modes, the two seams (`bpBuildPlan`/`bpResolvePlan`), the localStorage keys (plans + config), and pointers to ADR-0004
- DEVELOPMENT_PLAN.md: record the Buy Plan phase as shipped
- CHANGELOG.md: entry for the arc (ISSUE-17 → 20)
- Verify the CONTEXT.md glossary entries written during grilling (จัดชุดซื้อ, ชุดซื้อ, EV คู่, แก้เอง) still match what was actually built; amend if implementation drifted

## Acceptance criteria

- [ ] Mix page shows the button; clicking it lands on จัดชุดซื้อ in ลอตเตอรี่ใบ mode with Mix active as a source (verifiable in the rendered source labels)
- [ ] Mix page's budget-cuts feature is byte-for-byte untouched in behavior (no logic edits beyond adding the button)
- [ ] CLAUDE.md pages list and feature section updated; DEVELOPMENT_PLAN.md and CHANGELOG.md updated
- [ ] CONTEXT.md glossary entries verified against the shipped behavior
- [ ] `?v=` cache-bust bumped on touched static assets; full test suite stays green

## Blocked by

- ISSUE-19
