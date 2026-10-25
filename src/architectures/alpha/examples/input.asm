# Interactive Input
# Read a signed integer and print it.

.text
_start:
	lda $0, 5($31)
	call_pal 0x83
	mov $0, $16
	lda $0, 1($31)
	call_pal 0x83
	call_pal 0
