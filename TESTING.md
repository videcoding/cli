# Testing Policy

This repository now has a deliberate stopping point for automated testing work.

## Goal

The test suite is intended to cover:

- critical CLI behavior
- state management and runtime transitions
- configuration, permission, plugin, and MCP validation
- filesystem, process, logging, and debug edge cases
- release smoke paths

The goal is not to drive every file to 100% coverage.

## Current End State

The current suite is considered complete for this phase when all of the following pass:

```bash
bun run test
bun run test:coverage
bun run smoke
```

`bun run smoke:gui` remains a separate macOS desktop validation step and is not required for routine local completion unless GUI-specific work changed.

## What Is Already Covered

High-value coverage already exists for:

- CLI short-circuit and print-mode behavior
- isolated HOME and configuration discovery behavior
- bootstrap state and session/runtime state transitions
- log ingestion, debug logging, and error capture paths
- settings parsing, permission validation, plugin schema validation, and MCP config validation
- Bash permission prefix extraction, wrapper/env-var stripping, and rule matching behavior
- permission request routing and notification message selection
- MCP entrypoint handler registration, tool listing, and tool-call error handling
- filesystem path resolution, symlink handling, sync/async file operations, and process IO edge cases

## Stop Rule

Do not keep adding tests only to increase the coverage number.

Stop once:

- the critical paths above are covered
- the main test and smoke commands pass
- remaining gaps are mostly low-value compatibility code, bridge code, generated types, platform-specific probes, or feature-gated branches

Examples of lower-priority files in this category include:

- `src/utils/env.ts` module-load detection branches
- `src/utils/slowOperations.ts` feature-gated slow logging branches
- `src/entrypoints/agentSdkTypes.ts`
- `src/utils/which.ts` non-primary fallback paths

## When To Add More Tests

Add or update tests only when one of these is true:

- a critical path changes
- a regression or production bug was fixed
- a new user-facing feature was added
- a security-sensitive validation or permission rule changed

## Preferred Validation Sequence

For normal development:

```bash
bun run test
bun run smoke
```

For release-oriented validation:

```bash
bun run test
bun run test:coverage
bun run smoke
bun run smoke:gui
```
