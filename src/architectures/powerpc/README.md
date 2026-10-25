# PowerPC

This is a 32-bit, big-endian PowerPC teaching machine with 1 MiB of physical RAM. Code starts at `0x1000`, data and the RGB bitmap start at `0x10000`, and `r1` initially points near the top of RAM.

The native encoder and decoder implement immediate and register arithmetic, multiplication and division, logical operations, rotate/mask and shifts, signed and unsigned comparisons, all eight condition fields, conditional and counted branches, link/count-register branches, LR/CTR/XER moves, byte/halfword/word memory transfers, update addressing, indexed addressing, and synchronization instructions. Conventional `li`, `lis`, `mr`, `nop`, `la`, `slwi`, `srwi`, and branch aliases emit actual PowerPC words. Unsupported instructions or forms produce diagnostics or native faults.

The simulator preserves native LR and CTR semantics; recursive examples save LR explicitly. CR0 record forms retain XER.SO, and arithmetic right shifts update XER.CA. Carry-producing arithmetic and overflow-enable forms are not implemented. Division by zero and signed division overflow are reported as simulator faults rather than modeling an implementation-dependent result.

`sc` is the real system-call instruction, connected to a **THRAX educational ABI**, not a host OS or firmware. `r0` selects 1 (print signed `r3`), 4 (print zero-terminated string at `r3`), 5 (read signed 32-bit integer into `r3`), 10 (exit), or 11 (print low byte of `r3`). Other service numbers fault. Bitmap examples explicitly store little-endian RGB bytes even though native memory transfers are big-endian.

The shared assembler accepts `.text`, `.data`, `.org`, `.byte`, `.word` (16 bits), `.long` (32 bits), `.quad`, `.ascii`, `.asciz`, `.space`, `.equ`, labels, expressions and `.include`. PowerPC immediates must fit their native field; large constants can use `lis`/`ori`. Comments start with `#` or `;`.

## Floating point

The FPU is part of the base ISA on the 601/603/604/750 class this target models, so it is always present; there are no FPU-less (403/405-style) profiles. The register panel's Float tab shows `f0`–`f31` as 64-bit doubles and `FPSCR`; data tips show the double value.

Implemented: `lfs[u][x]`, `lfd[u][x]`, `stfs[u][x]`, `stfd[u][x]`, `stfiwx`; `fadd`, `fsub`, `fmul`, `fdiv`, the fused `fmadd`, `fmsub`, `fnmadd`, `fnmsub`, and their single-precision `…s` forms; `fsqrt`/`fsqrts`, `fres`, `frsqrte`, `fsel` (optional instructions; real 601/603/750 parts lack `fsqrt`); `fmr`, `fneg`, `fabs`, `fnabs`, `frsp`, `fctiw`, `fctiwz`, `fcmpu`, `fcmpo`, `mffs`, `mcrfs`, `mtfsf`, `mtfsfi`, `mtfsb0`, `mtfsb1`. Record (`.`) forms copy FPSCR[FX, FEX, VX, OX] into CR1.

Arithmetic is exact and rounded once, to double or single, in all four FPSCR[RN] modes (exact bigint arithmetic, not host floats, so no JavaScript rounding limits apply). FPSCR keeps every field: sticky exceptions with FX on 0→1 transitions, VX and FEX as summaries, FR, FI, FPRF/FPCC, the VX* causes, enables, NI and RN. NaN operands propagate in A, B, C order and are quieted; invalid operations produce the default QNaN. Enabled invalid and zero-divide exceptions leave the target and FPRF unchanged, enabled overflow and underflow deliver exponent-adjusted results (±1536, or ±192 for single), and tininess is detected before rounding. `stfs` uses the manual's bit-selection/denormalization without rounding; `lfs` converts exactly and keeps NaN payloads.

Not implemented: FP interrupts (MSR[FE0/FE1] behave as ignore-exceptions mode; an enabled exception sets FEX but never traps), FPSCR[NI] non-IEEE mode (stored only), and the 64-bit `fcfid`/`fctid`/`fctidz`. `fres` and `frsqrte` return correctly rounded values rather than a model's estimate tables. The architecturally undefined high word of `mffs` and `fctiw[z]` results is written as `0xFFF80000`. FP loads and stores require word alignment (the 60x/750 raise an alignment interrupt otherwise). Mandelbrot uses single-precision FPU arithmetic and matches the MIPS port pixel for pixel.

The implementation excludes vector instructions, 64-bit PowerPC, MMU/segments, privileged execution, native exception vectors, atomic reservations, device models, and cycle-accurate pipelines. Physical data accesses enforce native alignment. This is functional ISA execution, not a model of any particular PowerPC chip's timing.

Primary opcode reference: [IBM PowerPC instruction appendix](https://www.ibm.com/docs/en/aix/7.1.0?topic=reference-appendix-f-powerpc-instructions).
