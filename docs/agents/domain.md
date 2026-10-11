# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root
- **`docs/adr/`** — read ADRs that touch the area you're about to work in

If any of these files don't exist, **proceed silently**. Don't flag their absence or suggest creating them upfront. The domain-modeling skill creates them lazily when terms or decisions get resolved.

## File structure

Single-context repo:

    /
    ├── GLOSSARY.md
    ├── docs/adr/
    └── src/

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept isn't in the glossary, reconsider whether it belongs to the project vocabulary or note the gap for domain modeling.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding.
