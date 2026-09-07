/** Hands the browser a file to save, under the given name. */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	link.style.display = 'none'
	document.body.append(link)
	link.click()
	link.remove()
	window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadText(text: string, filename: string): void {
	downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename)
}
