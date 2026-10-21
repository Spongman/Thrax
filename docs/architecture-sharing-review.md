# Architecture sharing review

Reviewed and updated 21 October 2026 for the shared workbench refactor.

## Implemented follow-up

The confirmed debugger inconsistencies have now been fixed through shared machinery:

- [ExecutionController](../src/core/executionController.ts) owns scheduling, pacing,
  yielding, cancellation, Stop, Run To, and Step Over/Out completion for all CPUs,
  including MIPS. CPU modules retain call classification and native step/wait results.
  Step Over checks return address and frame depth, ignores its starting breakpoint
  during recursion, and never adds or removes user breakpoints.
- [HistoryCursor](../src/core/historyCursor.ts) now also backs MIPS. Row selection,
  retained futures and edit branching share policy. Selecting a row already at or
  ahead of the cursor returns false without changing the machine. Bulk rewind avoids
  repeatedly rebuilding observer state for each restored entry where the codec allows it.
- [MemoryEdits](../src/core/memoryEdits.ts) owns range validation and shift construction.
  Every CPU supplies its editable regions and commits one reversible edit. AVR and
  Cortex-M0 now implement insertion/deletion. AVR keeps flash, register aliases,
  special registers and SRAM separate; sparse MIPS memory supplies its tail lookup
  so a shift does not scan an enormous empty address range.
- [FrameStack](../src/core/frameStack.ts) owns typed storage, growth, history hooks and
  innermost-frame matching for Beta, Z80, 6502, ARM26, A32 and A64. Each explicitly
  selects its frame width and array type. Field decoding, ABI and unwind detection
  remain in the CPU directory.

- [ImageProgram](../src/core/imageProgram.ts) now supplies image bytes, symbol/data
  adaptation and source rows for every image-based target. Instruction lengths and
  native entry/symbol rules remain callbacks or small subclasses.
- [Architecture services](../src/core/architectureServices.ts) and
  [DisposableScope](../src/core/disposableScope.ts) own replacement, activation guards,
  editor resources, partial-setup rollback and late async cleanup for every family.
- [Assembly language providers](../src/services/assemblyLanguage.ts) share registration,
  completion ranges and hover adaptation. CPU directories supply grammar and token data.
- [Instruction help](../src/core/instructionHelp.ts) and the
  [tooltip UI helper](../src/services/tokenTooltip.ts) give source and disassembly the
  same content and a corner reference-link button. Native tables cover the instruction
  catalogs, conditional forms, compressed instructions and model-specific opcodes.

The final approved follow-up is also implemented:

- Instruction dependencies describe arrays of resources, including multiple writes,
  ARM condition flags, W/X aliases, MIPS FP lanes and HI/LO. The shared pipeline checks
  every destination and distinguishes memory results from ALU base writeback.
  Metadata stays cached; no dependency dictionary is allocated in the pipeline loop.
- Device interrupt requests identify backend-defined lines. MIPS Cause encoding,
  handler refusal and dropped-request behavior are documented and implemented locally.
- Profiles explicitly select indexed-byte or RGB32 bitmap layout and byte order.
  Examples can override the format and palette; loading another example/CPU clears
  those overrides. CPU word size only enables a matching word-read fast path.
- [Edit transactions](../src/core/editTransaction.ts) own edit lifetime and rollback
  coordination across all targets. Six delta backends also share close/undo/discard
  handling. Native callbacks retain writes, capture, memory maps and invalidation.
- [History views](../src/core/historyView.ts) own bounds, slicing, contiguous ID lookup,
  count-only reads and effect labels. Native codecs still materialize and decode their
  records. Count-only replay queries allocate no history rows. Snapshot codecs also
  use the common count/slice/effect helpers and hidden-output storage.
- [Console transport](../src/core/console.ts) shares retained input/cursors, integer
  input parsing and bounded string reads. The [Linux console environment](../src/core/environments/linuxConsole.ts)
  shares read/write/brk behavior for A32/A64. Their service numbers, register ABI,
  result width, faults and supervisor outcomes remain native. The shared
  [polled terminal](../src/core/devices/polledTerminal.ts) takes an explicit MMIO base;
  A32 no longer imports a device class from the A64 machine.
- [Assembler text helpers](../src/core/assembly/text.ts),
  [integer arithmetic](../src/core/assembly/integerArithmetic.ts) and
  [source-line traversal](../src/core/assembly/sourceLines.ts) replace repeated scanners
  and recursive RISC-V/68k includes. Traversal shares the existing iterative expander,
  with explicit depth/expansion/line limits and streaming consumption. Native grammar,
  precedence, AVR arithmetic shifts/byte extraction, encoders and pools stay local.
