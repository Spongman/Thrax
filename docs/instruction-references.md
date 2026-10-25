# Instruction reference audit

Checked 24 October 2026. Instruction links prefer HTML where a checked source
covers the operation. This is a static coverage fallback, not a runtime probe for
site outages. No external documentation is downloaded or bundled with the app.

| Family | Preferred source | Remaining limitations |
| --- | --- | --- |
| MIPS | [MARS-compatible HTML reference](https://asm-editor.specy.app/documentation/mips/instruction/add) | 188 supported mnemonics linked; `li.s` and `li.d` have no verified entry. |
| Beta | [MIT Computation Structures](https://computationstructures.org/notes/isas/notes.html#TARGET_14.8) | Core ISA uses HTML sections. Convenience macros retain their PDF entries; BSim services without documentation remain unlinked. |
| 6502 / 65C02 | [pagetable instruction reference](https://www.pagetable.com/c64ref/6502/?tab=2) and [Oxyron undocumented instructions](https://www.oxyron.de/html/opcodes02.html) | CPU selection and undocumented-opcode aliases remain architecture specific. |
| 65C816 | [pagetable 65C816 reference](https://www.pagetable.com/c64ref/6502/?cpu=65c816&tab=2) | Width suffixes use the base operation; JML uses the long JMP entry. |
| Z80 | [instruction groups and operand forms](https://jnz.dk/z80/instgroups.html) | Mnemonics with multiple operand pages link to their group listing. SLL aliases use the same documented extension entry. |
| ARM2 / ARM3 | [Acorn assembler manual](https://www.riscos.com/support/developers/asm/instrset.html) | Original 26-bit behavior is described alongside later ARM features; availability is governed by the selected CPU. |
| 6800 | [Motorola instruction summary transcription](https://k7mem.com/VC_XA_Summary.html) | Summary tables rather than a complete prose programming manual; text fragments select mnemonic rows. |
| 6809 | [Motorola programming manual, Appendix A](https://www.maddes.net/m6809pm/appendix_a.htm) | ANDCC / ORCC lack verified distinct destinations and remain unlinked. |
| 68HC11 | [instruction summary](https://www.cs.uaf.edu/2007/fall/cs441/proj1notes/sawyer/inst.html) | Summary tables; text fragments select mnemonic rows. |
| 68000 / 68010 / 68020 | [integer instructions](https://68k.hax.com/) and [Motorola floating-point chapter](https://m680x0.github.io/ref/floating-point-instructions.html) | Integer pages are small. The converted floating-point HTML chapter is about 4.5 MB before compression; it is still a comparatively heavy reference. |
| 8051 | [Keil instruction manual](https://www.keil.com/support/man/docs/is51/is51_instructions.asp) | Use the working legacy `.asp` pages; `.htm` redirects were unreliable. All 44 mnemonic pages returned their actual content without redirects. |
| 8086 / 80186 and x87 | [NASM CPU-tagged instruction reference](https://pushbx.org/ecm/doc/insref.htm) | Original 8087 FENI/FDISI are included. The manual also describes later CPUs, so CPU tags matter. |
| Alpha | [DEC main ISA](https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM) and [floating point](https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_010.HTM) | PDF fallback for SQRTS/SQRTT, ITOFS/ITOFT and FTOIS/FTOIT, absent from this older HTML manual. Qualifiers share the base instruction entry. |
| SPARC V8 | [Sun instruction-set mapping](https://docs.oracle.com/cd/E19120-01/open.solaris/816-1681/instructionset-18901/index.html) | Integer, FP and synthetic tables use verified sections. Uncovered names retain V8 PDF entries; annulled branches and listed aliases share their base entry. |
| VAX | [VSI MACRO and instruction-set manual](https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/) | All 275 supported mnemonics have HTML entries, including privileged operations. The complete HTML manual is about 2 MB before compression. |
| TMS9900 | [Nouspikel assembly reference](https://www.unige.ch/medecine/nouspikel/ti99/assembly.htm) | Native named anchors and a shared conditional-branch section; RT, IDLE and NOP retain PDF entries. |
| PDP-11 | [DEC PDP-11/40 handbook, split scans hosted by MIT](https://pdos.csail.mit.edu/6.828/2005/pdp11/) | 74 supported core/EIS mnemonic forms use individual scan pages, avoiding a complete PDF download. These are images in HTML, not searchable text. FP11/FIS, later instructions and condition-code operations retain PDF entries. |
| AVR | [Microchip instruction manual PDF](https://ww1.microchip.com/downloads/en/DeviceDoc/AVR-InstructionSet-Manual-DS40002198.pdf) | Official instruction HTML URLs returned maintenance, 404 or 503 responses during the audit. Retain the working PDF rather than publish broken links. |
| System/360 / System/370 | Existing IBM manual PDFs | No verified complete HTML semantics replacement. Opcode-only lists with incomplete descriptions are not equivalent references. |

Other families already using HTML references keep their existing destinations.

The shared lookup helper prefers a known destination and consults the existing PDF
lookup only when no HTML entry is known. URL tables remain inside each architecture
directory and load with that architecture. Lookup and rendering are outside the CPU
execution and history paths. No instruction semantics, timing, memory layout or
history buffers change.

Validation includes literal URL tests, aliases and size suffixes, documented-mnemonic
coverage, checking generated anchors against retrieved source HTML, and native
browser navigation through both source and disassembly hovers. External references
can change independently of THRAX; the source tables make future corrections local.
