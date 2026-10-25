; W65C02S Instructions
; CMOS zero store, memory bits, stack registers and accumulator increment

.org $0600
stz $10
smb3 $10
bbr3 $10, failed
ldx #42
phx
ldx #0
plx
txa
inc a
sta $0200
bra done
failed:
stz $0200
done:
stp
