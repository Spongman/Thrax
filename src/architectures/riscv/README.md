This target implements RV32IM and RV32IMC using the shared two-pass assembler and typed
history engine. The 1 MiB memory is flat and little-endian. Fetches and data
accesses must be naturally aligned; instruction targets use IALIGN=32 in RV32IM
and IALIGN=16 in RV32IMC. The ISA setting defaults to RV32IM.

The instruction definitions and exceptional multiplication/division cases
were checked against the official [RV32I specification](https://docs.riscv.org/reference/isa/v20260120/unpriv/rv32.html)
and [M extension specification](https://docs.riscv.org/reference/isa/v20260120/unpriv/m-st-ext.html).

RV32IMC adds all 27 integer forms from [the C 2.0 extension](https://docs.riscv.org/reference/isa/v20260120/unpriv/c-st-ext.html).
Each compressed instruction expands to an existing integer operation at decode;
the shared executor uses its actual instruction length for fall-through and links.
Mixed 16/32-bit source mapping, disassembly, breakpoints, calls and history retain
the original instruction bytes. Standard HINT encodings execute harmlessly;
reserved, custom, RV64-only and floating-point encodings fault.

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
No floating, atomic, privileged, CSR, pipeline or device model is
provided. FENCE is a no-op in the single-core sequential memory environment.

History stores fixed-width register snapshots and scalar control state in typed
columns and byte undo effects in shared blocks. Calls/returns record one frame
delta in typed columns; history has no object payloads and deep recursion does
not retain copies of the call stack.
