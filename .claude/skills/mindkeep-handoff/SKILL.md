---
name: mindkeep-handoff
description: Read and maintain .claude/HANDOFF.md, Mindkeep's cross-session continuity log. Use at the start of a Mindkeep session to get up to speed on where things stand, and at the end of one (after real, committed work) to record what happened so the next session can resume cold. NOT for routine commit messages, code comments, or one-off exploratory questions that don't change project state.
---

# Maintaining .claude/HANDOFF.md

`.claude/HANDOFF.md` is a hand-maintained, append-only continuity log
for this project, written across many separate chat sessions. It exists
because each new session starts with zero memory of prior ones — this
file is how "continue where we left off" actually works here. Treat it
as more authoritative than your own assumptions, but less authoritative
than the actual repo state (`git log`, current code) when the two
disagree — the file can go stale if a session forgot to update it.

## Reading it (start of session)

If the user references past Mindkeep work, asks to continue, or you're
about to touch a view/feature that plausibly has history, read the file
— at minimum the top "## Leggi prima questo: stato al DD/MM/YYYY, fine
sessione" section, which is a deliberately short resume-here summary
(branch, last pushed commit, an ordered "what to check before adding
anything else" list). The sections below it (`## Sessione DD/MM/YYYY:
titolo`, oldest first) are historical detail — read the recent ones
when the top summary points at something you need more context on;
don't assume you need to read the whole file for every task.

Cross-check anything load-bearing (a claimed function name, a "not yet
confirmed by the user" flag, a pending Pi deployment) against current
git log / code before acting on it — the guidance the file itself
follows for memory applies here too: a note that something exists is a
claim about *when it was written*, not proof it's still true.

## Writing it (end of session)

Update HANDOFF.md when you shipped and committed something a future
session would need context on — not for every message, not for
read-only investigation. Two edits, always together:

1. **Append a new section**, right before `## Prossimi passi`, titled
   `## Sessione DD/MM/YYYY: <breve titolo>` (add "(seconda parte)" etc.
   if there's already one for that date). Cover, in Italian, matching
   the existing terse-but-technical tone: what the user reported/asked,
   what you found (with file:line or function names, not just
   descriptions), what you changed and why, how you verified it (real
   test run, `npm test` count, or "not yet confirmed live" if you
   couldn't), and anything left open.
2. **Rewrite the top "Leggi prima questo" block**: bump the date, update
   the last-pushed-commit hash, and update the numbered "before adding
   anything else" list — add new open items, and only remove an item
   once its own text says it was resolved (don't silently drop
   something just because a session ended without addressing it).

Never delete or rewrite an old `## Sessione ...` section — it's a log,
not a summary; historical entries stay even after superseded.

Commit this as **its own commit**, separate from the feature/fix commit
it describes, with a message in the existing style: `Aggiorna HANDOFF:
<short reason>` (see `git log -- .claude/HANDOFF.md` for more
examples). Push it — this project's standing instruction is to commit
and push without asking once work is already approved.

If `.claude/HANDOFF.md` doesn't exist, don't create one from this
template on your own initiative — ask first. This convention was
established by the user for this specific project; inventing an
equivalent unprompted elsewhere would be scope creep.
