* Factorial
* Compute 5! in a subroutine called with BALR; prints 120.
* FACT saves its caller's registers in the caller's save area and
* returns the product by storing it over the saved R1.
FACTMAIN CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         ST    13,SAVE+4          chain the save areas
         LA    13,SAVE
         LA    1,5                argument n
         L     15,=A(FACT)        entry point
         BALR  14,15              call FACT; R1 = n!
         SVC   200                print R1
         L     13,SAVE+4          restore and return to the monitor
         LM    14,12,12(13)
         SR    15,15
         BR    14
*
* FACT: R1 = n on entry, n! on return; R13 -> caller's save area.
FACT     STM   14,12,12(13)       save the caller's registers
         LR    4,1                R4 counts n down to 1
         LA    3,1                R3, odd half of the 2/3 pair, = 1
FMUL     MR    2,4                R2:R3 = R3 * R4
         BCT   4,FMUL
         ST    3,24(,13)          replace the caller's saved R1
         LM    14,12,12(13)       restore, including the new R1
         BR    14
SAVE     DS    18F
         LTORG
         END   FACTMAIN
