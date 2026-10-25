@ Keyboard Interrupts
@ Echo keys typed in the Keyboard / Display tool from an IRQ handler, until a full stop.

@ The program owns address 0, so it starts at the reset vector in SVC mode
@ with interrupts off. It turns on the keyboard's interrupt, drops to USR
@ mode and idles; each key raises IRQ, and the handler echoes it to the
@ display and the console.

	.org 0
	b reset                 @ 0x00 reset
	b .                     @ 0x04 undefined instruction
	.word 0                 @ 0x08 SWI: left empty, so the built-in OS answers
	b .                     @ 0x0C prefetch abort
	b .                     @ 0x10 data abort
	b .                     @ 0x14 address exception
	b irq                   @ 0x18 IRQ
	b .                     @ 0x1C FIQ

reset:
	ldr r0, =KBD_STATUS
	mov r1, #2              @ bit 1: interrupt when a key is waiting
	str r1, [r0]
	teqp pc, #0             @ USR mode, IRQ and FIQ enabled
idle:
	add r2, r2, #1          @ count while waiting
	b idle

irq:                        @ IRQ mode: sp and lr are R13_irq and R14_irq
	stmfd sp!, {r0, r1}
	ldr r1, =KBD_DATA
	ldr r0, [r1]            @ take the key, which ends the request
	str r0, [r1, #TTY_DATA - KBD_DATA]
	swi OS_WriteC
	cmp r0, #'.'
	swieq OS_Exit
	ldmfd sp!, {r0, r1}
	subs pc, lr, #4         @ back to USR, flags and all
