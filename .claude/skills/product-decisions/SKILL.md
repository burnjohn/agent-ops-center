---
name: product-decisions
description: "Write, use and maintain Product Decision Records (PDR) in docs/decisions/product/ within Spec-Driven Development. Use when a product choice is made or debated (target user, problem, scope, MVP cut, what is out of scope, UX principle, pricing, metric of success), when writing a spec that needs such a choice, when a product decision changes, or when checking a spec against recorded decisions. Triggers: \"PDR\", \"product decision\", \"record this product decision\", \"who is this for\", \"is X in scope\", \"MVP\", \"out of scope\", \"продуктове рішення\", \"запиши рішення\", \"чи входить це в скоуп\"."
---

# Product Decisions

A PDR records one product decision that constrains future specs: who we build for, what problem we
solve, what is in or out of scope, which principle wins in a trade-off. ADRs
(`docs/decisions/architecture/`, skill `architecture-decisions`) answer *how we build*; PDRs answer
*what we build and why*. Specs (`docs/specs/`) are written within both.

## Is this a PDR?

Write a PDR only if at least one holds:
1. It defines the audience, the problem, or the success metric.
2. It puts something in or explicitly out of scope (MVP cut, "we will not do X").
3. It sets a UX or product principle that resolves future trade-offs ("local-first over collaboration").
4. Reversing it would change several specs or the roadmap.
5. Agents or people keep re-deciding it differently.

Not a PDR: copy text, a single screen's layout, an acceptance criterion of one feature — those go
into the spec.

## Setup

```
docs/decisions/product/
  README.md            # index: one line per PDR
  _template.md
  0001-<decision-slug>.md
```

## Template

```markdown
---
status: proposed            # proposed | accepted | rejected | deprecated | superseded
date: YYYY-MM-DD
decision-makers: []
affects: []                 # specs or areas, e.g. ["docs/specs/board.md", "onboarding"]
supersedes: []
superseded-by: []
---

# PDR-NNNN: <Decision as a short statement>

## Context
<User problem, evidence (interviews, data, constraints), what forces the choice now.>

## Considered Options
- <Option A>
- <Option B>

## Decision
Chosen option: "<Option A>", because <reason tied to the context>.

### Consequences
- Good, because <...>
- Bad, because <...>  <!-- what we give up, who is not served -->

### Guardrails
- RULE: <checkable statement a spec must satisfy, e.g. "No spec adds multi-tenant features before PDR-0005 is superseded">
```

## Writing rules

- **Title states the decision**, not the topic: "Target solo developers running local agents", not "Audience".
- **Context is evidence, not opinion.** Say where it comes from; mark assumptions as assumptions.
- **At least two real options.** "Do nothing / defer" counts if someone would defend it.
- **Consequences include what we lose.** A PDR with only upsides is a pitch.
- **Guardrails are checkable** against a spec: a reviewer can say pass/fail.
- **One decision per file.** Number `NNNN`, sequential, never reused.
- **Status.** Agents create PDRs only as `proposed`. A human accepts or rejects.

## Using PDRs

- **Specify.** Read `docs/decisions/product/README.md`. The spec lists the accepted PDRs that
  constrain it under `## Constraints`. A spec that contradicts an accepted PDR is invalid — change
  the spec or supersede the PDR first.
- **Missing decision.** If a spec needs a product choice nobody made, draft a `proposed` PDR, link it
  from the spec, and stop for the human. Do not invent the answer inside the spec.
- **Questions like "why don't we do X?"** — search `docs/decisions/product/` first and cite the PDR.

## Changing a decision

Never edit an accepted PDR's decision. Write a new PDR with `supersedes: ["PDR-OLD"]`, set the old
one to `status: superseded` + `superseded-by`, list affected specs in the new one's Consequences,
update the index. Allowed in-place edits: typos, links, `affects` after a rename.

## Index

`docs/decisions/product/README.md` holds one row per PDR, ordered accepted → proposed → others:

```markdown
| PDR | Decision | Status | Affects |
|---|---|---|---|
| [0001](0001-record-product-decisions.md) | Record product decisions as PDRs | accepted | all specs |
```

## Done checklist
- [ ] Passes the "Is this a PDR?" test; one decision per file.
- [ ] Context has evidence; at least two real options; downsides named.
- [ ] Guardrails are checkable against a spec.
- [ ] Status is `proposed` unless a human accepted it.
- [ ] Index updated; affected specs reference the PDR.
