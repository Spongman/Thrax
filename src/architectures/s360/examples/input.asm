* Interactive Input
* Read a signed integer and echo it.
INPUT    CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         SVC   201                read an integer into R1
         SVC   200                print R1
         LM    14,12,12(13)       restore and return to the monitor
         SR    15,15
         BR    14
         END   INPUT
