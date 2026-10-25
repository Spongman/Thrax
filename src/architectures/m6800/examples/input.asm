; Interactive Input
; Read and echo a signed 8-bit integer.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldaa #3
	swi
	ldaa #1
	swi

	ldaa #0
	swi
