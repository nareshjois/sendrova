const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;

const BUILTIN_ALIASES = new Set(["phone", "phone_raw"]);

/** Unique `{{name}}` placeholders in declaration order */
export function extractPlaceholders(template: string): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const match of template.matchAll(PLACEHOLDER_RE)) {
		const name = match[1];
		if (!name || seen.has(name)) continue;
		seen.add(name);
		names.push(name);
	}
	return names;
}

/** Replace `{{key}}` with fields[key]; missing keys become empty string */
export function renderTemplate(
	template: string,
	fields: Record<string, string>,
): string {
	return template.replace(PLACEHOLDER_RE, (_full, key: string) => {
		return fields[key] ?? "";
	});
}

/**
 * Validate that every placeholder maps to a CSV column or a built-in alias
 * (`phone`, `phone_raw`).
 */
export function validateTemplate(
	template: string,
	columns: string[],
): { ok: boolean; unknown: string[]; known: string[] } {
	const columnSet = new Set(columns);
	const known: string[] = [];
	const unknown: string[] = [];

	for (const name of extractPlaceholders(template)) {
		if (BUILTIN_ALIASES.has(name) || columnSet.has(name)) {
			known.push(name);
		} else {
			unknown.push(name);
		}
	}

	return { ok: unknown.length === 0, unknown, known };
}
