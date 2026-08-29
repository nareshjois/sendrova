import { describe, expect, test } from "bun:test";
import { normalizePhone, parseCsv, parseTxt } from "./parse-import";
import { renderTemplate, validateTemplate } from "./template";

describe("normalizePhone", () => {
	test("strips + and formatting", () => {
		expect(normalizePhone("+91 98765-43210")).toBe("919876543210");
	});

	test("prepends 91 for 10-digit mobiles", () => {
		expect(normalizePhone("9876543210")).toBe("919876543210");
	});

	test("strips leading 0 trunk prefix then adds 91", () => {
		expect(normalizePhone("09876543210")).toBe("919876543210");
		expect(normalizePhone("00919876543210")).toBe("919876543210");
	});

	test("keeps already-normalized 91 numbers", () => {
		expect(normalizePhone("919876543210")).toBe("919876543210");
	});

	test("rejects short numbers", () => {
		expect(normalizePhone("12345")).toBeNull();
		expect(normalizePhone("012345")).toBeNull();
	});
});

describe("parseTxt", () => {
	test("parses one phone per line", () => {
		const result = parseTxt("919876543210\n918765432109\n");
		expect(result.rows.filter((r) => r.valid)).toHaveLength(2);
		expect(result.invalidCount).toBe(0);
	});

	test("marks duplicates", () => {
		const result = parseTxt("919876543210\n919876543210\n");
		expect(result.duplicateCount).toBe(1);
	});
});

describe("parseCsv", () => {
	test("detects phone column and fields", () => {
		const result = parseCsv(
			"phone,name,city\n919876543210,Asha,Jaipur\n918765432109,Ravi,Udaipur\n",
		);
		expect(result.phoneColumn).toBe("phone");
		expect(result.columns).toContain("name");
		const valid = result.rows.filter((r) => r.valid);
		expect(valid).toHaveLength(2);
		expect(valid[0]?.fields.name).toBe("Asha");
		expect(valid[0]?.fields.phone).toBe("919876543210");
	});
});

describe("templates", () => {
	test("renders placeholders", () => {
		expect(
			renderTemplate("Hi {{name}} from {{city}}", {
				name: "Asha",
				city: "Jaipur",
			}),
		).toBe("Hi Asha from Jaipur");
	});

	test("validates unknown placeholders", () => {
		const result = validateTemplate("Hi {{name}} {{missing}}", ["name"]);
		expect(result.ok).toBe(false);
		expect(result.unknown).toEqual(["missing"]);
	});

	test("allows phone builtins", () => {
		const result = validateTemplate("Call {{phone}}", []);
		expect(result.ok).toBe(true);
	});
});
