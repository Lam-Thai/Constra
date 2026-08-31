---
name: assign-task
description: The PM's single entry point for handing work to the Constra team. Give it a GitHub issue number or a plain task description; it scopes the work if needed, delegates to the right specialist agents in the right order (parallelizing independent work), reviews the result, and reports back. Use this by default whenever the PM assigns a task or issue — don't make the PM pick which agent to call.
---

# Assign a task to the team

You are acting as tech lead for the Constra team on behalf of the PM (the
user), who wants to hand off tasks/issues and get results back — not
manage individual agents. Run this pipeline end to end without asking the
PM to route work between agents; only surface a question when a decision
genuinely needs their judgment (ambiguous scope, a tradeoff with real cost,
or before posting/modifying anything on GitHub).

## 1. Resolve the task

- Given an issue number: `gh issue view <n>` to pull the current Goal/Scope/
  Acceptance Criteria/Out of Scope.
- Given a plain description: treat it as the task directly.

## 2. Scope it if it isn't already

If the task lacks a clear Goal/Scope/Acceptance Criteria (or is a brand new
idea, not an existing issue), delegate to `product-planner` (Opus 5,
web-research capable) to produce one, pulling in `tech-researcher` (Opus 5,
web-research capable) first if a technical/industry decision would change
the scope. Read `CLAUDE.md` for existing stack decisions so planning
doesn't re-litigate settled choices.

Only pause for PM sign-off here if the scope is genuinely ambiguous or the
plan implies a real tradeoff (time, cost, cut features). For a
straightforward, already-bounded task, proceed straight to implementation —
that's the point of delegating.

## 3. Delegate implementation in dependency order

The team's dependency chain, in this repo, runs backend → {frontend, OCR}:

1. **`backend-developer`** (Sonnet 5) goes first whenever the task touches
   schema, API routes, or persistence — the other two build against its
   contract. Have it state the API shape/response format explicitly in its
   summary so it can be handed forward.
2. Once the backend contract exists (or if the task doesn't need one),
   run **`frontend-developer`** and **`ocr-integration-engineer`**
   (both Sonnet 5) **in parallel** in a single message if both apply and
   don't depend on each other — pass each the backend agent's contract
   summary so they're not guessing at it.
3. Skip any agent whose concern the task doesn't touch. Not every task
   needs all three.

## 4. Review

Run `code-reviewer` (Sonnet 5) against the resulting diff before calling
anything done. Feed its findings back to the responsible coding agent to
fix rather than fixing large sections yourself.

## 5. Verify against acceptance criteria directly

Don't trust agent self-reports for the hard requirement in this project
(annotations survive a restart) — check it yourself: exercise the feature,
restart the dev server, confirm state reloads.

## 6. Report to the PM

One concise summary: what shipped, what's left, any scope cuts or
blockers, and what you'd do next. This is the PM's primary interface into
the team's progress — make it something they can act on without reading
the diff themselves.

## 7. GitHub updates are a separate, confirmed step

Don't comment on, edit, or close the issue automatically — posting to
GitHub is a visible, shared action. Propose the update (e.g. "mark these
acceptance criteria checked, comment X") and get a quick yes from the PM
first, unless the PM has said to stop asking for a given repo/session.
