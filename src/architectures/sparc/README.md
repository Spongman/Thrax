# SPARC V8 teaching core

This is a 32-bit, big-endian SPARC V8 functional core with eight overlapping
register windows and 1 MiB of physical RAM. Code starts at `0x1000`, data and the
example bitmap at `0x10000`. Reset selects window zero, clears ICC/Y/WIM, FSR and
the FP registers, and sets `%sp` to RAM end minus 96 bytes. `%g0` always reads
zero.

The encoder and decoder support SETHI, all integer Bicc conditions and annul
forms, CALL/JMPL, SAVE/RESTORE, integer add/subtract including carry/borrow,
logical operations, shifts, signed/unsigned multiply and divide with Y, their
CC forms, byte/halfword/word/doubleword loads and stores, signed loads, LDSTUB,
SWAP, RD/WR of Y, Ticc, FLUSH and STBAR. Memory transfers enforce natural
alignment; doublewords require an even register pair. Multiply/divide retain
exact intermediate values. SPARC subtraction sets ICC.C for **borrow**.

Synthetic `set`, `mov`, `clr`, `cmp`, `tst`, `not`, `neg`, `inc`, `dec`,
`inccc`, `deccc`, bit operations, `jmp`, `ret` and `retl` emit real instructions.
`set` always emits two words, each with its own source row. It therefore must
not be used as one delay instruction. The shared assembler accepts `%hi(expr)`,
`%lo(expr)`, labels, expressions, `.include`, `.equ`, `.text`, `.data`, `.org`,
`.byte`, `.half`/`.hword` (16 bits), `.word`/`.long` (32 bits), `.quad`,
`.ascii`, `.asciz` and `.space`. Comments start with `!` or `//`.

## Windows, control flow and debugging

PC/nPC implement delayed branches, calls and returns. Conditional annul branches
skip the delay instruction when not taken; `ba,a` skips it when taken too.
CALL and JMPL link the call instruction's PC, so conventional returns use
`%o7+8` or `%i7+8`. SAVE reads its operands in the old window, decrements CWP
modulo eight, then writes the destination in the new window. RESTORE increments
CWP. Caller outs overlap callee ins; globals remain shared. SAVE/RESTORE do not
implicitly create or remove call frames. The common debugger closes a return
frame after its delay instruction, including the usual `ret; restore` sequence.

The debugger exposes visible integer registers, nPC, ICC/CWP in PSR, Y and WIM.
Invalid CWP and unaligned nPC edits are rejected. A PC edit resets nPC and
pending delay bookkeeping. WIM starts at zero: window spilling is a software
responsibility. With no invalid windows marked, SAVE can wrap and overwrite
old window contents. A SAVE/RESTORE into a marked WIM window faults atomically;
native overflow/underflow trap handlers are not supplied. The recursive
Ackermann example explicitly saves its state and link on the software stack,
so it does not depend on unimplemented automatic window spilling.

Shared typed column history captures visible registers and sparse byte changes
to architecture-owned internal words, including inactive windows and pending
delay state. It does not copy the entire physical window file per instruction.
Internal effects count toward the common 256 MiB history budget, but do not
appear as guest memory or trigger memory observers. Rewind restores all banks,
links and call frames. The default one-million-entry target and whole-block
eviction remain common across CPUs.

## Floating point

The FPU has `%f0`-`%f31` single registers and FSR. Doubles use an even/odd
pair with the high word in the even register; the register panel shows pairs
that way and data tips show each register's single value. The encoder rejects
odd double registers; a hand-made word naming one faults with
`ftt=invalid_fp_register`. Implemented: LDF/LDDF/LDFSR, STF/STDF/STFSR (GNU
`ld`/`ldd`/`st`/`std` with `%fN` or `%fsr` select the same words), FiTOs/d,
FsTOi, FdTOi, FsTOd, FdTOs, FMOVs, FNEGs, FABSs, FSQRTs/d, FADDs/d, FSUBs/d,
FMULs/d, FDIVs/d, FsMULd, FCMPs/d, FCMPEs/d and all sixteen FBfcc conditions
with annul forms, delay slots and the `fbz`/`fbnz` aliases. Words and pairs
need natural alignment.

Arithmetic is exact binary rounding, not host floats, so all four FSR.RD modes
round correctly for single and double, including subnormals. FsTOi/FdTOi always
truncate. FSR.cexc is replaced and aexc accumulated by every FPop; compares set
fcc to 0 (=), 1 (<), 2 (>) or 3 (unordered). FCMP signals invalid only for a
signaling NaN, FCMPE for any NaN. NaN results follow V8 Appendix N: SNaN rs2,
then SNaN rs1, then QNaN rs2, then QNaN rs1, quieted and keeping its payload;
invalid operations yield `0x7fffffff` (single) or `0x7fffffff_ffffffff`
(double). Invalid integer conversions saturate to `0x7fffffff` or `0x80000000`.
Tininess is detected before rounding; with FSR.UFM set any tiny result traps.
FSR.NS is stored but ignored (results stay standard). ver, ftt and qne read
zero; LDFSR and debugger edits change only RD, TEM, NS, fcc, aexc and cexc.
PSR.EF is not modelled: the FPU is always enabled.

FPops complete precisely, so the deferred-trap queue is always empty and STDFQ
faults with `ftt=sequence_error`. An exception enabled in FSR.TEM faults with
`ftt=IEEE_754_exception`, and quad-precision FPops (which encode) and unknown
opf values fault with `ftt=unimplemented_FPop`; as with other faults no state
retires, and no fp_exception handler is modelled. V8 leaves an FBfcc directly
after an FPop2 undefined: THRAX faults at run time when one executes there;
the assembler does not diagnose it statically. V9 forms such as FMOVd are not
accepted. Each history entry snapshots the 33 FP registers alongside the
integer view, so FP rewinds are exact at about 132 extra bytes per entry.

## Educational monitor and tools

`ta 0x10` invokes a THRAX monitor. `%g1` selects service 1 (print signed `%o0`),
4 (print NUL-terminated string at `%o0`), 5 (read signed 32-bit integer into
`%o0`), 10 (exit), or 11 (print low byte of `%o0`). This is a THRAX convention,
not a Solaris/Linux ABI. Other taken software traps fault. Monitor calls do not
perform native supervisor trap entry. Bitmap examples explicitly store the
shared little-endian RGB bytes, independent of native big-endian loads/stores.

All ten standard example topics and Floating-point Arithmetic use standalone
assembly files. Mandelbrot uses single-precision FPU arithmetic in the same
operation order as the MIPS program, so its iteration counts match. Bitmap and
Mandelbrot request the common Bitmap Display tool. Registers, memory, history,
console, call stack, symbols, statistics, profile, cache, branch history and
memory-reference tools use the shared controllers. Instruction completions and
source/disassembly hovers use the shared help UI and manual-link button.

This core excludes quad-precision floating point, coprocessor CBccc/CPops, V9,
tagged arithmetic, MULScc, ASI/alternate address spaces, privileged instructions,
native exception vectors, MMU, interrupts, devices and control transfers inside
another transfer's delay slot. Unsupported forms diagnose or fault; faults leave
no partially retired state. There is no hardware pipeline timing model or X-Ray
panel. Selecting an ISA alone does not select a particular SPARC implementation's pipeline.

Reference: [SPARC International's V8 Architecture Manual](https://research.swtch.com/sparcv8.pdf)
([official download page](https://sparc.org/technical-documents/specifications/)).
