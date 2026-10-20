AVR uses a bare classic AVRe integer core profile, not an MCU model. It has 32
8-bit registers, SREG, a 16-bit descending SRAM stack, 64 KiB flash and 64 KiB
data space. SRAM starts at data address 0x100. SP starts at 0xffff as a
workbench convenience. The register file and SPL/SPH/SREG alias data addresses
0..31 and 0x5d/0x5e/0x5f. All other I/O/peripheral accesses fault.

Debugger addresses are bytes: flash 0..0xffff, data at 0x10000 plus its hardware
address. Source code labels and `.org` also use **byte** addresses (unlike
Microchip AVRASM's word-based `.cseg` locations). `.dseg`/`.data` label values
are hardware data addresses, so `ldi r26, lo8(value)` / `ldi r27, hi8(value)`
work without adjustment. `.org` in data likewise takes a hardware data address.
IJMP/ICALL Z and return addresses on the stack retain AVR word addressing.
LPM Z uses a flash byte address. Code is little-endian in flash.

The assembler uses the shared expression, include, two-pass layout, byte
emission and diagnostic engines. It supports `.include`, `.equ`/`.set`,
`.org`, `.cseg`/`.text`, `.dseg`/`.data`, `.byte`/`.db`, `.word`/`.dw`, integer
expressions, characters and lo8/hi8/low/high. It does not implement AVRASM
macros, device include packs, linker relocations, GNU ELF, or automatic word
padding of odd-length `.db` output. Unsupported directives diagnose errors.

Supported instructions: ADD ADC SUB SBC CP CPC AND OR EOR MOV MUL CPSE;
LDI SUBI SBCI CPI ANDI ORI; COM NEG SWAP INC DEC ASR LSR ROR PUSH POP;
NOP BREAK RET IJMP ICALL LPM (implicit r0,Z); RJMP RCALL JMP CALL;
LDS STS LD ST (X/Y/Z plain, postincrement, predecrement); IN OUT;
BSET BCLR BST BLD SBRC SBRS; all named SREG conditional branches;
CLR TST LSL ROL SER SEC CLC SEI CLI aliases.

BREAK ends a workbench run. No interrupts, MCU peripherals, EEPROM, extended
address registers, sleep, watchdog, SPM, RETI, fractional/signed multiply,
ADIW/SBIW/MOVW, displacement loads/stores, or cycle-accurate timing are
implemented. Unsupported opcodes fault. No console or host syscall is invented.
History stores the small register file in typed entry buffers and sparse memory
undo in typed effect buffers through the shared history allocator/limits.

Encoding and flag semantics reference: Microchip AVR Instruction Set Manual,
DS40002198B (2021):
https://ww1.microchip.com/downloads/en/DeviceDoc/AVR-InstructionSet-Manual-DS40002198.pdf
