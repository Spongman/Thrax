@ Instruction Prefetch
@ ARM2 and ARM3 retain two prefetched words; modify the next one and print 12.

	.text
_start:
	ldr r0, =0xE3A01002     @ encoding of MOV r1,#2
	adr r2, target
	mov r3, #0
	str r0, [r2]            @ target is already in the instruction pipeline
target:
	mov r1, #1              @ first pass executes the prefetched original
	cmp r3, #0
	bne done
	mov r4, r1
	mov r3, #1
	b target                @ refetch the modified instruction
done:
	add r0, r4, #48
	swi OS_WriteC
	add r0, r1, #48
	swi OS_WriteC
	swi OS_Exit
