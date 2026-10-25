# WDC 65C816

Select WDC W65C816S under the 6502 family. The family's default remains NMOS
6502; old standalone `w65816` saved selections migrate to this variant. Native
code, examples and documentation live together in `mos6502/w65816/`. The native
backend loads when selected, and the common family router owns its lifecycle.

The architecture uses a native 256-entry opcode/address-mode table and the shared configurable assembler/runtime/history/editor/debugger adapter. All instruction encodings are W65C816 opcodes; this module supplies CPU semantics rather than another workbench implementation.

Reset enters emulation mode (E=1, M=X=1, S=0x01ff). CLC/XCE enters native mode; REP/SEP and PLP/RTI control the live accumulator/index widths. Eight-bit A operations preserve the hidden B byte; setting X truncates X/Y. TCS/TSC/TCD/TDC are always 16-bit. Native/emulation stack rules, decimal ADC/SBC, direct-page/stack-relative/absolute/long and indirect modes, banked calls/returns, BRK/COP/RTI and bytewise MVN/MVP are implemented.

The shared PC is the physical 24-bit program address, with PBR exposed separately. Instruction fetch/fall-through wraps within the program bank. DBR supplies ordinary absolute data accesses, direct page and stack use bank zero, and long addresses carry their own bank. The shared segment-address helper provides masking and bank translation; mode/default bank selection remains native. Code starts at 0x1000, data/framebuffer at 0x8000. Examples explicitly enter native 16-bit mode and move the stack to 0x7ffe.

Immediate widths must be explicit when needed: `lda.b #0x12`, `lda.w #0x1234`, `ldx.w #0x1234`. The default encoded immediate is eight bits. These suffixes choose encoding length only; the program must establish matching M/X flags. Use `.d` or a leading `<` for direct-page addresses, `.l` or a leading `|` for long addresses; ordinary operands encode absolute addresses. Examples include `lda.d 0x12`, `lda [0x12],y`, `lda (0x12,s),y`, `lda.l 0x123456,x`, and `mvn 2,3` (source bank, destination bank). Source-row disassembly uses the assembled row length for immediate widths; standalone decoding defaults to reset widths. Live memory/execution/history decoding uses actual M/X/E state and preserves the decoded instruction identity.

When no guest COP vector is installed, the real COP signature implements the explicitly simulator-defined THRAX monitor:

| COP signature | Operation |
| --- | --- |
| 0 | Halt |
| 1 | Print full A as a signed 16-bit integer |
| 2 | Print A low byte as a character |
| 3 | Print zero-terminated string at DBR:X |
| 4 | Read signed 16-bit integer into full A |

An installed BRK/COP vector takes precedence and pushes the native interrupt frame. BRK signature 0 with no vector and STP terminate teaching programs. WDM is the documented reserved NOP.

Limitations: no external interrupt, ABORT, timer, bus or peripheral model. WAI reports that no interrupt source is configured rather than pretending to complete a wait. Execution is functional, without hardware cycle counts. The full 16 MiB address space is RAM; no console or framebuffer register is secretly mapped into native memory. Monitor conventions are not a WDC hardware ABI.

Reference: [WDC W65C816S datasheet, March 2024](https://www.westerndesigncenter.com/wdc/documentation/w65c816s.pdf).

Tests check independent encoding bytes, M/X transitions, hidden accumulator preservation, decimal carry, long native stack frames, program-bank-boundary Step Over, recursive calls/input and all 1,024 pixels of both native graphics examples.
