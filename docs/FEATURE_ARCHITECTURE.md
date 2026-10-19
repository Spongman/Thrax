# THRAX Web Feature Architecture

THRAX is a workbench shared by several CPU architectures. The workspace,
debugger, panels and tools are written once against a neutral contract; each
architecture supplies its assembler, CPU, history schema, editor support,
examples and any panels of its own. One architecture is active at a time.

## Layered design

1. **Contract (`src/architectures/contracts.ts`)**: the only types shared code
   uses to reach a target: register descriptors, machine profile, assembled
   program, `Machine` (run control, inspection, history), disassembly, editor
   integration, panel and tool contributions.
2. **Composition (`src/architectures/registry.ts`)**: the one common-code
   module that names concrete architectures. It loads the selected one on
   demand and commits activations transactionally (see below).
3. **Architectures (`src/architectures/<id>/`)**: everything specific to a
   target. `mips/` holds the MARS assembler and simulator (`core/`), its
   history schema, editor language, examples and the MIPS-only tools
   (X-Ray, Mars Bot, Scavenger Hunt, Digital Lab). `beta/` holds the Beta CPU,
   the BSim machine profile, the UASM dialect with the bundled `beta.uasm`,
   its editor language, examples and pipeline model.
4. **Shared engine (`src/core`)**: what no target owns: the configurable
   assembler engine (`core/assembly`: tokens, expressions, macros, symbols,
   layout, byte emission), diagnostics, source index, history log and buffers,
   the execution observer seam, and settings.
5. **Debug session (`src/debug`)**: breakpoints by line and address, stepping
   that skips words the editor cannot show, and rebinding to each new build.
6. **Workspace (`src/store`, `src/components`)**: files, diagnostics,
   registers, memory, console, history and the dock layout. It never mutates
   machine state except through the contract.
7. **Tools (`src/tools`)**: opt-in observers (statistics, profile, cache,
   branch history, pipeline, memory reference) that run only while a panel
   consumes them and rewind with the history. They read instructions through
   the target's `InstructionSet`, never a concrete decoder.

## Adding an architecture

1. Create `src/architectures/<id>/` with a `manifest.ts` (id, display name,
   ids of any panels it contributes) and an `index.ts` whose default export is
   an `ArchitectureDefinition`: registers, examples, settings schema, optional
   panels, and `createServices()`, which returns the assembler, machine
   factory, profile, disassembly, editor installer and optional tools.
2. Register it in `src/architectures/registry.ts`: one loader
   (`<id>: () => import('./<id>')`) and its manifest.

Nothing else changes. Shared code must not import from an architecture
directory; types come from `contracts.ts`. Mutable state belongs to the
services `createServices()` returns, never to the definition.

## Loading and switching

Each architecture is a separate chunk, fetched when first selected; the
initial bundle holds only the manifests. Switching:

1. stops the current run at an instruction boundary, including one waiting
   for input;
2. loads and validates the module; a newer request, including choosing the
   active target again, supersedes it, and a superseded result is discarded
   before its services are created;
3. commits: the old services, machine, editor providers and tools are
   disposed, and the workspace drops registers, memory, history, address
   breakpoints and diagnostics;
4. on failure keeps the previous target and reports the error; a later
   attempt loads again.

Source files, line breakpoints, settings and the dock layout survive a
switch. Line breakpoints are resolved again by the next build. Panels a
target does not supply stay in the layout and show as unavailable.

## Performance boundaries

Composition happens at activation; execution stays inside the backend's own
batch loop with no per-instruction indirection. Observers are attached only
while a tool is consumed. History uses typed-array columns described by each
architecture's schema, and formatting is lazy.

## Compatibility boundary

Browser security prevents a direct port of desktop file dialogs, arbitrary
file I/O, MIDI and Swing tools. Those features use explicit browser adapters
(File System Access API, downloads, Canvas) and keep the target-visible
semantics where practical. The design rationale and staged plan are in
[MULTI_ARCHITECTURE_INVESTIGATION.md](MULTI_ARCHITECTURE_INVESTIGATION.md).
