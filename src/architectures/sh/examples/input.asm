; Interactive Input
; Read a signed integer and echo it.

.text
_start:
	mov #5, r0
	trapa #0x10
	mov #1, r0
	trapa #0x10
	mov #10, r0
	trapa #0x10
