# SuperH SH-1 / SH-2

The SuperH family offers SH-2 (default) and SH-1 in the common CPU variant
setting. Both are 32-bit functional integer cores using big-endian memory,
16-bit native instructions and 1 MiB of flat physical RAM. Code starts at
`0x1000`, data and the example bitmap at `0x10000`, and R15 starts at RAM end
minus 16 bytes. R0–R15, SR, GBR, VBR, MACH, MACL and PR are editable through
the shared register window. Undefined SR bits are masked.

The native assembler and decoder implement register/immediate arithmetic,
carry/borrow and signed-overflow forms, all integer comparisons, logical
operations, extension and byte/word swap, extraction, shifts and rotates,
word multiplies, stepwise DIV0U/DIV0S/DIV1 division, MAC.W, T-bit operations,
GBR byte masks, TAS.B, general and special-register memory transfers, PC-relative
literal loads, MOVA, conditional branches, delayed branches/calls and RTS.
Byte/word loads sign-extend. Word/longword data accesses enforce alignment.
Pre-decrement stores and post-increment loads preserve native ordering,
including equal base/destination behavior. Native instruction words are checked
against independent expected encodings in the tests.

SH-2 adds BRAF, BSRF, BT/S, BF/S, DT, MUL.L, DMULS.L, DMULU.L and MAC.L.
SH-1 rejects these in both source and raw machine code. SH-1 MACH has ten
valid bits and reads as sign-extended; SH-2 MACH has 32. Double products and
multiply-accumulate use exact bigint intermediates. SR.S selects native MAC.W
32-bit or MAC.L 48-bit saturation. Instruction timing is not simulated.

## Assembly and educational monitor

The shared assembler accepts labels, expressions, `.equ`, `.include`, `.text`,
`.data`, `.org`, `.align`, `.byte`, `.word` (16 bits), `.long` (32 bits),
`.ascii`, `.asciz` and `.space`. Comments begin with `;` or `//`.
Native immediate MOV and ADD take signed eight-bit values; logical immediates
zero-extend. Displacement memory syntax uses byte offsets, checked against the
native scale and field width. MOV.W/L can take a forward literal-pool label.

`mov32 #constant,Rn` is an explicitly synthetic THRAX convenience. It always
emits seven native MOV/SHLL8/ADD instructions, each with its own source row.
It loads arbitrary constants without implicit literal pools and cannot occupy
one delay slot. There are no host-executed arithmetic/example shortcuts.

`trapa #0x10` invokes a **THRAX educational ABI**, not an OS ABI. R0 selects
1 (print signed R4), 4 (print a NUL-terminated string at R4), 5 (read a signed
32-bit integer into R4), 10 (exit), or 11 (print R4's low byte). Other software
traps fault. Monitor calls do not perform native exception stacking/vector entry.

## Debugging, history and limits

Delayed targets and conditions are latched before the slot executes. PR links
PC+4. Returns remove their common debugger frame after the delay instruction,
so Step Over/Out includes it. PC-relative loads in an executed slot use the
native branch-destination PC base. Slot-illegal instructions fault atomically.
A PC edit clears pending delay state.

The family shares the configurable assembler frontend, execution controller,
variant routing, editor/help providers, register/memory/history UI, call stack,
statistics, profile, cache, branch history and memory-reference tools. History
remains a typed column store: 22 visible register/control words plus sparse
effects for four pending-control words. Internal state never appears as guest
RAM or produces memory-observer events. The common one-million-entry target,
256 MiB typed-buffer budget and block eviction apply unchanged.

All ten standard example topics are standalone text files and run on both
variants. Recursive calls explicitly save PR. Bitmap and Mandelbrot request
the shared Bitmap Display and write its little-endian RGB bytes explicitly.
Mandelbrot uses Q8 arithmetic, 16 iterations and the same hardcoded palette
as MIPS. See [performance measurements](../../../docs/new-cpu-benchmarks.md).

This functional environment excludes native exception/interrupt delivery,
MMU/cache hardware, devices and cycle/bus timing. RTE and SLEEP diagnose that
limitation when executed. The shared pipeline panel reports that no timing
model is supplied; X-Ray is unavailable. SH-2A's extra encodings and SH-2E's
floating-point state/instructions are not offered as cosmetic variants.

Primary reference: [Renesas SH-1/SH-2/SH-DSP Software Manual](https://www.renesas.com/en/document/mah/sh-1sh-2sh-dsp-software-manual).
