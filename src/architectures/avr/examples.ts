export const examples = {
	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw a 32 by 32 RGB gradient in SRAM at debugger address 0x10100.',
		code: `; Bitmap base: debugger 0x10100 = AVR SRAM address 0x100.
ldi r26, 0
ldi r27, 1
ldi r18, 32
row:
ldi r17, 32
pixel:
ldi r16, 0x20
st X+, r16
mov r16, r17
lsl r16
lsl r16
lsl r16
st X+, r16
mov r16, r18
lsl r16
lsl r16
lsl r16
st X+, r16
clr r16
st X+, r16
dec r17
brne pixel
dec r18
brne row
break
`
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3; the result 8 remains in r17.',
		code: `; Code labels and .org are BYTE addresses in this dialect.
ldi r16, 3
ldi r17, 5
add r17, r16
break
`
	},
	factorial: {
		name: 'Factorial',
		description: 'Compute 5! using MUL; the result 120 remains in r16.',
		code: `ldi r16, 1
ldi r17, 5
multiply:
mul r16, r17
mov r16, r0
dec r17
brne multiply
break
`
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute Fibonacci(10); the result 55 remains in r16.',
		code: `clr r16
ldi r17, 1
ldi r18, 10
next:
mov r19, r16
add r19, r17
mov r16, r17
mov r17, r19
dec r18
brne next
break
`
	},
	loop: {
		name: 'Loop Counter',
		description: 'Store 1 through 5 in SRAM at hardware 0x100 (debugger 0x10100).',
		code: `ldi r26, 0
ldi r27, 1
ldi r16, 1
ldi r17, 5
next:
st X+, r16
inc r16
dec r17
brne next
break
`
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Combine 12 and 10; AND = 8 in r18, OR = 14 in r19, XOR = 6 in r20.',
		code: `ldi r16, 12
ldi r17, 10
mov r18, r16
and r18, r17
mov r19, r16
or r19, r17
mov r20, r16
eor r20, r17
break
`
	},
	call: {
		name: 'Subroutine and SRAM',
		description: 'Harvard data, pointer addressing, stack and a subroutine.',
		code: `.dseg
value: .byte 41
.cseg
ldi r26, lo8(value)
ldi r27, hi8(value)
ld r16, X
rcall increment
st X, r16
break
increment:
push r17
ldi r17, 1
add r16, r17
pop r17
ret
`
	}
}
