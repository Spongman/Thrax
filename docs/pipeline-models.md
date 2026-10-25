# Pipeline view models and limits

The shared pipeline view displays one retired instruction stream. Stage timing,
dependency resources and availability come from the selected CPU backend. It does
not assume that every instruction set has a five-stage hardware implementation.
Speculative instructions that never retire are represented by control refill gaps,
rather than invented source rows. Counts begin when the tool starts watching.

| CPU model | Pipeline shown |
| --- | --- |
| MIPS, with or without delayed branching | Configurable five-stage, single-issue teaching model: IF, ID, EX, MEM, WB |
| MIT Beta | 6.004 pipelined Beta: IF, RF, ALU, MEM, WB; RF branch resolution and two load-to-use stalls with full bypass |
| ARM2 and ARM3 | Recorded fetch/decode/execute schedules from the simulator, including bus timing, multicycle execution, speculative fetch/refill and ARM3 cache effects |
| AArch32 and AArch64 | Explicitly hypothetical five-stage, single-issue teaching model; no specific Cortex core is selected |
| Cortex-M0, 6502/65C02/65C816, Z80, AVR, RV32IM/C, 68000/010/020, 6800/6809/68HC11, 8051, PowerPC, Alpha, 8086/8088/80186/80188 (with or without 8087), TMS9900, SPARC V8 and SH-1/SH-2 | No pipeline timing model is currently supplied; the panel says so and shows no unrelated controls or timeline |

An unavailable view means timing is unimplemented in THRAX. It does not imply
that a physical processor has no pipeline. In particular, neither an ISA such as
RISC-V nor an architecture state such as AArch64 specifies a unique pipeline.
Arm distinguishes ISA behavior from implementation choices such as pipeline length
in its [CPU architecture overview](https://www.arm.com/architecture/cpu).
The Beta model follows MIT's [Pipelining the Beta](https://computation-structures.github.io/course/lectures/L15_Pipelining_the_Beta.html).

## Scheduling and dependencies

The estimate models are in order and single issue. A stage stays occupied while
an instruction waits. Results use the selected register-file/bypass policy;
branches or register jumps resolved in ID must receive operands in ID even when
ordinary ALU operands are consumed in EX. A redirect cannot fetch its target
before its resolution stage finishes an operand stall. A32 ALU-to-PC and
load-to-PC instructions also wait for their own EX or MEM result, even if direct
branches/jumps use an earlier stage. MIPS delay slots execute
before the target fetch is charged its remaining refill cost.

Dependencies include register pairs, overlapping lanes, flags and base writeback.
Mixed-result loads distinguish memory results from ALU base updates. Static
conditional-write metadata can conservatively name possible destinations. A32
predicate outcomes are recorded explicitly, so failed predicates read condition
flags without inventing data reads, writes or unconditional redirects; replay uses
the same outcomes. The added A32 history column is one typed byte per entry.

The teaching models assume one cycle per stage and do not implement a separate
floating-point unit, multiply/divide latency, cache misses, bus arbitration or
out-of-order execution. They illustrate the selected rules rather than predict
performance of a named hardware core. Hardware-specific timing requires a native
model, not just another mnemonic/dependency table.

ARM2/ARM3 use the simulator's recorded reference-clock schedule instead. Changing
a hypothetical predictor cannot change it, so prediction is disabled. Control
refill time is measured in reference-clock ticks, separately from the two discarded
prefetch words. Configured slow memory can therefore make a refill exceed two ticks.
These models retain their existing limits around board-level MEMC, DRAM refresh
and electrical clock phase. Interrupt/exception overhead can leave gaps between
retired rows; the timing breakdown is not an exhaustive accounting of every tick.

## History and performance

Rewind, replay and timing-setting changes rebuild through the common retained
instruction history. After eviction, a replay can reconstruct only the retained
prefix. A tool opened during a run starts from the instructions it observes.
Native schemas remain typed column stores. A32 execution descriptors and both
predicate outcomes are cached; no object is created for every repeated instruction.
An unavailable model does no scheduling or branch-log work. The shared scheduler
still checks the same bounded recent-producer window while its panel is open.

The timeline renders at most 256 cycle columns at once, with paging for long
operations. Its stage view and hazard report read the same schedule. Tests cover
every selectable CPU/code variant, source-stage occupancy, executed delay slots,
early branch operands, native slow-memory/cache schedules and history replay.

Validation: all 35 CPU/code/optional-coprocessor configurations are covered by the
shared capability/replay test. Validation covers 5,783 passing tests (two skipped); lint,
type checking, production build and `git diff --check` pass. Browser checks cover
MIPS, Beta, ARM2, ARM3, A32/A64 and transitions to Cortex-M0/TMS9900's unavailable
view, including model captions and disabled hardware-prediction controls. SPARC
switching and its unavailable pipeline view were also checked in the browser.
