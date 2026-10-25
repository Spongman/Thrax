# Hello, THRAX!
# Print a greeting with the console service.

.text
_start:
	lis r3, 1
	ori r3, r3, message & 65535
	li r0, 4
	sc
	li r0, 10
	sc

.data
message: .asciz "Hello, THRAX!\n"
