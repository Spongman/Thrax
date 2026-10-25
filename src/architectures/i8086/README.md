# Intel x86: 8086 / 8088 / 80186 / 80188

The default CPU is 8086 with no numeric coprocessor. The math-coprocessor list depends on the CPU (see below). The 8088 shares 8086 integer semantics; 80188 shares 80186 integer semantics. Their external bus widths do not change this functional simulator. The workbench uses real x86 encodings and Intel operand order. The shared configurable assembler, runtime, source index, debugger controller, column-store history, memory inspector, editor integration and tools are reused. Native code here supplies register metadata, encoding/decoding, effective addresses and instruction semantics.

Registers are AX/CX/DX/BX/SP/BP/SI/DI, ES/CS/SS/DS, IP and FLAGS. The shared PC is the physical 20-bit instruction address. CS:IP fetches wrap IP at 16 bits; memory operands select DS or SS, support all eight 8086 effective-address forms and segment overrides, wrap effective offsets at 16 bits, and wrap physical addresses at 20 bits. Multi-byte transfers wrap at the segment end on 8086/8088; on 80186/80188 they continue physically beyond the segment end using the shared segment-address helper. Editing IP or CS synchronizes physical PC; moving physical PC outside the current segment window selects a representable CS:IP. Flat code begins at 0x1000, data/framebuffer at 0x8000, SS initially zero and SP at 0xfffe.

Supported baseline instructions include byte/word MOV, segment moves, LEA/LES/LDS, arithmetic/logic/test/compare and condition flags, register/memory INC/DEC, shifts/rotates by 1 or CL, signed/unsigned MUL/DIV, stack/flags operations, near/far direct and indirect CALL/JMP, RET/RETF/IRET, conditional jumps, LOOP/JCXZ, software interrupts, decimal adjustments, sign-extension/transfers and REP string instructions. Native calls push actual stack words and report frames through the common call-stack mechanism. PUSH SP stores the decremented SP on 8086/8088 and the original SP on 80186/80188. The original 8086 signed-divide quotient excludes the most negative integer; 80186/80188 include it. Conditional branches report actual outcomes to common observers.

Memory syntax examples: `mov ax, [bx+si+4]`, `mov word [label], 3`, `mov al, es:[di]`, `call far [pointer]`. Fixed disp16 encoding for based memory references keeps two-pass assembly layout independent of forward labels. Short conditional branches must fit -128..127 bytes; use a conditional skip over a near JMP for longer transfers. REP syntax is `rep movsb`. Original 8086 shifts accept 1 or CL; immediate PUSH and 80186+ forms are rejected unless an 80186/80188 is selected. Those CPUs add PUSHA/POPA, immediate PUSH and three-operand IMUL, immediate shifts/rotates, ENTER/LEAVE and BOUND. Shift counts are masked to five bits; original 80186 ENTER uses the full eight-bit nesting level. BOUND takes vector 5 as a trap with the following IP saved. Native INS/OUTS encodings are accepted but diagnose that no I/O-port devices are attached.

THRAX provides an explicitly simulator-defined monitor through the real `INT 0x80` encoding:

| AX | Operation |
| --- | --- |
| 0 | Halt |
| 1 | Print signed 16-bit BX |
| 2 | Print BX low byte as a character |
| 3 | Print zero-terminated string at DS:BX |
| 4 | Read signed 16-bit integer into AX |

This monitor is neither Linux nor DOS. INT 21h AH=02h character output and AH=4Ch exit are also accepted; other interrupts use the guest vector table or fault if unhandled. HLT terminates a teaching program.

Limitations: no external hardware interrupt/timer/controller, I/O-port devices, bus-cycle timing or speculative prefetch queue. LOCK does not model multiprocessor bus arbitration. REP strings execute as one debugger instruction. Decoding is bounded to 15 bytes to prevent unterminated prefix streams from hanging the workbench; this is a simulator safeguard, not an original 8086 architectural length rule. Unsupported encodings fault rather than silently behaving as NOP. It is a functional teaching core, not a PC BIOS/DOS machine.

