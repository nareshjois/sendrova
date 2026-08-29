import { rmSync } from "node:fs";

/** Remove a temp data dir; ignore Windows EBUSY on sqlite sidecar files. */
export function safeRmSync(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	} catch (err) {
		const code =
			err && typeof err === "object" && "code" in err
				? String((err as { code?: unknown }).code)
				: "";
		if (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY") {
			return;
		}
		throw err;
	}
}
