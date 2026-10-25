@ Hello, THRAX!
@ Print a greeting with the console service.

.syntax unified
.cpu cortex-m0
.thumb

.text
_start:
	ldr r0, =message
	svc #4
	bkpt #0
.ltorg

.data
message: .asciz "Hello, THRAX!\n"
