/**
 * Ctrl+click on a name jumps to where it is defined.
 *
 * The definition is found in the source text, not the symbol table, so it
 * works while the program does not assemble and for names no table holds
 * (`.eqv`, `.macro`).  A definition in another file is handed to the editor
 * opener, which brings that file forward through the store rather than
 * opening a second editor; Monaco moves within a file itself.
 */

import type * as Monaco from 'monaco-editor'
import type { WorkspaceFile } from './workspace'

export interface Definition {
	file: string
	line: number
	column: number
	/** Column just past the name, for the range Monaco underlines. */
	endColumn: number
}

/** What a label or symbol may be spelled with. */
const NAME = /[A-Za-z_.$][\w.$]*/g

/** The name under `column` (1-based) on `text`, or null when there is none. */
export function symbolAt(text: string, column: number): string | null {
	for (const match of text.matchAll(NAME)) {
		const start = match.index + 1
		const end = start + match[0].length
		// A click lands on a character, so the column just past the name is not it.
		if (column >= start && column < end) return match[0]
	}
	return null
}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Where `name` is defined: a label (`name:`), or the name given to `.eqv`,
 * `.macro` or `.extern`.  Files are searched in order, so the file the
 * reference is in comes first when the caller puts it first.
 */
export function findDefinition(files: readonly WorkspaceFile[], name: string): Definition | null {
	if (name.startsWith('$')) return null
	const escaped = escape(name)
	const label = new RegExp(`^\\s*(${escaped})\\s*:`)
	const directive = new RegExp(`^\\s*(?:\\S.*?)?\\.(?:eqv|macro|extern)\\s+(${escaped})(?![\\w.$])`, 'i')
	for (const file of files) {
		const lines = file.code.split('\n')
		for (let index = 0; index < lines.length; index++) {
			const line = stripComment(lines[index])
			const match = label.exec(line) ?? directive.exec(line)
			if (!match) continue
			const column = match.index + match[0].indexOf(match[1]) + 1
			return { file: file.title, line: index + 1, column, endColumn: column + name.length }
		}
	}
	return null
}

function stripComment(line: string): string {
	const hash = line.indexOf('#')
	return hash < 0 ? line : line.slice(0, hash)
}

/** The URI a definition in another file is opened through. */
export const DEFINITION_SCHEME = 'thrax-source'

export function definitionUri(monaco: typeof Monaco, file: string): Monaco.Uri {
	return monaco.Uri.from({ scheme: DEFINITION_SCHEME, path: `/${file}` })
}

export interface GotoDefinitionSources {
	/** Every project file. */
	files: () => readonly WorkspaceFile[]
	/** Title of the file in front, which breaks a tie between files that read the same. */
	active: () => string | undefined
	/** Brings a file forward at a line. */
	open: (file: string, line: number) => void
}

export function registerGotoDefinition(monaco: typeof Monaco, sources: GotoDefinitionSources): void {
	monaco.languages.registerDefinitionProvider('mips', {
		provideDefinition(model, position) {
			const name = symbolAt(model.getLineContent(position.lineNumber), position.column)
			if (!name) return null
			// The model's own text says which file it is; a match there stays in
			// this editor.  Two files can read the same (two new ones, say), and
			// then the one in front is taken to be this one.
			const text = model.getValue()
			const files = sources.files()
			const active = sources.active()
			const same = files.filter((file) => file.code === text)
			const own = same.find((file) => file.title === active) ?? same[0]
			const ordered = own ? [own, ...files.filter((file) => file !== own)] : files
			const found = findDefinition(ordered, name)
			if (!found) return null
			// The definition itself is not a link to anywhere.
			if (own && found.file === own.title && found.line === position.lineNumber && position.column >= found.column && position.column < found.endColumn) return null
			const range = new monaco.Range(found.line, found.column, found.line, found.endColumn)
			const target = found.file === own?.title ? model : modelFor(monaco, files.find((file) => file.title === found.file)!)
			return { uri: target.uri, range }
		},
	})

	// Monaco asks the opener for any model that is not the one in front of it.
	monaco.editor.registerEditorOpener({
		openCodeEditor(source, resource, selectionOrPosition) {
			// Within the file in front, Monaco moves the cursor itself.
			if (source.getModel()?.uri.toString() === resource.toString()) return false
			const target = monaco.editor.getModel(resource)
			if (!target) return false
			const title = resource.scheme === DEFINITION_SCHEME
				? resource.path.slice(1)
				: sources.files().find((file) => file.code === target.getValue())?.title
			if (title === undefined) return false
			const line = selectionOrPosition
				? 'startLineNumber' in selectionOrPosition ? selectionOrPosition.startLineNumber : selectionOrPosition.lineNumber
				: 1
			sources.open(title, line)
			// A stand-in made for a file with no editor has done its job.
			if (resource.scheme === DEFINITION_SCHEME) target.dispose()
			return true
		},
	})
}

/**
 * The model holding `file`: the editor's own when the file has a tab, or a
 * stand-in under the definition URI when it does not.  Monaco resolves the
 * model behind a location before it asks anyone to open it, so a location has
 * to name a model that exists.
 */
function modelFor(monaco: typeof Monaco, file: WorkspaceFile): Monaco.editor.ITextModel {
	const uri = definitionUri(monaco, file.title)
	const existing = monaco.editor.getModels().find((model) => model.uri.scheme !== DEFINITION_SCHEME && model.getValue() === file.code)
	if (existing) return existing
	const standIn = monaco.editor.getModel(uri)
	if (standIn) {
		standIn.setValue(file.code)
		return standIn
	}
	return monaco.editor.createModel(file.code, 'mips', uri)
}
