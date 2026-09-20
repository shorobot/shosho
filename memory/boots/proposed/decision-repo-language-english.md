# Proposal: D-00X — Repository language is English

Author: DevOps (devops-01), 2026-09-18, on the owner's instruction (chat, 2026-09-18).
For the Orchestrator to add to `/memory/decisions.md` and to apply to files it owns.

## Decision
Everything committed to the repository is written in **English**: code, comments, commit messages,
`/memory/*`, `/docs/*`, boots, proposals, READMEs, workflow names, UI placeholder text.
Ukrainian is used only in the chat dialogue between the owner and a session.

## Why
Owner instruction. English keeps the repo readable for any contributor, tool or model, and avoids
mixed-language drift between sessions.

## Consequences
- devops-01 already rewrote its own files in English (`apps/infra/README.md`,
  `memory/boots/proposed/decision-D-004.md`, placeholder page).
- Still in Ukrainian and owned by the Orchestrator (not touched by devops-01, per D-002):
  `README.md`, `docs/architecture.md`, `docs/api-contracts.md`, `memory/state.md`, `memory/log.md`,
  `memory/decisions.md`, `memory/boots/devops-01.md`. Suggested: one Orchestrator commit
  `[orchestrator] Translate memory/docs to English`, then all new boots are issued in English.
- Log entries and state rows written by devops-01 from now on are in English.
