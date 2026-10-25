; Loop Counter
; Print 1 through 5.

.text
_start:
	mov #1, r4
loop:
	mov #1, r0
	trapa #0x10
	mov r4, r1
	mov #32, r4
	mov #11, r0
	trapa #0x10
	mov r1, r4
	add #1, r4
	mov #6, r2
	cmp/ge r2, r4
	bf loop
	mov #10, r0
	trapa #0x10
