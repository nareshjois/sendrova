export type ErrorCode =
	| "VALIDATION_ERROR"
	| "UNAUTHORIZED"
	| "NOT_FOUND"
	| "CONFLICT"
	| "PAIR_EXPIRED"
	| "PAIR_REDEEMED"
	| "INVALID_SECRET"
	| "NO_DEVICE"
	| "JOB_TERMINAL"
	| "IDEMPOTENCY_CONFLICT"
	| "RATE_LIMITED"
	| "INTERNAL";

export class ApiError extends Error {
	readonly status: number;
	readonly code: ErrorCode;

	constructor(status: number, code: ErrorCode, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
	}
}

export function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
		},
	});
}

export function errorResponse(err: unknown): Response {
	if (err instanceof ApiError) {
		return json({ error: { code: err.code, message: err.message } }, err.status);
	}
	console.error("unhandled", err);
	return json(
		{ error: { code: "INTERNAL", message: "Internal server error" } },
		500,
	);
}
