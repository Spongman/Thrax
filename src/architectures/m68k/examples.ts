import type { Example } from '../contracts'
export const EXAMPLES: Record<string, Example> = {
	hello: {
		name: 'Hello, THRAX!',
		description: 'Educational TRAP #15 task 14 prints a zero-terminated string from A1.',
		code: `.data
message: .asciz "Hello, THRAX!\\n"
.text
_start:
    lea message,a1
    moveq #14,d0
    trap #15
    moveq #9,d0
    trap #15
`
	},
	factorial: {
		name: 'Factorial',
		description: 'Word multiplication, BSR/RTS and a DBRA loop; prints 120.',
		code: `.text
_start:
    moveq #5,d1
    bsr factorial
    moveq #3,d0
    trap #15
    moveq #9,d0
    trap #15
factorial:
    move.w d1,d2
    moveq #1,d1
    subq.w #1,d2
loop:
    move.w d2,d3
    addq.w #1,d3
    mulu.w d3,d1
    dbra d2,loop
    rts
`
	},
	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw a color ramp using long stores and address-register postincrement.',
		code: `.text
_start:
    movea.l #$10000,a0
    moveq #63,d1
    move.l #$0040ff,d2
pixel:
    move.l d2,(a0)+
    addi.l #$100,d2
    dbra d1,pixel
    moveq #9,d0
    trap #15
`
	},
	stack: {
		name: 'Stack and Registers',
		description: 'Save registers, change values, restore them and rewind the stack.',
		code: `.text
_start:
    moveq #42,d1
    moveq #-7,d2
    movem.l d1-d2/a0,-(sp)
    clr.l d1
    clr.l d2
    movem.l (sp)+,d1-d2/a0
    moveq #3,d0
    trap #15
    moveq #9,d0
    trap #15
`
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3, store the result, then print 8.',
		code: `.data
result: dc.l 0
.text
_start:
    moveq #5,d1
    moveq #3,d2
    add.l d2,d1
    move.l d1,result
    moveq #3,d0
    trap #15
    moveq #9,d0
    trap #15
`
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the tenth Fibonacci number with a DBRA loop; prints 55.',
		code: `.data
result: dc.l 0
.text
_start:
    moveq #0,d2
    moveq #1,d3
    moveq #9,d4
next:
    move.l d2,d5
    add.l d3,d5
    move.l d3,d2
    move.l d5,d3
    dbra d4,next
    move.l d2,result
    move.l d2,d1
    moveq #3,d0
    trap #15
    moveq #9,d0
    trap #15
`
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print one through five, one number per line, and retain the last counter in RAM.',
		code: `.data
counter: dc.l 0
.text
_start:
    moveq #1,d2
    moveq #4,d3
next:
    move.l d2,counter
    move.l d2,d1
    moveq #3,d0
    trap #15
    moveq #10,d1
    moveq #6,d0
    trap #15
    addq.l #1,d2
    dbra d3,next
    moveq #9,d0
    trap #15
`
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Compare AND, OR and XOR using 12 and 10; prints 8, 14 and 6.',
		code: `.data
results: dc.l 0,0,0
.text
_start:
    moveq #12,d2
    moveq #10,d5
    move.l d2,d3
    move.l d2,d4
    and.l d5,d2
    or.l d5,d3
    eor.l d5,d4
    move.l d2,results
    move.l d3,results+4
    move.l d4,results+8
    move.l d2,d1
    moveq #3,d0
    trap #15
    moveq #10,d1
    moveq #6,d0
    trap #15
    move.l d3,d1
    moveq #3,d0
    trap #15
    moveq #10,d1
    moveq #6,d0
    trap #15
    move.l d4,d1
    moveq #3,d0
    trap #15
    moveq #10,d1
    moveq #6,d0
    trap #15
    moveq #9,d0
    trap #15
`
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer into D1, store it, and echo it through educational TRAP #15.',
		code: `.data
result: dc.l 0
.text
_start:
    moveq #5,d0
    trap #15
    move.l d1,result
    moveq #3,d0
    trap #15
    moveq #9,d0
    trap #15
`
	}
}

export const EXAMPLES_68010: Record<string, Example> = {
	...EXAMPLES,
	returnArguments: {
		name: '68010: RTD and arguments',
		description: 'RTD restores the caller PC and removes one long stack argument.',
		code: `.text
_start:
    move.l #42,-(sp)
    bsr printArgument
    moveq #9,d0
    trap #15
printArgument:
    move.l 4(sp),d1
    moveq #3,d0
    trap #15
    rtd #4
`
	}
}

export const EXAMPLES_68020: Record<string, Example> = {
	...EXAMPLES_68010,
	scaledTable: {
		name: '68020: scaled table index',
		description: 'Brief scaled indexing selects a long table entry; EXTB sign-extends a byte.',
		code: `.data
table: dc.l 10,20,30,40
.text
_start:
    lea table,a0
    moveq #2,d1
    move.l 0(a0,d1.l*4),d1
    move.b #$80,d2
    extb.l d2
    moveq #3,d0
    trap #15
    moveq #9,d0
    trap #15
`
	}
}
