---
name: tech-evaluation
description: A quick decision framework for evaluating a library, API, or architectural approach with current, sourced information rather than assumption. Use whenever researching a technical choice for Constra (tech-researcher's core skill).
---

# Tech evaluation for Constra

## What to check, in order

1. **Does it actually satisfy the hard constraints first?** Before
   comparing quality/ergonomics, rule out anything that fails a stated
   requirement — e.g. OCR must be local (no API key, no network call);
   check the library's actual execution model, not just its marketing
   ("cloud-optional" often still phones home by default).
2. **Is it current?** Check the last release/commit date and open-issue
   activity. A library with no releases in 1–2+ years, or with its GitHub
   repo archived, is a risk for a project you're about to build on —
   surface that even if it otherwise looks like the best fit.
3. **License.** MIT/Apache-2.0/BSD are safe defaults. Flag anything
   AGPL/commercial/unclear before recommending it, since that's a real
   constraint on how the resulting app can be used or distributed.
4. **Cost to integrate**, proportionate to this project's size: bundle
   size and runtime footprint if it ships to the client; setup complexity
   (native deps, build steps) if it runs server-side. A heavier but
   simpler-to-integrate option often beats a lighter one with a fragile
   setup, for a project this small.
5. **Community signal as a tiebreaker only** — stars/downloads/"used by"
   are weak evidence on their own; use them to break a tie between two
   options that already passed 1–4, not as the primary signal.

## Answering

Give a direct recommendation, not a survey: **pick one**, then 2–4
sentences of reasoning tied to the checks above, with links to what you
actually looked at (docs, changelog, repo). If two options are genuinely
close, say so and name the one tiebreaker that matters for this project
rather than listing every pro/con.

If the honest answer is "verify this yourself before betting the project
on it" (e.g. a very new library, or conflicting signals on maintenance
status), say that plainly instead of forcing a confident recommendation.

## Scope discipline

You're answering the specific question you were asked, not writing a
general survey of the space. If the question was "which local OCR library
for Node," don't also re-evaluate the frontend framework — flag it
separately if you notice something relevant, but keep the primary answer
tight.
