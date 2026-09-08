import React from 'react'
import { createPortal } from 'react-dom'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { CodeWord } from '../core/types'
import { formatHex, formatWord, formatWordDigits } from '../core/format'
import { splitHex } from './HexNumber'
import type { HexDimming } from '../core/settings'
import { disassemble, disassembleData } from '../core/disassembler'
import { useTHRAXStore } from '../store/thraxStore'
import { describeToken, registerMipsDebugDataTips } from '../services/debugDataTips'
import { setFindReplaceEditor } from '../services/findReplace'
import { heatLevel } from '../tools/profile'
import { useFlash } from './highlight'
import './SourcePane.css'

/** Gutter columns are separated, and closed off, by two spaces. */
const COLUMN_GAP = '  '
/** Width of the gutter's address column: `0x` and eight digits. */
const ADDRESS_COLUMNS = 10
/** What a data tip leaves between itself and the row it is describing. */
const HOVER_GAP = 2

/**
 * The classes a gutter address wears, in both the shapes it is drawn in: text
 * injected into a source line, and a row of a view zone for a word that has no
 * line.  One function, so the two cannot drift apart.
 *
 * The hover is not in here.  A zone row is real DOM that is rebuilt whenever
 * this is recomputed, and rebuilding the node the pointer is over is how a
 * hover ends up never showing at all.
 */
export function gutterAddressClass(address: number | undefined, pc: number | null): string {
	return [
		'code-word',
		'code-word-gutter-address',
		address !== undefined ? 'code-word-address' : '',
		address !== undefined && address === pc ? 'code-word-current' : '',
	].filter(Boolean).join(' ')
}

/**
 * The runs one gutter address is drawn as, so it reads the way every other
 * panel spells a word: the prefix, the leading zeros the workspace dims, and
 * the digits that carry the value.
 *
 * They are runs rather than one string because Monaco injects text as a single
 * span per decoration, and the zeros need a class of their own.  Empty parts
 * are dropped so a decoration is only spent on something to draw.
 */
export function addressRuns(address: number, mode: HexDimming): { text: string, dim: boolean }[] {
	const { prefix, zeros, rest } = splitHex(formatWord(address), mode)
	return [
		{ text: prefix, dim: false },
		{ text: zeros, dim: true },
		{ text: rest, dim: false },
	].filter((run) => run.text.length > 0)
}

/**
 * The gutter of one line in three parts, so the disassembly can be drawn in a
 * span of its own.
 *
 * Concatenated they are the gutter as a single string, which is the whole point:
 * the columns are padded to one width for the file, and the source only stays
 * aligned if splitting them up adds and drops nothing.
 */
export function gutterParts(lead: string, code: string, asm: string): { pre: string, asm: string, tail: string } {
	return { pre: lead + code + (code && asm ? COLUMN_GAP : ''), asm, tail: COLUMN_GAP }
}

/**
 * Which character of a monospace span the pointer is on.
 *
 * The span's own width divides evenly into the characters it drew, so this needs
 * no font measurement.  A pointer past either end is clamped into the text,
 * which is where a hover on the last character of a line ends up.
 */
export function hoveredColumn(x: number, rect: { left: number, width: number }, length: number): number {
	if (length === 0 || rect.width === 0) return 0
	return Math.min(length - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * length)))
}

/**
 * Where a disassembly data tip is drawn, and what it says.  The coordinates are
 * relative to the editor, because that is what it is drawn inside.
 */
interface AssemblyTip {
	left: number
	top: number
	/** Whether it hangs below the row or sits above it, as Monaco's own does. */
	above: boolean
	paragraphs: string[]
}

/** The paragraphs of a data tip, which is written as Markdown. */
export function tipParagraphs(contents: string[]): string[] {
	return contents
		.flatMap((entry) => entry.split('\n\n'))
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
}

/**
 * One paragraph of a data tip, split into the runs it is drawn as.
 *
 * The tips are written for Monaco, which renders them as Markdown, and this one
 * is drawn inside the editor beside the gutter: the same emphasis and the same
 * code spans have to come out of it, or the two hovers would not look alike.
 * Only the two marks the tips actually use are understood.
 */
export function tipRuns(paragraph: string): { text: string, kind: 'plain' | 'strong' | 'code' }[] {
	const runs: { text: string, kind: 'plain' | 'strong' | 'code' }[] = []
	let plain = ''
	for (const match of paragraph.matchAll(/\*\*([^*]+)\*\*|`([^`]+)`|([\s\S]+?)(?=\*\*|`|$)/g)) {
		const [, strong, code, rest] = match
		if (rest !== undefined) {
			plain += rest
			continue
		}
		if (plain.length > 0) runs.push({ text: plain, kind: 'plain' })
		plain = ''
		runs.push(strong !== undefined ? { text: strong, kind: 'strong' } : { text: code, kind: 'code' })
	}
	if (plain.length > 0) runs.push({ text: plain, kind: 'plain' })
	return runs
}

/** A file that assembled to nothing has no machine words and no breakpoints. */
const NO_CODE_WORDS = new Map<number, CodeWord[]>()
const NO_LINES: ReadonlySet<number> = new Set<number>()

/**
 * Data tips read the live store, so one provider serves every open editor: a
 * second registration would answer the same hover twice.
 */
let dataTipsRegistered = false

const formatAddress = formatWord

