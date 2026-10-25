# Hello, THRAX!
# Print a greeting with the console service.

.text
_start:
	ldah $16, 1($31)
	lda $16, message - 65536($16)
	lda $0, 4($31)
	call_pal 0x83
	call_pal 0

.data
message: .asciz "Hello, THRAX!\n"
