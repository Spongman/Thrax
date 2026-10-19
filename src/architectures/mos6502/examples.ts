import { BitmapIcon, BitwiseIcon, FactorialIcon, FibonacciIcon, HelloIcon, InputIcon, KeyboardIcon, LoopIcon, MacrosIcon, MandelbrotIcon, RecursionIcon, SumIcon } from '../../components/icons'
import type { Example } from '../contracts'

/**
 * Example 6502 programs in ca65 syntax, ported from the MIPS and Beta
 * examples. Not ported: Coprocessors, as the 6502 has no floating point or
 * coprocessors, and TinyOS, a BSim kernel built on the Beta's segmentation,
 * which the 6502 lacks; Interrupts stands in for its timer and keyboard.
 *
 * Programs start at $0600, past the zero page, the stack and the display,
 * and end with BRK, which halts a program that sets no IRQ vector.
 */

const IO = `OUT    = $F000              ; write a character to the console
IN     = $F001              ; read a typed character, waiting for one
STATUS = $F002              ; bit 0: a key is ready; bit 1: the timer fired`

// Subroutines shared by several examples, pasted into each so it stands alone.

const PRINT_STRING = `; print_string: write the zero-terminated string at (ptr), up to 255 characters.
print_string:
	ldy #0
@next:
	lda (ptr),y
	beq @done
	sta OUT
	iny
	bne @next
@done:
	rts
`

const PRINT_DECIMAL = `; print_decimal: write the 16-bit number at num in decimal; clears num.
; Each pass divides num by 10, bit by bit, and pushes the remainder.
print_decimal:
	ldx #0                  ; digits pushed
@divide:
	lda #0
	sta rem
	ldy #16
@bit:
	asl num                 ; shift the next bit of num into rem
	rol num+1
	rol rem
	lda rem
	sec
	sbc #10
	bcc @smaller            ; rem < 10: this quotient bit is 0
	sta rem
	inc num                 ; quotient bit 1
@smaller:
	dey
	bne @bit
	lda rem
	pha                     ; the last digit, printed first once all are found
	inx
	lda num
	ora num+1
	bne @divide
@print:
	pla
	ora #'0'
	sta OUT
	dex
	bne @print
	rts
`

/** Sets ptr to `label` and prints it. */
const print = (label: string) => `	lda #<${label}
	sta ptr
	lda #>${label}
	sta ptr+1
	jsr print_string`

const VARIABLES = `ptr = $10                   ; 2 bytes: string pointer
num = $12                   ; 2 bytes: number to print
rem = $14                   ; remainder while printing`

