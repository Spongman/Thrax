# Intel 8051

The documented MCS-51 instruction encodings, register banks, accumulator/PSW arithmetic, calls and returns, bit addressing, MOVC and MOVX are modeled. Reserved opcode A5 faults. CPU execution does not model cycle timing, external interrupts, serial ports, timers or parallel-port pins.

The debugger uses explicit disjoint addresses: code `0x00000..0x0ffff`, 128-byte internal RAM `0x10000..0x1007f`, SFR `0x10100..0x1017f`, external XDATA `0x20000..0x2ffff`. Native direct addresses below 80h reach IRAM; direct addresses 80h and above reach SFR. Register banks alias IRAM. MOVX reaches XDATA; MOVC reaches code. Indirect internal addresses above 7Fh are unsupported on the original 128-byte 8051 (no 8052 extended RAM).

The THRAX host monitor reserves code address FF00h. A native `LCALL 0xff00` is intercepted with A selecting: 0 exit, 1 print signed R6:R7, 2 print character R7, 3 read signed integer R6:R7. This host service does not claim to be a physical 8051 instruction feature.

Reference: [Intel MCS-51 User's Manual, chapter 2: Programmer's Guide and Instruction Set](https://bitsavers.org/components/intel/8051/MCS-51_Users_Manual_Feb94.pdf).
