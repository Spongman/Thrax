* Loop Counter
* Print 1 through 5 with BXLE: R4 is the increment, R5 the limit.
LOOPS    CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         LA    2,1                counter
         LA    4,1                increment
         LA    5,5                limit
LOOP     LR    1,2
         SVC   200                print the counter
         LA    1,C' '             an EBCDIC blank
         SVC   202
         BXLE  2,4,LOOP           add 1, loop while not above 5
         LM    14,12,12(13)       restore and return to the monitor
         SR    15,15
         BR    14
         END   LOOPS
