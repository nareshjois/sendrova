export type ImportRow = {
	phone: string;
	phoneRaw: string;
	fields: Record<string, string>;
	valid: boolean;
	error?: string;
};

export type ImportResult = {
	rows: ImportRow[];
	columns: string[];
	phoneColumn: string | null;
	invalidCount: number;
	duplicateCount: number;
};

const PHONE_HEADER_RE = /^(phone|mobile|whatsapp|number)$/i;

/**
 * Normalize to digits for WhatsApp JIDs (India-focused):
 * - strips non-digits (so `+` is dropped)
 * - strips leading `0` trunk/international prefixes
 * - prepends `91` when exactly 10 digits remain
 */
export function normalizePhone(raw: string): string | null {
	let digits = raw.replace(/\D/g, "");
	digits = digits.replace(/^0+/, "");
	if (digits.length === 10) {
		digits = `91${digits}`;
	}
	if (digits.length < 10 || digits.length > 15) return null;
	return digits;
}

function emptyResult(): ImportResult {
	return {
		rows: [],
		columns: [],
		phoneColumn: null,
		invalidCount: 0,
		duplicateCount: 0,
	};
}

function finalizeRows(rows: ImportRow[]): Pick<
	ImportResult,
	"rows" | "invalidCount" | "duplicateCount"
> {
	const seen = new Set<string>();
	let invalidCount = 0;
	let duplicateCount = 0;

	const out = rows.map((row) => {
		if (!row.valid) {
			invalidCount += 1;
			return row;
		}
		if (seen.has(row.phone)) {
			duplicateCount += 1;
			invalidCount += 1;
			return {
				...row,
				valid: false,
				error: "duplicate",
			};
		}
		seen.add(row.phone);
		return row;
	});

	return { rows: out, invalidCount, duplicateCount };
}

function buildFields(
	base: Record<string, string>,
	phone: string,
	phoneRaw: string,
): Record<string, string> {
	return {
		...base,
		phone,
		phone_raw: phoneRaw,
	};
}

/** One phone number per non-empty line */
export function parseTxt(text: string): ImportResult {
	const lines = text.split(/\r?\n/);
	const rawRows: ImportRow[] = [];

	for (const line of lines) {
		const phoneRaw = line.trim();
		if (!phoneRaw) continue;

		const phone = normalizePhone(phoneRaw);
		if (!phone) {
			rawRows.push({
				phone: "",
				phoneRaw,
				fields: buildFields({}, "", phoneRaw),
				valid: false,
				error: "invalid phone",
			});
			continue;
		}

		rawRows.push({
			phone,
			phoneRaw,
			fields: buildFields({}, phone, phoneRaw),
			valid: true,
		});
	}

	const { rows, invalidCount, duplicateCount } = finalizeRows(rawRows);
	return {
		rows,
		columns: ["phone"],
		phoneColumn: "phone",
		invalidCount,
		duplicateCount,
	};
}

/** Minimal RFC4180-ish CSV split for a single line */
function splitCsvLine(line: string): string[] {
	const cells: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i]!;
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i += 1;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
			continue;
		}

		if (ch === '"') {
			inQuotes = true;
		} else if (ch === ",") {
			cells.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	cells.push(current);
	return cells.map((c) => c.trim());
}

function parseCsvLines(text: string): string[][] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
	return lines.map(splitCsvLine);
}

function looksLikePhoneColumn(values: string[]): boolean {
	const nonEmpty = values.filter((v) => v.trim().length > 0);
	if (nonEmpty.length === 0) return false;
	let ok = 0;
	for (const v of nonEmpty) {
		if (normalizePhone(v)) ok += 1;
	}
	return ok / nonEmpty.length >= 0.5;
}

function detectPhoneColumn(
	headers: string[],
	dataRows: string[][],
): string | null {
	for (const header of headers) {
		if (PHONE_HEADER_RE.test(header)) return header;
	}

	for (let col = 0; col < headers.length; col++) {
		const values = dataRows.map((r) => r[col] ?? "");
		if (looksLikePhoneColumn(values)) {
			return headers[col] ?? null;
		}
	}

	return null;
}

/** Header-required CSV; detect phone column; dedupe by normalized phone */
export function parseCsv(text: string): ImportResult {
	const table = parseCsvLines(text);
	if (table.length === 0) return emptyResult();

	const headers = table[0]!;
	if (headers.length === 0 || headers.every((h) => !h)) {
		return emptyResult();
	}

	const dataRows = table.slice(1);
	const phoneColumn = detectPhoneColumn(headers, dataRows);
	const phoneColIndex = phoneColumn ? headers.indexOf(phoneColumn) : -1;

	const rawRows: ImportRow[] = [];

	for (const cells of dataRows) {
		const base: Record<string, string> = {};
		for (let i = 0; i < headers.length; i++) {
			const key = headers[i]!;
			base[key] = cells[i] ?? "";
		}

		const phoneRaw =
			phoneColIndex >= 0 ? (cells[phoneColIndex] ?? "").trim() : "";

		if (!phoneColumn || phoneColIndex < 0) {
			rawRows.push({
				phone: "",
				phoneRaw,
				fields: buildFields(base, "", phoneRaw),
				valid: false,
				error: "no phone column",
			});
			continue;
		}

		if (!phoneRaw) {
			rawRows.push({
				phone: "",
				phoneRaw,
				fields: buildFields(base, "", phoneRaw),
				valid: false,
				error: "empty phone",
			});
			continue;
		}

		const phone = normalizePhone(phoneRaw);
		if (!phone) {
			rawRows.push({
				phone: "",
				phoneRaw,
				fields: buildFields(base, "", phoneRaw),
				valid: false,
				error: "invalid phone",
			});
			continue;
		}

		rawRows.push({
			phone,
			phoneRaw,
			fields: buildFields(base, phone, phoneRaw),
			valid: true,
		});
	}

	const { rows, invalidCount, duplicateCount } = finalizeRows(rawRows);
	return {
		rows,
		columns: headers,
		phoneColumn,
		invalidCount,
		duplicateCount,
	};
}
