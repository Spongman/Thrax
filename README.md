# THRAX - Teaching Harness for Runtime Assembly eXecution

A son of MARS (but in a different language). A modern, interactive web-based assembly workbench, built with React, Monaco Editor, and execution engines implemented in TypeScript. It runs sixteen CPU families in a shared workspace, including MIPS under MARS rules and the MIT Beta under BSim rules.

![THRAX](https://img.shields.io/badge/THRAX-Web%20Edition-blue)
![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6)
![React](https://img.shields.io/badge/Framework-React%2019-61dafb)
![License](https://img.shields.io/badge/License-MIT-green)

![The THRAX workspace, running a Mandelbrot program: source, execution history, instruction statistics, memory and a bitmap display](docs/screenshot.png)

## 🚀 Features

### Core Functionality
- ✅ **Sixteen Architecture Families**: MIPS (MARS), the MIT Beta (BSim), MOS 6502 / WDC 65C02 / WDC 65C816, Zilog Z80, ARM (AArch64, AArch32, Cortex-M0 Thumb, ARM2 and ARM3), AVR, RISC-V (RV32IM / RV32IMC), Motorola 68k (68000 / 68010 / 68020), Motorola 6800 / 6809 / 68HC11, Intel 8051, PowerPC, DEC Alpha, Intel 8086, TMS9900, SPARC V8 and SuperH (SH-1 / SH-2), chosen in Settings; each loads only when selected, and the files, line breakpoints and layout carry across
- ✅ **Complete MIPS Assembler**: Lexer → Parser → Machine Code Generator, with errors reported on the line that earned them
- ✅ **Full MIPS Simulator**: The whole MARS instruction table, coprocessors 0 and 1, delayed branching, and device interrupts
- ✅ **Monaco Editor**: Syntax highlighting, completion offering every instruction with its docs, and consistent source/disassembly instruction hovers with syntax, descriptions and a corner manual-link button
- ✅ **Source Workspace**: Multiple source tabs, find/replace, multi-file programs, and a Files panel
- ✅ **Interactive Debugging**: Run, pause, stop, step into/over/out, step back, and source breakpoints
- ✅ **Execution History**: Every instruction and what it changed, with time travel to any point in it
- ✅ **Register Viewer**: All 32 registers plus Coproc 1 and Coproc 0 tabs, editable while stopped
- ✅ **Memory Inspector**: A hex editor with a caret, an ASCII column, and INS/OVR, undoable like an instruction
- ✅ **Call Stack and Symbol Views**: Active `jal` / `jalr` calls, and per-file symbol tables
- ✅ **Cross-Panel Navigation**: A hovered address or register lights wherever else it appears
- ✅ **Heat Map and Gutter Columns**: Execution counts, addresses, and code bytes beside the source
- ✅ **Console I/O**: Output plus in-console input for the interactive syscalls
- ✅ **Dockable Layout**: Files opens at the far left of a fresh workspace; panels dock and tab, and the layout is saved between sessions
- ✅ **Files, Folders and Links**: Autosave, files and `.zip` archives in and out, a folder on disk as the project, share links, GitHub and gists
- ✅ **Portable Export**: Download assembled text in HexText format
- ✅ **MARS Tools**: Bitmap display, keyboard/display MMIO, cache simulator, pipeline model, instruction statistics, branch history, MIPS X-Ray, memory reference visualization, Mars Bot, Scavenger Hunt, and the Digital Lab Simulator
- ✅ **Settings**: Shared display and history preferences, plus each architecture's own options, kept per architecture: the MARS options with the three memory configurations for MIPS, and memory size and the console default for Beta
- ✅ **Example Programs**: Every CPU offers Sum of Numbers, Factorial, Fibonacci, Ackermann, Loop Counter, Bitwise Operations, Bitmap Display and Mandelbrot Set under the same names and order. Targets with a teaching console also offer Hello, THRAX! and Interactive Input; AVR leaves arithmetic results in registers or SRAM. The menu marks required tool windows and opens them on selection. Extra programs demonstrate supported features such as macros, polling I/O, interrupts, compressed instructions, armasm syntax and the Beta TinyOS lab
- ✅ **Dark Theme UI**: VS Code-inspired interface

Each Mandelbrot example hardcodes a 16-iteration limit and the MIPS blue-to-white palette, with black for the interior. Integer ports retain their native fixed-point precision. Byte-indexed examples configure the shared Bitmap Display palette when loaded. The machine profile explicitly selects indexed-byte or four-byte RGB pixels and byte order; an example can override that layout. Framebuffer format is independent of CPU word size.

### Supported Instruction Types

The assembler carries the MARS instruction table: 155 basic forms over 139 mnemonics, and 388 pseudo-instruction forms over 83 mnemonics, plus `bal`, `li.s` and `li.d`.

**Arithmetic**: ADD, ADDU, ADDI, ADDIU, SUB, SUBU, MULT, MULTU, MUL, MADD, MADDU, MSUB, MSUBU, DIV, DIVU, CLO, CLZ

**Logical**: AND, ANDI, OR, ORI, XOR, XORI, NOR

**Shifts**: SLL, SRL, SRA, SLLV, SRLV, SRAV

**Comparison**: SLT, SLTI, SLTU, SLTIU

**Load/Store**: LW, LH, LHU, LB, LBU, SW, SH, SB, LUI, LL, SC, LWL, LWR, SWL, SWR

**Jump & Branch**: BEQ, BNE, BGEZ, BGTZ, BLEZ, BLTZ, BGEZAL, BLTZAL, J, JAL, JR, JALR

**Conditional Move**: MOVN, MOVZ, MOVF, MOVT

**Traps**: TEQ, TEQI, TNE, TNEI, TGE, TGEU, TGEI, TGEIU, TLT, TLTU, TLTI, TLTIU

**Special**: MFHI, MFLO, MTHI, MTLO, NOP, SYSCALL, BREAK

**Coprocessor 1 (floating point)**: LWC1, SWC1, LDC1, SDC1, MFC1, MTC1, ADD/SUB/MUL/DIV/ABS/NEG/SQRT/MOV (`.s` and `.d`), CVT.S.W, CVT.S.D, CVT.D.W, CVT.D.S, CVT.W.S, CVT.W.D, ROUND/TRUNC/CEIL/FLOOR.W (`.s` and `.d`), C.EQ/C.LT/C.LE (`.s` and `.d`), BC1T, BC1F, MOVT, MOVF. Comparisons and branches use condition flag 0; double-precision operands take the even register of an even/odd pair.

**Coprocessor 0 (system control)**: MFC0, MTC0, ERET. The register file exposes `$8` (vaddr), `$12` (status), `$13` (cause), and `$14` (epc), reachable by number or by the `$status`-style aliases.

**Assembler pseudos**: LI, LA, MOVE, B, BAL, BEQZ, BNEZ, BLT/BLE/BGT/BGE (and unsigned variants), SUBI, SUBIU, MULU, MULO, MULOU, REM, REMU, ABS, NEG, NEGU, NOT, ROL, ROR, SEQ/SNE/SGT/SGE/SLE (and unsigned variants), ULW, USW, ULH, ULHU, USH, LD, SD, L.S, L.D, S.S, S.D, LI.S, LI.D. These are expanded to base MIPS instructions before addresses and branch offsets are assigned, so they work in debugging and HexText exports.

### Syscall Support
Every MARS syscall is implemented; the MIDI pair keeps its timing and plays nothing.
- `1`, `2`, `3`, `4`, `11`: Print integer, float, double, string, or character
- `5`, `6`, `7`, `8`, `12`: Read integer, float, double, string, or character
- `9`: Allocate heap memory (`sbrk`)
- `10`, `17`: Exit, or exit with a code
- `13`, `14`, `15`, `16`: Open, read, write, and close a file
- `30`: System time in milliseconds
- `31`, `33`: MIDI out, asynchronous and synchronous
- `32`: Sleep
- `34`, `35`, `36`: Print integer as hexadecimal, binary, or unsigned decimal
- `40`, `41`, `42`, `43`, `44`: Seed a random stream, then draw an int, a bounded int, a float, or a double from it
- `50` to `59`: Dialog input (confirm, int, float, double, string) and message output
- `60`: Clear the console

### Memory-Mapped Keyboard and Display

The Keyboard and Display Simulator uses the standard MMIO addresses:
`0xffff0000` receiver control, `0xffff0004` receiver data, `0xffff0008`
transmitter control, and `0xffff000c` transmitter data. Receiver and
transmitter readiness use bit 0. Reading receiver data consumes one queued
character; writing transmitter data appends its low byte to the tool display.

### Editing Registers and Memory
Whenever the machine is stopped, which includes a program that has been assembled and
not yet started, both windows can be typed into. Each edit is a history entry of its
own, so it shows in the history panel and steps back like an instruction does.

A register cell is double-clicked and typed over: the value reads in the radix the cell
is showing, `0x` names hexadecimal wherever it appears, and a float cell takes a float.
`$zero` is hardwired and stays read-only.

The memory window is a hex editor rather than a grid of edit boxes. Clicking a hex digit
or an ASCII character puts a caret on it; a hex digit typed there writes that nibble and
a character typed in the ASCII column writes that byte, each advancing the caret. The
arrow keys, **Home**, **End** and the page keys move it, **Tab** swaps columns, and
**Escape** puts it away and gives the panel's keys back to the workspace.

**Insert** switches the toolbar between **OVR** and **INS**. Overwriting replaces the
byte the caret is on, and **Delete** and **Backspace** zero a byte. Inserting makes room
instead: the rest of the section on show moves up a byte and the byte at the end of it
falls off, and **Delete** and **Backspace** take a byte away and move the section back
down. Memory is not a file, so a section is the region a byte can fall off the end of.

Text-segment writes go past the `Self-Modifying Code` setting, which gates a running
program rather than a hand edit: rewriting an instruction from the memory window is the
point of the exercise.

### Supported Data Directives
- Segments: `.data`, `.text`, `.kdata`, `.ktext`, each accepting an optional base address such as `.ktext 0x80000180`
- Storage: `.word`, `.half`, `.byte`, `.float`, `.double`, `.ascii`, `.asciiz`, `.space`, `.align`
- Symbols: `.globl`, `.global`, `.extern name, size` (which reserves `size` zeroed bytes in the data segment), `.eqv`
- Program structure: `.macro`/`.end_macro`, `.include "file.asm"`, and `.set`, which is accepted and ignored

### Operand Syntax
- Registers by name or number: `$t0` and `$8` are the same register, as are `$ra` and `$31`
- Character literals are integers: `li $t0, 'a'`, `.byte 'a', '
'`
- Label expressions add a constant to a label: `la $t0, arr+4`, `lw $t1, arr+4($s0)`, `.word arr+8`

### Multi-File Programs
The project is the set of files in the **Files** panel, and each has a tab while it is
open; closing a tab puts the file away without taking it out of the project, and the
panel is where it comes back or is removed. Double-clicking a tab renames the file.
`.include "lib.asm"` pulls in another project file by name, and the **All files** setting
assembles every file into one program instead of only the active one, as MARS's
"assemble all files in directory" does. It is offered only where the architecture
assembles several entry files, which MIPS does; a Beta program is the active file
and what it includes. Files share one symbol table, so labels
resolve across them; the active tab supplies the entry point, which is the `main`
label when the program defines one.

### MIT Beta (BSim profile)
The Beta is the 6.004 / Computation Structures 32-bit RISC: 32 registers with
`R31` reading zero, no delay slot, and the supervisor bit in the top bit of the
PC. Programs are UASM, with the instructions supplied as macros by a bundled
`beta.uasm`, so `.include "beta.uasm"` works without the file being in the
project. The full integer instruction set runs, `MUL` and `DIV` included.

The machine follows BSim:
- Memory is one flat region from address 0, 1 MB by default and 64 KB to 16 MB in Settings. Reset enters supervisor mode at `0x80000000`
- Vector table at `0x80000000` plus: 0 reset, 4 illegal instruction (and SVC), 8 segmentation fault, 12 clock, 16 keyboard, 20 mouse. An illegal instruction in supervisor mode, a misaligned load or store, an access outside memory, and division by zero stop the run with an error
- `HALT()` (the all-zero word) stops the machine; `RDCHAR()` reads a typed character into `R0`, carriage return as line feed, waiting while none is typed; `WRCHAR()` prints the low byte of `R0`. `RDCHAR` and `WRCHAR` need `.options tty`, or the Settings default when a program names neither `tty` nor `notty`
- `.options clock` raises a clock interrupt every 10,000 cycles; with `tty`, typed characters raise keyboard interrupts. A request waits until the CPU is in user mode, then is taken before the next instruction, clock first: `XP` gets PC+4 and the PC the vector. Interrupts step back like instructions and are named in the history. There is no mouse, so `CLICK()` reads -1 and the mouse interrupt never comes
- Typing: BSim keeps one typed character and each key press overwrites it; THRAX queues a submitted line and hands it over a character at a time, each once the last was read and 10,000 cycles have passed, as a typist would. A program that only polls `RDCHAR` gets typed text at once. Once a `tty` program has run in user mode, the console takes input while it runs
- `.options segmentation`: BSim's base-and-bounds MMU. A user-mode address at or past the bounds traps to vector 8 (`XP` is the PC on a fetch, PC+4 on a load or store); otherwise the base is added. In supervisor mode `LD` and `ST` at `SEG_BASE` (-4) and `SEG_BOUNDS` (-8) reach the two registers. The editor, breakpoints and history show user-mode addresses physically
- Not implemented, and so illegal: the `CYCLE`, `TIME`, `RANDOM`, `SEED` and `SERVER` privileged operations

UASM compatibility:
- Supported: `.include`, `.macro` in line and `{ }` block form with overloads by argument count, `.align`, `.ascii`, `.text` (zero-terminated and word-aligned), `.options` (`tty`, `clock`/`clk`, `segmentation`, `annotate`, `kalways`, `div`, `mul`, and their `no` forms), `.breakpoint`, which sets a line breakpoint each time the program is built, and `.protect` and `.unprotect`, which are accepted and recorded
- `.segment NAME` starts a user-mode segment assembled from address 0 and placed after the last, with its own labels falling back to the kernel's; the kernel gains `NAME_base` and `NAME_bounds`. Labels show at their physical addresses, as `NAME:label` where two segments share a name
- Symbols and the location counter: `name = expr`, `. = expr`, labels, and `.` in expressions
- Expressions evaluate strictly left to right with no precedence, as BSim does: `+ - * / % & | << >>` and unary `- ~ +`, over decimal, `0x` hex, `0b` binary, leading-zero octal and character literals. `>>` is logical, and division or modulo by zero is an error
- `.pcheckoff`, `.tcheckoff` and `.verify` only talk to the course's checkoff server, and are skipped
- Beta source files use the `uasm` editor language with completion of the library macros, go-to-definition into `beta.uasm`, and data tips for registers, symbols and macros; new files are `.uasm`, and **Download HexText** writes memory from address 0 as words

### MOS 6502 and WDC 65C02
The CPU model setting selects the original NMOS 6502 (default) or WDC W65C02S.
Both share the same CPU, assembler, debugger, memory/device model and history.

An NMOS 6502 on a bare board: the 151 documented opcodes plus all 105 undocumented encodings, in all 13 addressing
modes, with exact flags, NMOS decimal mode (Z from the binary sum, N and V from
the intermediate result on `ADC`; binary flags on `SBC`), the `JMP ($xxFF)`
page-wrap bug, zero-page and stack wrapping, and cycle counts with the
page-crossing and taken-branch penalties, shown as the `Cycles` register.

The machine:
- 64 KiB of RAM. `$0000-$00FF` zero page, `$0100-$01FF` stack, `$0200-$05FF` a 32 x 32 framebuffer for the Bitmap Display (base `0x200`, a byte per pixel whose low four bits pick one of 16 colours), code from `$0600` by default, the I/O page at `$F000`, vectors at `$FFFA` (NMI), `$FFFC` (RESET), `$FFFE` (IRQ/BRK)
- I/O page: `$F000` write prints a character; `$F001` read takes the next typed character (CR reads as LF), waiting for one; `$F002` read is the status (bit 0 a key is ready, bit 1 the timer fired), and any write acknowledges the timer; `$F003` write halts with that exit code; `$F004` enables interrupts (bit 0 keyboard IRQ, bit 1 timer IRQ, bit 2 timer raises NMI instead); `$F005`/`$F006` set the timer period in cycles, 0 to stop it. Other addresses in the page read 0
- The program starts at the RESET vector. When the program leaves it out, the assembler points it at the first instruction. When the IRQ vector is left out, `BRK` halts the machine
- IRQ is a level, taken between instructions while an enabled source holds it and `I` is clear; NMI is taken before the next instruction regardless of `I`. Both take 7 cycles, push PC and P with B clear, and step back like instructions
- The console and the Keyboard and Display tool share the keyboard queue. A program waiting at `$F001`, polling the status, or with the keyboard IRQ enabled can be typed to while it runs
- Settings: decimal mode, on by default; off ignores `D`, as the NES 2A03 does
- NMOS undocumented instructions assemble, disassemble and execute, including compound RMW operations, operand NOPs, masked stores and JAM/KIL. Unstable XAA and immediate LAX use a fixed `$EE` magic mask; masked stores include page-cross address corruption. These deterministic choices cannot reproduce chip/temperature-dependent behavior. See [the NMOS notes](src/architectures/mos6502/NMOS.md)
- Not modelled: dummy reads and the double write of read-modify-write instructions; the I/O page only answers data accesses, not instruction fetches

Assembly follows ca65 where it overlaps:
- `label:`, `@local:` labels scoped to the label before them, `;` comments, `name = expr`, `name .equ expr`, `.set name, expr`, `* = expr` and `.org`
- Numbers in decimal, `$` hex, `%` binary and `0x` hex; `'A'` characters; strings with C escapes; `*` is the location counter where an operand starts. Operators with ca65's precedence: unary `- ~ + < >` (low and high byte), then `* / & ^ << >>`, then `+ - |`
- Operands: `#imm`, `zp`, `zp,X`, `abs,Y`, `(ind)`, `(zp,X)`, `(zp),Y`, branch targets, and `A`, which `ASL`, `LSR`, `ROL` and `ROR` also take with no operand. An operand layout already knows to be below `$100` takes the zero-page form; a forward reference takes the absolute one. `z:` and `a:` force either
- Directives: `.byte`/`.db`/`.byt`, `.word`/`.dw`/`.addr`, `.res`/`.ds` with an optional fill, `.ascii`, `.asciiz`, `.align`, `.include`, `.macro name params` ... `.endmacro`/`.endm`, and `.breakpoint`. Macro arguments are values, and labels inside a macro are local to each expansion
- Not supported: `.if` and other conditionals, `.segment`, `.proc`/`.scope`, unnamed labels, and comparison and logical operators
- Sources use the `ca65` editor language with data tips for registers, symbols, addresses and mnemonics; new files are `.a65`

The W65C02S variant adds its documented CMOS instructions and addressing modes:
`BRA`, `STZ`, `TRB`/`TSB`, `PHX`/`PLX`, `PHY`/`PLY`, accumulator `INC`/`DEC`,
`JMP (abs,X)`, zero-page indirect operations, additional `BIT` forms,
`RMB`/`SMB`, `BBR`/`BBS`, `WAI` and `STP`. It corrects indirect JMP page wrapping,
uses CMOS decimal flags and timing, and clears D on interrupt entry after stacking
the previous flags. NMOS mode rejects CMOS-only instructions. Wait/stop and
interrupt transitions are reversible; the existing memory and history limits apply.
This remains a CPU teaching machine using THRAX's I/O page, rather than a WDC board.
See [the model notes](src/architectures/mos6502/W65C02S.md) for exact behavior and limits.

### Zilog Z80
A Z80 on a bare board: every documented instruction with the CB, ED, DD/FD and
DDCB/FDCB prefixes, the alternate registers, I and R (R counts each opcode
fetch), exact flags including H, P/V and N, and the undocumented forms programs
use: `IXH`/`IXL`/`IYH`/`IYL`, `SLL`, DDCB with a register copy, `IN F,(C)`,
`OUT (C),0`, and flag bits 3 and 5 (except `BIT n,(HL)`, which takes them from
H rather than MEMPTR). T-states are counted per instruction, as the Zilog manual
gives them, and shown as the `T-states` register.

The machine:
- 64 KiB of RAM; the program starts at `$0000`. The Bitmap Display reads a 32 x 32 framebuffer at `$C000`, a byte per pixel whose low four bits pick one of 16 colours
- Devices at `$FF00-$FF07`, and on I/O ports `$00-$07` (the low byte of the port address): `+0` write prints a character; `+1` read takes the next typed character, 0 when none; `+2` read is the status (bit 0 a character is waiting, bit 1 output ready, bit 2 the timer fired since the last read), write enables interrupts (bit 0 keyboard, bit 1 timer); `+3` write ends the program with that exit code; `+4` sets the timer period in units of 256 T-states, 0 to stop it; `+5` read takes the next typed character, waiting for one. The rest of the page is RAM
- Interrupts: the timer, then the keyboard, are taken before an instruction while IFF1 is set, never straight after `EI`. The keyboard puts `$F7` (`RST 30h`) on the bus and the timer `$FF` (`RST 38h`): IM 0 runs that RST, IM 1 goes to `$38`, IM 2 reads the handler from `I * 256 +` that byte. NMI (to `$66`, keeping IFF2 for `RETN`) is modelled but nothing raises it. Interrupts push a call-stack frame and step back like instructions
- `HALT` waits for an interrupt, skipping to the next timer tick or typed character; with interrupts disabled, or no enabled source that could raise one, it ends the program
- The shared Keyboard / Display window queues characters and shows device output for both polling and interrupt examples
- Not modelled: MEMPTR, the `LD A,I` interrupt quirk, IM 0 bus bytes other than RST, and contention or wait states

Assembly is the common subset of zasm and sjasmplus:
- `label:` anywhere, or a name in the first column without a colon; `.local` labels hang off the label before them; `;` comments
- Numbers: decimal, `$FF`, `#FF`, `0xFF`, `0FFh`, `%1010`, `0b1010`, `1010b`, `17o`; `'A'` characters; `$` is the current address. C operators with C precedence, comparisons and logic giving 1 or 0, and `LOW()` and `HIGH()`
- Directives: `ORG`, `EQU`, `=`/`DEFL`, `DB`/`DEFB`/`DM`/`DEFM`/`BYTE` (strings too), `DW`/`DEFW`/`WORD`, `DS`/`DEFS`/`BLOCK` with an optional fill, `ALIGN`, `INCLUDE "file"`, `END`, and macros written `name MACRO params` or `MACRO name params` ... `ENDM`. Directives may take a leading dot
- Macros expand as text, so a parameter can stand for a register; `.labels` inside a macro are local to each expansion, and the code maps to the line that invoked it
- Instruction sizes follow from the operands' shapes, so layout never waits for a value; `JR` and `DJNZ` out of range, displacements past -128..127 and invalid operand combinations are reported on their line
- Not supported: conditionals (`IF`), `PHASE`, `STRUCT`, unnamed and temporary labels, and `<`/`>` as low and high byte
- Sources use the `z80` editor language with data tips for registers, pairs and what they point at, symbols and numbers; new files are `.z80`

### ARM (AArch64, AArch32 and Cortex-M0)

The ARM target offers AArch64 and AArch32 ARMv8-A profiles, plus an ARMv6-M
Cortex-M0 Thumb profile. Its persisted target id remains `armv8` for compatibility.
The execution-state setting chooses AArch64 or AArch32; switching rebuilds,
and the Registers panel, the Examples menu and the editor language follow it.
Floating point is on by default for both (scalar FP for A64, VFPv4-D16 for
A32); the **Floating point** setting turns it off, making the FP instructions
undefined, rejecting them in the assembler, and offering the fixed-point
Mandelbrot example in place of the floating-point one. Advanced SIMD (NEON)
vector operations are not supported in either state.

AArch64 user programs at EL0, as Linux runs them, with no MMU: X0-X30, SP and
the PC as exact 64-bit values (the Registers panel shows them in full, with a
W tab for the 32-bit views), and NZCV. The integer A64 instruction set: add and
subtract with immediates, shifted and extended registers, carry, logical
(bitmask) immediates, move wide, bitfields and extract, multiply, multiply-long
and divide, conditional select and compare, every branch, and loads and stores
of every width with sign extension, pre- and post-index, register offsets,
pairs, unscaled offsets and literals. `svc`, `hlt`, `brk` and `nop` complete it.

Scalar floating point in V0-V31, viewed as S and D (a scalar write clears the
rest of the register), with FPCR (AHP, DN, FZ and RMode; trap enables read as
zero) and FPSR: `fmov` (register, general and immediate), `ldr`/`str`/`ldur`/
`stur`/`ldp`/`stp` of B, H, S, D and Q, `fadd`/`fsub`/`fmul`/`fdiv`/`fnmul`,
`fmadd`/`fmsub`/`fnmadd`/`fnmsub` (fused), `fsqrt`, `fabs`/`fneg`,
`fmax`/`fmin`/`fmaxnm`/`fminnm`, `fcmp`/`fcmpe` (also with `#0.0`),
`fccmp`/`fccmpe`, `fcsel`, `fcvt` between S and D, `frintn`/`p`/`m`/`z`/`a`/`x`/`i`,
`scvtf`/`ucvtf` and `fcvtzs`/`fcvtzu` (also fixed point with `#fbits`),
`fcvtns`/`nu`/`as`/`au`/`ps`/`pu`/`ms`/`mu`, and `mrs`/`msr` of `fpcr`, `fpsr`
and `nzcv`. Results follow the Arm ARM's pseudocode exactly: rounding modes,
NaN propagation and default NaN, flush-to-zero, saturating conversions and the
cumulative exception flags. Half precision and Advanced SIMD vectors are not
supported. The Registers panel's FP tab lists each Vn as Sn (`f`) or Dn (`d`)
with FPCR and FPSR; every FP effect, the upper half of a Q included, steps
back exactly.

The machine:
- Memory from `0x00400000`: code there, `.data` at `0x00420000`, the program break after the data, and SP starting at the top. The size is a setting (1, 4 or 16 MB); anything outside it faults. Unaligned data accesses are allowed and SP alignment is not checked
- System calls by `svc #0` with the number in X8 and the result in X0: `read` (63) from fd 0, waiting for typed input; `write` (64) to fd 1 and 2; `exit` (93) and `exit_group` (94); `brk` (214). Other numbers stop the program with an error
- MARS's keyboard and display registers answer 32-bit accesses at `0xFFFF0000` for the Keyboard and Display tool; the Bitmap Display reads words from `.data`
- `bl`/`blr` and `ret` keep the call stack; every effect, 64-bit values included, steps back exactly

Assembly is GNU as for AArch64 (`.s`/`.S`):
- `//` and `/* */` comments, `;` between statements, `name:` and numeric `1:` labels referred to as `1b`/`1f`; the program starts at `_start`, else `main`
- Registers `x0`-`x30`, `w0`-`w30`, `sp`, `wsp`, `xzr`, `wzr`, `lr`, `fp`, and `b0`-`b31`, `h0`, `s0`, `d0`, `q0` and so on; real immediates such as `#1.5` or `#-2.5e-3`; `#` before immediates is optional; `:lo12:` with `adrp`; `ldr x0, =value` becomes a `mov` where one encodes the value, else loads from a literal pool placed at `.ltorg`/`.pool` or the end of the section
- The preferred aliases: `mov`, `mvn`, `neg`, `cmp`, `cmn`, `tst`, `lsl`/`lsr`/`asr`/`ror`, `ubfx`/`sbfx`/`ubfiz`/`sbfiz`/`bfi`/`bfxil`/`bfc`, `sxtb`/`uxth`..., `cset`/`csetm`/`cinc`/`cinv`/`cneg`, `mul`/`mneg`/`smull`/`umull`; `b.eq` or `beq`. The disassembly prints them too
- Directives: `.text`, `.data`, `.bss`, `.rodata`, `.section`, `.byte`, `.hword`, `.word`, `.quad` (and their GNU synonyms), `.float`/`.single` and `.double`, `.ascii`, `.asciz`, `.string`, `.align`/`.p2align`, `.balign`, `.space`/`.skip`/`.zero`, `.fill`, `.equ`/`.set`/`=`, `.global`, `.include`, `.macro`/`.endm` with `\param`, defaults and `\@`, `.rept`/`.endr`, `.inst`, `.end`; object-file directives such as `.type` and `.cfi_*` are accepted and ignored
- Literals are exact to 64 bits; arithmetic on symbols is exact within 2^53
- Not supported: conditionals (`.if`), `.irp`, sections other than text and data, and relocations other than `:lo12:`
- Sources use the `aarch64` editor language with data tips for X and W registers, S and D registers as floats, effective addresses, symbols and numbers; new files are `.s`

AArch32 user programs in User mode, as Linux runs them under the EABI, with the
A32 instruction set only: no Thumb (T32), Advanced SIMD or other coprocessors.
R0-R14, a 32-bit PC that reads (and stores) as the instruction's address + 8,
and the CPSR with N Z C V Q and GE; User mode has no SPSR, and MSR writes only
the flags and GE. Everything the 26-bit ARM runs except `SWP` and the P forms,
plus `LDRH`/`STRH`/`LDRSB`/`LDRSH`/`LDRD`/`STRD`, `MRS`/`MSR`, `BX`/`BLX`, `CLZ`,
`MOVW`/`MOVT`, `MLS`, `UMULL`/`UMLAL`/`SMULL`/`SMLAL`, `SDIV`/`UDIV` (by zero
gives 0), `UBFX`/`SBFX`/`BFI`/`BFC`, `REV`/`REV16`/`REVSH`/`RBIT`,
`SXTB`/`SXTH`/`UXTB`/`UXTH` and their `A` forms, `LDREX`/`STREX`, `SVC`,
`BKPT`, `UDF`, `PLD`, the hints and the barriers. A write to the PC other than
by `B` or `BL` interworks: an odd address, like `BLX` to a label, would enter
Thumb, so it stops the program with an error saying so, changing nothing.

VFPv4-D16 floating point: S0-S31, overlaid as D0-D15 (D16-D31 are undefined),
and FPSCR (N Z C V, AHP, DN, FZ, RMode and the cumulative flags; Len and
Stride read as zero). `vmov` (core to S, core pair to D and back, immediate,
register), `vldr`/`vstr`, `vldm`/`vstm` (IA, DB, `!`), `vpush`/`vpop`,
`vadd`/`vsub`/`vmul`/`vdiv`/`vnmul`, `vmla`/`vmls`/`vnmla`/`vnmls` (two
roundings) and `vfma`/`vfms`/`vfnma`/`vfnms` (fused), `vsqrt`, `vabs`/`vneg`,
`vcmp`/`vcmpe` (also with `#0`), `vmrs` (`APSR_nzcv` or a core register) and
`vmsr` of FPSCR, and `vcvt` between F32 and F64, between floats and S32/U32
(toward zero, or `vcvtr` in the FPSCR mode) and to and from fixed point
(S16/U16/S32/U32 with `#fbits`). Every one takes a condition (`vaddeq.f32`).
Arithmetic follows the same Arm pseudocode as A64. The Registers panel's VFP
tab lists S0-S31 (`f`) or D0-D15 (`d`) with FPSCR, and every FP effect steps
back exactly. Not supported: D16-D31, half precision (`vcvtb`/`vcvtt`), the
ARMv8 additions (`vrint`, `vsel`, `vmaxnm`), `vldr` of an `=` literal, and in
armasm sources real constants and dotted types (`vadd.f32`; write
`vadd s0, s1, s2`).

The machine:
- The AArch64 state's memory layout, keyboard and display, and Bitmap Display; `LDR`, `STR` and the halfword forms may be unaligned and read the bytes they name, while `LDRD`, `STRD`, `LDM`, `STM` and the exclusives need a word-aligned address
- System calls by `svc #0` with the number in R7 and the result in R0: `read` (3), `write` (4), `exit` (1), `exit_group` (248), `brk` (45), as for AArch64
- `bl`/`blx` and any return to a caller's address keep the call stack; every effect steps back exactly

Assembly is the 26-bit ARM's GNU as and armasm (below), under ARMv8 rules:
`.s` and `.S` are GNU as and `.armasm` armasm, and new files are `.s`.
Mnemonics may be divided (`ldreqh`) or unified (`ldrheq`), and the disassembly
is unified (`addseq`, `push`, `pop`). A `mov` of a 16-bit value no rotation
fits becomes `movw`, and `movw`/`movt` take `#:lower16:` and `#:upper16:`.
Sources use the `arm` editor language with ARMv8's mnemonics, VFP's included;
GNU sources take `.float`/`.single` and `.double`, and real immediates such as
`#1.5`.

The Cortex-M0 profile executes ARMv6-M Thumb integer instructions, including
16-bit operations and 32-bit `BL`, through the common debugger and typed history.
It shares ARM arithmetic and condition-code helpers. MSP, PSP, CONTROL's SPSEL,
PRIMASK and NZCV are represented; code starts at `0x00400000`, data at
`0x00420000`, with the existing selectable ARM RAM sizes and history limits.
The assembler accepts a GNU unified Thumb subset and literal pools; macros,
numeric local labels and linker relaxation are absent.

This profile runs privileged Thread mode with a flat memory map. Hardware
exception entry/return, NVIC, SysTick, peripherals, full board boot and cycle
timing are absent. `BKPT` halts. Its teaching SVC ABI uses the immediate as the
service: 0 halts, 1 prints R0 as a signed integer, 4 prints a NUL-terminated
string at R0, 5 reads an integer into R0, and 11 prints a character. Other
services and unsupported instructions fault. See [the Cortex-M0 notes](src/architectures/armv8/m0/README.md).

### ARM (26-bit, ARMv2a)
The 26-bit ARM of the Acorn Archimedes: ARM2 and ARM3 are variants under ARM.
Migrating an old ARM26 workspace retains its selected model (ARM3 by default);
the combined ARM family's default remains AArch64. R15
holds the PC in bits 2-25 and N Z C V I F and the mode in the rest; USR, FIQ,
IRQ and SVC bank R13-R14 (FIQ R8-R14), and the Registers panel shows the
current view, the status flags, R15 whole, and every banked register on its own
tab. PC reads 8 ahead (12 with a register-specified shift and when stored);
`MOVS PC, LR`, the P forms (`TEQP`) and `LDM ... ^` also write the status bits,
all of them in a privileged mode and only NZCV in USR. Data processing with the
barrel shifter (RRX included), `MUL`/`MLA`, `LDR`/`STR` (byte, word, `T`, pre-
and post-index, scaled register offsets, unaligned loads rotated), `LDM`/`STM`
in all four modes with `!` and `^`, `B`/`BL` and `SWI`; ARM3 also supplies `SWP`
and CP15 `MRC`/`MCR`. No Thumb, `MRS`/`MSR`, halfword loads or external coprocessors.

The machine:
- RAM from 0 (512 KB to 16 MB, a setting); programs start at `0x8000` in USR mode, with R13_usr at the top of RAM and R13_svc, R13_irq and R13_fiq at `0x8000`, `0x7000` and `0x6000`. A program with bytes at address 0 owns the vectors and starts at reset in SVC with I and F set
- Exceptions take the vectors at `0x00`-`0x1C` (reset, undefined, SWI, prefetch abort, data abort, address exception for data above 26 bits, IRQ, FIQ) when the vector word is not zero; through an empty vector the run stops with the reason instead
- With the SWI vector empty, SWIs are RISC OS's console calls: `OS_WriteC` (&00), `OS_WriteS` (&01), `OS_Write0` (&02), `OS_NewLine` (&03), `OS_ReadC` (&04, waits for typed input; a line ends with 10) and `OS_Exit` (&11), the `X` forms alike; `swi OS_Exit` and `swi "OS_Exit"` both assemble
- The Keyboard and Display tool's registers sit above RAM: `KBD_STATUS` at `0x03FF0000` (bit 0 a key waits, bit 1 enables an IRQ while one does), `KBD_DATA` at `0x03FF0004`, `TTY_STATUS` at `0x03FF0008` and `TTY_DATA` at `0x03FF000C`, all predefined symbols; the tool's own help text names MARS's addresses. The Bitmap Display reads words anywhere in RAM
- ARM3 adds privileged CP15 cache controls and a functional 4 KB unified cache, with cacheable/updateable/disruptive regions, write-through updates and flushing. ARM2 rejects SWP and CP15. The common Registers window shows clock ticks and an ARM3 CP15 bank
- The shared pipeline displays actual fetch/decode/execute schedules, including multi-cycle loads/stores, block transfers, register shifts, operand-dependent multiplication and CP15 transfers. Configurable memory latency and sequential transfer costs distinguish S/N/I cycles; ARM3 adds cache-hit/miss timing, overlapping line fills and the datasheet's worst-case clock synchronization
- A two-word instruction queue performs speculative PC+8 fetches, preserves stale instructions after stores, and defers prefetch aborts until execution. PC redirects discard queued words and refill; CP15 flushing leaves the queue intact. Typed history preserves queue, cache, clock and timing state through rewind, at increased memory cost per entry. The Instruction Prefetch example demonstrates self-modifying code. MEMC, DRAM refresh and electrical clock phase remain outside the model; see [the ARM26 notes](src/architectures/armv8/arm26/README.md)
- `BL` and returns to its link keep the call stack; every effect, banked registers and status bits included, steps back exactly

Two assembler dialects, chosen by file: `.s`/`.S` are GNU as, `.armasm` is armasm, and any other file (`.asm`, new files) by its content when an indented `AREA` or a GNU directive says which, else by the dialect setting:
- GNU as: `@` and `//` comments, `;` between statements, `name:` and `1:` labels (`1b`/`1f`), `.text`, `.data`, `.bss`, `.section`, `.word`, `.hword`, `.byte`, `.ascii`, `.asciz`, `.align` (a power of two), `.balign`, `.space`, `.equ`/`.set`/`=`, `.org` (an absolute address), `.ltorg`, `.include`, `.macro`/`.endm` with `\param`, defaults and `\@`, `.end`; the program starts at `_start`
- armasm: `;` comments, labels in column 1 without a colon, `AREA` (CODE or DATA), `DCD`, `DCW`, `DCB`, `SPACE`, `FILL`, `EQU`, `ALIGN`, `LTORG`, `ENTRY`, `END`, `&FF` and `2_101` numbers and `:AND:`-style operators; `EXPORT`, `IMPORT` and the like are accepted and ignored
- Both: divided (`addeqs`, `ldmeqfd`) and unified (`addseq`) suffix orders, `#` optional, APCS register names, `ldr rd, =value` as a `mov`/`mvn` or a literal pool word, `adr`, `push`/`pop`, `nop`, `lsl`/`lsr`/`asr`/`ror`/`rrx` and `neg`; an immediate no rotation fits is retried on the complementary instruction (`mov`/`mvn`, `add`/`sub`, `cmp`/`cmn`, `and`/`bic`, `adc`/`sbc`). `.data` is placed after the code
- Not supported: conditionals, `.rept`, armasm macros and `GET`/`INCLUDE`
- Sources use the `arm` editor language for both dialects, so `;` shows as a comment in GNU sources too, with data tips for registers, labels, symbols and numbers; new files are `.asm`

### AVR

The initial AVR target is a classic 8-bit CPU teaching profile with 32 registers,
SREG, a 16-bit stack pointer, 64 KiB of flash and 64 KiB of data space. It supports
integer arithmetic and flags, branches and skips, calls and returns, stack
operations, direct and X/Y/Z indirect loads and stores, and program-memory reads.
`BREAK` stops execution. It is not a simulation of a particular ATmega device:
interrupt delivery, timers, UART, EEPROM and other MCU peripherals are absent.

Code labels, `.org` in `.text`/`.cseg`, and the debugger PC are **byte addresses**,
unlike the word addresses used by traditional Microchip AVR assemblers. Relative
branches and saved return addresses are encoded in hardware word units. Data
labels and pointers retain their hardware data addresses; the memory inspector
shows data at `0x10000 + address`, separately from flash at `0..0xFFFF`.
Data starts at hardware address `0x100`. Register, SREG and SP aliases in data
space refer to the live CPU state. Assembly uses `.include`, `.equ`/`.set`,
`.text`/`.cseg`, `.data`/`.dseg`, `.org`, `.byte`/`.db` and `.word`/`.dw`,
with `lo8`/`hi8` for address bytes. Unsupported instructions and directives are
reported explicitly. This is a source assembler, with no ELF or device-header loader.
Data symbols navigate to the mapped inspector address; generic navigation from a
raw register value such as SP cannot distinguish data pointers from flash pointers,
so use the SRAM section and add `0x10000` when navigating those values manually.

### RISC-V (RV32IM and RV32IMC)

The initial RISC-V target executes the 32-bit base integer ISA and all eight
multiply/divide instructions, including the specified division-by-zero and
signed-overflow results. Registers accept both `x0..x31` and ABI names; `x0`
stays zero. Memory is 1 MiB, little-endian, with text at `0x1000`, data at
`0x10000` and SP near the top. Instruction fetches and multi-byte data accesses
must be aligned. `EBREAK` halts; `FENCE` has no effect in this single-core model.
The ISA setting selects RV32IM (default, four-byte instruction alignment) or
RV32IMC (two-byte instruction alignment). The latter adds all 27 integer
compressed forms, explicitly written as `c.*`, mixed with regular 32-bit
instructions. Both use the same integer execution engine and history schema;
compressed calls save PC+2, and the debugger tracks each instruction's actual size.

Assembly uses a GNU-like source subset with includes, text/data sections,
integer and string data, alignment, constants, and common pseudos such as `li`,
`la`, `mv`, `j`, `call` and `ret`. `li` and `la` always occupy two instructions;
there is no linker relaxation. Programs enter at `_start`, then `main`, then
the text base. The environment is educational, not Linux: `ECALL` takes its
service number in `a7` and argument in `a0`: 1 prints an integer, 4 a
zero-terminated string, 5 reads an integer, 11 prints a character, and 10 or 93
exits. Other services fault. Atomic, floating-point, vector and
privileged instructions, CSRs, ELF loading and general relocations are absent.
Compression is explicit: ordinary instructions keep their original sizes, with
no automatic compression or relaxation. `.option rvc` enables explicit compressed
forms only under RV32IMC; `.option norvc` disables them until re-enabled. Reserved,
RV64-only and floating-point compressed encodings fault; standard HINTs are harmless.

### Motorola 68k (68000, 68010 and 68020)

The new `m68k` family selects an MC68000, MC68010 or MC68020 integer teaching
profile. It has D0-D7, A0-A7 (SP), PC and condition codes, with 1 MiB of big-endian
RAM, text at `0x1000`, data at `0x10000` and a descending stack near the RAM limit.
Supported operations include moves, integer arithmetic/logic, branches and calls,
DBcc/Scc, word multiply/divide, register shifts/rotates, bit operations, MOVEM and
the basic effective-address forms. The 68010 adds RTD, BKPT and MOVE from CCR;
the 68020 adds long branches, EXTB, long LINK and scaled brief indexing. Instruction
fetches remain even-aligned; the 68020 permits unaligned data accesses.

The assembler uses a Motorola-style source subset through the shared engine.
Unsupported model-specific instructions are rejected. Full indexed memory-indirect
extension words, long multiply/divide forms, FPU/MMU, hardware exception delivery,
OS boot and complete system emulation are absent. TRAP #15 supplies a teaching
console: task in D0, 3 prints signed D1, 6 prints D1's low-byte character,
14 prints a NUL-terminated string at A1, 5 reads an integer into D1, and 9 exits.
Other traps/tasks fault. Memory, register, console and call-frame effects rewind
through the shared typed history with the existing limits.

These targets use the shared register, memory, call-stack, history and
debugger windows, with typed history buffers and the common history limits.
They do not supply a cycle-accurate pipeline model or an X-Ray panel.

### Additional integer teaching CPUs

These additional backends use one configurable assembler frontend, runtime, debugger,
typed column history store, editor integration and common tool adapter. Native
modules supply instruction encodings and semantics, registers, address translation,
reset state and documentation. They support the same standard example menu,
including recursive Ackermann, interactive input, bitmap and Mandelbrot programs.

| CPU | Memory model | Native scope and limitations |
| --- | --- | --- |
| [Motorola 6800](src/architectures/m6800/README.md) | 64 KiB, big endian | Selectable 6800, 6809 and 68HC11 native encodings/registers/addressing; excludes native hardware interrupt and peripheral delivery |
| [Intel 8051](src/architectures/i8051/README.md) | Separate 64 KiB code and XDATA, 128-byte IRAM and SFR window | Documented MCS-51 instructions, banked registers, bit addressing, MOVC/MOVX; excludes timers, serial and port devices |
| [PowerPC](src/architectures/powerpc/README.md) | 1 MiB, big endian | 32-bit integer arithmetic, memory, condition fields and branches; excludes floating point, vectors, privileged/MMU and atomic operations |
| [DEC Alpha](src/architectures/alpha/README.md) | 1 MiB, little endian | Exact 64-bit integer registers and memory, integer branches and BWX; excludes floating point, locked memory, privileged PALcode and MMU |
| [Intel x86](src/architectures/i8086/README.md) | 1 MiB with 20-bit segment translation and native segment-boundary rules | 8086/8088 and 80186/80188, optional 8087 extended-precision arithmetic; excludes PC devices and bus/prefetch timing |
| [WDC 65C816](src/architectures/mos6502/w65816/README.md) | 16 MiB with program/data banks | Native/emulation modes, live M/X widths, decimal operations and banked calls; excludes external hardware and cycle timing |
| [TMS9900](src/architectures/tms9900/README.md) | 64 KiB, big endian, RAM-backed workspaces | Integer instructions, native addressing and workspace context switches; excludes CRU devices/instructions, X execution and external interrupts |
| [SPARC V8](src/architectures/sparc/README.md) | 1 MiB, big endian, eight overlapping register windows | Integer arithmetic, Y multiply/divide, delayed/annulled branches, calls and SAVE/RESTORE; excludes floating point, privileged traps/MMU, automatic window spilling and transfers inside delay slots |
| [SuperH](src/architectures/sh/README.md) | 1 MiB, big endian, SH-1/SH-2 | Integer arithmetic, memory/special registers, native delay slots, stepwise divide and exact multiply/MAC; excludes SH-2A/SH-2E extensions, native exceptions/devices and cycle timing |
| [DEC VAX](src/architectures/vax/README.md) | 1 MiB, little endian, kernel mode, physical addressing | All general addressing modes, integer/field/string/control instructions, CALLS/CALLG/RET frames and DEC F/D/G/H floating point rounded as the VAX does; excludes decimal strings, EDITPC/CRC/MATCHC/MOVTC, POLY/EMOD, queues, memory management and exception vectors |
| [DEC PDP-11](src/architectures/pdp11/README.md) | 64 KiB, little endian, no MMU, I/O page at 160000 (octal) | All eight addressing modes, the 11/20 base set, 11/40 additions with EIS, optional KE11-F FIS or FP11 F/D floating point rounded as DEC does, traps through vectors, a console DL11, octal display; excludes the MMU, user/supervisor modes, interrupts and other devices |
| [IBM System/360](src/architectures/s360/README.md) | 1 MiB of the 24-bit space, big endian, EBCDIC | Standard instruction set with BC-mode PSW, USING base resolution, decimal (packed, ED/EDMK) and hexadecimal floating point; System/370 MVCL/CLCL/ICM/STCM/CLM/SRP and extended float; excludes privileged/I/O instructions, interruption handlers, storage protection and DAT |

These are functional instruction simulators. They do not model complete boards,
operating systems or cycle-accurate pipelines. Each supplies an explicitly
documented THRAX monitor through a native trap/call instruction for example I/O.
The shared statistics, profile, cache, branch history and memory-reference tools
consume native execution events. A hardware pipeline model and MIPS X-Ray are
unavailable on these families. Cache results are an educational tool simulation.
See the family notes for exact instruction and monitor restrictions and the
[performance measurements](docs/new-cpu-benchmarks.md) for history and observer costs.

### CPU family defaults

The architecture list states each family's default. CPU variant menus also mark
the declared default, independently of option order or a saved selection.
Fixed-profile families have no variant selector. These are simulator profiles;
support for an ISA does not imply a complete board or every optional extension.

| Family | Default profile | Other selectable variants |
| --- | --- | --- |
| MIPS | MIPS32 under MARS rules | — |
| MIT Beta | Beta under BSim rules | — |
| 6502 family | MOS 6502 NMOS | W65C02S CMOS, W65C816S |
| Zilog | Z80 | — |
| ARM | AArch64/A64 | AArch32/A32, Cortex-M0 Thumb, 26-bit ARM2, 26-bit ARM3 |
| AVR | AVR8 teaching core | — |
| RISC-V | RV32IM | RV32IMC |
| Motorola 68k | MC68000 | MC68010, MC68020 |
| Motorola 6800 family | 6800 | 6809, 68HC11 |
| Intel MCS-51 | 8051 | — |
| PowerPC | 32-bit integer PowerPC | — |
| DEC Alpha | Alpha integer core with BWX | — |
| Intel x86 | 8086, no numeric coprocessor | 8088, 80186, 80188; independent optional 8087 |
| TI | TMS9900 | — |
| SPARC | SPARC V8 integer core | — |
| SuperH | SH-2 | SH-1 |
| DEC VAX | VAX-11/780 | MicroVAX II with or without the 78132 FPU |
| DEC PDP-11 | PDP-11/40 | PDP-11/20; 11/40 with KE11-F FIS; 11/45 and 11/70 or LSI-11/23, each with or without FP11 |
| IBM System/360 | Model 50/65 (decimal and floating point) | Model 30 with optional decimal and floating-point features; System/370 |

65C816 now lives under `mos6502/w65816/`, and the ARM2/ARM3 backend under
`armv8/arm26/`. Old `w65816` and `arm26` saved targets migrate into the
corresponding family choice. Existing family selections and layouts are retained.
Native backends load when selected, and release their previous run on a switch;
history schemas and byte budgets remain native and unchanged by the grouping.
ARM26 timing/dialect controls and the 6502 decimal-mode option appear only where
they apply. New source filenames follow the selected backend's extension.

Every variant supplies a complete effective example catalog. Compatible variants
reuse the same text asset and override individual topics explicitly: for example,
68HC11 reuses 6800 sources but overrides Factorial with MUL and Hello with
Y-indexed loads. Incompatible instruction sets have separate ports. There is no
automatic fallback based on the order of variants. Common tests execute the
effective catalog on every selectable CPU.

Loading an example reuses an empty, unedited editor or opens a new tab, with a
topic-based filename and no unsaved marker until the text is edited. It links
that document to its catalog topic. CPU, variant and
FPU changes load the matching port only while its text exactly matches the
loaded source. Edited documents stay untouched, including after Save clears
their unsaved marker; Undo back to the original text restores following.
Untouched inactive or hidden example tabs follow too, without changing the
active tab or filename. Missing ports leave the current source in place.
Destination bitmap settings and required windows are applied through the same
shared load controller. Native workspace saves retain links for unchanged
examples; ordinary imported files are never identified by matching text alone.

The x86 CPU selector and math-coprocessor selector are independent. Enabling the
8087 exposes its register bank and a floating-point example, without replacing
integer or fixed-point ports. Requirements appear in the shared example menu.
80186/80188 reuse the 8086 catalog with a native immediate-IMUL Factorial port.
The generic mixed-width register adapter presents exact 80-bit values over
explicit u32 history columns. With no coprocessor selected, x86 retains its
14-word register schema; the 8087 configuration stores 46 words. The one-million
entry history target and 256 MiB typed-buffer budget still apply. See the
[x86 scope and numerical limits](src/architectures/i8086/README.md).

### Files, Folders and Links
The workspace autosaves to the browser as you type, so a reload picks up where you
left off; **Save in this browser** keeps a second copy on purpose. Files come in from
the **Open** button, the File menu, or by dropping them anywhere on the page, a `.zip`
of them included; **Save** downloads the current file and **Download .zip** the whole
workspace. In Chromium browsers **Open folder…** makes a folder on disk the project,
the way a directory is MARS's: its `.asm` and `.s` files are the project, **Save**
writes each back in place, and the folder is offered again after a reload.

A workspace travels as a link too. **Copy share link** puts every file, compressed,
into the page's own URL, so nothing is stored anywhere. **Open from URL…** (or
`?load=<url>` on the address bar) opens a GitHub file, folder or gist, a `.zip`, or a
plain source file from anywhere that lets a browser fetch it. **GitHub…** signs in
with a personal access token that has the gist scope (GitHub's own sign-in cannot
finish in a page served from GitHub Pages, so the token is pasted once, checked, and
kept only in this browser), lists your gists to open, and publishes the workspace as a
secret gist or updates the one it came from. While signed in, the Files panel gains a
gist button group: start a blank workspace bound to a new gist, save to the current
gist, save as a new gist, and delete the current gist after confirming.

## 📦 Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Code Editor**: Monaco Editor
- **State Management**: Zustand
- **Styling**: CSS3
- **Build Tool**: Vite

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 22.12+ (22.x), 24.x or 26+ for the pinned Vite and Vitest versions
- npm or yarn

### Quick Start

```bash
# Clone the repository
git clone https://github.com/Spongman/THRAX.git
cd THRAX

# Install dependencies
npm install

# Start development server
npm run dev

# Open browser to http://localhost:3000
```

### Scripts

```bash
npm run dev          # development server on port 3000
npm test             # the Vitest suite, once (npm run test:watch keeps it running)
npm run typecheck    # type-check without emitting
npm run lint         # ESLint over src
npm run build        # type-check, then the production bundle in dist/
npm run preview      # serve the production bundle
npm run xray:svg     # regenerate the X-Ray drawings in docs/xray/
npm run deploy       # build and publish dist/ to GitHub Pages
```

## 📝 Example Programs

### Sum of Numbers
```mips
# Compute 5 + 3
addi $t0, $zero, 5
addi $t1, $zero, 3
add $t2, $t0, $t1
move $a0, $t2
addi $v0, $zero, 1
syscall
addi $v0, $zero, 10
syscall
```

### Loop Counter
```mips
# Print 1 through 5
addi $t0, $zero, 1

loop:
  addi $t1, $zero, 6
  beq $t0, $t1, done
  
  move $a0, $t0
  addi $v0, $zero, 1
  syscall
  
  addi $t0, $t0, 1
  j loop

done:
  addi $v0, $zero, 10
  syscall
```

## 🏗️ Architecture

```
src/
├── architectures/
│   ├── contracts.ts       # The neutral contract shared code uses
│   ├── registry.ts        # Loads and activates architectures; the only place that names them
│   ├── mips/              # MARS assembler and simulator (core/), history, editor, examples, MIPS-only tools
│   ├── beta/              # Beta CPU, BSim machine, UASM dialect and beta.uasm, editor, examples
│   ├── mos6502/           # NMOS 6502 / W65C02S plus w65816/, dialects, editor and examples
│   ├── z80/               # Z80 CPU, device page machine, Zilog-syntax dialect, editor, examples
│   ├── armv8/             # ARM profiles: a64/, a32/, m0/ and 26-bit arm26/
│   ├── armv8/arm26/       # 26-bit ARMv2a
│   ├── avr/               # Classic AVR integer teaching profile
│   ├── riscv/             # Shared RV32IM / RV32IMC assembler and CPU
│   ├── m68k/              # Shared 68000 / 68010 / 68020 integer teaching profiles
│   ├── m6800/, i8051/     # Native encodings, execution, documentation and examples
│   ├── powerpc/, alpha/   # 32-bit PowerPC and exact 64-bit Alpha integer cores
│   ├── sparc/             # SPARC V8 integer core with register windows and delay slots
│   ├── sh/               # SuperH SH-1/SH-2 with native delay slots and MAC state
│   ├── vax/              # DEC VAX: VAX MACRO, CALLS frames and F/D/G/H floating point
│   ├── pdp11/            # DEC PDP-11: MACRO-11 syntax, octal radix, EIS, FIS and FP11
│   ├── s360/             # IBM System/360/370: HLASM-style USING assembler, EBCDIC, decimal and HFP
│   └── i8086/, tms9900/   # Segmented memory and RAM workspace-based cores
├── core/                  # Shared assembler engine (assembly/), diagnostics, source index, history, settings
├── debug/                 # Debug session: breakpoints and stepping
├── tools/                 # Statistics, profile, cache, branch history, pipeline, memory reference
├── components/            # Workspace panels, dock layout, toolbar, dialogs
├── services/              # Files, archives, share links, GitHub
├── store/                 # Zustand workspace state
├── hooks/                 # Reusable React behavior
├── App.tsx                # Main application
└── main.tsx               # Startup: activates the saved architecture, then renders
```

### Adding an architecture

An architecture is one directory and one registry entry. Create
`src/architectures/<id>/` with a `manifest.ts` (id, name, contributed panel ids)
and an `index.ts` whose default export is an `ArchitectureDefinition` from
`contracts.ts`; then add its loader and manifest to `src/architectures/registry.ts`.
Shared code never imports an architecture directly. See
[docs/FEATURE_ARCHITECTURE.md](docs/FEATURE_ARCHITECTURE.md).

For functional CPUs, `src/core/configuredCpu.ts` exposes a configurable adapter.
It shares assembly layout, native decode caching, execution scheduling, input,
debugger edits, call frames, history replay, memory inspection, tool observers,
source navigation and editor providers. The architecture declares its own typed
history schema, register/memory mappings and native hooks; shared code does not
switch on CPU ids. Segment translation and wrapped word access are common helpers,
while native code chooses segments, banks, workspace pointers and instruction modes.

Programs live as plain `.asm` or `.uasm` files in each architecture's `examples/`
directory (or its backend directory). `examples.ts` holds menu metadata and `?raw`
imports. The source tree includes 252 standalone example programs and snippets;
there are no assembly template strings in the example modules. Constants remain
hardcoded in each program, including the common Mandelbrot iteration count/palette.

Targets with lazy backends expose `services.prepare(settings)` and
`services.isPrepared(settings)`. Await preparation before synchronous assembly,
profile reads or machine creation. Activation prepares the saved variant before
publishing it; variant changes prepare before committing their settings. ARM's
A64, A32 and Cortex-M0 backends load separately through its local variant catalog.
Failed or superseded loads keep the previous target and settings.

The shared service factory rejects assembly errors before constructing a machine.
Inspection uses the loaded program's decoder and symbol values; background
diagnostics cannot replace that context. Before the first load, inspection may use
the latest successful assembly. Local instruction catalogs connect completion
names, hover documentation and model availability; encoding tables and macro
libraries remain authoritative where they already supply those names.

Example declarations are data (`name`, `description`, `code`). Use the shared topic
IDs in `src/core/exampleCatalog.ts` for equivalent programs. `ExamplesMenu` owns
the SVG icons, canonical names, order and row layout for every architecture;
architecture modules supply their source programs and feature-specific extras.

## 🔄 Execution Pipeline

1. **Assembly**: the shared engine in `src/core/assembly` handles tokens, expressions, macros, symbols, layout and byte emission; each architecture configures it with its dialect (MARS for MIPS, UASM for Beta) and its encodings
2. **Activation**: the selected architecture's chunk loads, and its services supply the assembler, machine, profile, disassembly and editor support
3. **Simulation**: one shared execution controller schedules every CPU, handles debugger completion and bounds batches by machine steps and host time. History uses a shared cursor and architecture-declared typed-array columns; byte shifting and typed call-stack storage are shared while CPU state capture, memory maps and call/return detection remain local
4. **Inspection**: panels read registers, memory, history and the call stack through the contract, without side effects on the machine

Debugger edit transactions, history row adapters and effect presentation share common
helpers without changing the typed column store. Console transports and the A32/A64
Linux console environment are reusable; syscall ABIs, IRQ rules and hardware timing
remain in the CPU modules. Assembler frontends share quote-aware text scanning,
integer arithmetic and bounded include traversal while retaining their dialects.
Pipeline dependencies can name multiple destinations, flags and overlapping register
resources, including separate memory results and base writeback.

The Pipeline panel names its model and timing assumptions. MIPS and Beta use
teaching pipeline estimates; A32/A64 share an explicitly hypothetical five-stage
model. ARM2/ARM3 show their recorded execution-clock schedules. Other CPU models
currently report that pipeline timing is unavailable. Decode-stage branch/jump
operands, MIPS delay slots, A32 predicate outcomes and measured ARM refill ticks
are preserved through history replay. See [pipeline models and limits](docs/pipeline-models.md).

Shared views and tools preserve exact nonnegative addresses up to
`Number.MAX_SAFE_INTEGER`, rather than wrapping them to 32 bits. Wider register
values use `bigint`; values beyond that address range are displayed without offering
memory navigation. Each CPU still enforces its own bounded memory map.

## 📚 Roadmap

### Done ✅

**The machine**
- [x] Core MIPS assembler and simulator, with error reporting on the line that earned it
- [x] All basic instruction types (R, I, J): arithmetic, logical, shifts, comparison, load/store, branch and jump
- [x] Multiply/divide with HI/LO registers
- [x] Floating-point instructions (coprocessor 1) and the coprocessor 0 registers
- [x] Every MARS syscall except the MIDI pair, interactive input included (5, 8, 12)
- [x] Assembly directives and initialized data segments
- [x] Macros, `.include`, `.eqv`, and label expressions
- [x] The three MARS memory configurations
- [x] Delayed branching
- [x] Device interrupts, taken in place of the next instruction

**The workspace**
- [x] Monaco editor with MIPS syntax highlighting, multiple source tabs, and find/replace
- [x] Multi-file programs: assembled together or one at a time, with per-file symbol tables and `.globl` naming what crosses a file
- [x] Register, memory, call stack, symbol and history panels, dockable and saved between sessions
- [x] Step-through debugging, breakpoints, stepping back, and rewinding to any point
- [x] Execution history: every instruction, what it changed, and time travel through it
- [x] Editing registers by hand, and memory as a hex editor with a caret, an ASCII column and INS/OVR, undoable like anything else
- [x] Cross-panel navigation: an address or register lights wherever else it appears
- [x] Settings dialog covering the MARS options
- [x] Autosave, files and `.zip` archives in and out, and a folder on disk as the project (Chromium)
- [x] Share links carrying the workspace, opening from GitHub, and signing in to browse and publish gists
- [x] Save/load programs to browser storage, and export machine code to HexText
- [x] Keyboard shortcuts, and example programs

**The tools**
- [x] Bitmap display (24-bit RGB words, configurable base address)
- [x] Keyboard/display MMIO (receiver/transmitter data registers)
- [x] Cache simulation (configurable blocks, associativity, and replacement)
- [x] Pipeline model: five-stage timeline, the five stages on a chosen cycle, a hazard report, RAW hazards with and without forwarding, branch and jump resolved in ID, EX or MEM, and static, 1-bit and 2-bit prediction
- [x] Instruction statistics and the branch history table
- [x] MIPS X-Ray: the animated datapath, control unit, ALU control, and register bank, drawn as themed SVG
- [x] Memory reference visualization, Mars Bot, Scavenger Hunt, and the Digital Lab Simulator
- [x] A tool watches a run only while a panel wants it, and rewinds with the history

### Open 🎯
- [ ] Trim the bundle: the initial load is 4.8 MB minified, 1.25 MB gzipped, most of it Monaco; each architecture (MIPS 175 KB, Beta 92 KB) loads only when selected
- [ ] Take the Digital Lab's memory-mapped region from the chosen memory configuration rather than fixing it at `0xffff0000`
- [ ] A tooltip on a gutter address, to match the "Show 0x… in memory" the expanded words below it offer
- [ ] One mechanism for "written in place, so a selector would never see a change", rather than a version counter beside a wrapper
- [ ] A committed browser harness: what the layout decides is checked by hand today and not repeated
- [ ] Assembly program templates
- [ ] Dark/light theme toggle
- [ ] Mobile responsive design

The working notes behind these, and the decisions taken not to do other things,
are in [PLAN.md](PLAN.md).

### Future Enhancements 🚀
- [ ] Collaborative editing
- [ ] GPU accelerated simulation
- [ ] VR visualization mode
- [ ] AI-powered assembly generation
- [ ] Formal verification of programs

## Feature Architecture

The staged architecture for bringing the full desktop capability set to the
web port is documented in [docs/FEATURE_ARCHITECTURE.md](docs/FEATURE_ARCHITECTURE.md).

## 🐛 Known Limitations

- Coprocessor 1 covers single and double precision arithmetic, conversion, comparison, and moves; the FCSR is modelled as the eight condition flags only, so rounding mode selection and exception enables are not configurable
- Coprocessor 0 provides the vaddr/status/cause/epc registers, `mfc0`, `mtc0`, and `eret`. A `.ktext` handler at the selected configuration's exception address receives traps; without one, a trap records its cause and EPC and stops execution
- A label expression takes one label plus a constant (`arr+4`); differences of two labels are rejected
- A text segment can be based only before it emits instructions, since pseudo-instructions expand after parsing
- Every MARS syscall is implemented except the MIDI pair, 31 and 33, which keep their timing and play nothing; an unknown syscall number stops safely with an error
- A run has no instruction limit; execution yields between bounded batches, including code without source mappings. Pause allows Continue; Stop ends the run until a rewind, PC edit or fresh assembly. Step Over checks return address and frame depth so recursive calls finish correctly
- Sparse virtual memory covers the segments of the selected memory configuration. An address outside all of them faults, as does a load from or store into `.text` unless self-modifying code is enabled
- The history keeps the last 1,000,000 instructions by default; this is also the maximum configurable limit. Every architecture uses the same limit and shared typed-buffer storage; memory use and recording cost depend on its history schema and the effects of each instruction. Stepping back past what it holds is not possible, and neither is replaying what came before it
- The History info icon opens a tooltip with retained entries, live/allocated typed-buffer bytes and eviction counts for every CPU. The default typed-buffer budget is 256 MiB; payload heap is additional, so the entry limit is a retention target subject to that budget. Runtime/rewind measurements and reproducible benchmark commands are in [the existing CPU report](docs/runtime-benchmarks.md) and [the seven new CPU report](docs/new-cpu-benchmarks.md).
- Moving through history preserves later entries on every CPU. Stepping forward replays recorded effects, including console input and manual edits. Changing registers, memory or the PC while rewound discards the previous future and starts a new path
- Beta memory is one flat region of 64 KB to 16 MB, 1 MB by default. A program and its data must fit in it; an access past the end stops the run
- Settings are stored per architecture (under `thrax-web.settings.architecture.<id>`); settings saved before there was more than one architecture are read as MIPS settings
- Only one architecture is active at a time. Switching stops the run and discards registers, memory, history and address breakpoints; source files, line breakpoints and the layout are kept
- File operations that invalidate execution, explicit assembly failures and resets stop and dispose the old machine through shared session teardown. Late callbacks and asynchronous completions cannot overwrite a replacement session.
- Programs assembled for a configurable CPU variant must be reassembled before loading under another variant, including NMOS 6502 versus W65C02. A rejected load leaves the current machine intact.
- The toolbar distinguishes guest completion (Halted), debugger Stop (Stopped) and unhandled native faults (Fault, with details on hover). Breakpoints, pauses and console-input waits remain resumable; handled guest exceptions retain their native behavior.
- Step Back remains available after Halt, Stop or Fault when retained history can be rewound. Toolbar and keyboard controls share availability rules; rapid Pause/Continue commands cannot let an earlier run overwrite the current control state. Execution-fault diagnostics preserve preceding program output.

## Instruction references

Instruction hovers prefer checked HTML entries, including named instruction pages and
shared manual sections. PDP-11 core links open individual scanned handbook pages.
Where an HTML reference does not cover an operation, its existing PDF page remains
the destination. The [reference audit](docs/instruction-references.md) lists sources,
coverage gaps and remaining PDF dependencies. Reference lookup runs only while
building documentation; execution and history storage are unaffected.

## 📖 MIPS Reference

For detailed MIPS instruction set reference, see the original MARS documentation:
- [MARS Official Documentation](https://github.com/dpetersanderson/MARS)
- [MIPS ISA Reference](https://en.wikipedia.org/wiki/MIPS_architecture)

## 🤝 Contributing

Contributions are welcome! Please feel free to:
- Report bugs
- Suggest features
- Submit pull requests
- Improve documentation

## 📄 License

MIT License - Same as the original MARS simulator

Original MARS developed by Pete Sanderson and Ken Vollmar.
Web port developed by Spongman.

The X-Ray wire graph in `src/architectures/mips/tools/xray/datapaths.ts` is generated from MARS
4.5's datapath XML by `scripts/generate-xray-datapaths.py`.  The drawings
themselves are redrawn as themed SVG rather than copied.

The TinyOS Beta example, `src/architectures/beta/tinyos.uasm`, is the lab kernel from
MIT 6.004 Computation Structures (https://github.com/computation-structures/course),
used under the Creative Commons Attribution 4.0 International License; THRAX adds a
header. It ships twice: as handed out, with `MapUserAddress` (Design Problem 1) left
to the student, and as "TinyOS (solved)" with it filled in so the processes run.

## 🙏 Acknowledgments

- **Original MARS**: Pete Sanderson and Ken Vollmar
- **Monaco Editor**: Microsoft
- **React**: Meta
- **Zustand**: Poimandres

## 📞 Support

For issues, questions, or suggestions:
1. Check existing [GitHub Issues](https://github.com/Spongman/THRAX/issues)
2. Create a new issue with detailed description
3. Include example code if reporting a bug

## 🎓 Educational Use

This simulator is designed for educational purposes. It's perfect for:
- Learning MIPS assembly language
- Understanding computer architecture
- Studying processor execution models
- Debugging assembly programs
- Teaching low-level programming concepts

---

**Try it now**: [THRAX](https://github.com/Spongman/THRAX)
