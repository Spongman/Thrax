# DEC PDP-11

A functional PDP-11 with one 64 KiB little-endian address space and no memory management: the processor always runs in kernel mode with physical addresses. Words are 16 bits at even addresses, bytes 8 bits. Programs load at `1000` (octal) by default and start at the first instruction, or at the address `.END` names. SP starts at `160000`, so the stack grows down from the top of RAM. The I/O page `160000`-`177777` holds only the console DL11 (`177560`-`177566`), the switch register (`177570`, reads 0) and the PSW (`177776`); any other I/O page address times out to vector 4. The 32 by 32 Bitmap Display reads little-endian RGB32 at `40000`.

Registers and memory are shown in **octal** by default. The register and memory panels offer `0o` beside `0n` and `0x`; in octal, memory groups read as one number each (3, 6, 11 or 22 digits) and plain digits typed into the address box are octal. Digits are typed into memory in hexadecimal only; the ASCII column takes typing in either radix.

## Models

| Model | Instructions | Floating point option |
| --- | --- | --- |
| PDP-11/20 | Base set: no SOB, XOR, SXT, MARK, RTT, EIS | None |
| PDP-11/40 (default) | Adds SOB, XOR, SXT, MARK, RTT and the EIS: MUL, DIV, ASH, ASHC | KE11-F FIS: FADD, FSUB, FMUL, FDIV |
| PDP-11/45, 11/70 | 11/40 set plus SPL | FP11 |
| LSI-11/23 | 11/40 set plus MFPS and MTPS | FP11 |

An instruction the selected model lacks is an assembler error naming the model that has it. If its bytes reach the processor anyway (from `.WORD`, say), it traps to vector 10 as a reserved instruction, as the hardware does. The Floating point setting only offers what the selected model can take.

## Execution

All eight addressing modes, including the PC modes `#n`, `@#n`, relative and relative deferred, follow the handbook: the source is evaluated before the destination, byte autoincrement and autodecrement step by one except on SP and PC, and MOVB into a register sign-extends. Condition codes follow Table 5-1 of the PDP-11 Architecture Handbook. DIV leaves its registers unchanged on overflow (V) or division by zero (V and C). A store to the PSW at `177776` takes precedence over the storing instruction's own condition codes.

Traps push PSW and PC and load the new PC and PSW from the vector: odd word addresses and bus timeouts (4), reserved instructions (10), BPT and the T-bit trace (14), IOT (20), EMT (30), TRAP (34) and floating exceptions (244). A trap through a vector whose PC and PSW are both zero has nowhere to go, so it stops the program with a message instead. JMP or JSR to a register traps through vector 4. RTI and RTT restore the low byte of the PSW. HALT ends the program; WAIT does too, since nothing can interrupt this machine; RESET does nothing.

### Console

- **DL11**: a byte written to XBUF (`177566`) is printed; XCSR (`177564`) always reads ready (bit 7). The receiver reads empty.
- **THRAX monitor**: while the EMT vector at 30 is empty, `EMT 1` prints R0 as a signed integer, `EMT 2` prints the ASCIZ string at R0, `EMT 3` reads a signed 16-bit integer into R0 and `EMT 4` prints the character in R0. Installing an EMT handler restores the native trap. This is not RT-11 or any DEC monitor.

### Floating point

FP11 accumulators AC0-AC5 hold DEC F (32-bit) or D (64-bit) values, not IEEE: an excess-128 exponent, a hidden bit, no infinities or NaNs, and about 1.7e38 to 2.9e-39. SETF/SETD select the precision and SETI/SETL the integer width. Results round half away from zero, or chop when FT is set; D keeps all 56 bits. In F mode an operation writes only the upper half of the accumulator. Overflow (with FIV), underflow (with FIU), division by zero, failed integer conversion (with FIC) and undefined variables (with FIUV) set FEC and FEA and trap through 244 unless FID is set. Only AC0-AC3 can be named in an instruction's accumulator field; AC4 and AC5 are reached as a floating source or destination. MODF, LDEXP/STEXP, STCFD/LDCDF and the integer conversions (which truncate) are implemented.

The register panel shows each accumulator as its D memory image, first word lowest, with the shared DEC float reading: `f` reads the F value in the upper half and `d` the whole D value; both can be edited.

FIS works on F values on a stack addressed by a register, rounding like the FP11; overflow, underflow and division by zero trap through 244 without storing a result.

## Assembler

MACRO-11 style, case-insensitive for mnemonics, registers and directives; symbols are case-sensitive. Numbers are octal unless they end in a point (`10.`), or use `^B`, `^O`, `^D` or `^X`; `^C` complements and `^F` is a one-word floating literal. Operators `+ - * / & !` evaluate strictly left to right; group with `< >`. `'A` is one character and `"AB` a two-character word. `n$` labels are local to the span between ordinary labels. Comments start with `;`.

Directives: `.WORD`, `.BYTE`, `.ASCII` and `.ASCIZ` (any delimiter, with `<n>` byte values), `.BLKW`, `.BLKB`, `.EVEN`, `.FLT2`, `.FLT4`, `.RADIX`, `.END [start]`, `name = value`, `. = address`, `.INCLUDE "file"`, plus `.TEXT`, `.DATA` and `.EQU`/`.SET`. Listing and linkage directives such as `.TITLE`, `.GLOBL` and `.PSECT` are accepted and ignored. Macros (`.MACRO`, `.MCALL`) and conditional assembly are not implemented. An FP11 immediate written as a decimal number is a one-word floating literal, as in MACRO-11; integer conversions take integer immediates.

Reference: [PDP-11 Architecture Handbook (EB-23657-18), 1983](https://bitsavers.org/pdf/dec/pdp11/handbooks/EB-23657-18_PDP-11_Architecture_Handbook_1983.pdf); each instruction's hover links to its page.
