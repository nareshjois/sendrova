/**
 * Normalize destination to E.164 (+digits) or digits-only.
 * Strips spaces, dashes, parentheses; rejects empty / non-digit junk.
 */
export function normalizeTo(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const hasPlus = trimmed.startsWith("+");
	const digits = trimmed.replace(/[^\d]/g, "");
	if (!digits) return null;
	if (digits.length < 7 || digits.length > 15) return null;

	return hasPlus ? `+${digits}` : digits;
}
