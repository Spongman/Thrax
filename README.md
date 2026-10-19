# THRAX - Teaching Harness for Runtime Assembly eXecution

A son of MARS (but in a different language). A modern, interactive web-based port of the classic MARS MIPS simulator, built with React, Monaco Editor, and execution engines implemented in TypeScript. Alongside MIPS it runs the MIT Beta under BSim rules, assembled from UASM, in the same workspace.

![THRAX](https://img.shields.io/badge/THRAX-Web%20Edition-blue)
![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6)
![React](https://img.shields.io/badge/Framework-React%2019-61dafb)
![License](https://img.shields.io/badge/License-MIT-green)

![The THRAX workspace, running a Mandelbrot program: source, execution history, instruction statistics, memory and a bitmap display](docs/screenshot.png)

## 🚀 Features

### Core Functionality
- ✅ **Four Architectures**: MIPS (MARS), the MIT Beta (BSim), the MOS 6502 and the Zilog Z80, chosen in Settings; each loads only when selected, and the files, line breakpoints and layout carry across
- ✅ **Complete MIPS Assembler**: Lexer → Parser → Machine Code Generator, with errors reported on the line that earned them
- ✅ **Full MIPS Simulator**: The whole MARS instruction table, coprocessors 0 and 1, delayed branching, and device interrupts
- ✅ **Monaco Editor**: Syntax highlighting, completion offering every instruction with its docs, and a hover saying what each instruction does
- ✅ **Source Workspace**: Multiple source tabs, find/replace, multi-file programs, and a Files panel
- ✅ **Interactive Debugging**: Run, pause, stop, step into/over/out, step back, and source breakpoints
- ✅ **Execution History**: Every instruction and what it changed, with time travel to any point in it
- ✅ **Register Viewer**: All 32 registers plus Coproc 1 and Coproc 0 tabs, editable while stopped
- ✅ **Memory Inspector**: A hex editor with a caret, an ASCII column, and INS/OVR, undoable like an instruction
- ✅ **Call Stack and Symbol Views**: Active `jal` / `jalr` calls, and per-file symbol tables
- ✅ **Cross-Panel Navigation**: A hovered address or register lights wherever else it appears
- ✅ **Heat Map and Gutter Columns**: Execution counts, addresses, and code bytes beside the source
- ✅ **Console I/O**: Output plus in-console input for the interactive syscalls
- ✅ **Dockable Layout**: Panels dock and tab, and the layout is saved between sessions
- ✅ **Files, Folders and Links**: Autosave, files and `.zip` archives in and out, a folder on disk as the project, share links, GitHub and gists
- ✅ **Portable Export**: Download assembled text in HexText format
- ✅ **MARS Tools**: Bitmap display, keyboard/display MMIO, cache simulator, pipeline model, instruction statistics, branch history, MIPS X-Ray, memory reference visualization, Mars Bot, Scavenger Hunt, and the Digital Lab Simulator
- ✅ **Settings**: Shared display and history preferences, plus each architecture's own options, kept per architecture: the MARS options with the three memory configurations for MIPS, and memory size and the console default for Beta
- ✅ **Example Programs**: 13 ready-to-run MIPS programs, 12 Beta programs, among them the 6.004 TinyOS lab kernel, 13 6502 programs, 12 Z80 programs and 13 AArch64 programs
- ✅ **Dark Theme UI**: VS Code-inspired interface

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

### MOS 6502
An NMOS 6502 on a bare board: the 151 documented opcodes in all 13 addressing
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
- Not modelled: undocumented opcodes, which stop the run as illegal instructions; dummy reads and the double write of read-modify-write instructions; the I/O page only answers data accesses, not instruction fetches

Assembly follows ca65 where it overlaps:
- `label:`, `@local:` labels scoped to the label before them, `;` comments, `name = expr`, `name .equ expr`, `.set name, expr`, `* = expr` and `.org`
- Numbers in decimal, `$` hex, `%` binary and `0x` hex; `'A'` characters; strings with C escapes; `*` is the location counter where an operand starts. Operators with ca65's precedence: unary `- ~ + < >` (low and high byte), then `* / & ^ << >>`, then `+ - |`
- Operands: `#imm`, `zp`, `zp,X`, `abs,Y`, `(ind)`, `(zp,X)`, `(zp),Y`, branch targets, and `A`, which `ASL`, `LSR`, `ROL` and `ROR` also take with no operand. An operand layout already knows to be below `$100` takes the zero-page form; a forward reference takes the absolute one. `z:` and `a:` force either
- Directives: `.byte`/`.db`/`.byt`, `.word`/`.dw`/`.addr`, `.res`/`.ds` with an optional fill, `.ascii`, `.asciiz`, `.align`, `.include`, `.macro name params` ... `.endmacro`/`.endm`, and `.breakpoint`. Macro arguments are values, and labels inside a macro are local to each expansion
- Not supported: `.if` and other conditionals, `.segment`, `.proc`/`.scope`, unnamed labels, and comparison and logical operators
- Sources use the `ca65` editor language with data tips for registers, symbols, addresses and mnemonics; new files are `.a65`

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
- Not modelled: MEMPTR, the `LD A,I` interrupt quirk, IM 0 bus bytes other than RST, and contention or wait states

Assembly is the common subset of zasm and sjasmplus:
- `label:` anywhere, or a name in the first column without a colon; `.local` labels hang off the label before them; `;` comments
- Numbers: decimal, `$FF`, `#FF`, `0xFF`, `0FFh`, `%1010`, `0b1010`, `1010b`, `17o`; `'A'` characters; `$` is the current address. C operators with C precedence, comparisons and logic giving 1 or 0, and `LOW()` and `HIGH()`
- Directives: `ORG`, `EQU`, `=`/`DEFL`, `DB`/`DEFB`/`DM`/`DEFM`/`BYTE` (strings too), `DW`/`DEFW`/`WORD`, `DS`/`DEFS`/`BLOCK` with an optional fill, `ALIGN`, `INCLUDE "file"`, `END`, and macros written `name MACRO params` or `MACRO name params` ... `ENDM`. Directives may take a leading dot
- Macros expand as text, so a parameter can stand for a register; `.labels` inside a macro are local to each expansion, and the code maps to the line that invoked it
- Instruction sizes follow from the operands' shapes, so layout never waits for a value; `JR` and `DJNZ` out of range, displacements past -128..127 and invalid operand combinations are reported on their line
- Not supported: conditionals (`IF`), `PHASE`, `STRUCT`, unnamed and temporary labels, and `<`/`>` as low and high byte
- Sources use the `z80` editor language with data tips for registers, pairs and what they point at, symbols and numbers; new files are `.z80`

### ARMv8-A (AArch64)
AArch64 user programs at EL0, as Linux runs them, with no MMU: X0-X30, SP and
the PC as exact 64-bit values (the Registers panel shows them in full, with a
W tab for the 32-bit views), and NZCV. The integer A64 instruction set: add and
subtract with immediates, shifted and extended registers, carry, logical
(bitmask) immediates, move wide, bitfields and extract, multiply, multiply-long
and divide, conditional select and compare, every branch, and loads and stores
of every width with sign extension, pre- and post-index, register offsets,
pairs, unscaled offsets and literals. `svc`, `hlt`, `brk` and `nop` complete it.
Floating point and SIMD are not supported. An execution-state setting selects
AArch64; AArch32 is to follow.

The machine:
- Memory from `0x00400000`: code there, `.data` at `0x00420000`, the program break after the data, and SP starting at the top. The size is a setting (1, 4 or 16 MB); anything outside it faults. Unaligned data accesses are allowed and SP alignment is not checked
- System calls by `svc #0` with the number in X8 and the result in X0: `read` (63) from fd 0, waiting for typed input; `write` (64) to fd 1 and 2; `exit` (93) and `exit_group` (94); `brk` (214). Other numbers stop the program with an error
- MARS's keyboard and display registers answer 32-bit accesses at `0xFFFF0000` for the Keyboard and Display tool; the Bitmap Display reads words from `.data`
- `bl`/`blr` and `ret` keep the call stack; every effect, 64-bit values included, steps back exactly

Assembly is GNU as for AArch64 (`.s`/`.S`):
- `//` and `/* */` comments, `;` between statements, `name:` and numeric `1:` labels referred to as `1b`/`1f`; the program starts at `_start`, else `main`
- Registers `x0`-`x30`, `w0`-`w30`, `sp`, `wsp`, `xzr`, `wzr`, `lr`, `fp`; `#` before immediates is optional; `:lo12:` with `adrp`; `ldr x0, =value` becomes a `mov` where one encodes the value, else loads from a literal pool placed at `.ltorg`/`.pool` or the end of the section
- The preferred aliases: `mov`, `mvn`, `neg`, `cmp`, `cmn`, `tst`, `lsl`/`lsr`/`asr`/`ror`, `ubfx`/`sbfx`/`ubfiz`/`sbfiz`/`bfi`/`bfxil`/`bfc`, `sxtb`/`uxth`..., `cset`/`csetm`/`cinc`/`cinv`/`cneg`, `mul`/`mneg`/`smull`/`umull`; `b.eq` or `beq`. The disassembly prints them too
- Directives: `.text`, `.data`, `.bss`, `.rodata`, `.section`, `.byte`, `.hword`, `.word`, `.quad` (and their GNU synonyms), `.ascii`, `.asciz`, `.string`, `.align`/`.p2align`, `.balign`, `.space`/`.skip`/`.zero`, `.fill`, `.equ`/`.set`/`=`, `.global`, `.include`, `.macro`/`.endm` with `\param`, defaults and `\@`, `.rept`/`.endr`, `.inst`, `.end`; object-file directives such as `.type` and `.cfi_*` are accepted and ignored
- Literals are exact to 64 bits; arithmetic on symbols is exact within 2^53
- Not supported: conditionals (`.if`), `.irp`, sections other than text and data, and relocations other than `:lo12:`
- Sources use the `aarch64` editor language with data tips for X and W registers, effective addresses, symbols and numbers; new files are `.s`

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

- **Frontend**: React 18 + TypeScript + Vite
- **Code Editor**: Monaco Editor
- **State Management**: Zustand
- **Styling**: CSS3
- **Build Tool**: Vite

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 16+
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
│   ├── mos6502/           # 6502 CPU, I/O page machine, ca65-style dialect, editor, examples
│   ├── z80/               # Z80 CPU, device page machine, Zilog-syntax dialect, editor, examples
│   └── armv8/             # ARMv8-A: execution states; a64/ holds the A64 assembler, CPU and Linux machine
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

## 🔄 Execution Pipeline

1. **Assembly**: the shared engine in `src/core/assembly` handles tokens, expressions, macros, symbols, layout and byte emission; each architecture configures it with its dialect (MARS for MIPS, UASM for Beta) and its encodings
2. **Activation**: the selected architecture's chunk loads, and its services supply the assembler, machine, profile, disassembly and editor support
3. **Simulation**: the machine runs in batches, yielding between them, with history recorded in typed-array columns the architecture's schema describes
4. **Inspection**: panels read registers, memory, history and the call stack through the contract, without side effects on the machine

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
- A run has no instruction limit; execution yields between batches so runaway code does not block the page, and Pause stops it
- Sparse virtual memory covers the segments of the selected memory configuration. An address outside all of them faults, as does a load from or store into `.text` unless self-modifying code is enabled
- The history keeps the last 100,000 instructions by default, at about 150 bytes each and no cost to the speed of a run; it can be set as high as 1,000,000. The limit is shared by every architecture. Stepping back past what it holds is not possible, and neither is replaying what came before it
- Beta memory is one flat region of 64 KB to 16 MB, 1 MB by default. A program and its data must fit in it; an access past the end stops the run
- Settings are stored per architecture (under `thrax-web.settings.architecture.<id>`); settings saved before there was more than one architecture are read as MIPS settings
- Only one architecture is active at a time. Switching stops the run and discards registers, memory, history and address breakpoints; source files, line breakpoints and the layout are kept

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
