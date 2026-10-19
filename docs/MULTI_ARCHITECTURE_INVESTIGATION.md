# Multiple CPU architectures: design and implementation overview

Investigated and reviewed 18 October 2026. This document incorporates the agreed design constraints and proposes an incremental implementation sequence. No runtime changes or performance measurements have been made.

> The design has since been implemented. File paths and line numbers below describe the code as it was investigated: the MIPS assembler and simulator have moved from `src/core/` to `src/architectures/mips/core/`, the examples to `src/architectures/mips/examples.ts`, and the MIPS-only tools to `src/architectures/mips/tools/`. The implemented structure is described in [FEATURE_ARCHITECTURE.md](FEATURE_ARCHITECTURE.md).

## Recommendation

Extend THRAX as one shared workbench with dynamically loaded architecture backends. Keep one active machine and one target configuration per workspace. Start by adapting the existing MIPS implementation to a small backend contract, then implement MIT Beta against the same contract.

All implementation, configuration, examples, tests, and assets specific to an architecture should live under its own `src/architectures/<id>/` directory. Shared code should use contracts and registered contributions, with architecture selection confined to a small loader registry.

The extension contract is **one new architecture directory plus one loader entry in a single composition module**. That module is the sole location in common code that imports architectures and connects their contributions. The directory's module supplies all contributions needed to integrate it; adding a target must not require parallel edits to global lists of examples, settings, languages, panels, source extensions, or tools.

Share the workspace, debugger policy, memory inspection, history infrastructure, browser services, general educational tools, and a common assembler engine. Put assembly dialect rules and instruction encodings in configurations with narrow extension hooks; keep CPU execution and exception semantics in architecture modules. Extract reusable mechanics as MIPS and Beta demonstrate a real common need. Preserve familiar source syntax through dialect profiles rather than requiring a new universal assembly language.

The governing principle is **share as much as possible unless sharing creates severe design or performance problems**. This includes controllers, state machines, algorithms, and models as well as rendering and storage. Architecture adapters should supply the smallest necessary differences in data extraction, configuration, and semantics. Separate implementations need a concrete reason: incompatible semantics, an abstraction that materially complicates the design, or a measured performance problem. Speculative overhead alone is not a reason to duplicate behavior. Conversely, a universal hardware model is not a prerequisite for sharing ordinary operations.

Beta is a good second architecture because its basic machine resembles the existing 32-bit RISC model. However, supporting familiar MIT source files requires UASM compatibility, which is a separate and substantial part of the work.

## What the repository already provides

The repository has progressed beyond the JavaScript layout described in AGENTS.md: it uses TypeScript, React 19, and Vitest. The actual scripts include `test`, `typecheck`, `lint`, and `build`.

Several existing boundaries are useful:

- `src/debug/session.ts` separates source stepping and breakpoint policy from the simulator. Its behavior can largely be retained after replacing its concrete `MipsSimulator` dependency with an interface.
- `src/core/observer.ts` and `src/tools/registry.ts` separate tools from execution. Tools are attached only when consumed, and the registry supports registration and removal.
- `src/core/service.ts` supplies reversible service state. Its exchange/recording mechanism can serve other architectures' devices and host services.
- `src/core/historyLog.ts` and `src/core/effectStore.ts` provide bounded, efficient history storage. Their storage mechanics are reusable, although their public records and effect interpretation contain MIPS details.
- `src/services/workspace.ts` is already the document boundary for persistence, archives, and sharing.
- `src/components/DockLayout.tsx` already uses dynamic imports and React lazy loading for tool views.

These make an incremental migration practical. None currently constitutes a complete architecture interface.

## Where MIPS assumptions escape the core

`src/store/thraxStore.ts:573` constructs the assembler directly, and line 590 constructs `MipsSimulator`. The store also knows CP0, floating-point registers, MIPS memory layouts, disassembly, and simulator history types. This is the main integration point to change.

`src/core/types.ts` exposes `MipsProgram`, MIPS segments and operands, mandatory coprocessor state, HI/LO, delayed-branch state, and a single instruction `word`. Renaming these types would leave their assumptions intact.

`src/core/simulator.ts` combines instruction execution with the run scheduler, sparse memory, protection rules, history, MARS syscalls, keyboard/display MMIO, and exception handling. Execution defaults to PC+4 at line 659. Memory accesses around line 2504 enforce the current architecture's alignment and segment policy. These are candidates for separation, not behavior to impose on every CPU.

`src/core/lexer.ts` recognizes instructions using the MIPS ISA table; the parser and macro expander implement MIPS/MARS syntax. `src/core/isa.ts` has useful table-driven encoding ideas, but its formats and operand kinds are MIPS-specific.

The editor and panels also participate. `src/main.tsx` eagerly registers MIPS language support. `SourcePane.tsx`, `MemoryView.tsx`, and `HistoryView.tsx` directly use MIPS disassembly. `RegisterView.tsx` and its dock wrapper know register banks and CP0 editing. Hover tips and go-to-definition contain language-specific knowledge.

Finally, observers receive the MIPS `Decoded` shape, and `src/tools/replay.ts` imports the MIPS decoder. Statistics classify MIPS mnemonics and R/I/J encodings; pipeline dependency analysis is MIPS-specific. Even tools with generally reusable algorithms need these dependencies removed.

## Proposed boundaries

Distinguish three concerns, even if the first implementation packages them together:

