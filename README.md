# Ghost Wallet

An agent-controlled wallet that remembers your own trading mistakes and can
actually block a repeat and not just advise against it but explaining exactly
why in plain language, citing the specific memories the decision was based on.

Built for the [Sibyl Labs Hackathon](https://hack.sibyllabs.org) (Sep 1–10, 2026).

---

## The problem

Retail traders repeat the same categories of mistakes: chasing low-liquidity
tokens, blowing past their own stated risk limits, revenge-trading after a
loss because nothing in their tooling actually remembers *why* the last one
failed, and nothing has real power to stop a repeat.

DALBAR's 2025 report found retail investors correctly timed their entries and
exits only 25% of the time in 2024 (tying a record low), and have
underperformed the S&P 500 for 15 consecutive years running, not from bad
luck, but from repeated behavioral mispositioning. Behavioral finance
researchers have a name for part of why this keeps happening: *selective
memory* — people don't want to remember their own losses.

Ghost Wallet does.

## What it does

Ghost Wallet is a wallet the user configures with their own risk rules in
plain language ("never exceed 20% speculative exposure," "avoid low-liquidity
tokens"). As the user trades, Ghost Wallet records each outcome. what was
traded, the size, the result, and the lesson drawn from it. When the user
later proposes a new trade, Ghost Wallet checks it against both the standing
rules and the tagged history of past trades before allowing it to execute.
If the trade matches a pattern the user has lost money on before, or breaks
one of their own stated limits, Ghost Wallet blocks or resizes it — and can
explain exactly which remembered rule or past trade the decision is based on.

## Why this isn't for everyone (scope, stated honestly)

Ghost Wallet is built for *deliberate, mid-size portfolio/allocation decisions* not high-frequency or meme/snipe trading, where any friction is disqualifying. The deliberate friction of "wait, here's why I'm stopping you" is the product, not a limitation.

## How memory made this possible

Ghost Wallet stores two distinct kinds of structured memory in Sibyl Memory,
under two separate entity categories:

- **Risk rules** — a generic record type (`rule_type`, `applies_to`,
  `threshold`, `unit`, `notes`) so new kinds of limits can be added without changing the schema. E.g. `max_exposure_pct` on `speculative` at a threshold of `20`.
- **Trade lessons** — records of what actually happened on a past trade,
  including `category_tags` (e.g. `["meme", "low-liquidity"]`) so a *new*
  proposed trade can be matched against a past mistake by characteristics,
  not just by exact same token name.

**The deletion test:** if Sibyl Memory is removed, Ghost Wallet can no longer
distinguish a first-time trade from a repeat of a mistake the user has
already made. It has no basis to block or modify a transaction — it would
approve everything by default. Memory isn't a convenience layer here; it's
the authorization logic itself.

*(Once the decision engine is built, this section will link directly to the
code path where memory retrieval gates a transaction decision — this is
what judges will check first.)*

## Partner stack usage

### Base
*Not yet built.* Plan: a Base smart account / scoped session key that the
agent co-controls, so a block is enforced at the signing layer and can't be
bypassed by trading the same funds through a different interface. This
section will be filled in with the actual implementation once built —
intentionally left honest rather than described as finished.

### Virtuals / ACP
*Not yet built.* Plan: Ghost Wallet registers as a hireable risk-assessment
service. Other agents can send an ACP job asking "is this transaction safe
for this wallet, given its history?" and receive a judgment grounded in that
wallet's memory. This section will be filled in with a real example job
exchange once built.

## Demo

*Not yet recorded.* Will be added before submission — a 2–5 min video with
an unedited, continuous segment showing fresh-session cold-start recall, per
hackathon rules.

Demo beat, for reference while building:
1. Set rules → bad trade happens → memory records it
2. **Fresh session** → similar trade requested → blocked, "Why?" shows the
   exact remembered reasons
3. Modified/smaller version requested → approved → executed on Base
4. Separate agent requests Ghost's risk assessment via ACP → shown live
5. Deletion test → memory removed → same trade now goes through unopposed

## PMF evidence

*Not yet gathered.* Plan: seed data and validation drawn from the builder's
own real trading history, plus real outreach (not fabricated) before
submission. Per hackathon rules, fabricated PMF evidence is grounds for
disqualification, including after payout — nothing will be claimed here that
isn't publicly verifiable.

## Prior work declaration

This project's Sibyl Memory bridge pattern (a small Python helper script
called from a Node/TypeScript CLI via subprocess, since Sibyl Memory's
client library is Python-only) was first built and tested in a pre-hackathon
practice project called **Patrn** (a CLI for storing/recalling reusable code
snippets), built publicly on Twitter in the days before this hackathon's
build window opened. The bridge *pattern* is reused and adapted here; Ghost
Wallet's actual memory schema, decision logic, Base integration, and ACP
integration are new work built during the Sep 1–10 window.

Comparable existing products: *research not yet finalized — will only name
specific products here once verified to actually exist and confirmed to not
already do what Ghost Wallet does.*

## Tech stack

- TypeScript / Node.js (CLI and core logic)
- Python (`sibyl_memory_client`), called via subprocess bridge
- Sibyl Memory (structured entity storage)
- Base (smart account / session keys) — planned
- Virtuals Protocol (ACP) — planned
- Commander.js, chalk, cli-table3 (CLI interface)

## Setup

```bash
git clone https://github.com/draysongz/ghost-wallet.git
cd ghost-wallet
npm install
pip install sibyl-memory-client
npm run build
npm start
```

## License

MIT