- [Inspection helpers](../src/core/inspection.ts) share label lookup, integer descriptions
  and side-effect-free previews. Hover comment boundaries reuse the quote-aware scanner.
- Shared address formatting/navigation, cache tags, pipeline/profile keys and symbol
  lookups preserve safe integer addresses above 32 bits. Register words retain native
  wrapping. A64 values beyond the safe address range remain display-only; this does not
  add a full 64-bit virtual-memory implementation. Source gutters size their address
  column for the current file.
- Beta/Z80 native history constructors now use the workbench's one-million-entry policy.
  Architecture-declared buffers and the existing 256 MiB typed-byte budget are preserved.

The evidence below records the pre-extraction findings.

## Assessment

The UI boundary is mostly correct. History, registers, memory, call stack, examples,
pipeline, settings and docking already have shared views and substantial shared
controllers. The review identified excessive workbench policy below those views. The follow-up
above centralizes the run/debugger/history/edit mechanics and the confirmed reusable
assembler, inspection and console/device helpers.

An architecture should supply instruction execution, state access and reconstruction,
instruction/ABI descriptions, and its supported machine environment. A shared runtime
should own execution scheduling, user pause/stop, breakpoint traversal, history
navigation, edit transactions and tool lifecycle. Register widths and instruction sets
do not justify separate implementations of those operations.

This review covers ownership and reuse across all nine registered architecture
families and the AArch32, AArch64 and Cortex-M0 execution states. It examines runtime,
history, call stack, memory editing, assembly, program/source adapters, editor,
services, devices, metadata, tests and UI boundaries.

## Concrete behavioral findings

### 1. History navigation was implemented as different operations — corrected

MIPS retained a recorded future and moved a cursor. The other runtimes originally
undid state and truncated the log. The shared history window called the same method
and received different behavior. No ISA difference justified this.

The correction adds shared [cursor policy](../src/core/historyCursor.ts) and
[reversible-history storage/navigation](../src/core/reversibleHistory.ts). Six delta
codecs inherit the latter. AVR, RISC-V, 68k and Cortex-M0 use the shared cursor and
state/frame/byte exchange helpers. Architecture schemas still explicitly declare
their buffers. Replay applies stored effects, including accepted input and manual
edits, without executing device operations again.

The new [cross-architecture tests](../src/architectures/__tests__/historyNavigation.test.ts)
check retained row identities, repeated navigation, replay, output, memory, registers,
halt, input and divergent edits across variants. Older AVR/RISC-V store tests actually
expected a rewound manual edit to disappear when continuing; those expectations also
encoded the wrong shared behavior and have been corrected.

MIPS now uses the same cursor and branching policy, with its effect interpretation
remaining [in the simulator](../src/architectures/mips/core/simulator.ts). The snapshot codecs now also share slicing, direct count reads and effect presentation;
their field capture and reconstruction remain native.

### 2. Step Over uses different completion criteria — corrected

Reproduced live with a small recursive Beta program. Step Over started at PC 32,
call depth 1, and stopped at PC 36, depth 3. A deeper invocation returned to the same
address, satisfying the temporary breakpoint before the original call had returned.

[Beta](../src/architectures/beta/runtime.ts) previously used a return-address breakpoint.
The older MIPS, Z80, ARM26, A32 and A64 implementations used the same general pattern.
[RISC-V](../src/architectures/riscv/runtime.ts), AVR, 68k and Cortex-M0 already checked
call depth. Shared regression tests now exercise recursive calls across every family.

The shared execution controller now owns completion and breakpoint policy. A backend
supplies whether the current instruction calls, whether its condition passes, its
return address and the current frame depth. Delay slots,
compressed instruction lengths and banked link registers stay in that description.

### 3. Stop/Continue has different meanings — corrected

Reproduced through the runtime APIs using each target's Sum example. After one
instruction, Stop then Continue left AVR at instruction count 1; 68k continued to
instruction count 8 and halted normally.

