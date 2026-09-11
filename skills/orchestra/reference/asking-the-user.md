# Asking the user

Read before you put a question to the user, and before you decide not to. It carries the framing
pass that decides whether a question is theirs at all, the one interruption that is allowed, and
the formats for decisions and hands-on checks.

## The framing pass, and the one interruption

The user's standing instruction, 2026-08-14 in planetCraft: **take the maximum of information at
framing, then decide alone — no more than one interruption per row during development.**

**At adoption, before any launch**, go through every row of the roadmap and produce its
**anticipated decision list**: each fork the row will plausibly hit, with your recommendation and
what each branch costs. All rows at once, one document, one sitting. Put them to the user together.
Write each answer onto its row as `decisions: [{q, answer, at}]`. **Those are binding and are never
re-asked** — a recorded answer that gets asked again is the failure this pass exists to prevent.

**Then one interruption per row, for the row's whole life**, and the measurements say what to spend
it on. In planetCraft, across one roadmap: thirteen merge approvals asked, thirteen granted, none
refused, zero defects caught. Three human looks at a page, three serious defects caught, every one
past a green suite. So:

- a row that ships **something a human looks at or uses** → its one interruption is the
  **hands-on gate**, unchanged;
- a row that ships nothing of the sort → **no interruption**: it lands once every configured gate
  is green (`gates`).

Everything else you decide yourself, from the recorded decisions, the roadmap and the project's own
rules, which reach a worker as `briefExtra`. **Every such decision is journalled as a `ruling`** —
the question, what you chose, why, and the precedent you leaned on:

```sh
orchestra journal ruling dev-loop/S3 "old cross-build curves: kept empty with their reason, per the framing answer on S3"
```

The rulings are visible in the checkpoint, in the journal, and on the page, whose rail carries a
`ruling` line like every other journalled line — so deciding alone stays visible to a later reader
and any of them can be broken.
**Exceeding the budget is not forbidden — it is recorded.** When you genuinely must ask a second
time, say in the same breath what framing failed to anticipate; that is the input that makes the
next framing pass better, and it is the only way this regime improves rather than drifts.

What this costs, stated plainly so nobody discovers it later: a wrong solo ruling now runs until the
next checkpoint instead of being stopped within the hour. The exposure is a fork framing did not
anticipate and no precedent covers — which is exactly what the `ruling` lines make visible.

## Before writing any question

**Before you put ANY question mid-development, three checks.** Was it already answered at framing —
`decisions[]` on the row (see The framing pass, and the one interruption)? Can you answer it
yourself from a recorded decision, the project's own rules (which reach a worker as `briefExtra`),
or a precedent already set on another row? Has this row already spent its one interruption? If any
of those lands, **rule and journal it instead of asking** (`kind: ruling`). The two most expensive
questions of the 2026-08-12/14 roadmap, in planetCraft, were both of this kind: releasing a file
hold owned by a branch abandoned two weeks earlier, which no rule ever created, waited 8 h 07; and
taking over four worktrees whose sessions were provably dead waited two hours forty-four before the
answer came back "yes, all four" in six minutes.

Every question is written once and lands in two places: the message you put in chat, and the `ask`
of its `pending[]` item. **The `ask` carries that whole body, word for word — never a summary of
it.** The page renders this body alongside the row’s title, opening links, images and answer buttons.
Keep the explanation complete; refer to those controls by their visible names instead of repeating
their URLs or the row’s technical metadata. Measured 2026-09-08 in duckJam,
where every ask was one dense sentence: of the twelve answers given from the page that day, two
were not answers at all — "Ta question n'a aucun sens, je ne comprends rien" and "pourquoi tu as
besoin de 2 personnes ?" — each costing a full round trip before the question could even be
understood, and one of the two had to be asked twice.

**Write it for someone who has never seen the code AND does not know the project's vocabulary.**
Keep implementation paths, function names and identifiers out of the explanation. For a CLI
test, give the actual working directory and command in the test instructions so it is runnable.
The second half is the one that fails. Every word a worker uses for a thing — the name of a model,
a mode, a stage, a score, a policy — is a word learnt inside the code, and on the page it means
nothing. Three tests, and a body failing any of them is rewritten before it is sent:

