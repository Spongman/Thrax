/**
 * A symbol table whose writes stay local while reads fall through to the
 * enclosing scope.  An undefined value is stored deliberately: it shadows the
 * parent, as a forward reference does during layout.
 */
export class SymbolScope {
	private readonly values = new Map<string, number | undefined>()

	constructor(readonly parent: SymbolScope | null = null) {}

	lookup(name: string): number | undefined {
		if (this.values.has(name)) return this.values.get(name)
		return this.parent?.lookup(name)
	}

	/** This scope's own value, ignoring enclosing scopes. */
	own(name: string): number | undefined {
		return this.values.get(name)
	}

	assign(name: string, value: number | undefined) {
		this.values.set(name, value)
	}

	entries(): IterableIterator<[string, number | undefined]> {
		return this.values.entries()
	}
}
