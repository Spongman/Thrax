# Motorola 68k integer teaching profile

Choose MC68000 (default), MC68010 or MC68020 in the target settings. The
selection is one architecture with a shared assembler, CPU, debugger adapters,
editor, examples and explicitly declared typed history schema.

This is a bounded integer execution environment, not a complete emulation of
all instructions or of an Amiga, Macintosh, Atari, operating system or board.
Encodings and model differences were checked against NXP's
[M68000 Family Programmer's Reference Manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf),
particularly the effective-address formats, integer instruction descriptions,
and the processor instruction summary in Appendix A.

## Machine and model differences

The machine supplies D0–D7, A0–A7 (A7/SP), PC, SR and CCR, and 1 MiB of flat
big-endian RAM. Text starts at `$1000`, data and the default Bitmap Display
start at `$10000`, and SP starts at RAM end minus 16 bytes. `_start` is the
entry point when defined, then `main`, then the text base. Arithmetic wraps at
the operand width and narrow data-register writes preserve their upper bits.
MOVEA.W and address arithmetic sign-extend word operands.

MC68000/MC68010 require even addresses for multi-byte data accesses. MC68020
permits odd data accesses. Instruction fetches and taken instruction targets
always require even addresses. All accesses must remain inside RAM; the model
does not wrap addresses onto a 24-bit physical bus. Bus/address errors, illegal
instructions, unsupported operations and divide-by-zero report debugger errors
and restore the instruction's registers, memory, console and history atomically.
Hardware exception entry, exception vectors and exception stack formats are
not simulated.

- **MC68000:** the common instruction subset below; unscaled brief indexing.
- **MC68010:** also RTD, BKPT and MOVE from CCR. RTD restores PC and adjusts
  SP by a signed word displacement; BKPT stops in this teaching environment.
- **MC68020:** also EXTB.L, long branch displacements, brief index scales
  1/2/4/8, unaligned data accesses, and the later MOVEM base-register value
  when its own register is included in a predecrement store.

SR displays `$2000 | CCR`; only the five condition bits are editable. There
are no separate user/supervisor stacks, privilege transitions, interrupt mask
behavior, trace handling, MMU, cache or cycle model. Privileged instructions
including MOVE to SR, STOP, RESET and RTE are excluded. The optional floating-point
coprocessor is described below.

## Optional MC68881/MC68882 coprocessor

With the MC68020 selected, the **Math coprocessor** setting offers None (default),
MC68881 or MC68882. The two execute identically here: the MC68882's concurrent
execution, extra pipelining and speed are not modelled, and there is no cycle
model. The setting is not offered for the MC68000/MC68010 and a stored choice
falls back to None: those CPUs have no coprocessor interface, so a 68881 could
only be driven as a memory-mapped peripheral through its response/command
registers, never by F-line instructions. Without the coprocessor, F-line words
are rejected by the assembler and fault at execution. Encodings follow the
[MC68881/MC68882 User's Manual](https://www.nxp.com/docs/en/reference-manual/MC68881UM.pdf)
and section 5 of the Programmer's Reference Manual (coprocessor ID 1).

**State.** FP0–FP7, FPCR, FPSR (condition codes N/Z/I/NAN, quotient byte,
exception status and accrued exceptions) and FPIAR. FP registers are exact
extended precision, not JS doubles: each holds the 80 significant bits of the
96-bit memory format (sign, 15-bit exponent, 64-bit mantissa with explicit
integer bit), and the register panel shows those raw bits. Data tips and
history show an approximate decimal value. Reset leaves FP0–FP7 holding the
default NaN `$7FFF…FFFF` and the control registers zero. History stores the
whole FPU state per instruction, so stepping back restores it bit for bit.

**Arithmetic.** FMOVE, FADD, FSUB, FMUL, FDIV, FSGLMUL, FSGLDIV, FABS, FNEG,
FSQRT, FINT, FINTRZ, FMOD, FREM, FSCALE, FGETEXP, FGETMAN, FCMP and FTST are
exact and correctly rounded using the FPCR rounding mode (RN/RZ/RM/RP) and
precision (extended/single/double). Single/double rounding precision narrows
the mantissa only; the extended exponent range is kept. FSGLMUL/FSGLDIV round to
a single-precision mantissa. Extended values with a zero exponent field scale by
2^-16383, as on the 68881. NaN operands propagate (the destination NaN wins and
is made quiet); a NaN the FPU creates is the positive default NaN.

**Transcendentals.** FSIN, FCOS, FSINCOS, FTAN, FASIN, FACOS, FATAN, FSINH, FCOSH,
FTANH, FATANH, FETOX, FETOXM1, FTWOTOX, FTENTOX, FLOGN, FLOGNP1, FLOG10 and FLOG2
are evaluated in IEEE double precision (about 53 significant bits, typically
within 1–2 double ulps) and then rounded to the FPCR precision; they are not
accurate to the full 64-bit extended mantissa. Logarithms and the exponential
family split the binary exponent so results beyond double range stay correct to
about double precision; trigonometric arguments beyond double range are treated
as infinite (operand error). INEX2 is set except for known exact cases.

**Formats and transfers.** FMOVE converts B/W/L/S/D/X/P sources and destinations,
including immediates (`#1.5`, `#-2.5e3` or integers) and packed decimal with a
static `{#k}` or dynamic `{Dn}` k-factor (default `{#17}`); a four-digit decimal
exponent sets OPERR. Packed input conversion sets INEX1. Out-of-range integer
stores set OPERR and write the largest integer of the operand's sign. FMOVECR
returns correctly rounded constants for offsets $00, $0B–$0F and $30–$3F; other
offsets fault. FMOVE/FMOVEM move FPCR, FPSR and FPIAR, and FMOVEM.X moves static or
dynamic FP register lists in 96-bit format. `dc.s`, `dc.d` and `dc.x` take
decimal literals.

**Conditions.** FBcc (word/long), FScc, FDBcc and FTRAPcc implement all 32
predicates; the IEEE-nonaware ones (SF … ST) set BSUN when NAN is set. FNOP is
supported.

**Exceptions.** Status and accrued bits follow the manual. An exception enabled
in FPCR, or a taken FTRAPcc, stops with a debugger fault and the instruction is
undone; coprocessor exception processing and its stack frames are not simulated.
FSAVE and FRESTORE are privileged (supervisor-only) and excluded like other
privileged instructions.

With a coprocessor the examples add **Floating-point Arithmetic**, and
**Mandelbrot Set** becomes the FPU version: single-precision rounding via FPCR
reproduces the MIPS port's iteration counts pixel for pixel.

## Implemented integer subset

- MOVE.B/W/L, MOVEA.W/L, MOVEQ, MOVEM.W/L, LEA, PEA, EXG, SWAP, EXT.W/L.
- ADD/SUB/CMP, AND/OR/EOR, immediate forms, ADDQ/SUBQ and ADDA/SUBA/CMPA.
- CLR, TST, NEG, NOT; static/dynamic BTST/BCHG/BCLR/BSET.
- Register ASL/ASR, LSL/LSR, ROL/ROR and ROXL/ROXR, with immediate or register
  counts. Memory shift/rotate forms are excluded.
- Word-source MULU/MULS and DIVU/DIVS, including quotient/remainder packing
  and quotient overflow. Later long multiplication/division forms are excluded.
- BRA/BSR and all 14 conditional branches, DBcc/DBRA, Scc, JMP/JSR, RTS,
  LINK.W/UNLK, NOP, ILLEGAL and educational TRAP #15.
- MOVE from SR, MOVE to CCR, and ORI/ANDI/EORI to CCR.

Data-register direct, address-register direct where supported, address indirect,
postincrement/predecrement, signed word displacement, brief indexed, absolute
short/long, PC-relative displacement/brief index and immediate modes are
implemented. Full MC68020 extension words, base/index suppression and memory
indirect modes are excluded. Control transfers and LEA/PEA require a control
addressing mode. Read-modify-write destinations must be alterable. ADDX/SUBX,
decimal arithmetic, CMPM, MOVEP, bitfields, CAS and other unlisted instructions
are excluded and their overlapping raw encodings are rejected.

## Assembly syntax and educational console

Source uses Motorola-style operands and `#` immediates, `$` or `0x` hex,
`;` comments and `*` full-line comments. Register/instruction spelling is case
insensitive; symbols and character literals preserve case. `.text`, `.data`,
`.bss`, `.section`, `section`, `.include`/`include`, `equ`, `.equ`, `.set`,
`org`/`.org`, `even`, byte-boundary `.align`/`.balign`, `.ascii`/`.asciz`,
`dc.b/w/l`, `.byte`, `.word` (16 bits), `.long` (32 bits), `ds.b/w/l` and
`.space`/`.zero` are supported. Reservation counts are bounded literals; there
is no linker, macro language, relocation operator or general GNU-as/vasm
compatibility claim. Metadata `.global`/`.globl`, `xdef`, `.type` and `.size`
are accepted without introducing link semantics.

Unsuffixed ordinary operations use word size. Branches default to fixed word
displacements; `.s`/`.b` selects short and `.l` selects MC68020 long. Absolute
operands default to long; `.w` selects sign-extended short addressing. Numeric
`4(pc)` means a displacement; a symbol such as `label(pc)` is resolved relative
to its extension word. Brief index examples are `4(a0,d1.w)` and
`4(a0,d1.l*4)`. No automatic branch relaxation occurs.

TRAP #15 uses D0 as task number: **3** prints signed D1; **14** prints the
zero-terminated byte string at A1; **5** reads a signed integer into D1;
**6** prints the low byte of D1 as a character; **9** halts. This small task
set resembles educational 68k tools; it is not full EASy68K compatibility.
Other trap vectors/tasks fault.

Include expansion is bounded at 64 nested files, 4096 expansions and 100000
expanded lines/statements. Output reservations are bounded before allocation
to 1 MiB. Long data declarations produce at most four debugger gutter rows.
History retains exact original instruction words and typed register/control
snapshots, byte undo effects and constant-size call-frame deltas. It uses the
common history block allocation, eviction and byte limits without retaining
object snapshots per instruction or quadratic copies of recursive call stacks.