1. **CPU/ISA:** registers, decoding, instruction semantics, architectural faults, and execution modes.
2. **Machine profile:** memory map, reset/entry behavior, connected devices, interrupt routing, host service conventions, and the calling convention used by debugger adapters. The current MIPS/MARS environment is one such profile.
3. **Assembly dialect:** source syntax, macros, directives, includes, and source-language metadata.

This prevents a CPU from becoming synonymous with one operating environment. It also allows later variants to share an implementation while selecting different features. One workspace still selects just one target configuration.

An architecture supplies assembler configuration, CPU creation, register descriptors, disassembly/inspection adapters, editor configuration, examples, settings, and supported models/tools. The composition module combines these with shared engines and exposes one active-target interface. Assembly always uses the common assembler; CPU creation does not require each target to reimplement a debugger or run scheduler.

The shared runtime host owns scheduling, run/pause/stop, breakpoint policy, input coordination, history navigation, and progress publication. Its CPU adapter supplies instruction execution and the architectural reset, fault, register, and memory semantics. Shared step-over/step-out use call/return information from the adapter. During extraction, a temporary MIPS adapter can delegate to existing simulator methods, but the final ownership is shared wherever behavior is common. CPU-specific execution can use shared mechanisms directly without interpreting a universal instruction language.

Keep the key boundaries small and distinct:

- The architecture definition is immutable configuration and factories; it holds no current machine or workspace state.
- An activation handle owns the selected target's configured services, editor/model contributions, and their disposal. Its assembly and runtime APIs are the only target services the store/controller layer needs.
- A program image owns addressed bytes and source/symbol metadata. Assembly errors return diagnostics without replacing the active machine with a partial result. Any private instruction representation stays behind its adapter.
- A machine instance owns current CPU/device state, history, and execution status. Reassembly/reset cannot accidentally share mutable state with another instance.
- Inspection and event interfaces expose neutral data to shared controllers/tools. They do not expose an architecture-specific AST, decoded-instruction union, or direct access to mutable CPU internals.

Keep CPU-private state inside the backend. Publish a common debug view containing execution status, PC, instruction count, register banks, memory access, pending input, and optional call frames. Register descriptors need stable IDs, width, aliases, editability, grouping, and optional roles such as stack pointer or link register. Flags and overlapping register views must be expressible later without inventing fake MIPS registers.

Call/return recognition belongs to the architecture adapter configured with the selected profile's calling convention. Beta's link-writing control transfers do not all represent procedure calls. Step-over and step-out should use documented conventions and expose their limitations for hand-written assembly.

Call-stack presentation and control remain shared: selection, frame highlighting, source/address navigation, and debugger actions operate on a common frame model. The adapter supplies frame extraction and call/return semantics, including the identity or return condition needed by the shared step-out operation. Do not duplicate a call-stack controller merely because the frame data comes from a different CPU.

## Directory ownership and avoiding architecture switches

Use `src/architectures/mips/` and `src/architectures/beta/` as complete ownership boundaries. Each can contain `index.ts`, `isa/`, `runtime/`, `assembly/`, `profiles/`, `editor/`, `tools/`, `components/`, `examples/`, `assets/`, and adjacent tests as needed. These are optional internal subdivisions, not a requirement to create empty directories. Arm versions would normally share one `arm/` family directory with internal variants.

Keep neutral contracts in `src/architectures/contracts.ts` (or a small `contracts/` directory), and the loader mapping in `src/architectures/registry.ts`. Keep the common assembler engine and runtime primitives in `src/core/`; debugger policy stays in `src/debug/`, generic tools in `src/tools/`, and generic UI in `src/components/`. Dialect-specific configuration initially belongs to its architecture directory. If multiple architectures later use the same dialect implementation, extract that genuinely shared implementation into the common assembly infrastructure and retain target-specific configuration locally.

Make `src/architectures/registry.ts` the single composition module: it owns the loader mapping, module validation, activation, and connection of every architecture contribution to shared services. All architecture imports in common code, including optional lightweight manifest imports, must occur in this file. It supplies the app with a configured active-target facade and contribution catalogs. The store, debugger, editor host, settings UI, menus, and dock layout consume those neutral services/catalogs; they do not each import a backend or separately wire its pieces together. Architecture-private imports and lazy loading of architecture-owned submodules remain inside the architecture directory.

For MIPS this means moving CPU-specific execution, decoding and ISA definitions, CP0/FP semantics, MARS syscall bindings and memory maps, MIPS pseudo-ops, language configuration, examples, effect interpretation, and MIPS-specific pipeline/X-Ray definitions and assets into `mips/`. Beta owns its register conventions, exception behavior, UASM adapter/configuration, bundled `beta.uasm`, examples, and specialized contributions under `beta/`. Shared controllers, execution mechanics, pipeline algorithms, file I/O, numeric helpers, history storage, and macro/layout mechanisms remain outside wherever neutral contracts permit reuse. Moving a currently MIPS-coupled component does not establish that its entire implementation must remain architecture-specific.

Enforce a simple dependency direction:

- Architecture implementations may import common contracts, assembler services, runtime primitives, and appropriate shared UI utilities.
- Shared code may import neutral contracts and use the selected architecture object. Only the loader registry imports architecture entry points, through dynamic imports.
- One architecture must not import another architecture's implementation. Extract a shared utility when justified instead of importing, for example, a MIPS integer helper into Beta.
- Framework-independent CPU and assembly modules must not import React, Monaco, or the workspace store. Put those integrations in the architecture's editor/UI modules, with their own lazy entry points where useful.

