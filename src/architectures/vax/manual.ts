import { htmlInstructionLink } from './htmlReferences'
import { preferInstructionLinks, instructionLinks } from '../../core/instructionHelp'
import { reference } from './isa'

/**
 * PDF pages (not printed page numbers, which run 14 lower) of each family's
 * opcode list in the 1987 VAX Architecture Reference Manual.  First match wins.
 */
const PAGES: readonly (readonly [RegExp, number])[] = [
	[/^adawi$/, 59], [/^add[bwl][23]$/, 60], [/^adwc$/, 61], [/^ash[lq]$/, 62], [/^bic[bwl][23]$/, 63], [/^bis[bwl][23]$/, 64],
	[/^bit[bwl]$/, 65], [/^clr[bwlqo]$/, 65], [/^cmp[bwl]$/, 66], [/^cvt(bw|bl|wb|wl|lb|lw)$/, 67], [/^(dec[bwl]|div[bwl][23])$/, 68],
	[/^ediv$/, 69], [/^emul$/, 70], [/^inc[bwl]$/, 71], [/^(mcom|mneg)[bwl]$/, 72], [/^mov[bwlqo]$/, 73], [/^(movz(bw|bl|wl)|mul[bwl][23])$/, 74],
	[/^pushl$/, 75], [/^rotl$/, 76], [/^(sbwc|sub[bwl][23])$/, 77], [/^tst[bwl]$/, 78], [/^xor[bwl][23]$/, 79],
	[/^mova[bwlqfdgho]$/, 80], [/^pusha[bwlqfdgho]$/, 81], [/^cmpz?v$/, 83], [/^extz?v$/, 84], [/^ff[sc]$/, 85], [/^insv$/, 86],
	[/^acb[bwlfdgh]$/, 87], [/^aobl(ss|eq)$/, 88], [/^b(neq|eql)u?$|^b(gtr|leq|geq|lss)u?$|^bv[cs]$|^bc[cs]$/, 90],
	[/^bb[sc]$/, 92], [/^bb(ss|cs|sc|cc)$/, 93], [/^bb(ssi|cci)$/, 94], [/^blb[sc]$/, 95], [/^(br|bsb)[bw]$/, 96], [/^case[bwl]$/, 97],
	[/^(jmp|jsb)$/, 99], [/^rsb$/, 100], [/^sobg(eq|tr)$/, 101], [/^callg$/, 104], [/^calls$/, 105], [/^ret$/, 107],
	[/^bi[cs]psw$/, 108], [/^bpt$/, 109], [/^halt$/, 111], [/^index$/, 112], [/^movpsl$/, 113], [/^(nop|popr)$/, 114], [/^pushr$/, 115],
	[/^add[fdgh][23]$/, 136], [/^clr[fdgh]$/, 137], [/^cmp[fdgh]$/, 138], [/^cvtr?[bwlfdgh][bwlfdgh]$/, 138], [/^div[fdgh][23]$/, 142],
	[/^mneg[fdgh]$/, 144], [/^mov[fdgh]$/, 145], [/^mul[fdgh][23]$/, 146], [/^sub[fdgh][23]$/, 152], [/^tst[fdgh]$/, 153],
	[/^cmpc[35]$/, 157], [/^locc$/, 159], [/^movc[35]$/, 164], [/^skpc$/, 171], [/^rei$/, 267], [/^chmk$/, 269], [/^mtpr$/, 296], [/^mfpr$/, 297],
]

const instructionLinkFallback = instructionLinks(reference, mnemonic => PAGES.find(([pattern]) => pattern.test(mnemonic))?.[1])
export const instructionLink = preferInstructionLinks(htmlInstructionLink, instructionLinkFallback)
