#!/usr/bin/env node
// UserPromptSubmit hook: hand an interactive conductor the answers the user typed on the
// monitoring page, without it having to ask.
//
// This hook is a convenience, not the channel — a tick fetches the same text with `orchestra
// inbox`, and must, because this hook is structurally unable to serve a session the page spawned:
// a session the page spawned fires its single UserPromptSubmit before it can record itself as the
// conductor, so the gate below is looking at the *previous* conductor's id and stays silent. Both
// this hook and `orchestra inbox` go through `relay` (`lib/register/relay.mjs`), so the two can
// never disagree about the same answer.
//
// This hook runs in EVERY session in a project that has opted in — every worker, the user's own —
// so its first duty is to say nothing. Three gates, cheapest first:
//   1. no config -> this project has not opted in, and the hook must have no behaviour at all;
//   2. no .orchestra/inbox.jsonl -> the monitoring page has never run, and the read costs nothing;
//   3. not the conductor -> a worker must never be told about another task's decisions.
//
// WHICH SESSION IS "THE CONDUCTOR" IS ASKED OF THE BEAT FIRST, AND OF THE REGISTER ONLY AFTER — the
// beat decides, and the register only answers when no beat is live. `conductor.inboxSeen` is a
// single shared watermark with no owner: whoever reads these answers is expected to stamp past
// them, and from that moment nobody else is ever told they existed. Measured 2026-08-12 in
// planetCraft — a second session stamped and five answers (a design ruling, a failed playtest, a
// merge approval, a launch ruling, a question) were never delivered to the conductor the user was
// actually talking to. The register alone was not enough to prevent it: it named a session that had
// already been dead for half an hour on 2026-08-13, while three more answers rotted behind it.
// The beat can, because it is written every two seconds by a loop that lives exactly as long as the
// session holding the baton, so when one is live it decides, and a session that is not it is shown
// nothing — which is what stops it consuming answers on the real conductor's behalf. With no live
// beat this falls back to the register, exactly as before, which is the state of any project whose
// conductor has not armed its watch yet.
//
// The comparison is a prefix: the register stores `conductor.session` as a SHORT id while this
// hook's payload carries the full session UUID, and the beat carries the full uuid too, so one
// prefix test covers both. Below eight characters it is not an identity at all — a truncated or
// garbled field would prefix-match an arbitrary session and hand a worker somebody else's
// decisions.
import { existsSync } from 'node:fs';
import { readPayload, projectFor } from '../lib/guards/payload.mjs';
import { inboxPath } from '../lib/register/inbox.mjs';
import { liveConductor } from '../lib/register/beat.mjs';
import { readState } from '../lib/register/state.mjs';
import { relay } from '../lib/register/relay.mjs';

const payload = readPayload();
if (!payload) process.exit(0);

const cfg = projectFor(payload.cwd ?? process.cwd());
if (!cfg) process.exit(0);

if (!existsSync(inboxPath(cfg.root))) process.exit(0);

// Below eight characters it is not an identity at all: see the header above.
const SHORT_ID_LEN = 8;
const holds = (id, session) => typeof id === 'string' && id.length >= SHORT_ID_LEN && session.startsWith(id);

const session = payload.session_id ?? '';
const beat = liveConductor(cfg.root);

let isConductor;
if (beat) {
  isConductor = holds(beat.session, session);
} else {
  // A register mid-rewrite, or one edited into something unparseable, must not crash a hook that
  // fires on every prompt — stay silent, the same way `relay` itself stays silent on this file.
  let state;
  try { state = readState(cfg.root); } catch { state = null; }
  isConductor = holds(state?.conductor?.session, session);
}
if (!isConductor) process.exit(0);

process.stdout.write(relay(cfg.root));
