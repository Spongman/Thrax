# DEC VAX

A 32-bit, little-endian, byte-addressed VAX running in kernel mode with
physical addressing and 1 MiB of RAM. There is no memory management, no
interrupts and no system control block: an exception that would vector
through the SCB (reserved instruction, reserved operand or addressing mode,
arithmetic traps, BPT) instead stops the program, undoing the faulting
instruction. Code starts at `0x1000`, data and the example bitmap at `0x10000`.
Reset clears R0-R13, sets SP to the end of RAM and the PSL to `^X001F0000`
(kernel mode, IPL 31).

The registers are R0-R11, AP (R12), FP (R13), SP (R14), the PSL and the shared
PC (R15). The register panel can also read R0-R11 as F_floating and each
register pair as D_floating, with the sign and exponent word in the first
register, as the VAX holds them.

## Instructions

Every general addressing mode is encoded and executed: short literal,
register, register deferred, autodecrement, autoincrement and its deferred
form, byte/word/longword displacement and their deferred forms, index
(`base[Rx]`, scaled by the operand size) and the PC forms: immediate, absolute
and relative. Operand specifiers are evaluated in order with their side effects,
reads happen as each is evaluated, and writes follow the operation.

Implemented: MOV, MOVZ, MOVA, PUSHA, PUSHL, CLR, TST, CMP, BIT, MCOM, MNEG, INC,
DEC, ADD/SUB/MUL/DIV in two- and three-operand forms, BIS, BIC, XOR, CVT among
B/W/L, ADWC, SBWC, ADAWI, ASHL, ASHQ, ROTL, EMUL, EDIV, MOVQ, CLRQ, MOVO, CLRO;
all conditional branches, BRB, BRW, JMP, BSBB, BSBW, JSB, RSB, CASEB/W/L,
ACBB/W/L/F/D/G/H, AOBLSS, AOBLEQ, SOBGEQ, SOBGTR, BBS/BBC and their set/clear
and interlocked forms, BLBS, BLBC; CALLS, CALLG and RET with entry masks and
the architected frame; PUSHR, POPR, MOVPSL, BISPSW, BICPSW, INDEX; EXTV, EXTZV,
INSV, CMPV, CMPZV, FFS, FFC; MOVC3, MOVC5, CMPC3, CMPC5, LOCC, SKPC; HALT, NOP,
BPT, REI, CHMK, MTPR, MFPR; and for F, D, G and H_floating: ADD, SUB, MUL, DIV,
MOV, MNEG, CMP, TST, ACB, CVT to and from B/W/L, CVTR..L and conversions between
the formats.

Not implemented, so reserved on every model: decimal string instructions,
EDITPC, CRC, MATCHC, MOVTC, MOVTUC, SCANC, SPANC, POLY, EMOD, queue
instructions, PROBE, LDPCTX/SVPCTX, CHME/CHMS/CHMU and XFC.

## Floating point

F, D, G and H_floating use the VAX's own formats, not IEEE: a hidden-bit
fraction 0.1f x 2^(e - bias), exponent zero meaning zero (or, with the sign
set, a reserved operand that faults), no infinities, NaNs or denormals.
Arithmetic is exact, then rounded once to nearest with ties away from zero.
Overflow and division by zero fault; underflow gives zero (PSW FU is not
modeled as a trap). Floating short literals cover 0.5 to 120 in steps of the
six-bit `0.1fff x 2^eee` encoding. The bit-level codec lives in
`src/core/decFloat.ts`, shared with any DEC architecture.

## Variants

| CPU variant | Floating point | Gated |
| --- | --- | --- |
| VAX-11/780 | built in: F, D, G, H | nothing |
| MicroVAX II | 78132 FPU: F, D, G | every H_floating instruction, including conversions to and from H, and the octaword CLRO, MOVO, MOVAO and PUSHAO raise a reserved instruction fault, as the MicroVAX subset leaves them to software emulation |
| MicroVAX II | none | additionally every F, D and G instruction faults; its Mandelbrot example uses 8.8 fixed point and it has no floating-point example |

The assembler accepts every instruction on every model; the decoder applies
the gating, as the hardware does. `MFPR #62` (SID) reads `^X01000000` on the
VAX-11/780 and `^X08000000` on the MicroVAX II.

## Console

`CHMK #code` is served by a console monitor in place of an operating system:

| Code | Effect |
| --- | --- |
| 1 | print R0 as a signed decimal |
| 4 | print the NUL-terminated string at R0 |
| 5 | read a signed integer into R0, waiting for input |
| 10 | halt |
| 11 | print the character in R0 |

The console IPRs also work for output: `MTPR Rn, #35` (TXDB) prints a
character and `MFPR #34, Rn` (TXCS) always reports READY in bit 7. RXCS and RXDB
read zero; console input arrives only through CHMK #5. `HALT` ends a program.

## Assembler

VAX MACRO, case-insensitive for mnemonics, registers, directives and symbols.
Labels end in `:` or `::`; `10$:` local labels are scoped between ordinary
labels. Comments start with `;`. Numbers are decimal; `^X`, `^O`, `^B`, `^D`
choose a radix, `^A/c/` is a character, `^C` complements, `^M<R2,R3>` is a
register mask and `<>` groups. Operators are `+ - * / & ! \`.

Operands: `#` immediate (`S^#` forces a short literal, `I^#` an immediate),
`@` deferral, `(Rn)+`, `-(Rn)`, `@(Rn)+`, `disp(Rn)` with optional `B^ W^ L^`,
`@#address`, a bare symbol for PC-relative, and `[Rx]` indexing. A floating
operand takes decimal text such as `#0.1` or `#-1.25`, or an integer
expression converted exactly. As VAX MACRO does, the assembler picks a short
literal and the shortest displacement for any value it already knows. A
forward reference takes the longword form, which always reaches across the
1 MiB memory.

Directives: `.ENTRY name, mask`, `.BYTE`, `.WORD`, `.LONG`, `.ADDRESS`, `.QUAD`,
`.OCTA`, `.F_FLOATING`/`.FLOAT`, `.D_FLOATING`/`.DOUBLE`, `.G_FLOATING`,
`.H_FLOATING`, `.ASCII`, `.ASCIZ`, `.ASCIC` (any delimiter, with `<n>` bytes
between strings), `.BLKB` through `.BLKO`, `.ALIGN` (keyword or power of two),
`. = expr`, `name = expr`, `.PSECT` (a name containing DATA or a NOEXE
attribute selects data), `.TEXT`, `.DATA`, `.ORG`, `.EQU`, `.INCLUDE` and
`.END [start]`; starting at an `.ENTRY` procedure skips its mask. Listing
directives such as `.TITLE` are accepted and ignored.

Instruction hovers link each mnemonic to its page of the VAX Architecture
Reference Manual (EY-3459E-DP, 1987).
