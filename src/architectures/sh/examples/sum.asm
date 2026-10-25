; Sum of Numbers
; Add 3 and 5; prints 8.

.text
_start:
	mov #3, r4
	add #5, r4
	mov #1, r0
	trapa #0x10
	mov #10, r0
	trapa #0x10
