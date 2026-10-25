# Configurable CPU runtime measurements

Recorded on 24 October 2026 using Node v24.17.0, Windows 10.0.19045 and an
Intel Core i7-9700. Raw results: [new-cpu-benchmark.json](new-cpu-benchmark.json).

Reproduce with:

```sh
npm run bench:runtime -- --architectures=m6800,i8051,powerpc,alpha,i8086,w65816,tms9900 --steps=50000 --samples=1 --output=docs/new-cpu-benchmark.json
```

Each configuration has a 10,000-step warmup and one measured 50,000-instruction
Mandelbrot run, followed by rewinding half the retained history and replaying it.
This is a smoke measurement rather than a statistically stable comparison.
Assembly, activation, machine construction and GC are outside the timers.
Rendering, browser JIT and asynchronous scheduler yields are excluded. Different
native ports execute different instruction sequences; these rates describe the
simulator workload rather than guest hardware speed. There is no before/after baseline.

| CPU | 2K history, tools closed (M instr/s) | 1M history, tools closed | 1M history, tools open | Typed bytes/entry | Rewind 25K entries, tools closed (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6800 | 2.14 | 2.33 | 0.64 | 88 | 8.2 |
| 8051 | 1.21 | 1.19 | 0.48 | 120 | 14.1 |
| PowerPC | 2.34 | 2.33 | 0.73 | 213 | 10.9 |
| Alpha | 0.48 | 0.49 | 0.32 | 328 | 44.4 |
| 8086 | 1.15 | 1.27 | 0.54 | 136 | 9.1 |
| 65C816 | 1.54 | 1.41 | 0.60 | 107 | 10.0 |
| TMS9900 | 1.00 | 0.98 | 0.47 | 149 | 20.4 |

The production tool registry requested statistics, profile, cache, branch history,
pipeline and memory references. These CPUs do not publish a pipeline timing model,
so that panel contributes no native pipeline simulation. Tools attach only while
wanted. The observed slowdown with tools open is approximately 1.5–3.7 times;
requesting snapshots after rewind adds approximately 24–29 ms of deferred rebuilding.

History remains a typed column store. Each family explicitly declares register
cardinality, exact wide storage and instruction-byte capacity. These cores capture
complete small register files, with sparse byte deltas for memory; they never copy
all RAM per instruction. The reported bytes/entry include partly filled blocks,
exclude spare pooled blocks, RAM and tool/object heaps, and describe this workload.
Alpha has the largest cost because 32 exact 64-bit registers require two 32-bit
columns per register. One million Alpha entries at this density would exceed the
256 MiB typed-buffer budget, so eviction occurs before that target. PowerPC also
has a larger register footprint than the eight-bit cores. Sparse register deltas
could reduce this in a separate, measured optimization.

Repeated native decoding is cached by address, mode and fetched bytes. Page versions
invalidate modified/generated code, including data writes that overlap code pages.
Repeated encodings reuse decoded identities. A rare cleanup scans retained decode
ids after 65,536 distinct decodes; ordinary stepping performs no such scan. RAM-backed
8051/TMS9900 register snapshots use side-effect-free reads. Exact Alpha bigint
arithmetic is measurably slower than the 32-bit paths. All measured runs completed
and respected the configured history retention policy.

As with existing cores, observer tools rebuild from retained history after a seek.
If older entries were evicted, the reconstructed result covers the retained prefix;
it cannot recover discarded events. The configured adapter uses the existing
shared policy. Long REP operations on 8086 are one debugger instruction and can
produce large memory journals; an interrupted or faulted operation still rolls
back atomically, even if its history row exceeded the retention budget.

## SPARC V8 addition

[sparc-benchmark.json](sparc-benchmark.json) records a later SPARC-only measurement
on the same host and Node version. Each mode has a 10,000-instruction warmup and
three 100,000-instruction Mandelbrot samples; the table uses the median sample.
Reproduce with `node --expose-gc scripts/benchmark-runtime.mjs --architectures=sparc --steps=100000 --samples=3 --output=docs/sparc-benchmark.json`.

| History target | Tools | M instructions/s | Typed bytes/retained entry | Rewind / replay (ms) |
| --- | --- | ---: | ---: | ---: |
| 2K | Closed | 1.07 | 236 | 2.2 / 2.0 (1,872 entries) |
| 1M | Closed | 1.05 | 217 | 49.0 / 48.2 (50,000 entries) |
| 1M | Open | 0.60 | 217 | 60.6 / 58.0 (50,000 entries) |

The same set of shared tools was requested. Deferred tool rebuilding after the
watched rewind/replay adds 44.9/38.7 ms. There is no SPARC pipeline timing model.
The 2K target retains 3,744 entries in this sample because eviction works on
whole typed blocks; it is a target rather than an exact row count.

SPARC keeps 36 visible register/control words in each entry. Its 140 internal
words, including inactive register windows and pending delay state, use sparse
byte effects in the existing typed journal. They are not copied wholesale per
instruction, and produce no fake guest RAM/tool traffic. The measured density is
specific to this instruction mix; window rotations or more varied register
values change it. Sparse effects consume the same history byte budget. Exact
multiply/divide use bigint intermediates. No changes to another CPU's native
arithmetic path are required. This sample does not establish a before/after
performance comparison against the preceding implementation.

## 6809, 68HC11 and SuperH

[m680x-sh-benchmark.json](m680x-sh-benchmark.json) contains three measured
100,000-instruction Mandelbrot runs per mode, after 10,000-step warmups, on the
same Node/Windows/i7-9700 host. Reproduce with
`node --expose-gc scripts/benchmark-runtime.mjs --architectures=m6800,sh --steps=100000 --samples=3 --output=docs/m680x-sh-benchmark.json`.

| CPU | 1M history, tools closed (M instr/s) | Tools open | Typed bytes/entry | Rewind / replay 50K entries, tools closed (ms) |
| --- | ---: | ---: | ---: | ---: |
| 6800 | 2.45 | 0.76 | 86 | 16.9 / 15.3 |
| 6809 | 1.86 | 0.66 | 104 | 19.5 / 18.5 |
| 68HC11 | 2.03 | 0.74 | 96 | 19.9 / 18.2 |
| SH-2 | 2.64 | 1.02 | 151 | 16.7 / 16.8 |
| SH-1 | 1.77 | 0.92 | 151 | 18.4 / 18.2 |

These are workload samples, not stable CPU-to-CPU or before/after comparisons.
Both SuperH examples use the common SH-1 instruction subset; the different
measured rates include JIT/sample variation. Six observer tools were requested
as above, with no native pipeline scheduling for these CPUs. Grouping families
adds routing at assembly/activation/editor boundaries, not to instruction
execution or history replay. All hot CPU and typed-history paths remain native.

The Motorola variants share byte/word arithmetic, flags, stack primitives and
branch conditions. The common branch condition helper avoids allocating an
array on every branch. 6809/68HC11 snapshots explicitly add their visible
registers, including reversible D aliases of A:B. SuperH reuses SPARC's generic
sparse internal-state journal for four delayed-control words. Native multiply
accumulates and double products retain exact bigint intermediates. No complete
RAM image or physical-window snapshot is added per instruction.

Combining 65C816 with 6502 and ARM26 with ARM leaves their native execution and
history codecs unchanged. A service release hook clears live configured-runtime
references, so cached editor providers do not retain a disposed CPU's RAM/history
after a switch. All families keep the same default history target and memory
budget. As above, table bytes exclude object/tool heaps and spare pooled blocks.

## x86 CPU variants and optional 8087

[Raw measurements](x86-variants-benchmark.json) cover all eight CPU/coprocessor
combinations: 100,000 steps, three samples per mode and 10,000-step warmups.
Reproduce with `node --expose-gc scripts/benchmark-runtime.mjs --architectures=i8086 --steps=100000 --samples=3 --output=docs/x86-variants-benchmark.json`.
The workload is the same integer Mandelbrot source with or without the FPU;
these measurements isolate enabled-state/history costs, not floating-point speed.

| CPU | No FPU, tools closed (M instr/s) | 8087 enabled | No FPU / 8087 typed bytes per entry | No FPU / 8087 rewind 50K entries (ms) |
| --- | ---: | ---: | ---: | ---: |
| 8086 | 1.30 | 1.23 | 133.6 / 262.1 | 17.0 / 21.5 |
| 8088 | 1.30 | 1.22 | 133.6 / 262.1 | 17.6 / 21.9 |
| 80186 | 1.27 | 1.22 | 133.6 / 262.1 | 17.6 / 21.9 |
| 80188 | 1.28 | 1.22 | 133.6 / 262.1 | 17.7 / 22.3 |

With six observer tools requested, all combinations measure roughly 0.58–0.62M
instructions/s. Enabled FPU state adds 32 u32 register words (128 bytes per
retained entry); the small additional table difference includes block rounding.
Replaying 50K entries measures 17–18 ms without the FPU and about 22 ms with it,
tools closed. These are samples on one host, not before/after regression claims.
The existing byte budget still bounds retained blocks, so an enabled FPU may
retain fewer entries than a narrow CPU when the budget is reached.

The shared logical-register view formats 80-bit values only at inspection/UI
boundaries. Recording and replay still copy/exchange native typed words directly.
No per-entry FPU objects, full memory snapshots or family-dispatch calls were
added. The exact binary arithmetic helpers are shared and used only for FPU
instructions; non-FPU execution does not perform bigint arithmetic.
