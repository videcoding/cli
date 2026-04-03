# VideCoding CLI

This repository is primarily set up for local development, building, and testing.

## Development Environment

Requirements:

- Bun `1.3+`
- Node.js `18+`
- macOS for GUI automation work and `bun run smoke:gui`

Install dependencies:

```bash
bun install
```

Run from source:

```bash
bun run dev
```

Useful variants:

```bash
bun run dev -- --help
bun run dev -- --version
```

`bun run dev` executes [`src/entrypoints/cli.tsx`](./src/entrypoints/cli.tsx) with [`scripts/dev-preload.mjs`](./scripts/dev-preload.mjs), so local workspace packages are used directly during development.

## Build

Build the CLI:

```bash
bun run build
```

Build output is written to [`dist`](./dist):

- [`dist/claude`](./dist/claude)
- [`dist/src-build/cli.js`](./dist/src-build/cli.js)

Clean generated output:

```bash
bun run clean
```

## Test Commands

Testing scope and stop-rule are documented in [`TESTING.md`](./TESTING.md).

Unit and integration tests:

```bash
bun run test
```

Watch mode:

```bash
bun run test:watch
```

Coverage report:

```bash
bun run test:coverage
```

Standard smoke test:

```bash
bun run smoke
```

GUI smoke test:

```bash
bun run smoke:gui
```

Recommended validation sequence:

```bash
bun install
bun run test
bun run build
bun run smoke
bun run smoke:gui
```

## What `bun run smoke` Covers

The standard smoke test currently verifies:

- build success
- `./dist/claude --version`
- `node bin/claude.js --version`
- `./dist/claude --help`
- `./dist/claude auth status --text`
- `./dist/claude plugin list`
- `./dist/claude mcp list`
- `./dist/claude agents`
- workspace package loading
- `computer-use` MCP server initialization

## What `bun run smoke:gui` Covers

The GUI smoke test currently verifies:

1. build
2. GUI permission preflight
3. frontmost app and mouse position checks
4. package-backed screenshot capture
5. executor screenshot
6. mouse move and restore
7. key press and release
8. opening `TextEdit`, creating a document, inserting a fixed test string, and verifying the document content

Permissions involved:

- `Accessibility`
- `Screen Recording`

If `Screen Recording` is granted during the run, macOS may still require restarting the terminal before the GUI smoke test can fully pass.

## Workspace Packages Used In Development

The main local workspace packages involved in development and smoke coverage are:

- [`audio-capture-napi`](./packages/audio-capture-napi)
- [`claude-for-chrome-mcp`](./packages/claude-for-chrome-mcp)
- [`computer-use`](./packages/computer-use)
- [`computer-use-input`](./packages/computer-use-input)
- [`computer-use-mcp`](./packages/computer-use-mcp)
- [`image-processor-napi`](./packages/image-processor-napi)
- [`modifiers-napi`](./packages/modifiers-napi)
- [`url-handler-napi`](./packages/url-handler-napi)

## Repository Layout

- [`src`](./src): main CLI source
- [`packages`](./packages): local workspace packages
- [`scripts`](./scripts): build, development, and smoke-test scripts
- [`bin`](./bin): launcher entrypoint
- [`vendor`](./vendor): vendored helper binaries such as fallback `ripgrep`

## Current Notes

- The repository is documented as `VideCoding CLI`, but the current runtime identifiers and binary paths still use `claude` naming internally.
- Actual model use still requires a valid login state.
- GUI validation depends on a real macOS desktop session with the required permissions.
