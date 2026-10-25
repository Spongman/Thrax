* Ackermann
* Recursive A(3, 3) = 61 with standard linkage. Each level saves its
* caller's registers in the caller's save area and takes the next
* 72-byte area of STACK as its own; the result comes back in R3 by
* replacing the caller's saved R3.
ACKER    CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         ST    13,STACK+4         chain to the monitor's save area
         LA    13,STACK           first save area of the stack
         LA    2,3                m
         LA    3,3                n
         BAL   14,ACK             R3 = A(m, n)
         LR    1,3
         SVC   200                print it
         L     13,STACK+4         restore and return to the monitor
         LM    14,12,12(13)
         SR    15,15
         BR    14
*
* ACK: m in R2, n in R3; returns A(m, n) in R3.
ACK      STM   14,12,12(13)       save the caller's registers
         LA    13,72(,13)         push this level's save area
         LTR   2,2
         BNZ   ACKM               m > 0
         LA    3,1(,3)            A(0, n) = n + 1
         B     ACKRET
ACKM     LTR   3,3
         BNZ   ACKMN              n > 0
         BCTR  2,0                A(m, 0) = A(m - 1, 1)
         LA    3,1
         BAL   14,ACK
         B     ACKRET
ACKMN    BCTR  3,0                A(m, n) = A(m - 1, A(m, n - 1))
         BAL   14,ACK
         BCTR  2,0
         BAL   14,ACK
ACKRET   SH    13,=H'72'          pop back to the caller's save area
         ST    3,32(,13)          replace the caller's saved R3
         LM    14,12,12(13)
         BR    14
         LTORG
STACK    DS    (100*18)F          100 nested save areas
         END   ACKER
