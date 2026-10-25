# IBM System/360 and System/370

A functional System/360 problem-state CPU with an IBM Assembler (H/HLASM)
style assembler. Storage is big endian and byte addressed with 24-bit
addresses; 1 MiB of the 16 MiB space is simulated, and an address above it is
an addressing exception. Programs assemble from `0x1000`; the Bitmap Display
reads device memory at `X'10000'`.

## Models

| Setting | Instructions |
| --- | --- |
| System/360 Model 30 | Standard instruction set. The decimal and floating-point features are separate CPU settings, each *Installed* or *Not installed*. |
| System/360 Model 50/65 (default) | Standard set, decimal feature and floating-point feature. |
| System/370 | Everything above plus MVCL, CLCL, ICM, STCM, CLM, SRP, extended-precision floating point (AXR, SXR, MXR, MXDR, MXD, LRDR, LRER) and relaxed operand alignment. |

An instruction the selected model lacks is an assembler error naming the
missing feature, and as hand-made object code it is an operation exception.
The decimal feature covers AP, SP, ZAP, CP, MP, DP, ED and EDMK; PACK, UNPK,
MVO, CVB and CVD are standard. The floating-point feature covers every
floating-point instruction. System/360 models require natural alignment of
halfword, fullword and doubleword operands (specification exception);
System/370 does not.

## Registers and PSW

R0-R15 are 32 bits; F0, F2, F4 and F6 are 64-bit hexadecimal floating-point
registers, shown and edited as numbers through the shared `ibm` float
encoding. The PSW is shown in BC mode: system mask 0, key 0, AMWP = 0101
(EBCDIC, machine checks enabled, running, problem state), interruption code
0, ILC 0, then the condition code, program mask and 24-bit instruction
address. CC and the program mask are editable on their own. BAL and BALR
load the right half of the PSW into R1 (ILC, CC, program mask, return address),
as BC mode does; LA clears the leftmost eight bits.

Reset follows OS/360 linkage: R15 holds the entry point, R13 a 72-byte save
area at `X'F00'` and R14 the address of an `SVC 3` at `X'FFE'`, so the standard
`BR 14` return ends the program.

## Program interruptions

There are no interruption handlers or new PSWs: an interruption is reported as
a fault such as `Program interruption 0007: data exception`, and the
instruction retires nothing (on hardware some, such as fixed-point overflow,
complete first). Operation, execute, addressing, specification, data,
fixed-point overflow and divide, decimal overflow and divide, exponent
overflow and underflow, significance and floating-point divide are detected.
The program mask starts at zero, so fixed-point overflow, decimal overflow,
exponent underflow and significance only set the condition code or produce a
true zero until SPM enables them. Privileged, I/O and storage-key
instructions are not implemented.

## Floating point

Hexadecimal floating point follows GA22-6821: a sign, a 7-bit excess-64
power-of-16 characteristic and a 6, 14 or 28 digit fraction (1.0 is
`41100000`). Additions align with one guard digit; every result is
truncated. Short operations leave the right half of a register unchanged.
MER/ME produce a short product on System/360 and a long product on
System/370; HER/HDR do not normalize on System/360 and do on System/370.
The assembler rounds E, D and L constants to nearest. There are no
conversion instructions: the floating-point example converts with the
classic unnormalized add of `X'4E00000000000000'`.

## Character set

Text is EBCDIC (code page 037). `C'...'` constants and character
self-defining terms are EBCDIC, the console translates EBCDIC to Unicode
(X'15' and X'25' end a line), and the memory panel reads bytes through the
same code page.

## Supervisor calls

| SVC | Service |
| --- | --- |
| 3 | EXIT: halt |
| 35 | WTO: R1 points to `AL2(length+4),AL2(flags)` and the text; writes it and a new line |
| 200 | Write R1 as a signed decimal integer |
| 201 | Read a signed integer into R1 |
| 202 | Write the EBCDIC character in the rightmost byte of R1 |
| 203 | Write R0 bytes of EBCDIC text from the address in R1 |

3 and 35 follow OS/360; 200-203 are a THRAX teaching convention.

## Assembler

Statements have a name field starting in column 1, an operation, operands
and remarks, separated by blanks; a tab counts as a blank. Operands end at the
first blank outside a quoted string, and the rest of the line is remarks. `*`
in column 1 (or `.*`) makes a comment line. There is no continuation column.
The examples use the conventional columns 1, 10 and 16 with spaces, and
remarks from column 36. Operations and symbols are case insensitive; symbols
are kept as first written.

Supported: CSECT, START, DSECT, USING (with several registers covering 4096
bytes each), DROP, DC and DS (types C, X, B, F, H, A, Y, E, D, L, P and Z,
duplication factors, length modifiers, multiple operands and values), EQU
(with an optional length), ORG, LTORG, CNOP, END (entry point), COPY of another
open file, literals (`=F'5'`, `=A(NAME)`, `=C'...'`), the length attribute
`L'NAME`, location counter `*`, self-defining terms (`X'..'`, `B'..'`,
`C'..'`) and the extended branch mnemonics. TITLE, EJECT, SPACE and PRINT are
accepted and ignored; macros, conditional assembly, EXTRN/ENTRY and
continuation lines are not supported. A GNU-style `.equ name, value` is also
accepted.

Symbolic storage operands resolve through USING: the base giving the smallest
displacement is chosen, the highest register on a tie, and an operand outside
every USING is an error. Explicit `D(X,B)`, `D(L,B)` and `D(L1,B1)` forms are
accepted wherever a storage operand is. Instructions are halfword aligned;
literals are pooled at LTORG or END, doubleword aligned first. Sections are
laid out from `0x1000`, each CSECT starting on a doubleword; DSECTs generate no
object code.

## Examples

Every example uses the standard linkage (STM 14,12,12(13), BALR/USING,
LM and BR 14). Mandelbrot is 8.8 fixed point with M and D on every model;
Mandelbrot Set (Floating Point) and Floating-point Arithmetic appear where the
floating-point feature is installed.

## Gaps

No timing, channels, I/O, interruption handlers, storage protection keys,
EC mode, DAT, or MVS/OS services beyond the SVCs above. The ILC field of the
displayed PSW is always zero.

Reference: [IBM System/360 Principles of Operation, A22-6821-7](https://bitsavers.org/pdf/ibm/360/princOps/A22-6821-7_360PrincOpsDec67.pdf)
and [IBM System/370 Principles of Operation, GA22-7000-4](https://bitsavers.org/pdf/ibm/370/princOps/GA22-7000-4_370_Principles_Of_Operation_Sep75.pdf).
