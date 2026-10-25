; Floating-point Arithmetic
; MC68881/MC68882: sqrt(81) * 5, 1000 * sqrt(2) and 1000 * sin(pi / 6); prints 45, 1414 and 500.

.text
main:
	fmove.l #81, fp0
	fsqrt.x fp0		; 9
	fmul.l #5, fp0		; 45
	fmove.l fp0, d1
	bsr print

	fmove.w #2, fp1
	fsqrt.x fp1		; 1.41421356...
	fmul.l #1000, fp1
	fintrz.x fp1		; truncate to 1414
	fmove.l fp1, d1
	bsr print

	fmovecr.x #0, fp2	; pi from the constant ROM
	fdiv.w #6, fp2
	fsin.x fp2		; 0.5
	fmul.l #1000, fp2
	fmove.d fp2, result	; keep the double in RAM
	fmove.l fp2, d1		; round to nearest: 500
	bsr print

	fcmp.l #499, fp2	; IEEE-aware: false if fp2 were a NaN
	fbogt done
	fmove.l #-1, fp3	; not reached
done:
	moveq #9, d0
	trap #15

; Print D1 and a newline.
print:
	moveq #3, d0
	trap #15
	moveq #10, d1
	moveq #6, d0
	trap #15
	rts

.data
result: ds.l 2
