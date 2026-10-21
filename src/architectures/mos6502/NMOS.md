# NMOS undocumented instructions

NMOS mode decodes every byte: 151 documented encodings plus 105 unintended
encodings. Assembly, disassembly, editor completion, hover, execution, tool
access events and rewind use the same model tables. W65C02S uses separate tables
and rejects NMOS-only mnemonics even when it assigns the same bytes other meanings.
For example, `$07` is NMOS `SLO zp` versus CMOS `RMB0 zp`, `$CB` is `AXS #imm`
versus `WAI`, and `$DB` is `DCP abs,Y` versus `STP`.

Supported families are `SLO`, `RLA`, `SRE`, `RRA`, `SAX`, `LAX`, `DCP`, `ISC`,
`ANC`, `ALR`, `ARR`, `AXS`, `XAA`, `LAS`, `AHX`, `SHX`, `SHY`, `TAS`, operand
and implied `NOP`s, the duplicate immediate `SBC`, and all twelve `KIL` bytes.
Common aliases include `ASO`, `LSE`, `ISB`/`INS`, `DCM`, `ASR`, `SBX`, `ANE`,
`LXA`/`OAL`, `AAX`, `SHA`/`AXA`, `SXA`, `SYA`, `LAR`/`LAE`, `SHS`, and `JAM`/`HLT`.
Disassembly uses canonical names. Where multiple encodings mean the same thing,
assembly selects the documented encoding, or the first listed unintended one:
`NOP` remains `$EA`, `SBC #imm` remains `$E9`, `ANC #imm` uses `$0B`. Use `.byte`
when exact duplicate bytes matter (for example `$EB` or the second ANC `$2B`).

Compound instructions preserve their NMOS flags, decimal behavior and fixed
RMW timing. Read NOPs access their operand, including device side effects and
indexed page penalties. KIL holds PC at its own opcode and stops instruction
execution; IRQ/NMI cannot wake it. THRAX reports the jam as a halted run, with
two entry cycles charged; continuous electrical bus activity while jammed is
not simulated. Reset and rewind recover normally.

The physically unstable instructions need deterministic choices:

- `XAA #imm`: `A = (A | $EE) & X & imm`.
- Immediate `LAX` (alias `LXA`): `A = X = (A | $EE) & imm`.
- `AHX`, `SHX`, `SHY` and `TAS` mask with the unindexed address high byte plus
  one. On an indexing page cross, the stored value also replaces the destination
  high byte. TAS first writes `SP = A & X`.

These choices match the selected independent test vectors; real parts can vary
with chip revision, electrical conditions and RDY timing. Dummy bus reads and
the original-value write of RMW instructions remain outside this instruction-level
model, as for documented instructions. Memory and history limits are unchanged.
The NMOS Undocumented Instructions example prints `42` and then jams; CMOS does
not offer that example.

References: [Michael Steil's decode analysis](https://www.pagetable.com/31),
[groepaz's measured instruction report](https://www.esocop.org/docs/MOS6510UnintendedOpcodes-20152412.pdf),
and [SingleStepTests/65x02](https://github.com/SingleStepTests/65x02).
The tests include 800 independently generated register/memory/cycle vectors
(first 32 cases for 25 selected opcodes in `6502/v1`), including decimal and
masked-store cases. Their MIT license is included with the fixture.