[68k's runner](../src/architectures/m68k/runtime.ts) previously cleared its user-stopped flag
when a run starts. [AVR](../src/architectures/avr/runtime.ts) previously set `halted` and
its runner refused to start. MIPS also treated user Stop as terminal until a fresh run.

The shared controller now keeps user Stop separate from CPU halt/wait. Stop is terminal
until rewind, a PC edit or a fresh assembly; Pause permits Continue. ISA-specific
HALT/WAI/WFI behavior remains a backend fact.

### 4. Common memory-edit operations are missing on some targets — corrected

[AVR](../src/architectures/avr/runtime.ts) and
[Cortex-M0](../src/architectures/armv8/m0/runtime.ts) previously returned false
for insert/delete. Other targets copied byte-shifting loops.
The common interface and memory panel offer these operations without describing
that difference as a capability.

The shared edit builder now validates and shifts within architecture-owned editable
spans and commits one reversible transaction. AVR flash versus
SRAM, device holes and cache/prefetch invalidation require explicit backend handling;
they do not require different insert/delete controllers. If a region truly cannot
support an operation, expose that to the common view instead of silently rejecting it.

### 5. Copied runners have a responsiveness risk — corrected

The older runners counted only source-visible instructions toward a paced batch.
The [Beta loop](../src/architectures/beta/runtime.ts), for example, could continue
before incrementing `executed` when the next PC has no source row. ARM26, A32, A64,
6502, Z80 and MIPS contained the same pattern. A run that remains in executable unmapped
code could therefore avoid the batch boundary in paced mode. This is a code-level
finding; a browser hang was deliberately not induced during this review.

The shared scheduler now has independent raw-step and elapsed-host-time budgets,
regardless of how many source rows it animates. The newer runners previously had
different combinations of raw-step and time limits, which is further evidence that
this policy should have one implementation.

## Ownership decisions

| Area | Current evidence | What should be shared | What stays architecture-owned |
| --- | --- | --- | --- |
| Run loop and pacing | Originally ten copied runtime runners plus the MIPS simulator; all now delegate scheduling to `ExecutionController`. | One scheduler: yielding, pacing/catch-up, cancellation, progress publication, raw-step/time budgets and user run state. | Execute one machine event; report halt/wait/fault and retirement facts. |
| Debug controls | `ExecutionController` now owns completion and breakpoint traversal; `DebugSession` retains shared source-level stepping. | Run-to, Step Over/Out, breakpoint-start rules and cleanup; source-level stepping remains in the existing common session. | Call/return/conditional classification, instruction length, return address, frame extraction and address normalization. |
| History | Block allocation/limits already use `HistoryLog`; the fix shares cursor/navigation and exchange helpers. | Retention, cursor, traversal, branching, stable row adapters, replay notifications, common history controller and contract tests. MIPS cursor policy is now migrated. | Explicit typed schemas, field capture/exchange, device/cache/pipeline state and effect interpretation. |
| Call stack | Beta/Z80/6502/ARM26/A32/A64 now share `FrameStack` storage and history hooks. Other targets use arrays of common `CallFrame`s. | Frame storage, capacity growth, inverse deltas, snapshots and shared call-stack navigation/controller. | Detecting calls/returns/interrupts, ABI arguments, frame pointers, banked registers, address masks and unwind heuristics. |
| Memory inspection/editing | Shifts now share `MemoryEdits`; AVR/M0 operations are implemented. Some inspector readers remain repeated. | Side-effect-free inspector helpers, edit transactions, range/shift operations, validation and change publication. | Memory maps, aliases, byte order, widths, Harvard translation, device protection and cache invalidation. Hardware load/store semantics stay in CPUs. |
| Assembled programs | Image adapters now delegate source rows, symbols, section reads and data extraction to `ImageProgram`. MIPS retains native scoped-symbol adaptation. | One `AssemblyImage` adapter and section-byte reader, with configurable instruction spans and data-row policy. | Entry convention, address translation, decode/length callbacks, dialect-specific symbol scopes and extra program metadata. |
| Assembly | Most targets already use shared statements, layout, symbols, emission, expressions and source expansion. Newer frontends now share comment scanners, argument splitting, integer arithmetic and include traversal. | Configurable lexical helpers, ordinary integer arithmetic policies, common directive parsing and include/diagnostic plumbing. | Syntax/precedence configurations, encoders, addressing modes, range checks, macro rules, relaxation and literal pools. |
| Editor providers | Shared language registration, completion ranges, hover presentation and disposal are in place; RISC-V/68k providers moved out of `index.ts`. | Provider registration, completion construction, generic register/symbol hovers, definition-navigation integration and resource ownership. | Grammar, token patterns, register aliases, instruction docs/completions and dialect symbol rules. |
| Console services | A32/A64 share Linux console mechanics. Teaching integer validation and bounded string reads are shared by RISC-V/M0/68k. | Buffered input/output, conversion helpers and reusable service handlers selected by explicit environment configuration. | Service numbers/register ABI, guest memory access, errno/width conversion, traps and supported service sets. |
| MMIO devices | Input/output transport is shared. A32/A64 select a reusable polled terminal with an explicit MMIO base; timer/IRQ protocols remain native. | Reusable FIFO/text-output/timer primitives where semantics match; common device-window adapters. | Register maps, read side effects, IRQ wiring, timing units, terminal HALT versus interrupt sleep and device protocols. |
| Service lifecycle | All nine family factories now use common service/resource ownership; registry activation cleanup remains shared. | A typed service/resource factory handling guards, replacement, late async completion and disposal. | Concrete assembler, backend, profile, editor configuration and specialized tools. |
| Profiles and settings | Shared settings engine exists; Beta/Z80 native constructor defaults now use the workbench's 1,000,000-entry policy. | Workbench policy/defaults and capability descriptions; factories should receive limits explicitly. | Reset state, memory sections, aliases, model choices and supported features. |
| Examples | Shared catalog/menu/controller and required-tool activation exist; source and metadata remain local. | Names/order, loading behavior, tool activation and result/reference tests. | Assembly source, algorithm precision choices and required tools. |
| Pipeline/tools | Shared pipeline controller/view uses stage/hazard/timing descriptions. Shared statistics/cache/branch/profile tools use observer contracts. | Keep common rendering, pagination, selection, replay and lifecycle here. | ISA classification, genuine pipeline/timing data and specialized hardware models. |
| X-Ray and board-specific panels | MIPS contributes its datapath and device panels through common docking/tool registration. | Panel shell, selection/navigation, subscriptions and lifetime. | Datapath wiring, SVGs and board-specific device behavior. |

Before extraction, A32/A64 had identical 42-line runner bodies; Beta/ARM26 and
ARM26/A32 were about 95% textually similar. Those copies have been removed.

## Additional boundary cleanup

The MIPS parser/instruction types and effect kinds now live under
`src/architectures/mips/core/`. Its legacy source-row adapter moved to
`src/architectures/mips/sourceIndex.ts`; the common source index accepts neutral rows.
The other adapters now share image conversion, with explicit instruction sizing,
symbol visibility and Harvard entry conventions.

The assembly engine should continue accepting dialect configurations. Replacing all
frontends with one rigid grammar would lose UASM macros, ca65/Zilog conventions,
GNU/armasm differences and valid ISA-specific encoding choices. Existing shared ARM
encoding/parser code is useful family-level reuse, including ARM26 and A32.

## Implemented boundary and sequence

The UI-facing `Machine` contract is preserved. Shared execution/history/edit
controllers own workbench policy through composition with native state backends. Architecture registration still happens through the registry;
the common runtime imports contracts and helpers, never concrete CPU directories.

The backend supplies raw step/restore/edit primitives, machine state, flow descriptions,
memory/profile capabilities and history codecs. The facade implements workbench policy
once. Use an explicit capability where behavior is unsupported, rather than an ISA
switch or an undocumented false-returning stub.

Migration sequence and status:

1. Completed: shared contracts for Stop/Continue, recursive Step Over/Out, breakpoint
   ownership, input replay and edits, plus deterministic scheduler tests for host
   budgets, run-to-current-PC, waits, faults, speed changes and cancellation. Existing
   observer/disposal/architecture-switching suites remain part of full validation.
2. Completed: every target, including MIPS, now uses the shared execution controller,
   fixing recursive Step Over, Stop/Continue and hidden-code yielding.
3. Completed: MIPS history cursor migration, common memory-edit construction and typed
   call-stack storage. Capture/exchange codecs remain explicit and typed.
4. Completed: program/source adapters, service/editor resource ownership, shared hover
   formatting and MIPS boundary cleanup. These are cold paths.
5. Completed: dependency/device/bitmap contracts, edit transactions, history/effect
   presentation, selective assembler/console/device/inspection helpers and common
   address-width cleanup, backed by dialect/ABI/device and boundary tests.

## Performance constraints

Keep the CPU execution loops, decoders and hardware memory access paths specialized.
Share the host loop at the existing step boundary, with one cached backend reference.
Preserve the zero-observer fast path and lazy tool attachment. Avoid an allocated event
object, register dictionary or full RAM snapshot per instruction.

History must continue using architecture-declared typed columns and sparse effects.
Generic helpers may exchange those columns; they should not force every CPU into a
single full-register snapshot layout or invent default additional buffers. The current
fix exchanges data in place and adds small control columns where immutable row metadata
must remain separate. Console replay retains the hidden output suffix.

Keep the existing byte budget as well as the entry limit: `HistoryLog` currently uses
a 256 MiB default typed-buffer budget. A setting of one million entries is a capacity
target subject to that budget, and schema/effect sizes vary. A shared retention status
now explains retained entries, typed allocation and eviction consistently without architecture-specific UI logic.

Cold-path abstractions for assembly, source indexes, editor setup and service lifecycle
are low performance risk. The final extractions add no full RAM snapshots or generic
per-instruction event objects. Native typed schemas are unchanged. Matching bitmap and
inspection word reads retain fast paths; source visitors stream without retaining a
second expanded-line array. Wider pipeline dependencies add bounded resource comparisons
only while that tool is attached, over the existing eight-instruction producer window. Scheduler extraction needs bounded-host-time checks and
representative run/rewind benchmarks. Pipeline and cache correctness must retain their
CPU-specific timing/cache codecs through the migration.

## Validation and status

Final validation: 197 test files passed, two skipped; 5,132 tests passed, two skipped.
ESLint, type checking, production build and `git diff --check` passed.

Cross-architecture contract tests cover history retention/replay, accepted input,
recursive Step Over/Out, unchanged user breakpoints, Pause/Stop/Continue, rewinding
stopped runs, and single-entry insert/delete edits across families and exposed
code/register variants. Dedicated AVR checks cover Harvard boundaries and aliases.
Deterministic scheduler tests cover hidden code, raw-step/time budgets, cancellation,
fault cleanup, speed changes, waits and Run To the current PC.

The approved follow-up sequence is complete. ISA execution, native history schemas,
interrupt/timing rules, dialect grammars and ABI register mapping remain specialized.

Browser verification of the original Beta reproduction now goes from PC 32/depth 1
to PC 36/depth 1, rather than depth 3. A local Chromium scheduling sanity check
(no tools, 2,000 retained entries, warmed median of three 200,000-step runs) took
27.1 ms for Beta and 22.4 ms for MIPS. Direct synchronous stepping took 21.2 ms and
14.3 ms respectively; it omits host yields and debugger scheduling, so these are
not before/after regression measurements or a substitute for workload benchmarks.

The shared MIPS history view also retains all eight rows after double-clicking row
two, with seven rows marked ahead of the cursor.

Instruction hover coverage checks every completion catalog and representative native
conditions, suffixes, compressed links, undocumented instructions and model restrictions.
Source and disassembly share reference-button rendering. Browser checks confirmed the
BGE hover and its corner action, including separation from Monaco's copy button.

Every Mandelbrot port hardcodes the same 16-iteration limit and MIPS palette in
its own example; there is no shared constants module or generated palette data.
Cross-CPU framebuffer tests compare every pixel with a reference using each port's
native arithmetic and viewport. Byte-indexed targets select the example palette through
the shared Bitmap Display configuration.

A live two-file-drop reproduction exposed a shared dock race: activating the neighbouring
tab reconciled file panels before the deferred close had completed, recreating the tab.
Pending removals now suppress that recreation while retaining Dockview moves. Tests cover
this event ordering; browser verification closed both dropped tabs, closed the final
editor and reopened a file from Files.

The final follow-up also has regression coverage for multi-register/flag/alias hazards,
ALU writeback versus memory bypasses, failed native edit rollback, allocation-free
history count reads, strict console input, Linux wait/fault behavior, quoted text and
relative/repeated/bounded includes. Cache/profile/pipeline/gutter tests retain addresses
above 32 bits; bitmap tests prove layout is independent of CPU word size and byte order.

Live browser checks after the final extraction rendered both MIPS RGB and 6502 indexed
bitmap examples through the shared panel. MIPS retained all 11 Sum history rows and
6502 retained all 170 after selecting the second row twice and replaying to completion;
row identities were unchanged. The production build succeeds with its existing warning
about large Monaco/application chunks. A subsequent follow-up adds the [runtime benchmark matrix](runtime-benchmarks.md) across 16 CPU/model configurations, with execution, rewind, deferred tool rebuilding and typed-buffer retention measurements. It is not a before/after speedup claim.


## Tool metadata and retention follow-up

Native descriptors now name flags, pair/list results, stack changes, alternate and
aliased registers for Z80, AVR, 6502/65C02, Cortex-M0 and 68k. Their caches keep
construction off repeated instruction paths. Tests check independent encodings and
compare actual changed data registers against metadata in representative ports.
Memory-dependent flags use the loaded-result latency, separate from ALU base updates.

Branch-table indexing and memory-reference grouping take explicit instruction alignment
and memory word bytes from each machine’s tool configuration. Standalone tools use
bytes. No tool branches on an architecture ID. RISC-V compression and Thumb use
two-byte instruction alignment; byte-addressed data targets keep byte grouping.

The shared history log supplies retention counters through every machine history and
one common History footer. Per-architecture typed columns and the existing pooling,
entry-target and byte-budget policies remain in place. See the benchmark report for
remaining full-register codecs, tool overhead and deferred-replay costs.