An architecture entry point supplies its contributions: CPU factory, assembler configuration, inspection/disassembly operations, register descriptors, machine profiles, setting definitions, examples, editor integration loader, model/tool configuration or factories, and optional specialized panel loaders. Shared code consumes the configured active-target interface without knowing concrete types. Calls should resemble `activeTarget.assemble(...)`, `activeTarget.createMachine(...)`, `machine.writeRegister(id, value)`, and `activeTarget.disassemble(...)`; only composition connects the underlying contributions.

For example, MIPS supplies CP0 register descriptors and edit handlers; the generic register panel and controller consume them. An IEEE floating-point inspector can be shared, with MIPS supplying register pairing/access rules. Specialized panels are contributed only when a common view/controller cannot express their behavior appropriately. Shared `DockLayout` must not gain a `case 'mips'` or CP0 imports. Likewise, the common assembler invokes registered directive handlers and operand parsers rather than branching on the architecture ID.

Prefer behavior-bearing optional interfaces over a growing list of flags. A `callTracking` adapter can expose call frames and procedure-step support; a machine profile can contribute an interrupt adapter. Check for the required facility once when composing controls or attaching a tool. Mandatory operations stay mandatory in the contract. Architecture-private state should not become a central `MipsState | BetaState | ArmState` union that every shared consumer must narrow.

Branches on neutral concepts such as stopped/running, register width, endianness, emission-fragment kind, or an available capability are ordinary shared logic. Explicit architecture identity is still needed in the registry, persistence, and selection UI; it should not determine instruction or presentation behavior there. MIPS-only compatibility migrations can live with the MIPS module behind a migration hook, while the shared document migration only assigns legacy workspaces their default target ID.

Use ESLint restricted-import rules to protect the direction, including type-only imports: shared code should not depend on private architecture types either. Check production chunks as part of validating the boundary. The acceptance criterion for a later architecture is that adding its directory and loader registration does not require editing the common assembler, debugger, store, or panel switch statements. If a new architectural feature requires extending a neutral contract, that is a deliberate interface change rather than an architecture-ID exception.

This organization supports both requested properties: a complete architecture is easy to find in one directory, and new backends extend the system through configuration and implementations of shared interfaces.

The only routine wiring outside the new directory should be an entry such as `beta: () => import('./beta')` in the loader registry. An optional small manifest inside the architecture directory supplies its display name and other selection metadata without loading its implementation. The registry can initially list a lightweight manifest import beside the loader; if the list grows, Vite glob discovery of manifests and lazy entry points can remove even that manual registration. Explicit registration is the simpler initial choice.

The loaded architecture module declares available profiles/dialects, assembler configuration, CPU factory, register descriptors, file extensions, default source, examples, setting definitions and validation, editor integration, tool factories, panel contributions, and any target-specific migration hooks. The common composition module connects them once through neutral registration APIs and owns their disposal. Common menus, file filters, settings UI, examples UI, and panel hosts render or consume the resulting catalogs. Architecture-specific settings remain owned and validated by the architecture module instead of enlarging a central settings union. Persisted target options can remain opaque to the workspace serializer and are validated when the selected module loads.

For example, the composition module loads Beta, combines its dialect/ISA/profile with the common assembler, connects its machine factory to the runtime host, and registers its editor, examples, settings, tools, and panels. It returns one activation handle containing the configured facade and a cleanup operation. These operations use the same contribution contract for every target, rather than a Beta-specific registration sequence. Hosts provide generic registration mechanisms; they contain no architecture-specific linking logic. Keep this composition module as orchestration only: actual CPU rules and configuration stay in the architecture directory.

Validate manifests and module contracts centrally, including duplicate IDs, invalid configuration, and missing required contributions. These are bundled first-party modules checked against the same TypeScript contracts; an independently versioned plugin ABI is unnecessary for this work. Unsupported optional features should simply be absent from the module's contributions. Keep registration and disposal explicit so switching targets removes the previous module's live contributions. These mechanisms should be implemented once and reused by every architecture.

Demonstrate the contract when adding Beta: after the shared foundations are established, its implementation should touch only `src/architectures/beta/` and the loader entry, apart from documentation or optional shared test-harness registration. A future CPU that needs a new neutral facility may justify a shared interface extension, but repeated architecture-ID branches or global registration edits indicate an incomplete boundary.

## Memory, code, and history

The shared program image should contain addressed byte sections, entry information, symbols, diagnostics, and source mappings. It should not require a contiguous `number[]` of 32-bit instruction words. A displayed instruction needs an address, byte length, encoded bytes, and formatted assembly. Decoding should accept memory and execution context, since later targets may have multiple instruction modes.

Likewise, expose memory through byte-addressed inspection operations. The current word-keyed sparse map can remain MIPS's implementation behind an adapter. Shared storage may eventually use sparse pages, but changing storage and CPU semantics simultaneously would make the migration harder to validate. Endianness, alignment, address wrapping, access permissions, and unmapped-memory behavior must be explicit policies. Debugger inspection must avoid device read side effects.

Source rows currently assume four-byte instructions and four-byte data groups (`src/core/sourceIndex.ts:38`). Separate instruction length from a configurable display grouping for data. Audit address formatting, memory editing, disassembly navigation, history, and exports for the same assumption.