- **what you name is something the user can see or do**, never what the code calls it;
- **every number says what it counts and what would be good** — "scores 0.312 where the other
  scores 4.580" is two numbers and no question, "falls over on 31 tries out of 32" is a fact
  anyone can judge. A number that will not speak that way belongs in the footer;
- **the question itself is one sentence, ends in a question mark, and reads on its own.** If the
  user has to reconstruct what is being asked from the paragraph above it, it is not a question
  yet.

**And relaying is rewriting, never quoting.** A worker's sentence was written by the one person who
has been reading that code all day; passed through untouched, it carries their vocabulary straight
onto the page. That is where nearly every unreadable ask comes from.

That same duckJam question, before and after — the failure is not the length, it is that every
noun in it was learnt in the code:

> written: "Round 04: the published walker falls 31 times out of 32 and scores 0.312, where the
> recovery policy scores 4.580. The round is passable, but by a tool other than the season's. Is
> that the intended shape?"
> asked: "Nobody can finish round 04: the character players download falls over on 31 of its 32
> tries. A different character, one that is not part of the season, does finish it. Do we keep
> round 04 as it is, or make it beatable by the season's own character?"

## Choose the format that matches the user's action

A decision asks the user to choose an outcome. A hands-on check asks them to perform specific
steps and report what they observe; use the test format in `hands-on-gate.md`. Do not turn a test
into a vague “Do you validate?” or ask the user to design their own test.

Write plain text with short labelled sections in the user's language. The page displays text,
so markdown emphasis and markdown links appear literally. Use everyday names for visible things;
keep exact button/menu labels so the user can find them. Write one action per sentence.

For a decision, use this order:

> Situation: <what happens today, in one concrete sentence>
> Choice: <what each alternative changes for the user and its main tradeoff>
> Recommendation: <the option you recommend and why, in one sentence>
> Question: <one explicit choice, understandable on its own, ending in ?>
> Options: A) <concrete outcome> · B) <concrete outcome>

Offer only real alternatives; two are enough when there are two. Avoid “yes/no”, “validate”,
“continue” or “as planned” when those labels hide what the answer will authorize. Populate the
item's `options` with those same letters and texts: Monitor renders them as answer buttons.

Opening destinations belong in the row's `links[]`; a test server's port belongs in the pending
item's `port`. In the body, name the matching control: “Open the staging preview below”, then
say where to navigate inside it. Do not repeat those URLs in the question, options or footer.
For chat, put any necessary clickable destination outside the shared `ask` body. A command the
user must run belongs in the test instructions, with its working directory.

The technical footer is optional. Include only evidence needed for this question that Monitor
does not already show. Screenshot paths still belong there so Monitor can display the images:

> <sub>Pictures: <repo-relative screenshot paths></sub>

Before posting, read the body as the recipient: can they name the choice or first action, locate
the control, and know what answer to give without reading the worker's report? If not, rewrite it.
If the worker omitted a test step or expected result, obtain that evidence before asking the user;
do not fill the gap with guesses.

Relay the user's answer back to the worker verbatim, plus whatever context the worker needs.

### A question about a picture must carry the picture

You have no way to show the user an image and they have no way to open one you only describe, so a
question like "which of these two arms reads better?" is unanswerable unless the file itself is on
screen. **Name every screenshot the question is about by its repo-relative path, in the `<sub>`
footer** — `.orchestra/images/c1-altitude-branch.png`, `.orchestra/images/s1-dossier-home.png`. The
page reads those paths out of the ask, resolves them against the checkout, the worker's worktree
and `.orchestra/images/`, and draws each one as a thumbnail beside the question, one click from
full size. Nothing else is required of you: there is no field to fill and no upload.
`.orchestra/images/` is also the one directory `orchestra archive-images` sweeps.

The footer is where they belong precisely because the body stays free of paths — a path in the body
would break the plain-language rule above, and a path in the footer breaks nothing.

The same reading applies to a `note` and to a journal line, so a capture worth keeping is worth
naming in either. Ask a worker that reports a measurement from a frame to write the frame's path
where it says what it measured; a note that says "it looks wrong now" with no path is a claim the
user cannot check.
