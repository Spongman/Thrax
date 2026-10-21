# Runtime and history benchmark

Recorded 2026-10-21T07:31:46.654Z on Intel(R) Core(TM) i7-9700 CPU @ 3.00GHz, Windows 10.0.19045, Node v24.17.0. Raw samples: [runtime-benchmark.json](runtime-benchmark.json).

Run `npm run bench:runtime` to reproduce. Options use equals signs: `npm run bench:runtime -- --steps=100000 --samples=3 --architectures=mips,beta --output=results.json`. The script loads each CPU through the registry; the assembly stays in each architecture’s existing Mandelbrot example. No new native imports are required in the runner.

Method: one 10,000-step warmup and three fresh-machine samples per configuration, 100,000 synchronous `step()` calls, then rewind half the retained entries and replay that future. Assembly, activation, machine construction and explicit GC between samples are outside the timers. Each row uses the sample with median execution time; its other measurements belong to that same run. All samples here retired 100,000 instructions.

The three modes are a 2,000-entry target with tools closed, a 1,000,000-entry target with tools closed, and a 1,000,000-entry target with all six common tools open (statistics, profile, cache, branch table, pipeline and memory references). Tool defaults are used through the production registry. History is enabled in every mode; there is no common history-disabled runtime mode. Entry targets are subject to whole-block retention and the 256 MiB typed-buffer budget.

These measurements isolate execution/history and observer costs. They exclude React rendering, periodic UI snapshot refresh, host scheduling/yields, source following and browser JIT differences. Native Mandelbrot ports have different instruction sequences and arithmetic, so the rates compare simulator paths on this workload, not guest CPU hardware performance. There is no pre-change baseline from which to claim a speedup or regression.

## Execution

Rates are millions of retired guest instructions per second. Slowdown compares the two one-million-entry modes.

| CPU | 2K, tools closed | 1M, tools closed | 1M, six tools | Tool slowdown |
| --- | ---: | ---: | ---: | ---: |
| MIPS | 3.15 | 3.58 | 0.47 | 7.7× |
| Beta | 3.05 | 2.99 | 0.37 | 8.1× |
| NMOS 6502 | 1.00 | 0.99 | 0.38 | 2.6× |
| W65C02 | 1.00 | 1.02 | 0.38 | 2.7× |
| Z80 | 1.11 | 1.06 | 0.50 | 2.1× |
| A64 | 1.14 | 1.29 | 0.26 | 5.0× |
| A32 | 2.06 | 2.00 | 0.28 | 7.3× |
| Cortex-M0 | 2.02 | 1.89 | 0.68 | 2.8× |
| ARM3 | 1.16 | 1.13 | 0.25 | 4.6× |
| ARM2 | 1.22 | 1.14 | 0.23 | 4.8× |
| AVR | 3.17 | 3.65 | 0.76 | 4.8× |
| RV32IM | 3.74 | 3.20 | 0.84 | 3.8× |
| RV32IMC | 3.71 | 3.16 | 0.86 | 3.7× |
| 68000 | 1.04 | 0.84 | 0.41 | 2.0× |
| 68010 | 0.94 | 0.97 | 0.41 | 2.3× |
| 68020 | 1.07 | 0.95 | 0.43 | 2.2× |

## Retention and rewind

Memory is live typed-buffer allocation after the 100,000-step execution, rounded to one decimal MiB. Bytes/entry include partially filled blocks. Payload objects, tool storage and the machine’s RAM are additional. Rewind times are for 50,000 entries. Tool rebuild is measured by requesting snapshots after rewind; it is lazy and separate from the machine’s restore cost.

| CPU | Live MiB | Bytes/entry | Rewind, tools closed (ms) | Rewind, six tools (ms) | Deferred tool rebuild (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| MIPS | 4.7 | 49 | 14.2 | 23.7 | 123.7 |
| Beta | 6.3 | 66 | 9.6 | 18.0 | 93.3 |
| NMOS 6502 | 6.9 | 72 | 9.0 | 19.2 | 60.7 |
| W65C02 | 6.9 | 72 | 9.1 | 19.0 | 64.8 |
| Z80 | 8.7 | 91 | 12.9 | 22.4 | 88.2 |
| A64 | 8.0 | 84 | 17.0 | 25.6 | 101.5 |
| A32 | 7.3 | 77 | 8.1 | 16.2 | 99.3 |
| Cortex-M0 | 13.9 | 146 | 38.8 | 45.0 | 58.4 |
| ARM3 | 24.0 | 252 | 13.8 | 26.8 | 328.2 |
| ARM2 | 24.0 | 252 | 13.9 | 23.6 | 286.9 |
| AVR | 10.3 | 108 | 10.0 | 19.4 | 309.4 |
| RV32IM | 17.6 | 185 | 38.1 | 52.1 | 65.6 |
| RV32IMC | 17.6 | 185 | 39.1 | 46.6 | 66.1 |
| 68000 | 12.5 | 132 | 40.8 | 52.7 | 245.7 |
| 68010 | 12.5 | 132 | 39.6 | 52.5 | 231.0 |
| 68020 | 12.5 | 132 | 39.6 | 50.8 | 223.1 |

## Implications

- All six tools add about 2–8× execution cost here. Lazy attachment remains essential: a closed tool receives no instruction events. Metadata construction is cached per decoded instruction/encoding, so the new resource sets are not rebuilt on every step. This benchmark does not isolate metadata overhead from existing tool work.
- Deferred rebuilding after a long rewind takes about 58–328 ms in this run. Replay walks retained instructions and, for some tools, native decoders; the work is linear in the retained prefix. Future improvements should profile individual tools, then consider checkpoints or cheaper replay decoding without changing execution semantics. Holding Step Back benefits from settling once after many seeks.
- AVR, RV32IM/C, Cortex-M0 and 68k still save their small complete register files into explicitly declared typed entry columns. RV32 uses about 185 bytes/entry here, versus MIPS’s 49; sparse register deltas are a candidate optimization, not part of this change. The larger ARM26 footprint (about 252 bytes/entry) chiefly includes precise prefetch/clock/timing state and must preserve exact rewind behavior. None of these paths copies all RAM per instruction.
- A straight-line extrapolation of this workload approaches 240 MiB for one million ARM26 entries, before spare blocks and opaque payloads. More effects per instruction can hit the byte budget earlier. The shared History footer now reports actual retained entries, live and allocated typed bytes, payload counts and entries evicted by entry/byte policy. It labels one million as a target; it does not promise that many entries for every workload.
- Entry-limit and byte-budget eviction counters update only when entries are dropped; the status object is constructed only when a caller reads it. Branching away from retained history is not counted as budget eviction. Reset starts fresh counters. Typed schemas, block pooling and existing budget policies are unchanged.

## Static dependency limits

The metadata describes decoded operands, including condition-code resources, register aliases, list/pair destinations and ALU base updates. Flags computed from memory use the loaded-result class. Conditional writes conservatively name their possible destinations. Implicit sequential PC/refresh progression is not treated as a data hazard. AVR indirect accesses can reach memory-mapped register aliases whose identities depend on live pointers; their exact addresses remain runtime memory events, rather than a guessed static register list. System-call effects likewise depend on the simulated ABI and service selected at runtime.
