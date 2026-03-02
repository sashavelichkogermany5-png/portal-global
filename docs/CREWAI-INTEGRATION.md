# Optional Crew Runner Engine

This repo supports an optional external engine for generating agent message chains and draft actions.

It is NOT a second project. Portal Global remains a single project.
Node stays the source of truth for:
- agent_messages storage
- safe action execution and audit

Python service only returns messages + draft action proposals.

## Run Crew Runner
PowerShell:
- ops\run-crewai.ps1

Health:
- http://localhost:5055/health

## Enable in Node
Set env:
- AGENTS_ENGINE=crewai
- CREWAI_URL=http://localhost:5055
- CREWAI_API_KEY=dev

Then:
- npm run dev

## Verify
- Open /app -> Agent Console
- page_view should show EventNormalizer -> Router -> UICoach
- Replay re-dispatches and updates thread
