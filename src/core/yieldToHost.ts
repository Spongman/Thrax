/**
 * Resolves after the host has had a turn: a message task, so the page can paint
 * and take input. Awaiting a resolved promise only lets microtasks run, and
 * setTimeout(0) is clamped to 4 ms once nested.
 */
export function yieldToHost(): Promise<void> {
	return new Promise((resolve) => {
		const { port1, port2 } = new MessageChannel()
		port1.onmessage = () => {
			port1.close()
			resolve()
		}
		port2.postMessage(null)
	})
}
