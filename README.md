# THRAX - Teaching Harness for Runtime Assembly eXecution

A son of MARS (but in a different language). A modern, interactive web-based port of the classic MARS MIPS simulator, built with React, Monaco Editor, and a complete MIPS execution engine implemented in TypeScript.

![THRAX](https://img.shields.io/badge/THRAX-Web%20Edition-blue)
![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6)
![React](https://img.shields.io/badge/Framework-React%2018-61dafb)
![License](https://img.shields.io/badge/License-MIT-green)

![The THRAX workspace, running a Mandelbrot program: source, execution history, instruction statistics, memory and a bitmap display](docs/screenshot.png)

## 🚀 Features

### Core Functionality
- ✅ **Complete MIPS Assembler**: Lexer → Parser → Machine Code Generator
- ✅ **Full MIPS Simulator**: Execute MIPS instructions with accurate register/memory state
- ✅ **Monaco Editor**: Professional syntax highlighting and code editing
- ✅ **Real-time Execution**: Assemble and run MIPS programs instantly
- ✅ **Register Viewer**: Monitor all 32 MIPS registers in real-time, with Coproc 1 and Coproc 0 tabs
- ✅ **Memory Inspector**: View memory contents during execution
- ✅ **Console I/O**: Output plus in-console input for supported syscalls
- ✅ **Data Segments**: Initialize memory with `.data`, labels, strings, and numeric values
- ✅ **Interactive Debugging**: Assemble, toggle source breakpoints, step, continue, and step back
- ✅ **Call Stack View**: Inspect active `jal` / `jalr` calls while stepping
- ✅ **Source Workspace**: Multiple source tabs and find/replace
- ✅ **Portable Export**: Download assembled text in HexText format
- ✅ **Bitmap Display**: Render word-addressed 24-bit RGB framebuffer memory
- ✅ **Keyboard/Display MMIO**: Queue keyboard input and inspect transmitter output at the standard MMIO device addresses
- ✅ **Example Programs**: 8 ready-to-run MIPS programs
- ✅ **Dark Theme UI**: VS Code-inspired interface

### Supported Instruction Types

**Arithmetic**: ADD, ADDI, ADDU, ADDIU, SUB, SUBU, MUL, MULT, MULTU, DIV, DIVU

**Logical**: AND, ANDI, OR, ORI, XOR, XORI, NOR

**Shifts**: SLL, SRL, SRA, SLLV, SRLV, SRAV

**Comparison**: SLT, SLTI, SLTU, SLTIU

**Load/Store**: LW, LH, LHU, LB, LBU, SW, SH, SB, LUI, LA

**Jump & Branch**: BEQ, BNE, BGEZ, BGTZ, BLEZ, BLTZ, BLT, BLE, BGT, BGE, J, JAL, JR, JALR

**Special**: MFHI, MFLO, MTHI, MTLO, NOP, MOVE, LI, SYSCALL

**Coprocessor 1 (floating point)**: LWC1, SWC1, LDC1, SDC1, MFC1, MTC1, ADD/SUB/MUL/DIV/ABS/NEG/SQRT/MOV (`.s` and `.d`), CVT.S.W, CVT.S.D, CVT.D.W, CVT.D.S, CVT.W.S, CVT.W.D, ROUND/TRUNC/CEIL/FLOOR.W (`.s` and `.d`), C.EQ/C.LT/C.LE (`.s` and `.d`), BC1T, BC1F, MOVT, MOVF. Comparisons and branches use condition flag 0; double-precision operands take the even register of an even/odd pair.

**Coprocessor 0 (system control)**: MFC0, MTC0, ERET. The register file exposes `$8` (vaddr), `$12` (status), `$13` (cause), and `$14` (epc), reachable by number or by the `$status`-style aliases.

**Assembler pseudos**: LA, B, BAL, BEQZ, BNEZ, BLT/BLE/BGT/BGE (and unsigned variants), NOT, NEG, NEGU, ABS, SEQ/SNE/SGT/SGE/SLE (and unsigned variants), REM, REMU, L.S, L.D, S.S, S.D, LI.S, LI.D. These are expanded to base MIPS instructions before addresses and branch offsets are assigned, so they work in debugging and HexText exports.

### Syscall Support
- `1`: Print integer
- `4`: Print string (null-terminated)
- `5`: Read integer
- `8`: Read string
- `9`: Allocate heap memory (`sbrk`)
- `10`: Exit program
- `11`: Print character
- `12`: Read character
- `17`: Exit with code
- `2`, `3`: Print float from `$f12` or double from `$f12`/`$f13`
- `6`, `7`: Read float or double into `$f0`
- `34`, `35`, `36`: Print integer as hexadecimal, binary, or unsigned decimal

### Memory-Mapped Keyboard and Display

The Keyboard and Display Simulator uses the standard MMIO addresses:
`0xffff0000` receiver control, `0xffff0004` receiver data, `0xffff0008`
transmitter control, and `0xffff000c` transmitter data. Receiver and
transmitter readiness use bit 0. Reading receiver data consumes one queued
character; writing transmitter data appends its low byte to the tool display.

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
"assemble all files in directory" does. Files share one symbol table, so labels
resolve across them; the active tab supplies the entry point, which is the `main`
label when the program defines one.

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

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
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
├── core/
│   ├── lexer.ts           # Tokenization
│   ├── parser.ts          # AST generation
│   ├── assembler.ts       # Machine code generation
│   ├── simulator.ts       # Execution engine
│   ├── mipsLanguage.ts    # Monaco syntax support
│   └── index.ts           # Exports
├── components/
│   ├── Toolbar.tsx        # Run/Reset/Examples
│   ├── RegisterView.tsx   # Register display
│   ├── MemoryView.tsx     # Memory inspector
│   ├── BitmapDisplay.tsx  # Memory-mapped RGB framebuffer tool
│   ├── KeyboardDisplayTool.tsx # THRAX keyboard/display MMIO tool
│   └── ConsoleOutput.tsx  # Program output
├── store/
│   └── thraxStore.ts       # Zustand state management
├── hooks/
│   └── useExamples.ts     # Example loader hook
├── App.tsx                # Main application
└── examples.ts            # Example programs
```

## 🔄 Execution Pipeline

1. **Lexical Analysis** (`Lexer`)
   - Tokenizes assembly source code
   - Recognizes instructions, registers, labels, immediates

2. **Parsing** (`Parser`)
   - Builds AST from tokens
   - Resolves labels and addresses
   - Validates syntax

3. **Assembly** (`Assembler`)
   - Encodes instructions to machine code
   - Handles R-type, I-type, J-type formats
   - Calculates branch offsets

4. **Simulation** (`MipsSimulator`)
   - Executes machine code instruction-by-instruction
   - Manages 32 registers + special registers (HI, LO, PC) and the CP0/CP1 register files
   - Simulates memory (4MB)
   - Handles syscalls

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
- [x] Editing registers and memory by hand, undoable like anything else
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
- [x] Pipeline model: five-stage timeline, RAW hazards with and without forwarding, branch and jump resolved in ID, EX or MEM, and static, 1-bit and 2-bit prediction
- [x] Instruction statistics and the branch history table
- [x] MIPS X-Ray: the animated datapath, control unit, ALU control, and register bank, drawn as themed SVG
- [x] Memory reference visualization, Mars Bot, Scavenger Hunt, and the Digital Lab Simulator
- [x] A tool watches a run only while a panel wants it, and rewinds with the history

### Open 🎯
- [ ] Trim the bundle: 4.8 MB minified, 1.26 MB gzipped, most of it Monaco
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
- A run pauses after 1,000,000 instructions and can be continued; execution yields between batches so runaway code does not block the page
- Sparse virtual memory covers the segments of the selected memory configuration. An address outside all of them faults, as does a load from or store into `.text` unless self-modifying code is enabled
- The history keeps the last 100,000 instructions by default, at about 150 bytes each and no cost to the speed of a run; it can be set as high as 1,000,000. Stepping back past what it holds is not possible, and neither is replaying what came before it

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

The X-Ray wire graph in `src/tools/xray/datapaths.ts` is generated from MARS
4.5's datapath XML by `scripts/generate-xray-datapaths.py`.  The drawings
themselves are redrawn as themed SVG rather than copied.

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
