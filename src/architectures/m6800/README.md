# Motorola 6800 / 6809 / 68HC11

The common CPU variant setting selects the original 6800 (default), 6809 or
68HC11. Each uses its actual opcode map and native register/flag/stack behavior.
All three live in this directory and share arithmetic, flag and stack primitives,
the configurable assembler frontend, runtime, debugger controllers and tools.
They are grouped as a family for selection; they are not binary-compatible modes.

The original M6800 documented instruction set and immediate, direct (`<address`), indexed (`offset,X`), extended and relative addressing are implemented. Addresses default to extended encoding, making forward references stable. `BHS/BLO` and `LSL` aliases are accepted. Later instructions are rejected when the original 6800 is selected.

6809 adds D (the overlapping A:B pair), Y, U, DP, E/F condition bits, long
branches, word arithmetic/comparisons, register transfer/exchange, LEA, MUL,
register-list S/U stack operations, and its separate opcode pages. Native
indexed postbytes support signed five/eight/16-bit offsets, A/B/D offsets,
pre/post auto-indexing, PCR-relative addresses and indirection, including extended
indirect addresses. `<offset`/`>offset` force an eight/16-bit indexed displacement;
unresolved indexed expressions use 16 bits. PCR operands name the absolute
target, with `<target,PCR` selecting the short form. Direct-page operands name
the low byte; DP supplies the high byte. Stack pushes pre-decrement, unlike
6800/68HC11's post-decrement. TST preserves C and right shifts preserve V.
RTI honors CC.E when deciding whether a full frame is present. Undefined
mixed-width TFR/EXG forms and illegal postbytes are rejected.

68HC11 adds D, Y, word arithmetic/full-width comparisons, Y-indexed and cross
X/Y prefix pages, MUL, IDIV/FDIV, word shifts, X/Y exchange, Y stack transfers,
memory bit masks and bit-test branches. Indexed offsets are unsigned bytes.
MUL preserves Z; division writes native quotient/remainder and flags, including
FFFF on a zero divisor. Indeterminate division remainders are preserved in
this simulator. TAP cannot re-set the X interrupt mask once cleared. RTI pulls
Y as part of the native frame. STOP continues when CCR.S disables it; otherwise
it reports the missing external wakeup source.

The THRAX host monitor intercepts native `SWI`: A=0 exits, A=1 prints signed B, A=2 prints character B, A=3 reads signed 8-bit integer into B. The monitor preserves other registers. Hardware SWI interrupt stacking/vector dispatch, IRQ/NMI, peripherals and cycle timing are not modeled. `WAI` reports that no external interrupt source is modeled instead of silently halting.

Reference: [Motorola M6800 Programming Reference Manual, November 1976](https://www.bitsavers.org/components/motorola/6800/Motorola_M6800_Programming_Reference_Manual_M68PRM%28D%29_Nov76.pdf).

The same educational SWI ABI applies to all three variants. 6809 SWI2/SWI3,
SYNC and CWAI report missing native interrupt/vector delivery. Native peripheral
models, supervisor traps and hardware pipeline timing are outside this teaching
environment. The pipeline panel reports the absent model; X-Ray is unavailable.

Each variant has 64 KiB RAM, code at `0x1000`, data/bitmap at `0x4000` and a
reset S of `0xefff`; 6809 U resets to `0xdfff`, DP to zero. Registers, memory,
call stack, symbols, console and observer tools use shared controllers. The
history schemas explicitly choose 5/9/7 visible words and maximum 3/5/5 native
instruction bytes for 6800/6809/68HC11. D is a reversible alias of A:B, not
independent state. The common one-million-entry target and 256 MiB typed-column
budget remain unchanged. Replacing a variant releases its previous native state;
programs must be reassembled before loading under a different variant.

All ten standard example topics are available on each variant. 6809 has native
text ports for its different encodings; 68HC11 reuses compatible source files
and has separate MUL-factorial and Y-indexed string examples. No example is an
embedded TypeScript string. Bitmap examples request their shared tool and use
the same framebuffer format, 16-iteration limit and MIPS Mandelbrot palette.

Variant references: [Motorola 6809 Programming Manual](https://bitsavers.org/components/motorola/6809/M6809PM.rev0_May83.pdf),
[NXP M68HC11 Reference Manual](https://www.nxp.com/docs/en/reference-manual/M68HC11RM.pdf).