Reference: [Intel 8086 Family User's Manual, October 1979](https://bitsavers.org/components/intel/8086/9800722-03_The_8086_Family_Users_Manual_Oct79.pdf).

Tests use independent opcode bytes, native segment/stack behavior, IP-boundary Step Over, recursive calls, console input, and all 1,024 framebuffer pixels for both graphics examples.

## Optional Intel 8087 or 80187

The math-coprocessor choices depend on the CPU:

| CPU | Coprocessor choices |
| --- | --- |
| 8086, 8088 | None, Intel 8087 |
| 80186, 80188 | None, Intel 8087 (via 82188), Intel 80187 |

80186/80188 systems reached an 8087 through the 82188 integrated bus controller;
the label records that, and the functional model is the same 8087. The settings
dialog offers the 80187 only with an 80186/80188 (a shared choice option may name
the settings it applies to). A stored 80187 setting with an 8086/8088, for example
after changing the CPU, selects no coprocessor.

The optional coprocessor is an extension of each offered x86 CPU, not a separate family
or CPU variant. It adds an eight-entry 80-bit register stack and control/status/tag
words, instruction/data exception pointers and opcode state. The register window
shows logical ST(0)..ST(7) as exact raw 80-bit hexadecimal/integer values, plus
control/environment registers. TOP-relative reads and edits, memory, exceptions,
tags and save/restore all rewind through common typed history. There is no
binary64 conversion in basic arithmetic or real/integer memory conversions.

Implemented native forms include FLD/FST/FSTP (binary32/64/80), FILD/FIST/FISTP
(signed 16/32/64-bit), FBLD/FBSTP (18-digit packed decimal), register and memory
add/multiply/subtract/divide, integer memory arithmetic, comparison/pop forms,
FXCH/FFREE, constants, sign/absolute/test/examine, square root, integer rounding,
finite FSCALE, FXTRACT, partial FPREM, TOP adjustment, control-word and environment
transfers, 14-byte real-mode environments and 94-byte save/restore images,
initialization, exception clearing and 8087 interrupt-mask controls.
Later forms such as FNSTSW AX and FCOMI are rejected.

Arithmetic uses common exact binary primitives with bigint intermediates, 64-bit
extended significands, PC=24/53/64 and all four RC rounding modes. Finite binary
load/store, square root, basic arithmetic, gradual underflow, overflow, signed
zero, quiet NaN and infinity are represented. Exception flags, masked indefinite
results and suppressed unmasked-result writes are modeled. Unmasked exceptions
remain pending until a waiting operation diagnoses the missing external
coprocessor interrupt delivery. Waiting aliases emit an actual WAIT followed by
the corresponding FN instruction; these retire as two debugger operations.

This is a documented functional subset, not a complete 8087 electrical or
numerical conformance implementation. Transcendentals (F2XM1, FYL2X, FYL2XP1,
FPTAN and FPATAN), bus concurrency/timing, interrupt delivery, exhaustive NaN
payload propagation and all historical special-value/projective-infinity tables
are not implemented. FSCALE supports finite scale operands. Comparisons honor
projective infinity equality; the complete original IC-dependent arithmetic
behavior is not claimed. Unsupported instructions fault or fail assembly.

### Intel 80187

The 80187 runs the 80387 numeric core behind the 80186 coprocessor interface, so
it executes the 80387 instruction set without protected mode. Here it executes
everything the 8087 model above does, with the same register view, 46-column
history and save/restore images, plus:

- FSIN (D9 FE), FCOS (D9 FF) and FSINCOS (D9 FB) for |x| < 2^63; larger operands
  set C2 and are left unchanged. Results come from an exact bigint reduction by pi/2
  rounded once to extended precision with RC. The real 80387 reduces with an
  internal pi of limited precision, so results for large operands can differ from
  the hardware in the last bits.
- FPREM1 (D9 F5): IEEE remainder with the quotient rounded to nearest, ties to even;
  partial reduction, C2 and quotient bits follow FPREM.
- FUCOM ST(i) (DD E0+i), FUCOMP ST(i) (DD E8+i), FUCOMPP (DA E9): as FCOM, except
  that a quiet NaN gives unordered without invalid operation.
- Affine infinity only: the IC control bit is stored but ignored, so -inf < +inf.
  Projective closure remains 8087-only.
- FINIT/FNINIT and FSAVE set the 80387 control word 037Fh rather than 03FFh. FENI/FDISI
  (and FN forms) execute as no-ops: the 80187 has no interrupt-enable mask bit.
- FSETPM (DB E4) is accepted and ignored, following the 80387, which treats it as a
  no-op; this follows 80387 documentation and is not confirmed from the 80C187 data sheet.

FSCALE and FXTRACT share the existing implementation, which already uses
80387-style operand ranges (any scale truncated toward zero; FXTRACT of zero
signals zero divide). 80387 transcendentals the 8087 model lacks (FPTAN, FPATAN,
F2XM1, FYL2X, FYL2XP1) are not implemented on either coprocessor, nor are
FSTSW AX, the stack-fault (SF) status bit, or 80387 denormal/unsupported-format
tables beyond what the 8087 model already checks.

Exceptions and WAIT behave identically for both coprocessors: unmasked exceptions
stay pending until a waiting instruction (WAIT, or any non-FN coprocessor
instruction) diagnoses the missing interrupt delivery. Neither model requires a
WAIT before each coprocessor instruction or models the 8087's queue tracking,
bus concurrency, or the 80186-to-80187 coprocessor bus protocol; waiting aliases emit an
actual WAIT, and FN forms do not.

Compatible integer examples are shared. 80186/80188 override only Factorial to
teach immediate IMUL. Selecting either coprocessor adds **Floating-point
Arithmetic**, marked **Requires: Intel 8087**, which computes sqrt(81) * 5 = 45,
and replaces **Mandelbrot Set** with a coprocessor version of the MIPS example:
the same view, size, 16-iteration limit, escape test (4 < |z|^2), palette and
this target's framebuffer at 0x8000. Precision control 24 makes each add and
multiply round as binary32, so every pixel matches the MIPS single-precision
output. Without a coprocessor the Q8 fixed-point Mandelbrot is unchanged.
Selecting the 80187 also adds **Trigonometry**, marked **Requires: Intel 80187**,
which reduces 100 radians by 2*pi with FPREM1 and prints 10000 * sin and cos
from FSINCOS: `-5064 8623`.

Without a coprocessor, history retains the existing 14-word register snapshot. With one,
46 explicit u32 columns include the eight 80-bit registers and environment:
128 extra register bytes per retained entry. Logical mixed-width views are built
only for display/inspection. History recording and replay still exchange native
typed columns directly; the shared 1M-entry target and 256 MiB whole-block budget
apply unchanged. CPU/coprocessor selection routes once at assembly/activation,
not through a per-step family dispatcher.

Primary references: [Intel AP-186, March 1983](https://bitsavers.org/components/intel/80186/210973-001_AP-186_Introduction_to_the_80186_Microprocessor_Mar83.pdf),
[Intel iAPX 86/88/186/188 Programmer's Reference, 1983](https://bitsavers.org/components/intel/80186/210911-001_iAPX86_88_186_188_Programmers_Reference_1983.pdf),
[Intel's 8087 architectural description](https://kib.kiev.ua/x86docs/Intel/486/8087.pdf),
the Intel 80C187 data sheet and the Intel 80387 Programmer's Reference Manual.
