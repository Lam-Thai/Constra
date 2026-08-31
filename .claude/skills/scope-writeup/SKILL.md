---
name: scope-writeup
description: How to turn a rough task into a Goal/Scope/Acceptance Criteria/Out of Scope writeup, and how to file or update it as a GitHub issue safely. Use whenever scoping new or ambiguous work for Constra (product-planner's core skill).
---

# Scope writeup for Constra

## Structure

Match the format already used on this repo's tracking issues:

```markdown
## Goal
One or two sentences: the outcome and why it matters. Not a feature list.

## Scope
Concrete bullets — specific enough that a coding agent isn't guessing.
Name the actual pieces (schema change, API route, UI component), not
vague verbs like "improve X".

## Acceptance Criteria
- [ ] Testable, observable outcomes — not implementation details.
      Someone who didn't write the code should be able to check each box.

## Out of Scope
Bullets naming things adjacent to this work that are explicitly NOT being
done, so nobody gold-plates the task or a reviewer doesn't wonder why
something obvious is missing.
```

## Keep scope tight

This project's origin is a strict one-hour take-home. That constraint
should shape every plan you write, even for follow-on work: prefer the
smallest change that satisfies the acceptance criteria over the most
complete one. If you cut something to keep scope tight, say so explicitly
in "Out of Scope" or a trailing "Notes" section — don't just omit it
silently.

## Research before locking scope, when it matters

If a scoping decision hinges on something outside this repo — "what's the
sane data model for versioned annotations," "how do comparable tools
handle multipage navigation" — pull in `tech-researcher` rather than
guessing. Don't research reflexively for every task; only when the answer
would actually change the Scope or Acceptance Criteria.

## Filing or updating a GitHub issue

```bash
gh issue create --repo <owner>/<repo> --title "<title>" --body-file <path>
gh issue edit <number> --repo <owner>/<repo> --body-file <path>
gh issue comment <number> --repo <owner>/<repo> --body "<update>"
```

Write the body to a file in the scratchpad directory first — don't inline
a multi-line `--body` string in the shell command. Posting to GitHub is a
visible, shared action: show the exact title/body to the PM and get a
clear go-ahead before running the `gh` command, for both new issues and
edits to existing ones. This applies even inside an automated pipeline
(e.g. `assign-task`) — scoping can run autonomously, but publishing it
externally is always a confirmed step.
