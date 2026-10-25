# ARM26: ARM2 and ARM3

ARM2 and ARM3 are CPU variants under the ARM family. The family defaults to
AArch64; an old ARM26 saved selection without a CPU model migrates to ARM3,
preserving the earlier target's SWP support. The backend now lives inside
`armv8/arm26/` and is loaded when a 26-bit variant is selected.
Both use the shared ARM assembler, ALU, debugger controllers and pipeline view.
ARM2 rejects SWP and CP15 transfers in source and traps their raw encodings.

ARM3 adds `SWP`/`SWPB`, privileged `MRC`/`MCR` to CP15, and a functional unified
4 KB cache. The cache has 256 sixteen-byte lines in four sets of 64 ways,
write-through stores, no write allocation, and deterministic pseudo-random
replacement. Instruction fetches and data reads share its contents. SWP always
reads external RAM, including when a cache copy exists.

CP15 c0 reads revision-zero ID `0x41560300`; writing c1 flushes the cache.
c2 implements cache enable, shared user/supervisor tags and monitor mode bits;
c3, c4 and c5 select cacheable, updateable and disruptive 2 MB regions.
Updates and disruptive flushing work even with caching disabled. c2 resets
to zero. The hardware's unspecified initial c3-c5 values are initialized to zero
for repeatability; programs must configure these before enabling caching.
Illegal CP15 transfers and all user-mode accesses take the undefined path.
MRC to R15 changes NZCV only. Other coprocessors remain absent.

The common Registers window shows clock ticks and an ARM3 CP15 bank. The cache
example supplies a reset vector so it starts in SVC; ordinary applications
still start in USR. Debugger memory reads show RAM without touching the cache.
Debugger memory edits flush it, with that flush recorded for rewind.

## Memory and instruction timing

Counts use reference-clock ticks, with one tick per ARM3 fast-clock period (F).
The Memory timing settings specify the sequential memory-transfer cost A and
memory latency L; both default to one and accept 1, 2, 3, 4, 8, 16, 32 or 64.
A non-sequential transfer costs N = L + A. With the cache disabled, internal
and coprocessor cycles cost L. This makes ARM2/cache-disabled timing depend on
the actual S/N/I operation sequence, rather than assigning every operation one
tick.

With the ARM3 cache enabled, hits and internal cycles run on the fast clock.
Misses fetch four words in ascending address order, restarting the CPU when its
requested word arrives. Sequential reads and internal cycles can overlap the
remaining fill; a new non-sequential access, store or coprocessor transfer waits
for it. Stores write through, and SWP reads externally. Monitor mode keeps the
CPU on the memory clock. Clock switching follows the datasheet's worst-case
synchronization model: F + 2L to the memory clock, F back to the fast clock.
These are deterministic model timings, not a phase-exact simulation of two
physical oscillators. The manual's worked example evaluates to 31 ticks for
F = L = A = 1, as checked independently in the tests.

The instruction sequence before any redirect refill is:

| Operation | Bus/core operations |
| --- | --- |
| Data processing | Instruction fetch; then I with a register-specified shift |
| MUL / MLA | Instruction fetch, then m internal cycles (1-16 from unsigned Rs) |
| LDR / STR | Instruction fetch, N read, I / instruction fetch, N write |
| LDM / STM | Instruction fetch, N first word, S remaining words; LDM adds I |
| SWP | Instruction fetch, N external read, N write, I |
| MRC / MCR | Instruction fetch, I, transfer, I / instruction fetch, I, transfer |
| Failed condition | Instruction fetch, without operand or destination effects |

An instruction's fetch is S unless the preceding operation used internal/data
cycles. Every PC redirect adds an N/S target refill after execution; undefined
instruction entry also adds I. The shared F/D/E view consumes these measured
fetch/execute times and displays multi-cycle stages and held decode. Its timeline
renders at most 256 clock columns at once, with paging for long waits.
Instructions still retire atomically rather than exposing partial execution.

## Speculative prefetch and history

The CPU keeps the two instruction words already in its pipeline. Each instruction
fetches PC+8 before executing, including branches and failed conditions. A store
cannot change those queued words; a taken branch or another PC write discards
them and refills from the target. Discarded fetches still populate the ARM3 cache.
A speculative fetch outside RAM records an abort marker and raises it only if
that word reaches execute. A redirect can discard the marker harmlessly.
CP15 cache flushes leave queued instructions intact. Debugger memory/PC/status
edits invalidate the queue so stepping reflects the edit; memory edits flush the
cache too.

Typed history saves the prefetch words, deferred aborts, line-fill/clock state and
observed schedule, so rewind and pipeline reconfiguration reproduce the same
execution. Those columns add 180 bytes per entry, and execute durations use 32
bits to retain long memory waits. Cache changes use the existing typed effect
stream. There is one approximately 5 KB cache state, not a cache snapshot per
instruction, and no per-bus-cycle trace allocation. Existing RAM and history
entry limits are unchanged; long histories now use more memory per entry.

## Remaining limitations

- DRAM refresh, peripheral bus contention and electrical clock phase are absent.
  Timing uses the configured A/L values and worst-case clock synchronization.
  The generic Cache tool is an independent experiment, not a view of CP15's cache.
- The memory map is flat RAM plus THRAX's keyboard/display. There is no MEMC
  translation or memory protection, IOC/VIDC, DMA, board boot or complete RISC OS.
- There is no FPA/external coprocessor. RISC OS-style SWIs remain teaching host
  services whose implementation time is not included in the cycle count.
- Hardware-unpredictable operand combinations and exact partial effects of
  aborted block transfers are not reproduced; the assembler warns for Rd=Rm
  multiplication, and the CPU validates a block transfer's addresses up front.

References: VLSI Technology's [ARM family data manual, VL86C020 sections](https://bitsavers.org/components/vti/1990_Acorn_RISC_Machine_Family_Data_Manual.pdf),
especially pp. 3-33, 3-39, 3-45 to 3-47 and 3-57 to 3-66;
[Acorn application note 276](https://chrisacorns.computinghistory.org.uk/docs/Acorn/AN/276.pdf)
for distinguishing ARM2, ARM250 and ARM3.
