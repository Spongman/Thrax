# Repository Guidelines

## Project Structure & Module Organization

THRAX is a Vite-powered React 19 and TypeScript workbench for assembling, running and debugging programs for several CPU architectures (MIPS under MARS rules, and the MIT Beta under BSim rules). Keep application entry points in `src/main.tsx` and `src/App.tsx`. Place shared UI components and their paired styles in `src/components/` (for example, `Toolbar.tsx` and `Toolbar.css`).

Each architecture lives in one directory, `src/architectures/<id>/`, holding its `manifest.ts`, an `index.ts` that default-exports its `ArchitectureDefinition`, and everything specific to it: assembler or dialect, CPU, history schema, editor language, examples, tests, and any panels or tools only it supplies. MIPS keeps its assembler and simulator in `src/architectures/mips/core/`; Beta keeps UASM in `src/architectures/beta/uasm/`. Shared code reaches an architecture only through the types in `src/architectures/contracts.ts`; `src/architectures/registry.ts` is the one place that imports concrete architectures. Adding one is a new directory plus its loader and manifest in that registry.

Architecture-neutral machinery belongs in `src/core/` (the configurable assembler engine in `src/core/assembly/`, diagnostics, source index, history log, observer seam, settings). Debug session logic is in `src/debug/`, shared tools in `src/tools/`, browser services (files, archives, GitHub, share links) in `src/services/`, Zustand state in `src/store/thraxStore.ts`, and reusable React behavior in `src/hooks/`.

## Build, Test, and Development Commands

- `npm install` installs the pinned dependency tree from `package-lock.json`.
- `npm run dev` starts the Vite development server on port 3000.
- `npm test` runs the Vitest suite once; `npm run test:watch` keeps it running.
- `npm run typecheck` type-checks without emitting.
- `npm run lint` runs ESLint over `src`.
- `npm run build` type-checks and creates the production bundle in `dist/`.
- `npm run preview` serves the production bundle locally for a final check.
- `npm run xray:svg` regenerates the MIPS X-Ray SVGs in `docs/xray/`.

Run `npm test`, `npm run lint` and `npm run build` before opening a pull request.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: tab indentation, LF line endings, single quotes, no semicolons, and ES modules. Use PascalCase for React components and component files (`MemoryView.tsx`), camelCase for functions, hooks, variables, and modules (`useExamples.ts`), and descriptive CSS classes such as `.memory-view`. Pair component-specific CSS with its component. Keep assembler and simulator logic framework-independent. Shared code must not import from an architecture directory; use `import type` from `contracts.ts`.

## Testing Guidelines

Keep tests in a `__tests__/` directory beside the module, named `*.test.ts`. When changing parsing, assembly, or execution semantics, add or update representative programs in the architecture's `examples.ts` and check registers, memory, console output, and error cases. Check encodings against independent expected words, not only round trips. Switching behavior is covered in `src/store/__tests__/architecture.test.ts` and `architectureLifecycle.test.ts`.

## Commit & Pull Request Guidelines

Recent history uses short, imperative, sentence-case subjects, such as `Fix assembler branch offset calculation` and `Add step-through debugging with breakpoints`. Keep each commit focused; avoid mixing refactors with behavior changes. Pull requests should explain the user-visible and architecture-semantic impact, link relevant issues, list validation commands, and include screenshots or a short recording for UI changes. Call out newly supported instructions, syscalls, directives, or compatibility limitations explicitly.

## Configuration & Safety

Do not commit `node_modules/` or generated `dist/` output. Preserve the simulators' execution safeguards and the activation cleanup in the registry when modifying runtime behavior, and document any changes to memory limits, history limits, or supported features in `README.md`.