const formatCodeWord = (row: CodeWord) => row.word === null
	? row.bytes.map((byte) => formatHex(byte, 2)).join(' ') + (row.truncated ? ' …' : '')
	: formatWordDigits(row.word)

interface SourcePaneProps {
	/** The open file this editor is showing. */
	documentId: string
}

function SourcePane({ documentId }: SourcePaneProps) {
	const store = useTHRAXStore()
	const hexDimming = store.settings.hexDimming
	const { activeDocumentId, branchHistory, breakpoints, callStack, documents, entryDocumentId, focusedSource, gutterColumns, heatMap: showHeatMap, heatMapLines: showHeatLines, hovered, pipeline, profile, selectedFrame, setBreakpointLines, setDocumentCode, toggleBreakpointAddress, toggleBreakpointLine } = store
	// Bug 12: every editor marks up its own file.  The keyboard and the find
	// widget still belong to the tab in front of the user, and a diagnostic with
	// no file of its own to the entry file the assembler started from.
	const isActiveFile = documentId === activeDocumentId
	const isEntryFile = documentId === entryDocumentId
	const sourceDocument = documents.find((candidate) => candidate.id === documentId)
	const code = sourceDocument?.code ?? ''
	const title = sourceDocument?.title ?? ''
	const diagnostics = React.useMemo(
		() => store.diagnostics.filter((diagnostic) => diagnostic.file ? diagnostic.file === title : isEntryFile),
		[store.diagnostics, isEntryFile, title],
	)
	// Every lookup names this file, so each editor shows the words, breakpoints
	// and execution pointer of the file it is holding.
	const codeWords = store.codeWords.get(title) ?? NO_CODE_WORDS
	const sourceIndex = store.sourceIndex
	const breakpointLines = store.breakpointLines.get(title) ?? NO_LINES
	const pc = store.pc
	const { address: showAddresses, code: showCodeBytes, disassembly: showDisassembly } = gutterColumns
	const editorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null)
	const monacoRef = React.useRef<Parameters<OnMount>[1] | null>(null)
	const breakpointDecorationIds = React.useRef<string[]>([])
	const executionDecorationIds = React.useRef<string[]>([])
	const hoverDecorationIds = React.useRef<string[]>([])
	const frameDecorationIds = React.useRef<string[]>([])
	const revealedFrameRef = React.useRef<number | null>(null)
	const codeWordDecorationIds = React.useRef<string[]>([])
	const profileDecorationIds = React.useRef<string[]>([])
	const codeWordZoneIds = React.useRef<string[]>([])
	const revealedPc = React.useRef<number | null>(null)
	const toggleBreakpointLineRef = React.useRef(toggleBreakpointLine)
	const toggleBreakpointAddressRef = React.useRef(toggleBreakpointAddress)
	const setBreakpointLinesRef = React.useRef(setBreakpointLines)
	const breakpointLinesRef = React.useRef(breakpointLines)
	const copiedBreakpointLinesRef = React.useRef<{ text: string, relativeLines: number[] } | null>(null)
	const isActiveFileRef = React.useRef(isActiveFile)
	const titleRef = React.useRef(title)
	// The mouse handler is installed once, so what it reaches for has to be a
	// ref rather than the value that was current when it was installed.
	const sourceIndexRef = React.useRef(sourceIndex)
	/**
	 * The line of this file the hovered address sits on, or undefined.
	 *
	 * The gutter is redrawn from this rather than from the address: an address in
	 * another file, in data, or on the line already lit is not a reason to rebuild
	 * every line's injected text.
	 */
	const hoveredLine = React.useMemo(() => {
		if (store.hovered.address === null) return undefined
		const location = sourceIndex.lineForAddress(store.hovered.address)
		return location?.file === title ? location.line : undefined
	}, [sourceIndex, store.hovered.address, title])
	const hoveredAddressRef = React.useRef(store.hovered.address)
	/** The address span of each zone row, so a hover can light one in place. */
	const zoneAddressNodes = React.useRef<{ address: number, node: HTMLElement }[]>([])
	const focusMemoryAddressRef = React.useRef(store.focusMemoryAddress)
	const hoverRef = React.useRef(store.hover)
	const handleAssemblyHoverRef = React.useRef<(element: HTMLElement | undefined, clientX: number) => void>(() => {})
	const clearAssemblyTipRef = React.useRef<() => void>(() => {})
	/** The editor's own node, which the data tip is drawn inside. */
	const [editorNode, setEditorNode] = React.useState<HTMLElement | null>(null)
	/** Monaco's own hover delay, so this one waits exactly as long. */
	const hoverDelay = React.useRef(300)

	const tipTimer = React.useRef<number | undefined>(undefined)

	sourceIndexRef.current = sourceIndex
	hoveredAddressRef.current = store.hovered.address
	focusMemoryAddressRef.current = store.focusMemoryAddress
	hoverRef.current = store.hover
	toggleBreakpointLineRef.current = toggleBreakpointLine
	toggleBreakpointAddressRef.current = toggleBreakpointAddress
	setBreakpointLinesRef.current = setBreakpointLines
	breakpointLinesRef.current = breakpointLines
	isActiveFileRef.current = isActiveFile
	titleRef.current = title

	// What the pointer is over in the gutter's disassembly, if anything.  The
	// gutter is not in any model, so Monaco's own hover never fires there and
	// this is drawn over the token in the same widget instead.
	const [assemblyTip, setAssemblyTip] = React.useState<AssemblyTip | null>(null)
	const assemblyTipRef = React.useRef<AssemblyTip | null>(null)
	assemblyTipRef.current = assemblyTip

	const hoverRegister = React.useCallback((name: string | null) => {
		hoverRef.current({ register: name })
	}, [])

	const clearAssemblyTip = React.useCallback(() => {
		window.clearTimeout(tipTimer.current)
		hoverRegister(null)
		if (assemblyTipRef.current !== null) setAssemblyTip(null)
	}, [hoverRegister])

	React.useEffect(() => () => window.clearTimeout(tipTimer.current), [])

	const handleAssemblyHover = React.useCallback((element: HTMLElement | undefined, clientX: number) => {
		// Monaco's hover can be moved into and read; so can this one.
		if (element?.closest('.assembly-tooltip')) return
		const span = element?.closest('.code-word-asm') ?? null
		const text = span?.textContent ?? ''
		const editor = editorNode
		if (!span || text.length === 0 || !editor) {
			clearAssemblyTip()
			return
		}
		const rect = span.getBoundingClientRect()
		const { registers, memory, fpRegisters, labels } = useTHRAXStore.getState()
		const described = describeToken(text, hoveredColumn(clientX, rect, text.length), { registers, memory, fpRegisters, labels })
		hoverRegister(described?.register ?? null)
		if (!described) {
			clearAssemblyTip()
			return
		}
		// Drawn from the start of the token rather than from the pointer, so it
		// holds still while the pointer crosses the one word it is describing, and
		// the move that does not change it costs no render.
		const paragraphs = tipParagraphs(described.contents)
		const editorRect = editor.getBoundingClientRect()
		// Below the row, unless the row is near enough the top of the editor that
		// Monaco would have put its own hover there instead.
		const above = rect.top - editorRect.top > editorRect.height / 2
		const next: AssemblyTip = {
			left: rect.left - editorRect.left + (described.start / text.length) * rect.width,
			top: above ? rect.top - editorRect.top - HOVER_GAP : rect.bottom - editorRect.top + HOVER_GAP,
			above,
			paragraphs,
		}
		const current = assemblyTipRef.current
		if (current && current.left === next.left && current.top === next.top && current.paragraphs.join('\n') === paragraphs.join('\n')) return
		// Once a tip is up it follows the pointer at once, as Monaco's does; the
		// delay is what it waits before the first one.
		window.clearTimeout(tipTimer.current)
		if (current !== null) setAssemblyTip(next)
		else tipTimer.current = window.setTimeout(() => setAssemblyTip(next), hoverDelay.current)
	}, [clearAssemblyTip, editorNode, hoverRegister])

	handleAssemblyHoverRef.current = handleAssemblyHover
	clearAssemblyTipRef.current = clearAssemblyTip

	// A navigation from another panel names a file as well as a line, so only the
	// editor holding that file answers it.
	const navigating = useFlash('navigation', focusedSource && focusedSource.file === title ? focusedSource.request : null)
	const navigatedLine = navigating && focusedSource?.file === title ? focusedSource.line : null

	React.useEffect(() => {
		if (!focusedSource || focusedSource.file !== title) return
		const editorInstance = editorRef.current
		if (!editorInstance) return
		const { line } = focusedSource
		// Arriving at a line means arriving in the file: the caret goes to the
		// first thing on the line and the keyboard comes with it, so the next
		// keystroke edits what was navigated to.
		editorInstance.setPosition({ lineNumber: line, column: editorInstance.getModel()?.getLineFirstNonWhitespaceColumn(line) ?? 1 })
		editorInstance.revealLineInCenterIfOutsideViewport(line)
		// The dock brings the tab forward in its own effect, which runs after this
		// one and would take the focus back, so the editor asks for it afterwards.
		const handle = window.requestAnimationFrame(() => editorInstance.focus())
		return () => window.cancelAnimationFrame(handle)
	}, [focusedSource, title])

	const handleEditorMount: OnMount = React.useCallback((editorInstance, monaco) => {
		editorRef.current = editorInstance
		monacoRef.current = monaco
		if (isActiveFileRef.current) setFindReplaceEditor(editorInstance)
		if (!dataTipsRegistered) {
			dataTipsRegistered = true
			// The provider reads the model it was asked about, so a hover answers
			// for the file under the pointer rather than for the entry file.
			registerMipsDebugDataTips(monaco, () => {
				const { registers, memory, fpRegisters, labels } = useTHRAXStore.getState()
				return { registers, memory, fpRegisters, labels }
			})
		}
		const editorDomNode = editorInstance.getDomNode()
		setEditorNode(editorDomNode)
		hoverDelay.current = editorInstance.getOption(monaco.editor.EditorOption.hover).delay
		// Monaco sizes the hover it shows over content from the editor's font and the
		// hover it shows over the margin from nothing at all, so the profile popup
		// came out at the page's size.  Publishing the font here lets one rule size
		// every hover in the workspace, Monaco's own two included.
		const publishHoverFont = () => {
			const { fontSize, lineHeight } = editorInstance.getOption(monaco.editor.EditorOption.fontInfo)
			editorDomNode?.style.setProperty('--thrax-hover-font-size', `${fontSize}px`)
			editorDomNode?.style.setProperty('--thrax-hover-line-height', `${lineHeight / fontSize}`)
		}
		publishHoverFont()
		editorInstance.onDidChangeConfiguration((event) => {
			if (event.hasChanged(monaco.editor.EditorOption.fontInfo)) publishHoverFont()
		})
		const captureBreakpointCopy = (event: ClipboardEvent) => {
			const model = editorInstance.getModel()
			const selection = editorInstance.getSelection()
			if (!model || !selection || selection.isEmpty()) return
			const startLine = selection.startLineNumber
			const relativeLines = [...breakpointLinesRef.current]
				.filter((line) => line >= startLine && line <= selection.endLineNumber)
				.map((line) => line - startLine)
			const copied = { text: model.getValueInRange(selection), relativeLines }
			copiedBreakpointLinesRef.current = copied
			try {
				event.clipboardData?.setData('application/x-thrax-breakpoints', JSON.stringify(copied))
			} catch {
				// Browsers may disallow custom clipboard formats; the in-app fallback remains.
			}
		}
		editorDomNode?.addEventListener('copy', captureBreakpointCopy)
		editorInstance.onMouseDown((event) => {
			if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
				const line = event.target.position?.lineNumber
				if (!line) return
				toggleBreakpointLineRef.current(titleRef.current, line)
				return
			}
			// The gutter strip is injected before the source, so a click there is
			// aimed at the word it spells rather than at the text: it sends the
			// memory view to that address.  The class is the only handle on it,
			// since the mouse target says nothing about injected text.
			if (!event.target.element?.closest('.code-word-address')) return
			const line = event.target.position?.lineNumber
			if (!line) return
			const address = sourceIndexRef.current.addressesForLine(titleRef.current, line)[0]
			if (address !== undefined) focusMemoryAddressRef.current(address)
		})
		editorInstance.onMouseMove((event) => {
			// The gutter's disassembly answers wherever it is drawn, injected into a
			// line or in a row of a zone below one.
			handleAssemblyHoverRef.current(event.target.element ?? undefined, event.event.browserEvent.clientX)
			// A word row hanging below a line reports its own address through its own
			// listeners.  Without this the line it hangs from answers for it, and
			// every row of an expansion lit the first word of the instruction.
			if (event.target.element?.closest('.code-word-zone')) return
			const line = event.target.element?.closest('.code-word-address') ? event.target.position?.lineNumber : undefined
			const address = line === undefined ? undefined : sourceIndexRef.current.addressesForLine(titleRef.current, line)[0]
			hoverRef.current({ address: address ?? null })
		})
		editorInstance.onMouseLeave(() => {
			hoverRef.current({ address: null })
			clearAssemblyTipRef.current()
		})
		// The tip is placed against the editor rather than against the text, so it
		// would be left pointing at nothing once the text moved under it.
		editorInstance.onDidScrollChange(() => clearAssemblyTipRef.current())
		// Each editor reports where its own file's markers moved to.
		editorInstance.onDidChangeModelContent(() => {
			const model = editorInstance.getModel()
			if (!model) return
			const movedLines = breakpointDecorationIds.current
				.map((id) => model.getDecorationRange(id)?.startLineNumber)
				.filter((line): line is number => line !== undefined)
			setBreakpointLinesRef.current(titleRef.current, movedLines)
		})
		editorInstance.onDidPaste((event) => {
			const plainText = event.clipboardEvent?.clipboardData?.getData('text/plain') ?? ''
			const encoded = event.clipboardEvent?.clipboardData?.getData('application/x-thrax-breakpoints')
			let copied = copiedBreakpointLinesRef.current
			if (encoded) {
				try {
					const parsed: unknown = JSON.parse(encoded)
					if (typeof parsed === 'object' && parsed !== null && 'text' in parsed && 'relativeLines' in parsed &&
						typeof parsed.text === 'string' && Array.isArray(parsed.relativeLines)) {
						copied = {
							text: parsed.text,
							relativeLines: parsed.relativeLines.filter((line): line is number => typeof line === 'number' && Number.isInteger(line)),
						}
					}
				} catch {
					// Custom clipboard formats are optional in browsers.
				}
			}
			if (!copied || (plainText && plainText !== copied.text)) return
			const nextLines = new Set(breakpointLinesRef.current)
			for (const relativeLine of copied.relativeLines) nextLines.add(event.range.startLineNumber + relativeLine)
			setBreakpointLinesRef.current(titleRef.current, nextLines)
		})
		editorInstance.onDidDispose(() => editorDomNode?.removeEventListener('copy', captureBreakpointCopy))
	}, [])

	// The toolbar's Find opens Monaco's find widget on the file in front of the
	// user, so this editor claims it for as long as it is the one showing.
	React.useEffect(() => {
		if (!isActiveFile) return
		setFindReplaceEditor(editorRef.current)
		return () => setFindReplaceEditor(null)
	}, [isActiveFile])

	// Debugger keys, captured before Monaco claims F8 and friends.  Only the
	// editor in front of the user listens, so one press steps once.
	React.useEffect(() => {
		if (!isActiveFile) return
		const handler = (event: KeyboardEvent) => {
			if (!/^F(5|7|8|9|10)$/.test(event.key) || event.repeat) return
			const store = useTHRAXStore.getState()
			const line = editorRef.current?.getPosition()?.lineNumber
			// Blank and comment lines carry no address, so aim at the next line that does.
			const addressAt = (from?: number) =>
				from === undefined ? undefined : store.sourceIndex.codeAddressAtOrAfter(title, from)

			switch (event.key) {
				case 'F5':
					if (event.altKey) {
						store.pause()
						store.reset()
					} else if (event.shiftKey) {
						store.reset()
						void store.run()
					} else if (store.isPaused) void store.continue()
					else void store.run()
					break
				case 'F7': {
					// Step out needs no cursor address, so it comes first.
					if (event.shiftKey && !event.ctrlKey) {
						void store.stepToReturn()
						break
					}
					const address = addressAt(line)
					if (address === undefined) break
					if (event.ctrlKey && event.shiftKey) store.setProgramCounter(address)
					else void store.runToAddress(address)
					break
				}
				case 'F8':
					store.step()
					break
				case 'F9':
					if (line !== undefined) store.toggleBreakpointLine(title, line)
					break
				case 'F10':
					void store.stepOver()
					break
			}
			event.preventDefault()
			event.stopPropagation()
		}
		window.addEventListener('keydown', handler, true)
		return () => window.removeEventListener('keydown', handler, true)
	}, [isActiveFile, title])

	// Machine words only reach the gutter when at least one column is turned on.
	const showGutter = codeWords.size > 0 && (showAddresses || showCodeBytes || showDisassembly)
	// An address alone says nothing about a word, so the extra rows a
	// pseudo-instruction needs appear only once a column describes them.
	const showWordRows = showGutter && (showCodeBytes || showDisassembly)

	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		if (!editorInstance || !monaco) return

		// Pseudo-instructions put several words on one line; each maps back to it.
		const lineAt = (address: number | null) => {
			if (address === null) return undefined
			const location = sourceIndex.lineForAddress(address)
			return location?.file === title ? location.line : undefined
		}
		const breakpointDecorations: editor.IModelDeltaDecoration[] = [...breakpointLines]
			.map((line) => ({
				range: new monaco.Range(line, 1, line, 1),
				options: {
					glyphMarginClassName: 'breakpoint-glyph',
					isWholeLine: true,
					stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
				},
			}))
		breakpointDecorationIds.current = editorInstance.deltaDecorations(breakpointDecorationIds.current, breakpointDecorations)

		const executionDecorations: editor.IModelDeltaDecoration[] = []
		const currentLine = lineAt(pc)
		// A pseudo-instruction's later words own their own gutter row, which carries
		// the pointer itself; the source line keeps it only when no such row shows.
		const firstAddress = currentLine === undefined ? undefined : sourceIndex.addressesForLine(title, currentLine)[0]
		const onGutterRow = showWordRows && firstAddress !== undefined && firstAddress !== pc
		if (currentLine !== undefined && !onGutterRow) {
			executionDecorations.push({
				range: new monaco.Range(currentLine, 1, currentLine, 1),
				options: {
					className: 'current-execution-line',
					isWholeLine: true,
					linesDecorationsClassName: 'current-execution-arrow',
				},
			})
		}
		executionDecorationIds.current = editorInstance.deltaDecorations(executionDecorationIds.current, executionDecorations)

		// The memory view and the history report the word under the pointer.  The
		// line number lights, which is the only mark there is when the address
		// column is off; the address itself is lit in the gutter pass below.
		const hoverDecorations: editor.IModelDeltaDecoration[] = []
		if (hoveredLine !== undefined) {
			hoverDecorations.push({
				range: new monaco.Range(hoveredLine, 1, hoveredLine, 1),
				options: { lineNumberClassName: 'address-hovered-number', isWholeLine: true },
			})
		}
		// A line another panel navigated to, lit in the navigation colour until it
		// fades.  Whole-line, since it is the line rather than a value in it.
		if (navigatedLine !== null) {
			hoverDecorations.push({
				range: new monaco.Range(navigatedLine, 1, navigatedLine, 1),
				options: { className: 'flash-navigation-line', isWholeLine: true },
			})
		}
		hoverDecorationIds.current = editorInstance.deltaDecorations(hoverDecorationIds.current, hoverDecorations)

		// Every live frame returns somewhere, marked by an arrow in the margin.
		const selectedAddress = selectedFrame === null ? null
			: selectedFrame === -1 ? pc
				: callStack[selectedFrame]?.returnAddress ?? null
		const frameDecorations: editor.IModelDeltaDecoration[] = []
		for (const frame of callStack) {
			const line = lineAt(frame.returnAddress)
			if (line === undefined) continue
			frameDecorations.push({
				range: new monaco.Range(line, 1, line, 1),
				options: {
					linesDecorationsClassName: `return-address-arrow${frame.returnAddress === selectedAddress ? ' selected' : ''}`,
				},
			})
		}
		frameDecorationIds.current = editorInstance.deltaDecorations(frameDecorationIds.current, frameDecorations)

		if (selectedFrame !== revealedFrameRef.current) {
			revealedFrameRef.current = selectedFrame
			const line = lineAt(selectedAddress)
			if (line !== undefined) editorInstance.revealLineInCenterIfOutsideViewport(line)
		}
	}, [breakpointLines, breakpoints, callStack, hoveredLine, navigatedLine, pc, selectedFrame, showWordRows, sourceIndex, title])

	// Assembly diagnostics for this file, as squiggles under the offending text.
	// An empty list clears them, so a fixed line stops being marked as the user types.
	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		const model = editorInstance?.getModel()
		if (!editorInstance || !monaco || !model) return

		const lineCount = model.getLineCount()
		const markers: editor.IMarkerData[] = diagnostics.map((diagnostic) => {
			const line = Math.min(Math.max(diagnostic.line ?? 1, 1), lineCount)
			const lineEnd = model.getLineMaxColumn(line)
			const startColumn = Math.min(Math.max(diagnostic.column ?? 1, 1), lineEnd)
			// Without a column of its own, a diagnostic marks the whole line.
			const endColumn = Math.min(diagnostic.endColumn ?? (diagnostic.column === undefined ? lineEnd : startColumn + 1), lineEnd)
			return {
				severity: diagnostic.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
				message: diagnostic.message,
				source: 'thrax',
				startLineNumber: line,
				startColumn,
				endLineNumber: line,
				endColumn: Math.max(endColumn, startColumn + 1),
			}
		})
		monaco.editor.setModelMarkers(model, 'thrax', markers)
	}, [code, diagnostics])

	// Stepping keeps the instruction about to run inside the middle third of the
	// editor: crossing an edge scrolls by just enough to hold it there, so the
	// next instruction lands where the last one was rather than jumping.
	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		if (!editorInstance || !monaco || revealedPc.current === pc) return
		revealedPc.current = pc

		const location = sourceIndex.lineForAddress(pc)
		if (location?.file !== title) return
		const line = location.line
		// A pseudo-instruction's later words sit in rows of their own below the line.
		const row = showWordRows ? Math.max(0, sourceIndex.addressesForLine(location.file, line).indexOf(pc)) : 0

		const lineHeight = editorInstance.getOption(monaco.editor.EditorOption.lineHeight)
		const { height } = editorInstance.getLayoutInfo()
		const top = editorInstance.getTopForLineNumber(line) + row * lineHeight
		const offset = top - editorInstance.getScrollTop()
		const highest = height / 3
		const lowest = (height * 2) / 3 - lineHeight
		if (offset >= highest && offset <= lowest) return
		editorInstance.setScrollTop(Math.max(0, top - (offset < highest ? highest : lowest)))
	}, [pc, showWordRows, sourceIndex, title])

	// Execution counts, as a heat map over the line numbers and a hover that
	// reports what the profile, the branch predictor and the pipeline model saw
	// at every machine word the line assembled to.
	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		const model = editorInstance?.getModel()
		if (!editorInstance || !monaco || !model) return

		// The profile counts only while the heat map asks for it, and it starts from
		// nothing when it is switched on.  An empty profile therefore means "not
		// measured", which is not the same as "never ran": saying the latter told
		// every line it had never executed whenever the heat map was turned on
		// after a run.
		const counting = (showHeatMap || showHeatLines) && profile.total > 0
		const bhtEntryFor = new Map(branchHistory.entries.flatMap((entry) => entry.addresses.map((address) => [address, entry] as const)))
		const lineCount = model.getLineCount()
		const decorations: editor.IModelDeltaDecoration[] = []

		for (const [line, words] of codeWords) {
			if (line > lineCount) continue
			// Data holds no instructions, so only code words carry a profile.
			const instructions = words.filter((word) => word.word !== null)
			if (instructions.length === 0) continue
			const count = instructions.reduce((total, word) => total + (profile.byAddress.get(word.address)?.count ?? 0), 0)
			const level = heatLevel(count, profile.max)
			const hover: string[] = []

			for (const word of instructions) {
				const entry = profile.byAddress.get(word.address)
				const text = word.word === null ? '' : disassemble(word.word, word.address) ?? ''
				hover.push(`**${formatAddress(word.address)}**${text ? `  \`${text}\`` : ''}`)
				// Nothing is counting unless the heat map asked for it, and a count
				// nobody took is not a count of zero.
				if (!counting) continue
				if (!entry || entry.count === 0) {
					hover.push('- Never executed')
					continue
				}
				const share = profile.total === 0 ? 0 : (entry.count / profile.total) * 100
				hover.push(`- Executed **${entry.count.toLocaleString()}** times (${share.toFixed(1)}% of ${profile.total.toLocaleString()})`)

				const branches = entry.taken + entry.notTaken
				if (branches > 0) {
					hover.push(`- Branch taken ${entry.taken.toLocaleString()}, not taken ${entry.notTaken.toLocaleString()} (${((entry.taken / branches) * 100).toFixed(1)}% taken)`)
					const bht = bhtEntryFor.get(word.address)
					if (bht && bht.predictions > 0) {
						const aliases = bht.addresses.length - 1
						hover.push(`- BHT entry ${bht.index} predicts ${bht.predictTaken ? 'taken' : 'not taken'}: ${bht.correct.toLocaleString()}/${bht.predictions.toLocaleString()} correct${aliases > 0 ? ` (shared with ${aliases} other branch${aliases > 1 ? 'es' : ''})` : ''}`)
					}
				}

				const stats = pipeline.byAddress.get(word.address)
				if (stats) {
					const costs: string[] = []
					if (stats.stalls > 0) costs.push(`${stats.stalls.toLocaleString()} stall cycles${stats.loadUseStalls > 0 ? ` (${stats.loadUseStalls.toLocaleString()} load-use)` : ''}`)
					if (stats.flushed > 0) costs.push(`${stats.flushed.toLocaleString()} cycles refilling after the instruction before`)
					if (stats.branches > 0) costs.push(`${stats.mispredictions.toLocaleString()}/${stats.branches.toLocaleString()} mispredicted`)
					if (costs.length > 0) hover.push(`- Pipeline: ${costs.join(', ')}`)
				}
			}

			decorations.push({
				range: new monaco.Range(line, 1, line, 1),
				options: {
					isWholeLine: true,
					...(showHeatMap && level >= 0 ? {
						lineNumberClassName: `heat-number heat-level-${level}`,
						...(showHeatLines ? { className: `heat-line-${level}` } : {}),
					} : {}),
					lineNumberHoverMessage: { value: hover.join('\n') },
					stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
				},
			})
		}

		profileDecorationIds.current = editorInstance.deltaDecorations(profileDecorationIds.current, decorations)
	}, [branchHistory, code, codeWords, pipeline, profile, showHeatLines, showHeatMap])

	// Once the source assembles, the gutter columns sit between the line numbers
	// and the source, one row per machine word.
	const gutterText = React.useMemo(() => {
		const rows = [...codeWords.values()].flat()
		const assembly = new Map<number, string>()
		rows.forEach((row, index) => {
			assembly.set(row.address, row.word === null ? disassembleData(row, rows[index + 1]) : disassemble(row.word, row.address) ?? '')
		})
		// One width per column keeps the source aligned down the whole file.
		const codeWidth = Math.max(0, ...rows.map((row) => formatCodeWord(row).length))
		const assemblyWidth = Math.max(0, ...[...assembly.values()].map((text) => text.length))
		// Three parts rather than one string, so the disassembly is a span of its own
		// and a pointer over it can be told which character it is on.
		const restParts = (entry?: CodeWord) => {
			const code = showCodeBytes ? (entry ? formatCodeWord(entry) : '').padEnd(codeWidth) : ''
			const asm = showDisassembly ? (entry ? assembly.get(entry.address) ?? '' : '').padEnd(assemblyWidth) : ''
			// The gutter's own gap, plus the address column's width when this line
			// has no address to fill it, so the source stays aligned either way.
			const lead = !showAddresses ? '' : (entry ? '' : ' '.repeat(ADDRESS_COLUMNS)) + COLUMN_GAP
			return gutterParts(lead, code, asm)
		}
		return { restParts }
	}, [codeWords, showAddresses, showCodeBytes, showDisassembly])

	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		const model = editorInstance?.getModel()
		if (!editorInstance || !monaco || !model) return
		const { restParts } = gutterText

		const lineCount = model.getLineCount()
		const decorations: editor.IModelDeltaDecoration[] = []
		for (let line = 1; showGutter && line <= lineCount; line += 1) {
			const words = codeWords.get(line)
			const current = words?.[0].address === pc
			const addressClass = gutterAddressClass(words?.[0].address, pc) + (line === hoveredLine ? ' address-hovered' : '')
			const runs = showAddresses && words !== undefined ? addressRuns(words[0].address, hexDimming) : []
			const parts = restParts(words?.[0])
			const wordClass = current ? 'code-word code-word-current' : 'code-word'
			// Every `before` is injected ahead of every `after`, and injections that
			// tie are laid down in the order they are given, so the runs of one
			// address stay in order and the rest of the gutter follows them.
			decorations.push({
				range: new monaco.Range(line, 1, line, 1),
				options: {
					// Lines without code keep the columns blank so the source stays aligned.
					before: { content: runs[0]?.text ?? '', inlineClassName: `${addressClass}${runs[0]?.dim ? ' hex-zero' : ''}` },
					after: { content: parts.pre, inlineClassName: wordClass },
					// Monaco drops injected text on an empty range without this.
					showIfCollapsed: true,
					stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
				},
			})
			for (const run of runs.slice(1)) {
				decorations.push({
					range: new monaco.Range(line, 1, line, 1),
					options: {
						before: { content: run.text, inlineClassName: `${addressClass}${run.dim ? ' hex-zero' : ''}` },
						showIfCollapsed: true,
						stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
					},
				})
			}
			// Every `after` is laid down in the order it is given, so these follow
			// the one above and the gutter reads pre, disassembly, gap.
			for (const part of [
				{ content: parts.asm, className: `${wordClass} code-word-asm` },
				{ content: parts.tail, className: wordClass },
			]) {
				if (part.content.length === 0) continue
				decorations.push({
					range: new monaco.Range(line, 1, line, 1),
					options: {
						after: { content: part.content, inlineClassName: part.className },
						showIfCollapsed: true,
						stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
					},
				})
			}
		}
		codeWordDecorationIds.current = editorInstance.deltaDecorations(codeWordDecorationIds.current, decorations)
		// The hovered line, not the hovered address: every address that is not on a
		// line of this file leaves this alone rather than redrawing the whole file.
	}, [code, gutterText, hexDimming, hoveredLine, pc, showAddresses, showGutter])

	// The rows of a view zone, for words the source has no line for.  Rebuilding
	// these throws away the DOM the pointer is over, so a hover must never be a
	// reason to run this: the class is toggled in place below instead.
	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		const model = editorInstance?.getModel()
		if (!editorInstance || !monaco || !model) return
		const { restParts } = gutterText
		const lineCount = model.getLineCount()

		const lineHeight = editorInstance.getOption(monaco.editor.EditorOption.lineHeight)
		const fontInfo = editorInstance.getOption(monaco.editor.EditorOption.fontInfo)
		const layout = editorInstance.getLayoutInfo()
		const zoneAddresses: { address: number, node: HTMLElement }[] = []
		editorInstance.changeViewZones((accessor) => {
			for (const id of codeWordZoneIds.current) accessor.removeZone(id)
			codeWordZoneIds.current = []
			if (!showWordRows) return
			for (const [line, words] of codeWords) {
				if (words.length < 2 || line > lineCount) continue
				const domNode = document.createElement('div')
				domNode.className = 'code-word-zone'
				domNode.style.fontFamily = fontInfo.fontFamily
				domNode.style.fontSize = `${fontInfo.fontSize}px`
				// These words have no source line, so the zone brings its own margin:
				// a breakpoint spot and, when the pc is here, the execution pointer.
				const marginDomNode = document.createElement('div')
				marginDomNode.className = 'code-word-zone-margin'
				for (const entry of words.slice(1)) {
					const row = document.createElement('div')
					row.className = entry.address === pc ? 'code-word code-word-row-current' : 'code-word'
					row.style.height = `${lineHeight}px`
					row.style.lineHeight = `${lineHeight}px`
					const rowAddress = document.createElement('span')
					rowAddress.className = gutterAddressClass(entry.address, pc)
					if (entry.address === hoveredAddressRef.current) rowAddress.classList.add('address-hovered')
					zoneAddresses.push({ address: entry.address, node: rowAddress })
					// The address column can be off, in which case a word row has no
					// address either: the gutter's own gap belongs to the column, so
					// drawing one anyway runs it straight into the bytes.
					for (const run of showAddresses ? addressRuns(entry.address, hexDimming) : []) {
						const part = document.createElement('span')
						if (run.dim) part.className = 'hex-zero'
						part.textContent = run.text
						rowAddress.append(part)
					}
					rowAddress.title = `Show ${formatWord(entry.address)} in memory`
					rowAddress.addEventListener('mousedown', (event) => {
						event.preventDefault()
						event.stopPropagation()
						focusMemoryAddressRef.current(entry.address)
					})
					rowAddress.addEventListener('mouseenter', () => hoverRef.current({ address: entry.address }))
					rowAddress.addEventListener('mouseleave', () => hoverRef.current({ address: null }))
					const parts = restParts(entry)
					const asmSpan = document.createElement('span')
					asmSpan.className = 'code-word-asm'
					asmSpan.textContent = parts.asm
					row.append(rowAddress, document.createTextNode(parts.pre), asmSpan, document.createTextNode(parts.tail))
					domNode.append(row)

					const marginRow = document.createElement('div')
					marginRow.className = 'code-word-margin-row'
					marginRow.style.height = `${lineHeight}px`
					marginDomNode.append(marginRow)
					// Data never executes, so only code rows take a breakpoint.
					if (entry.word === null) continue
					const glyph = document.createElement('div')
					glyph.className = breakpoints.has(entry.address) ? 'code-word-breakpoint active' : 'code-word-breakpoint'
					glyph.style.left = `${layout.glyphMarginLeft}px`
					glyph.style.width = `${layout.glyphMarginWidth}px`
					glyph.title = `Toggle breakpoint at ${formatWord(entry.address)}`
					glyph.addEventListener('mousedown', (event) => {
						event.preventDefault()
						event.stopPropagation()
						toggleBreakpointAddressRef.current(entry.address)
					})
					marginRow.append(glyph)
					if (entry.address === pc) {
						const arrow = document.createElement('div')
						arrow.className = 'current-execution-arrow code-word-arrow'
						arrow.style.left = `${layout.decorationsLeft}px`
						marginRow.append(arrow)
					}
				}
				codeWordZoneIds.current.push(accessor.addZone({ afterLineNumber: line, heightInLines: words.length - 1, domNode, marginDomNode }))
			}
		})
		zoneAddressNodes.current = zoneAddresses
	}, [breakpoints, code, gutterText, hexDimming, pc, showAddresses, showWordRows])

	// Lights the zone row for the address under the pointer, wherever it is being
	// pointed at, without touching the rows themselves.
	React.useEffect(() => {
		for (const { address, node } of zoneAddressNodes.current) {
			node.classList.toggle('address-hovered', address === hovered.address)
		}
	}, [hovered.address])

	return (
		<div className="source-pane">
			<div className="source-editor">
				<Editor
					height="100%"
					defaultLanguage="mips"
					value={code}
					onChange={(value) => setDocumentCode(documentId, value ?? '')}
					theme="vs-dark"
					options={{
						minimap: { enabled: false },
						glyphMargin: true,
						fontSize: 14,
						lineNumbers: 'on',
						lineNumbersMinChars: 2,
						scrollBeyondLastLine: false,
						automaticLayout: true,
					}}
					onMount={handleEditorMount}
				/>
			</div>
			{assemblyTip && editorNode && createPortal(
				// Drawn inside the editor, wearing Monaco's own hover classes, so it
				// is the same widget the source shows: same border, same colours,
				// same font, and they cannot drift apart.
				<div
					className="monaco-hover assembly-tooltip"
					role="tooltip"
					style={{ left: assemblyTip.left, top: assemblyTip.top, transform: assemblyTip.above ? 'translateY(-100%)' : undefined }}
				>
					<div className="monaco-hover-content">
						<div className="hover-row markdown-hover">
							<div className="hover-contents">
								{assemblyTip.paragraphs.map((paragraph, index) => (
									<p key={index}>
										{tipRuns(paragraph).map((run, runIndex) => (
											run.kind === 'strong' ? <strong key={runIndex}>{run.text}</strong>
												: run.kind === 'code' ? <code key={runIndex}>{run.text}</code>
													: <React.Fragment key={runIndex}>{run.text}</React.Fragment>
										))}
									</p>
								))}
							</div>
						</div>
					</div>
				</div>,
				editorNode,
			)}
		</div>
	)
}

export default SourcePane
