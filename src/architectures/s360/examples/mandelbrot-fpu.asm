* Mandelbrot Set
* CPU: System/360 Model 30 with the floating-point feature, Model 50/65, System/370
* FPU: floating-point feature; long hexadecimal floating point
* 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)
*
* The same picture in long (14 hex digit) floating point. The pixel
* step 2.5 / 32 is exact in base 16, so cx and cy are stepped by
* addition. Four floating-point registers hold x, y, x*x and y*y;
* c and y*y wait in storage.
MANDELFP CSECT
         STM   14,12,12(13)       save the caller's registers
         BALR  12,0               establish a base register
         USING *,12
         L     2,=A(FRAME)        R2 -> first pixel
         LD    0,YMIN             cy = -1.25
         STD   0,CY
         LA    3,32               rows
ROW      LD    0,XMIN             cx = -2.0
         STD   0,CX
         LA    4,32               columns
COLUMN   SDR   0,0                x = 0
         SDR   2,2                y = 0
         SR    9,9                iteration
ITERATE  LDR   4,0                F4 = x * x
         MDR   4,0
         LDR   6,2                F6 = y * y
         MDR   6,2
         STD   6,YY
         ADR   6,4                escape once |z|^2 > 4
         CD    6,FOUR
         BH    ESCAPED
         MDR   2,0                y = 2 * x * y + cy
         ADR   2,2
         AD    2,CY
         SD    4,YY               x = x * x - y * y + cx
         AD    4,CX
         LDR   0,4
         LA    9,1(,9)
         CH    9,=H'16'
         BL    ITERATE
ESCAPED  LR    1,9                colour by iteration count
         SLL   1,2
         L     1,PALETTE(1)
         ST    1,0(,2)
         LA    2,4(,2)            next pixel
         LD    0,CX               cx = cx + step
         AD    0,STEP
         STD   0,CX
         BCT   4,COLUMN
         LD    0,CY               cy = cy + step
         AD    0,STEP
         STD   0,CY
         BCT   3,ROW
         LM    14,12,12(13)       restore and return to the monitor
         SR    15,15
         BR    14
FRAME    EQU   X'10000'           the display: little-endian RGB pixels
         LTORG
XMIN     DC    D'-2.0'
YMIN     DC    D'-1.25'
STEP     DC    D'0.078125'        2.5 / 32
FOUR     DC    D'4.0'
CX       DS    D
CY       DS    D
YY       DS    D
* Iteration count to colour, each word in the display's byte order
* (blue, green, red, unused); index 16 is the interior.
PALETTE  DS    0F
         DC    X'30000000,4A100000,661F0000,80300000'
         DC    X'A0440000,BD590000,D4721A00,E08C3D00'
         DC    X'EAA66200,F2BF8600,F7D5A800,FBE6C600'
         DC    X'FDF1DE00,FEF8EF00,FFFCF800,FFFFFF00'
         DC    X'00000000'
         END   MANDELFP
