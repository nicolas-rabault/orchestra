// How far along a set of tasks is — one rule, three readers: the strip across the whole window, a
// roadmap's own frame, and the tests. Pure, and served to the browser like `layout.mjs`, because
// the page and the suite must count the same way.
//
// The words are the SCHEDULER's own, not new ones invented for a bar: `lib/register/ready.mjs`
// treats `claimed || review` as in flight and hands work only to `todo`.

// The board at a glance: how many tasks are being worked on right now and how many are queued
// behind them, which is the one question the canvas cannot answer without panning it.
//
// `total` is carried so no reader can imply that active + waiting + landed is everything: `dropped`,
// `built-held` and `paused` are in none of the three, and a summary that silently omits them would
// be read as a total. How many things are waiting on the USER is not here — that is one question
// per item, not per task, and `openQuestions` in answers.mjs already owns that rule for the corner
// list, the red pulse and the strip alike.
export function tally(nodes) {
  const counts = { active: 0, waiting: 0, landed: 0, total: nodes.length };
  for (const n of nodes) {
    if (n.status === 'claimed' || n.status === 'review') counts.active += 1;
    else if (n.status === 'todo') counts.waiting += 1;
    else if (n.status === 'landed') counts.landed += 1;
  }
  return counts;
}

// The same figures as widths, for a bar. Every task falls in exactly one band and the bands sum to
// the total: `other` is the remainder — `paused`, `dropped`, `built-held` — and it exists precisely
// because a bar drawn from the three named figures alone would show a roadmap as finished while a
// sixth of it sat in a state the bar never mentioned. That is the same failure `total` was added to
// the strip to prevent, and a bar states it far more loudly than a row of pills does.
//
// Ordered as it is read, left to right: ground gained, ground being taken, ground queued, the rest.
// A band nobody is in is dropped rather than drawn zero-wide, so the bar and any legend built from
// it name the same states.
export function segments(counts) {
  const other = Math.max(0, counts.total - counts.landed - counts.active - counts.waiting);
  if (counts.total <= 0) return [];
  return [
    { band: 'landed', n: counts.landed },
    { band: 'active', n: counts.active },
    { band: 'waiting', n: counts.waiting },
    { band: 'other', n: other },
  ].filter((s) => s.n > 0).map((s) => ({ ...s, frac: s.n / counts.total }));
}
