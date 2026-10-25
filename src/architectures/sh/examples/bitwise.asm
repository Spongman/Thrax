; Bitwise Operations
; AND, OR and XOR of 12 and 10 produce 8, 14 and 6.

.text
_start:
	mov #10, r1
	mov #12, r4
	and r1, r4
	mov #1, r0
	trapa #0x10
	mov #32, r4
	mov #11, r0
	trapa #0x10
	mov #12, r4
	or r1, r4
	mov #1, r0
	trapa #0x10
	mov #32, r4
	mov #11, r0
	trapa #0x10
	mov #12, r4
	xor r1, r4
	mov #1, r0
	trapa #0x10
	mov #10, r0
	trapa #0x10