Retain bounded history, reversible effects, and typed-buffer storage. The common engine requires only a minimal base set of bookkeeping buffers for its own operations, such as entry identity/count, entry kind, and effect ranges. Each architecture explicitly declares the additional per-entry and per-effect buffers it requires, including their element types and allocation cardinality. There is no default architecture schema and no automatic MIPS-shaped set of columns. PC, encoded instruction data, execution-mode state, registers, and architectural effects are represented by the target's declared buffers and exposed through neutral history accessors where the debugger or tools need them. MIPS declares its own compact register/CP0/HI/LO and delayed-branch representation; Beta declares its required representation independently.

The shared storage engine owns block allocation, indexing, cursor movement, eviction, recording boundaries, and accounting for both the required base buffers and declared extensions. Architecture codecs own recording and exchanging their state, using the common reversible recording infrastructure. Reusable codecs/helpers remain available for targets to select explicitly; none is installed as an implicit default. Sparse variable-sized payloads may use a shared payload store when requested by a codec. Avoid per-step whole-machine snapshots or heavyweight object allocation.

Validate the buffer declaration at activation and bind direct typed-array access or specialized accessors for recording. Schema validation and string-key resolution must stay out of the per-effect path. Distinguish buffers indexed by instruction entry from those indexed by effect, and define allocation/eviction lifetimes consistently. Keep register IDs and field names private to the codec, rather than teaching the common engine their meanings. Public history views are decoded lazily for inspection, without converting every stored record into an object on each step. Account for actual allocated block/payload bytes alongside entry limits, since targets can have different record sizes. Exact mandatory base columns and numeric widths should be derived from the shared engine's needs during implementation, rather than inherited from MIPS state.

Today the effects use typed columns, while `HistoryLog` holds blocks of entry objects. Preserve the existing effect-storage optimization and introduce typed entry columns as a distinct, benchmarked migration. Freeze each machine's complete buffer schema when its history is created. Block capacity is a shared allocation policy; targets specify column types and elements per record, without each reimplementing the allocator. Bound accessors must follow block rotation rather than retaining stale arrays. Entry IDs and logical counts must not silently wrap because a chosen column is too narrow.

CPU effects and shared service/device effects must retain one chronological ordering. Undo applies them in reverse order; redo applies them in forward order using exchanged values. The common base contains any routing/bookkeeping needed for this ordering, while explicitly declared codecs own payload buffers. Profiles select reusable service codecs explicitly at machine creation; dynamically attaching a tool cannot change an existing history schema. A shared device/service must not need to know the CPU's buffer layout to record its changes.

Recording must handle repeated writes, partially completed input instructions, faults/interrupts, and user edits. A divergent edit or execution truncates future records and their payloads across all buffers. Eviction removes complete entries and releases associated effects, payloads, and tool records consistently. Define an explicit oversized-entry policy and report when a history byte limit cannot retain an entry; never silently retain half an entry or discard live state. Typed-array bytes can be accounted exactly, while arbitrary object payloads require bounded serialization or a declared size estimate; a byte budget must not claim to be an exact JavaScript heap limit.

Replay must decode recorded bytes using the selected backend and historical execution mode, rather than reading current memory or importing the MIPS decoder. Input, time, random values, pending interrupts, devices, and suspended operations must remain reproducible across backward/forward navigation.

Use numbers for the initial 32-bit targets, while making widths explicit. AArch64/RV64 will need a deliberate 64-bit value representation; current JavaScript bitwise operations cannot simply be widened. Keep that future work behind value/accessor boundaries rather than converting the entire app to BigInt now.

## A common configurable assembler

This is feasible and is the recommended direction, incorporating the preference for a common assembler. MIT's UASM is an especially useful precedent: its general macro machinery assembles Beta instructions using definitions supplied in `beta.uasm`. The [MIT lecture explicitly describes its use with different ISA macro definitions](https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/pages/c10/c10s1/). That supports a shared engine; it does not establish that UASM syntax alone can accept existing MARS, Arm, or 6502 source unchanged.

Use three layers within the assembler:

- **Common engine:** source loading, token positions, expression AST/evaluation, macro expansion mechanics, symbol scopes, sections/fragments, fixups, layout, byte emission, diagnostics, and source/expansion maps.
- **Dialect profile:** comment/string/identifier rules, numeric literals, case sensitivity, operand syntax, macro definition/invocation syntax, symbol visibility, include behavior, directives, and alignment conventions.
- **ISA description and hooks:** register names, instruction operand forms, encoding fields, range/alignment validation, PC-relative calculations, and pseudo-instruction lowering. Reuse instruction metadata for disassembly, completion, and documentation where it fits.

Configuration can be TypeScript objects with typed callbacks. It need not be pure JSON or a new schema language. MIPS forms can remain table-driven with custom handlers for exceptional encodings and pseudo-operations. Beta can express instruction encodings through UASM macros while a matching ISA description supplies decoding and debugger metadata. If both describe encodings, cross-check them with expected words and round-trip tests.

For example, the public call can be `assemble(files, { dialect: marsDialect, isa: mipsIsa, profile: marsProfile })`, or the same function with `uasmDialect`, `betaIsa`, and a Beta profile. Both produce the same addressed-byte program image and diagnostics. A backend supplies those objects; the shared assembler does not import every CPU implementation.

The common intermediate representation should be emission fragments such as labels, assignments, byte expressions, data, alignment, origin changes, and architecture instructions. This accommodates UASM macros that ultimately emit byte expressions as well as MIPS instructions that need later encoding. Preserve symbolic expressions until layout is settled; do not prematurely convert labels into numeric operands.

