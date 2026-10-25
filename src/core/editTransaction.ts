export interface EditTransaction {
	begin(): void
	commit(): void
	/** Close any open capture, restore native state and discard the failed edit. */
	rollback(): void
	changed?(): void
}

/** One reversible debugger action. Capture and invalidation remain backend operations. */
export function editTransaction(change: () => void, transaction: EditTransaction): true {
	transaction.begin()
	try {
		change()
		transaction.commit()
	} catch (error) {
		transaction.rollback()
		throw error
	}
	transaction.changed?.()
	return true
}

/** Native backends retain their codecs and share only failed-edit cleanup. */
export function capturedHistoryEdit(change: () => void, capture: {
	begin(): void
	close(): void
	undo(): unknown
	branch(): unknown
}): true {
	return editTransaction(change, {
		begin: () => capture.begin(),
		commit: () => capture.close(),
		rollback: () => {
			capture.close()
			capture.undo()
			capture.branch()
		},
	})
}

/** Sparse-delta codecs share close/undo/discard policy as well as edit lifetime. */
export function deltaHistoryEdit(change: () => void, history: {
	end(): boolean
	stepBack(): boolean
	readonly timeline: { branch(): boolean }
} | null, begin: () => void): true {
	return editTransaction(change, {
		begin,
		commit: () => { history?.end() },
		rollback: () => {
			if (history?.end()) {
				history.stepBack()
				history.timeline.branch()
			}
		},
	})
}
