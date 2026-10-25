; Fibonacci
; Compute F(10); prints 55.

.text
_start:
	mov #0, r1
	mov #1, r2
	mov #10, r3
loop:
	mov r2, r4
	add r1, r4
	mov r2, r1
	mov r4, r2
	add #-1, r3
	tst r3, r3
	bf loop
	mov r1, r4
	mov #1, r0
	trapa #0x10
	mov #10, r0
	trapa #0x10