Carry emission provenance through macro expansion. UASM may emit an instruction as several byte expressions; the debugger still needs an invocation location and instruction boundary where known. The dialect/ISA adapter can annotate known instruction emissions, while raw data remains data or unclassified bytes. Do not infer that every decodable word is source code. Runtime execution and disassembly can inspect bytes independently of those source annotations. This keeps code gutters, source stepping, and breakpoints consistent across both frontends.

Start with a shared expression parser supporting precedence and configurable operators/functions, a reusable token cursor, and dialect-specific statement/operand parsers. MARS `4($sp)` and UASM `ADD(R1,R2,R3)` cannot safely be distinguished by arbitrary comma splitting. Keep grammar hooks explicit rather than accumulating architecture conditionals in the engine. Instruction names should generally remain identifiers until macro/instruction resolution, unlike the current lexer that classifies them using the MIPS table.

Concrete extraction work is needed. The current parser lays out data while the assembler lays out text, the expression parser permits only one label plus constants, and macro arguments are not balanced general expressions. Includes are expanded before macros and globally deduplicated. These choices must become dialect policy or shared mechanisms with the appropriate semantics. In particular, preserve MARS include-once behavior while defining UASM include behavior from its compatibility target.

Implement bounded multipass layout/fixup resolution, with useful errors for unresolved symbols and nonconverging origin/size dependencies. Preserve today's MIPS pseudo-expansion choices. Leave branch relaxation and size selection as optional ISA hooks for later targets, with convergence limits, rather than assuming one sizing pass works for all CPUs. Use explicit expression arithmetic/overflow rules: do not accidentally use signed JavaScript bitwise results as addresses or silently change existing MARS calculations.

Retain expansion-depth limits and add budgets for expanded tokens, include depth, emitted bytes, and layout passes. Share these safeguards as well as the algorithms. Full object-file linking and compatibility with every vendor assembler can remain separate future work.

The migration should extract the engine from MIPS under its existing tests, then use Beta/UASM to validate the extension points. This shares substantially more than a final output type while keeping the two source dialects faithful. It is more initial work than a second standalone assembler, but it directly supports the requested long-term direction.

## MIT Beta scope

