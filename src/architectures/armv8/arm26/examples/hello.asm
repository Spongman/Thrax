@ Hello, THRAX!
@ Print a string with the RISC OS OS_Write0 call.

	.text
	.global _start
_start:
	adr r0, message         @ r0 -> the string, PC-relative
	swi OS_Write0           @ write it
	swi OS_Exit

message:
	.asciz "Hello, THRAX!\n"
	.align 2
