This target implements RV32IM and RV32IMC, each optionally with F or with F and D
(RV32IMF, RV32IMFC, RV32IMFD, RV32IMFDC), using the shared two-pass assembler and typed
history engine. The 1 MiB memory is flat and little-endian. Fetches and data
accesses must be naturally aligned (so FLD/FSD need 8-byte alignment); instruction
targets use IALIGN=32 without C and IALIGN=16 with it. The ISA setting defaults to
RV32IM and the floating-point setting to none; D implies F.

The instruction definitions and exceptional multiplication/division cases
were checked against the official [RV32I specification](https://docs.riscv.org/reference/isa/v20260120/unpriv/rv32.html)
and [M extension specification](https://docs.riscv.org/reference/isa/v20260120/unpriv/m-st-ext.html).

RV32IMC adds all 27 integer forms from [the C 2.0 extension](https://docs.riscv.org/reference/isa/v20260120/unpriv/c-st-ext.html).
Each compressed instruction expands to an existing integer operation at decode;
the shared executor uses its actual instruction length for fall-through and links.
Mixed 16/32-bit source mapping, disassembly, breakpoints, calls and history retain
the original instruction bytes. Standard HINT encodings execute harmlessly;
reserved, custom and RV64-only encodings fault, as do the floating-point forms
unless F (C.FLW, C.FSW, C.FLWSP, C.FSWSP) or D (C.FLD, C.FSD, C.FLDSP, C.FSDSP) is selected.

## F and D

All RV32F and RV32D instructions are implemented, checked against the
[F](https://docs.riscv.org/reference/isa/v20260120/unpriv/f-st-ext.html) and
[D](https://docs.riscv.org/reference/isa/v20260120/unpriv/d-st-ext.html) chapters:
loads and stores, the four fused multiply-adds, FADD/FSUB/FMUL/FDIV/FSQRT, sign
injection (with the FMV/FNEG/FABS aliases), FMIN/FMAX (minimumNumber and
maximumNumber: one NaN operand is ignored, -0 < +0), every FCVT between W, WU, S
and D, FMV.X.W/FMV.W.X, FEQ/FLT/FLE and FCLASS. With F only, f0-f31 are 32 bits;
with D they are 64 bits and singles are NaN-boxed: an operand whose upper 32 bits
are not all ones reads as the canonical NaN, while FSW and FMV.X.W move the low 32
bits unchanged.

Arithmetic is computed exactly in BigInt and rounded once, so all five rounding
modes (RNE, RTZ, RDN, RUP, RMM) and the static and dynamic `rm` encodings are exact
for both precisions; nothing relies on `Math.fround`. Results that are NaN are
always the canonical NaN, NV/DZ/OF/UF/NX accrue in fflags, tininess is detected
after rounding, and FCVT to integer saturates with NV. A reserved `rm` (5 or 6) is
an illegal instruction, as is a dynamic `rm` while frm holds 5-7. Without a rounding
operand the assembler encodes `dyn`, except for the exact FCVT.D.S, FCVT.D.W and
FCVT.D.WU, which encode RNE as current LLVM and binutils do.

fcsr (frm in bits 7:5, fflags in 4:0) is reached through Zicsr, which F requires:
CSRRW/CSRRS/CSRRC, their immediate forms, the CSRR/CSRW/CSRS/CSRC(I) shorthands and
FRCSR/FSCSR/FRRM/FSRM(I)/FRFLAGS/FSFLAGS(I) are accepted once F is selected. Only
the CSRs fflags (1), frm (2) and fcsr (3) exist; any other CSR number is an illegal
instruction. `.float` and `.double` emit IEEE data.

The register panel's Float tab shows each f register's low word, which holds a
single; with D each register pairs with its high word `fN.hi`, so the double view
reads all 64 bits. Typing a single into fN NaN-boxes it. History snapshots the float
file and fcsr, so stepping back restores them bit for bit.

With F or D selected the Mandelbrot example is the single-precision program from
the MIPS target (same view, palette and escape test, and the same pixels), and a
Floating-point Arithmetic example is added.

The assembler provides a GNU-like subset, without a linker, macros, numeric
local labels, relocation operators or ELF. `li` and `la` always emit LUI/ADDI;
`call` emits a JAL and therefore has its range. Compressed instructions require
explicit `c.*` syntax; there is no automatic compression. `.option rvc` enables
those forms only in RV32IMC and `.option norvc` disables them until re-enabled.
`nopic` and `norelax` describe the fixed source environment; other option modes are diagnosed. Includes
are bounded at 64 nested files, 4096 file expansions and 100000 expanded source
lines/statements. Output reservations are bounded before allocation to 1 MiB.

Educational ECALL uses a7 for service, a0 for argument/result: 1 prints a
signed integer, 4 prints a zero-terminated byte string, 5 reads a signed integer,
11 prints a character, and 10/93 exits. This is not Linux. EBREAK halts.
No atomic, privileged, pipeline or device model is provided, and no CSRs
beyond the floating-point ones. FENCE is a no-op in the single-core sequential memory environment.

History stores fixed-width register snapshots and scalar control state in typed
columns and byte undo effects in shared blocks. Calls/returns record one frame
delta in typed columns; history has no object payloads and deep recursion does
not retain copies of the call stack.