Beta uses 32-bit instructions and 32 general-purpose registers, with R31 fixed at zero. This makes it a relatively close fit, but it needs independent encoding, decoding, arithmetic, and control-flow semantics. See the [MIT course ISA notes](https://computationstructures.org/notes/isas/notes.html).

The [Beta specification](https://computationstructures.org/notes/pdfs/beta.pdf) highlights important differences: destination-last syntax, link-writing branches/jumps, PC-relative LDR, and supervisor state in the high PC bit with XP exception handling. Branches have no MIPS delay slot. MUL/DIV support should be named explicitly because the summary marks them optional. Memory policy must allow Beta's instruction/data usage rather than inheriting MARS text-segment restrictions.

The larger frontend issue is UASM. Instructions are macros from `beta.uasm`, not merely built-in mnemonic tokens. The assembler supports expressions, symbol assignments, the location counter, macro overloads, includes, byte emission, and layout. The course's `WORD` macro emits bytes in little-endian order. Existing MARS macro substitution is insufficient. See the [MIT assembly notes](https://computationstructures.org/notes/assembly/notes.html).

My recommended first Beta release supports ordinary course-style UASM files and bundled `beta.uasm`, with an explicit compatibility list. Resolve includes through the existing workspace plus bundled libraries; preserve macro invocation/definition source locations. The include model must follow UASM semantics rather than automatically assembling every open library as an independent translation unit.

Use this initial delivery boundary when preparing implementation: the documented integer instruction set, explicitly including MUL/DIV, common course macros/directives and expressions, source-level debugging and rewind, and a named educational machine profile with precisely specified halt and basic console operations. Define the profile against a pinned reference `beta.uasm` and representative supported programs before implementing those operations. This is a proposed compatibility milestone rather than a claim of complete BSim compatibility. Supervisor/interrupt and OS-lab compatibility, checkoff tooling, and additional simulator-specific directives are subsequent milestones; unsupported features need clear diagnostics or execution errors.

Separate that milestone from full BSim compatibility. Simulator directives, checkoff facilities, protection options, privileged/host I/O operations, and operating-system labs need a defined support matrix. `HALT()` and console operations must be assigned their actual environment semantics rather than mapped to MARS syscall numbers. The [BSim documentation](https://computation-structures.github.io/course/labs/tool_docs/bsim.html) is an appropriate compatibility checklist.

A clean Beta implementation is likely manageable; UASM compatibility and shared UI extraction are the larger uncertainties. Existing BSim material is valuable for differential testing. Reusing an implementation would first require inspection of its exact source, licensing, dependencies, and ability to expose effects/history; this investigation did not establish those conditions.

## What can be shared across tools

Keep docking, files, console presentation, diagnostics, symbols, breakpoints, heat maps, and ordinary debugger controls shared. Most windows should use a shared view and shared controller with a narrow architecture adapter. Register controllers share selection, editing workflows, formatting, and highlighting; memory controllers share navigation, selection, editing workflows, and formatting. Descriptors/accessors supply the differing data and semantic rules. File-service mechanics can be shared while syscall numbers, argument registers, and ABI rules stay in profiles.

Cache, memory-reference, and branch-prediction algorithms can largely share implementations once their event and replay dependencies are neutral. Preserve the cache tool's current definition as a data-access model unless a profile explicitly enables instruction-cache analysis. Review address indexing assumptions for variable instruction alignment.

Statistics and profiling can consume neutral instruction metadata: mnemonic, category, encoding label, byte length, and optional register dependencies. Do not require every architecture to report MIPS R/I/J formats. Compute only the metadata consumed by active tools, preserving the current low overhead when tools are closed.

Define event timing explicitly before adapting the tools. The current `onInstruction` fires before execution, so it must not silently become an instruction-retired event. Distinguish instruction start, memory/branch activity, and completion or suspension/fault where consumers need them; associate events with stable history identity. Preserve existing MIPS counting behavior during extraction. Dynamic branch outcomes and accessed addresses must be recorded by interested tools or shared trace facilities for replay, since decoding bytes alone cannot reconstruct them. Device events and debugger inspection must not be counted as CPU accesses accidentally.

Pipeline presentation and controllers should be common: timeline/grid rendering, navigation, selection, highlighting, playback, and explanatory interaction operate on model-provided stages, rows, and events. Share scheduling, hazard, forwarding, and prediction algorithms wherever configuration and semantic adapters suffice. Instruction dependencies and control-flow interpretation come from the target adapter. A pipeline describes a processor implementation rather than an ISA alone, so a target may offer multiple models; avoid assuming every CPU has the current five stages. Use concrete MIPS and Beta models to establish where genuine algorithm differences require specialized strategies. An instruction-level emulator does not establish cycle-accurate timing.

X-Ray can remain a specialized architecture-owned visualization while reusing suitable animation controls, selection, tooltips, and SVG interaction utilities. Portability is assessed within a component, not only at the whole-window level. Specialized views/controllers are exceptions justified by incompatible behavior or severe design/performance costs.

Bitmap and existing MMIO devices may share rendering, controllers, and device logic where the machine profile supplies compatible mappings. Their interrupts need CPU-specific adapters. Keep one common dock layout across architectures. On switching, common windows rebind to the selected machine; the pipeline window selects a supported model or displays an unavailable state. Specialized panels may retain their dock positions with an unavailable state when the target supplies no implementation. Capability checks prevent incompatible models from attaching, without requiring a separate saved layout for each architecture.

## Dynamic loading and switching

Use an explicit registry of small descriptors and lazy loaders:

```ts
const architectureLoaders = {
  mips: () => import('./mips'),
  beta: () => import('./beta'),
}
```

Vite supports code splitting through dynamic imports; the existing dock panels demonstrate the same pattern. Architecture editor integrations and optional tools can be additional lazy chunks. See [Vite's feature documentation](https://vite.dev/guide/features.html).

The critical constraint is the import graph: shared components, formatting helpers, the store, and tool replay must stop importing MIPS implementations. Otherwise a lazy registry leaves much of MIPS in the initial bundle. Use type-only imports for contracts, avoid eagerly re-exporting every backend, and inspect the production bundle to verify the result. Tool views are already lazy, but `createToolRegistry()` currently imports and instantiates tool models eagerly.

Switch targets transactionally through the composition module:

1. Preserve source/settings and stop and await the current run at a defined instruction boundary, including suspended input/sleep handling. Starting a new activation invalidates previous request tokens immediately.
2. Load and validate the requested module. Prepare configuration and contribution descriptors without attaching live observers, changing global editor providers, or creating a second running machine.
3. Commit the activation: detach the old contributions, bind the new ones, change the active-target reference, and clear runtime-derived state. Keep the old stopped machine until commit succeeds so failure can restore the previous activation; do not run or attach it concurrently with the replacement. Dispose it after successful commit.
4. On failure, dispose any partial registration and restore the previous stopped activation. Use idempotent cleanup handles and reject stale completions/progress callbacks by generation. Release old provider registrations, timers, observers, device queues, and service references.

Changing profile or dialect within a target follows the same invalidation rules when it changes assembly or machine semantics. Resolved modules may be cached; rejected load promises must allow retry. Since module imports cannot generally be cancelled, ignore stale results and clean up any resources they prepared. Use a neutral loading/error state in existing windows rather than publishing half of the new target's configuration.

Keep current source buffers and the shared layout when switching; selecting another target does not overwrite source with an example. Per-target workspace recall is optional future convenience. Never reinterpret old registers, memory, compiled code, history, or address breakpoints as the new CPU. Retained source-line breakpoints are resolved again only after assembly. Scope cached assembly results to source revision, target, dialect, profile, and relevant options. Loading previously visited modules again normally uses the browser's module cache; switching disposes live machines but does not unload imported JavaScript. Keep batched main-thread execution initially. A worker per active session is an optional later isolation strategy, with termination available for stronger cleanup, at the cost of a message/snapshot protocol.

Persist the target ID, profile, dialect, and options in a versioned workspace document. Treat old documents as MIPS and report unknown targets explicitly. Update browser restoration, archives, gists, share links, local-file filters, and examples together. `.uasm` must be supported; current source filtering only recognizes `.asm` and `.s`. Preserve an entry root for UASM libraries. Scope architecture settings appropriately while retaining one shared layout and global presentation preferences.

## Later architectures

Assuming “Risc5” means **RISC-V**, RV32I is a sensible later target. Select extensions explicitly. Compressed instructions are an early reason to support variable instruction lengths. See the [RISC-V ISA source](https://github.com/riscv/riscv-isa-manual/blob/main/src/unpriv/rv32.adoc).

For Arm, choose a concrete initial profile and supported subset. A32, T32/Thumb, and A64 differ materially; an Arm version number alone does not define the scope. Some targets need execution-mode changes within one machine, which is compatible with having only one active architecture. See [Arm's ISA overview](https://developer.arm.com/-/media/Arm%20Developer%20Community/PDF/Learn%20the%20Architecture/Armv8-A%20Instruction%20Set%20Architecture.pdf?revision=ebf53406-04fd-4c67-a485-1b329febfb3e).

For 6502 and Z80, plan for smaller registers, status flags, variable-length instructions, stack/address wrapping, and variant-specific behavior. Choose original 6502 versus 65C02 deliberately; the latter has its own [vendor documentation](https://www.westerndesigncenter.com/wdc/downloads.php). Z80 also needs an I/O address space and register aliases/pairs; consult the [Zilog CPU manual](https://www.zilog.com/docs/z80/z80cpu_um.pdf). Leave port I/O and interrupt hooks possible without implementing a general bus framework for Beta.

These targets justify flexible boundaries now. They do not require implementing their semantics before Beta works.

## Performance risks and difficult boundaries

No architecture implementation has been added, so these are risks inferred from the current code and the proposal, not measured regressions. Moving files, introducing TypeScript interfaces, and selecting a backend once do not themselves require significant runtime overhead. Dynamic loading adds first-use latency; it does not add a network operation per instruction. Architectural cleanliness should not be confused with making every low-level operation dynamically extensible.

The most important performance constraint is to compose at activation and keep execution inside the selected backend. The shared scheduler may call a backend's batch/step method, but instructions should not traverse a chain of generic services for every operand, register access, and arithmetic operation. Avoid asynchronous promises or worker messages per instruction. Preserve synchronous execution batches and publish progress between batches. Additional indirect calls and mixed object shapes are possible costs to benchmark, not proof that interfaces are too slow.

History is a higher-confidence allocation risk. `EffectStore` currently uses compact typed-array columns, and execution reuses cached decoded instructions. A generic design that creates register-change objects, byte arrays, dependency lists, display strings, and cloned machine views on every instruction could greatly increase allocation, garbage collection, and retained memory. Keep runtime register access numeric and direct; descriptors belong to inspection. Keep packed effects, cheap history envelopes, cached decode/metadata, and lazy formatting. A byte-oriented program-image API does not require a separately allocated byte array in every history entry.

Memory is another high-frequency boundary. Existing MIPS word accesses already assemble bytes through `readByte`/`writeByte`. Adding per-byte device discovery, policy callbacks, proxy layers, or conversion objects would multiply that work. Provide backend fast paths for ordinary RAM and width-aware access, with device/protection routing where required. Preserve write tracking and decode-cache invalidation. A generic debugger memory accessor need not be the accessor used for every CPU load/store.

UI publication can dominate even with a fast CPU loop. `thraxStore.ts` currently rebuilds source code rows across assembled files in `codeWordsByFile()` when publishing simulator views. Adding generic disassembly, register descriptors, or full memory copies to that operation could make large programs sluggish. Build static descriptors once, publish at bounded intervals, preserve view caching, and compute expensive inspection data for visible/changed regions. These existing costs should be measured separately from instruction throughput before attributing a regression to the backend interface.

Tool replay is already linear in the instructions replayed (`src/tools/replay.ts`). Replacing its decoder must not make every tool rebuild complete history on every UI refresh. Preserve lazy replay and versioned snapshots, attach only consumed observers, and generate rich instruction metadata only when needed. Repeated rewind across long histories may eventually justify checkpoints, but that is an existing algorithmic limit rather than an unavoidable cost of multiple CPUs.

The assembler can become slower through repeated token copying, recursive expansion, and rerunning complete layout unnecessarily. Cache reusable parsing/library work where semantics permit, keep symbolic expressions and emission fragments, and rerun only phases affected by unresolved sizes. Fixed-size instruction targets should not pay for optional relaxation on every build. Bound expansion and layout passes, and make failure diagnostic. UASM compatibility has semantic traps around expression rules, symbol binding, includes, location changes, and macro provenance; aggressive caching must respect those differences.

The hardest correctness boundaries are reversible CPU/device state, side-effect-free debugger inspection, variable-length/mode-dependent decoding, and asynchronous activation cleanup. A common history model must preserve backend control state without forcing MIPS fields onto Beta. Code writes or mode changes must invalidate the appropriate decode results. Closing or switching targets must stop old runs and remove providers, listeners, observers, and service state before stale callbacks can update the new workspace.

Single-location composition also needs scope discipline: it connects declared contributions through generic host APIs; it must not become a large switch containing each CPU's setup or special cases. CPU-specific setup stays behind the module's factories/hooks. Shared abstractions should be extended for demonstrated needs, avoiding a general hardware bus or cycle model before a supported target needs one.

Validate MIPS before/after with the same programs and settings: closed tools versus selected active tools; arithmetic-heavy versus memory-heavy loops; bounded history at representative depths; stepping/rewind/replay latency; and small versus large source files. Record execution throughput, browser responsiveness, retained heap after history fills, assembly time, startup/chunk size, and switching cleanup. Warm the runtime and repeat measurements; retain the existing MIPS algorithms during the first extraction so architectural changes can be assessed separately from algorithm changes. No slowdown percentages can be supported until this baseline and an implementation exist.

## Implementation sequence and completion criteria

Implement in reviewable stages. Each stage retains a functioning MIPS application and runs the relevant regression tests. Temporary adapters must have a named removal stage; their use during migration must not become a second permanent assembly or controller implementation.

1. **Baseline and contracts.** Run `npm test`, `npm run lint`, and `npm run build` (which includes type checking). Record existing failures separately from regressions. Capture execution, history-memory, assembly, and UI measurements with representative examples. Define the initial active-target, CPU, inspection/event, assembler-configuration, contribution, and history-schema contracts from actual consumers. Establish the Beta compatibility fixture list. Completion: current behavior/performance is recorded and responsibilities have one owner each.

2. **MIPS module and composition.** Introduce `src/architectures/contracts.ts` and `registry.ts`, move architecture-owned implementation/assets/tests into `mips/`, and adapt the existing runtime behind the active-target interface. Move runtime construction and architecture linking out of `thraxStore.ts`, `main.tsx`, and panel wrappers into composition. Add target identity to workspace persistence with legacy-MIPS migration and explicit unknown-target handling. Temporary forwarding exports can preserve tests during the move but must be removed by the next stage. Completion: MIPS loads through the single entry point, legacy workspaces open, and ordinary execution remains equivalent.

3. **Shared runtime, controllers, and inspection.** Extract common run/debug control and adapt register, memory, call-stack, history, console, and symbol controllers to neutral services. Replace shared MIPS disassembly/language imports, fixed-word code rows, and concrete decoded events. Register model contributions centrally; separate common pipeline controller/view/algorithms from MIPS model configuration. Make debugger reads side-effect-free. Retain one layout and stable common panel IDs. Complete the strict import boundary and remove forwarding exports. Completion: every existing MIPS window/tool works through its intended shared interface, including edits, source stepping, and rewind; no shared implementation imports a concrete architecture outside the registry.

4. **Configurable typed history.** Generalize allocation and recording around required common bookkeeping plus explicit MIPS extension columns. Convert entry storage separately from effects and keep comparison points between changes. Bind shared service recording without MIPS payload dependencies. Define oversized-entry, truncation, and eviction policies; handle block transitions and payload disposal across all declared buffers. Completion: backward/forward navigation reproduces registers, memory, input, device/service state, and suspended/faulting control state; history growth remains bounded and measured. A focused synthetic schema fixture with different column types/cardinalities verifies that the allocator does not assume MIPS's buffer shape, without creating a production fake CPU.

5. **Common assembler with MARS configuration.** Extract expression, macro, symbol, source-map, fragment/layout, fixup, diagnostic, and byte-emission machinery. Move MARS syntax/pseudo/encoding rules into explicit configuration and hooks; replace the temporary assembler adapter. Preserve current MIPS machine bytes, accepted/rejected source behavior, includes, symbol scope, warnings, and source mappings. Establish known-byte and negative fixtures in addition to round trips. Completion: the common assembler is the application path for MIPS, with no architecture-ID branches and no material unexplained assembly-time regression.

6. **Beta/UASM integration.** Add `src/architectures/beta/` and its one registry entry, supplying the CPU semantics, explicit history schema, UASM dialect/configuration, libraries, profile, editor metadata, and examples. Exercise shared source mapping with byte-emitting macros, call-stack extraction, history, memory/register editing, and applicable tools. A modeled Beta pipeline can reuse the common pipeline infrastructure; until a compatible model is supplied, the window reports its unavailable state. Completion: the declared Beta compatibility fixture set passes, selected encodings/results agree with an independent reference, and normal integration requires no new global lists or architecture branches. If Beta exposes a missing neutral contract, extend it deliberately and keep the MIPS regression suite green.

7. **Lifecycle, performance, and documentation.** Exercise MIPS-to-Beta-to-MIPS switching during runs, input waits, pending loads, and failures; restore shared-layout windows and re-resolve source breakpoints. Verify retry, cleanup, and stale-result rejection. Inspect production chunks to confirm the selected architecture loads on demand and inactive implementations are absent from the initial shell. Compare the recorded performance scenarios with identical settings; investigate regressions beyond measurement noise and require an explicit justified tradeoff for any material loss. Update README, feature architecture documentation, and repository guidance to match the implemented structure, scripts, memory/history limits, and supported Beta profile. Completion: the module extension contract, compatibility boundaries, and measured costs are demonstrated.

Use targeted tests after each change, with the full MIPS suite, lint, and production build at integration checkpoints. Browser checks should cover existing tools as well as the new selection/loading/error behavior. Do not treat encode/decode round trips alone as proof of ISA correctness: both can share the same mistake. Check independent expected words, boundary operands, memory effects, and branch targets. Performance comparison needs warmed repeated runs, closed/open tool scenarios, and separate CPU versus UI timing; no fixed slowdown percentage is justified before a baseline exists.

The structural decisions are settled: maximum practical sharing, one architecture directory and composition entry, a common configurable assembler, shared views/controllers and layout, and typed history with an explicit target schema. The exact initial Beta reference library/profile and supported feature checklist remain a bounded compatibility task for stage 1, not a reason to postpone the MIPS baseline and interface work. Detailed field names, block capacities, and adapter signatures should follow implementation evidence within these constraints.

The highest risks remain UASM compatibility, historical event/control-state fidelity, and activation cleanup. This final design pass checked those boundaries against the current source and aligned the delivery stages with the agreed constraints. No application code, implementation spike, benchmark, or runtime test was executed for this documentation-only review.