export const EXAMPLES: Readonly<Record<string, Example>> = {
	input: {
		icon: InputIcon,
		name: 'Interactive Input',
		description: 'Read a line from $F001 into a buffer, then print it',
		code: `; Read a line into a buffer, then print it

${IO}

${VARIABLES}

	ldx #0
read:
	cpx #63                 ; keep the last byte for the zero
	beq done
	lda IN                  ; waits until a character is typed
	sta buffer,x
	inx
	cmp #10                 ; through the end of the line
	bne read
done:
	lda #0
	sta buffer,x
${print('buffer')}
	brk

${PRINT_STRING}
buffer: .res 64
`,
	},

	hello: {
		icon: HelloIcon,
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code, a byte at a time',
		code: `; .asciiz data and a print-string subroutine

${IO}

${VARIABLES}

${print('message')}
	brk

message: .asciiz "Hello, THRAX!\\n"

${PRINT_STRING}`,
	},

	sum: {
		icon: SumIcon,
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: `; Simple addition example
; Compute 5 + 3 = 8

${IO}

${VARIABLES}

	lda #5                  ; A <- 5
	clc                     ; ADC adds the carry too, so clear it first
	adc #3                  ; A <- A + 3 = 8

	; Print result
	sta num
	lda #0
	sta num+1
	jsr print_decimal

	; Print newline
	lda #'\\n'
	sta OUT
	brk

${PRINT_DECIMAL}`,
	},

	factorial: {
		icon: FactorialIcon,
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120',
		code: `; Factorial example
; Compute 5! = 5 * 4 * 3 * 2 * 1 = 120, in 16 bits

${IO}

${VARIABLES}
factor = $15                ; multiplier, and the loop counter n
bits   = $16
mcand  = $17                ; 2 bytes

	lda #1                  ; result = 1
	sta num
	lda #0
	sta num+1
	lda #5                  ; n = 5
	sta factor

loop:
	jsr multiply            ; result = result * n
	dec factor              ; n--
	bne loop                ; until n == 0

	jsr print_decimal
	brk

; multiply: num = num * factor, 16 x 8 bits by shifting and adding.
multiply:
	lda num
	sta mcand
	lda num+1
	sta mcand+1
	lda #0
	sta num
	sta num+1
	lda factor
	sta bits
@next:
	lsr bits                ; the factor's low bit says whether to add
	bcc @shift
	clc
	lda num
	adc mcand
	sta num
	lda num+1
	adc mcand+1
	sta num+1
@shift:
	asl mcand               ; the multiplicand doubles for the next bit
	rol mcand+1
	lda bits
	bne @next
	rts

${PRINT_DECIMAL}`,
	},

	fibonacci: {
		icon: FibonacciIcon,
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: `; Fibonacci sequence
; Compute fib(10) with 16-bit additions

${IO}

${VARIABLES}
previous = $20              ; 2 bytes: fib(n - 2)
current  = $22              ; 2 bytes: fib(n - 1)

	lda #0                  ; fib(0) = 0
	sta previous
	sta previous+1
	sta current+1
	lda #1                  ; fib(1) = 1
	sta current
	ldx #2                  ; i = 2

loop:
	clc                     ; num = previous + current, low byte then high
	lda previous
	adc current
	sta num
	lda previous+1
	adc current+1
	sta num+1
	lda current             ; previous = current
	sta previous
	lda current+1
	sta previous+1
	lda num                 ; current = num
	sta current
	lda num+1
	sta current+1
	inx                     ; i++
	cpx #11                 ; while i <= 10
	bne loop

	jsr print_decimal       ; num is fib(10)
	brk

${PRINT_DECIMAL}`,
	},

	ackermann: {
		icon: RecursionIcon,
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: `; Ackermann function
; A(m, n) = n + 1                    when m = 0
;         = A(m - 1, 1)              when n = 0
;         = A(m - 1, A(m, n - 1))    otherwise
;
; Each call pushes its return address and m on the hardware stack, so page 1
; fills up as the recursion deepens. A(3, 3) goes 63 calls deep.

${IO}

${VARIABLES}

${print('prompt')}

	ldx #3                  ; ackermann(3, 3)
	ldy #3
	jsr ackermann

	sta num                 ; print the result
	lda #0
	sta num+1
	jsr print_decimal
	brk

prompt: .asciiz "A(3, 3) = "

; ackermann: A <- A(X, Y), keeping X; Y is lost.
ackermann:
	cpx #0
	bne @m_positive
	iny                     ; m = 0: A(0, n) = n + 1
	tya
	rts

@m_positive:
	txa                     ; keep m across the calls
	pha
	cpy #0
	bne @both_positive
	dex                     ; n = 0: A(m, 0) = A(m - 1, 1)
	ldy #1
	jsr ackermann
	jmp @return

@both_positive:
	dey                     ; inner call: A(m, n - 1)
	jsr ackermann
	tay                     ; outer call: A(m - 1, inner)
	dex
	jsr ackermann

@return:
	tay                     ; restore m, keeping the result
	pla
	tax
	tya
	rts

${PRINT_STRING}
${PRINT_DECIMAL}`,
	},

	loop: {
		icon: LoopIcon,
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: `; Loop counter example
; Print numbers 1 through 5

${IO}

${VARIABLES}
counter = $20

	lda #1                  ; counter = 1
	sta counter

loop:
	lda counter             ; if counter == 6, exit
	cmp #6
	beq done

	; Print counter
	sta num
	lda #0
	sta num+1
	jsr print_decimal

	; Print space
	lda #' '
	sta OUT

	; Increment and loop
	inc counter
	jmp loop

done:
	; Print newline
	lda #'\\n'
	sta OUT
	brk

${PRINT_DECIMAL}`,
	},

	bitwise: {
		icon: BitwiseIcon,
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, ORA and EOR',
		code: `; Bitwise operations
; Test AND, OR, XOR with two values

${IO}

${VARIABLES}
first  = $20
second = $21

	lda #12                 ; first = 12 (binary: 1100)
	sta first
	lda #%1010              ; second = 10 (binary: 1010)
	sta second

	; AND operation
	lda first
	and second              ; A = 12 & 10 = 8
	jsr print_byte

	lda #' '
	sta OUT

	; OR operation
	lda first
	ora second              ; A = 12 | 10 = 14
	jsr print_byte

	lda #' '
	sta OUT

	; XOR operation
	lda first
	eor second              ; A = 12 ^ 10 = 6
	jsr print_byte

	brk

; print_byte: print A in decimal.
print_byte:
	sta num
	lda #0
	sta num+1
	jmp print_decimal       ; its RTS returns for us

${PRINT_DECIMAL}`,
	},

	bitmap: {
		icon: BitmapIcon,
		name: 'Bitmap Display',
		description: 'Draw colour bands for the Bitmap Display tool',
		code: `; Fill a 32 x 32 grid of pixels for the Bitmap Display tool.
; Tool settings: base address 0x200, unit 8, width 256, height 256.
; Each byte is one pixel whose low four bits pick one of 16 colours,
; in row-major order: pixel (row, column) is at $0200 + 32 * row + column.

DISPLAY = $0200
ptr     = $10               ; 2 bytes: the start of the current row
sum     = $12

	lda #<DISPLAY
	sta ptr
	lda #>DISPLAY
	sta ptr+1
	ldx #0                  ; row

row:
	ldy #0                  ; column

column:
	stx sum                 ; colour = (row + column) / 4: diagonal bands
	tya
	clc
	adc sum
	lsr
	lsr
	and #15
	sta (ptr),y

	iny
	cpy #32
	bne column

	clc                     ; the next row starts 32 bytes on
	lda ptr
	adc #32
	sta ptr
	bcc same_page
	inc ptr+1
same_page:
	inx
	cpx #32
	bne row

	brk
`,
	},

	mmio: {
		icon: KeyboardIcon,
		name: 'Keyboard and Display',
		description: 'Echo queued keystrokes through the I/O page',
		code: `; Memory-mapped I/O, through the Keyboard and Display tool or the console.
; Queue characters while the program runs; each one is echoed to the
; display. A period ends the program.

${IO}

poll:
	lda STATUS              ; bit 0 is set once a character is ready
	and #1
	beq poll

	lda IN                  ; reading it consumes the character
	sta OUT                 ; writing it prints to the display
	cmp #'.'
	bne poll

	brk
`,
	},

	macros: {
		icon: MacrosIcon,
		name: 'Macros',
		description: 'Define once, use many times with .macro and symbols',
		code: `; Macros are expanded by the assembler, so each use costs no call-and-return
; overhead. Labels inside a body are local to each expansion, which is
; why "again" can be reused safely. Arguments are values.

${IO}

${VARIABLES}
count = $20

FIRST  = 5                  ; symbols name constants, like .eqv
SECOND = 3

.macro print_string_at text
	lda #<text
	sta ptr
	lda #>text
	sta ptr+1
	jsr print_string
.endmacro

.macro count_to limit
	lda #0
	sta count
again:
	inc count
	lda count
	sta num
	lda #0
	sta num+1
	jsr print_decimal
	lda count
	cmp #limit
	bne again
.endmacro

.macro done
	brk
.endmacro

	print_string_at banner

	count_to FIRST
	print_string_at newline

	count_to SECOND
	print_string_at newline

	done

banner:  .asciiz "counting: "
newline: .asciiz "\\n"

${PRINT_STRING}
${PRINT_DECIMAL}`,
	},

	interrupts: {
		icon: KeyboardIcon,
		name: 'Interrupts',
		description: 'Timer and keyboard IRQs: a dot per tick, typed keys echoed, five ticks then exit',
		code: `; The timer raises an IRQ every PERIOD cycles; the handler prints a dot per
; tick and echoes any key typed meanwhile. The main program waits for five
; ticks, then exits through $F003. The IRQ vector at $FFFE points at the
; handler, so BRK would enter it too.

${IO}
EXIT   = $F003              ; write the exit code to halt
ENABLE = $F004              ; bit 0: keyboard IRQ, bit 1: timer IRQ
PERIOD = $F005              ; 2 bytes: cycles between timer ticks

ticks = $10
TICKS = 5

	lda #0
	sta ticks
	lda #<2000              ; a tick every 2000 cycles
	sta PERIOD
	lda #>2000
	sta PERIOD+1
	lda #%11                ; keyboard and timer IRQs
	sta ENABLE
	cli                     ; let IRQs in

wait:
	lda ticks
	cmp #TICKS
	bne wait

	sei
	lda #0
	sta ENABLE
	lda #'\\n'
	sta OUT
	lda #0
	sta EXIT

irq:
	pha
	lda STATUS
	and #2                  ; the timer fired?
	beq @keys
	sta STATUS              ; any write acknowledges it
	inc ticks
	lda #'.'
	sta OUT
@keys:
	lda STATUS
	and #1                  ; a key is ready?
	beq @done
	lda IN
	sta OUT
@done:
	pla
	rti

.org $FFFE
.word irq
`,
	},

	mandelbrot: {
		icon: MandelbrotIcon,
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal in 8.8 fixed point, drawn to the Bitmap Display',
		code: `; Mandelbrot set, in signed 8.8 fixed point: $0100 is 1.0.
;
; Open the Bitmap Display tool with base 0x200, unit 8, 256 x 256.
;
; For each pixel, c = cx + i*cy and z starts at 0.  The loop iterates
; z = z^2 + c until |z|^2 reaches 4, and colours the pixel by how many
; iterations that took.  Points that never escape are inside the set and
; stay black.

DISPLAY = $0200
SIZE    = 32
MAXITER = 15
STEP    = 20                ; 2.5 / 32 in 8.8: the view is 2.5 wide and high
X_MIN   = -512              ; -2.0
Y_MIN   = -320              ; -1.25

cx   = $20                  ; each a 2-byte 8.8 number
cy   = $22
zx   = $24
zy   = $26
zx2  = $28
zy2  = $2A
ma   = $30                  ; mul's operands and result
mb   = $32
prod = $34                  ; 4 bytes
sign = $38
iter = $39
col  = $3A
row  = $3B
ptr  = $3C                  ; 2 bytes: the start of the current row

	lda #<DISPLAY
	sta ptr
	lda #>DISPLAY
	sta ptr+1
	lda #<Y_MIN
	sta cy
	lda #>Y_MIN
	sta cy+1
	lda #0
	sta row

row_loop:
	lda #<X_MIN
	sta cx
	lda #>X_MIN
	sta cx+1
	lda #0
	sta col

column_loop:
	lda #0                  ; z = 0
	sta zx
	sta zx+1
	sta zy
	sta zy+1
	sta iter

iterate:
	lda zx                  ; zx2 = zx * zx
	sta ma
	sta mb
	lda zx+1
	sta ma+1
	sta mb+1
	jsr mul
	lda ma
	sta zx2
	lda ma+1
	sta zx2+1

	lda zy                  ; zy2 = zy * zy
	sta ma
	sta mb
	lda zy+1
	sta ma+1
	sta mb+1
	jsr mul
	lda ma
	sta zy2
	lda ma+1
	sta zy2+1

	clc                     ; escaped once zx2 + zy2 >= 4.0 ($0400)
	lda zx2
	adc zy2
	lda zx2+1
	adc zy2+1
	cmp #4
	bcs escaped

	lda zx                  ; zy = 2 * zx * zy + cy
	sta ma
	lda zx+1
	sta ma+1
	lda zy
	sta mb
	lda zy+1
	sta mb+1
	jsr mul
	asl ma
	rol ma+1
	clc
	lda ma
	adc cy
	sta zy
	lda ma+1
	adc cy+1
	sta zy+1

	sec                     ; zx = zx2 - zy2 + cx
	lda zx2
	sbc zy2
	sta zx
	lda zx2+1
	sbc zy2+1
	sta zx+1
	clc
	lda zx
	adc cx
	sta zx
	lda zx+1
	adc cx+1
	sta zx+1

	inc iter
	lda iter
	cmp #MAXITER
	beq inside
	jmp iterate             ; too far back for a branch
inside:
	lda #0                  ; never escaped: inside the set, black
	beq plot

escaped:
	lda iter                ; the iteration count is the colour
plot:
	ldy col
	sta (ptr),y

	clc                     ; cx += STEP
	lda cx
	adc #STEP
	sta cx
	lda cx+1
	adc #0
	sta cx+1
	inc col
	lda col
	cmp #SIZE
	beq next_row
	jmp column_loop

next_row:

	clc                     ; cy += STEP, and the next row of pixels
	lda cy
	adc #STEP
	sta cy
	lda cy+1
	adc #0
	sta cy+1
	clc
	lda ptr
	adc #SIZE
	sta ptr
	bcc same_page
	inc ptr+1
same_page:
	inc row
	lda row
	cmp #SIZE
	beq finished
	jmp row_loop

finished:
	brk

; mul: ma = ma * mb >> 8, signed 8.8; clobbers mb, prod, sign and X.
mul:
	lda ma+1                ; the result is negative when the signs differ
	eor mb+1
	sta sign
	bit ma+1                ; multiply magnitudes
	bpl @a_positive
	sec
	lda #0
	sbc ma
	sta ma
	lda #0
	sbc ma+1
	sta ma+1
@a_positive:
	bit mb+1
	bpl @b_positive
	sec
	lda #0
	sbc mb
	sta mb
	lda #0
	sbc mb+1
	sta mb+1
@b_positive:
	lda #0                  ; prod = ma * mb, 16 x 16 bits by shifting right
	sta prod+2
	sta prod+3
	ldx #16
@bit:
	lsr mb+1
	ror mb
	lda prod+3
	bcc @rotate
	clc
	lda prod+2
	adc ma
	sta prod+2
	lda prod+3
	adc ma+1
@rotate:
	ror a                   ; the add's carry, or 0, becomes the top bit
	sta prod+3
	ror prod+2
	ror prod+1
	ror prod
	dex
	bne @bit
	lda prod+1              ; the middle two bytes are the 8.8 product
	sta ma
	lda prod+2
	sta ma+1
	bit sign
	bpl @done
	sec
	lda #0
	sbc ma
	sta ma
	lda #0
	sbc ma+1
	sta ma+1
@done:
	rts
`,
	},
}
