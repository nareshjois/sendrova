import { errorResponse, json } from "./errors";
import { handleDeviceHealth } from "./routes/device";
import {
	handleCreateJob,
	handleGetJob,
	handlePendingJobs,
	handleUpdateJobStatus,
} from "./routes/jobs";
import {
	handlePairComplete,
	handlePairStart,
	handlePairStatus,
	handleUnpair,
} from "./routes/pair";
import type { Env } from "./types";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			if (!env.TOKEN_SIGNING_KEY) {
				return json(
					{ error: { code: "INTERNAL", message: "TOKEN_SIGNING_KEY not configured" } },
					500,
				);
			}
			return await route(request, env);
		} catch (err) {
			return errorResponse(err);
		}
	},
};

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/+$/, "") || "/";
	const method = request.method.toUpperCase();

	if (method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: corsHeaders(),
		});
	}

	let response: Response;

	if (method === "GET" && path === "/health") {
		response = json({ ok: true });
	} else if (method === "POST" && path === "/v1/pair/start") {
		response = await handlePairStart(env, request);
	} else if (method === "POST" && path === "/v1/pair/complete") {
		response = await handlePairComplete(env, request);
	} else if (method === "GET" && path === "/v1/pair/status") {
		response = await handlePairStatus(env, request);
	} else if (method === "POST" && path === "/v1/pair/unpair") {
		response = await handleUnpair(env, request);
	} else if (method === "POST" && path === "/v1/jobs") {
		response = await handleCreateJob(env, request);
	} else if (method === "GET" && path === "/v1/jobs/pending") {
		response = await handlePendingJobs(env, request);
	} else if (method === "POST" && /^\/v1\/jobs\/[^/]+\/status$/.test(path)) {
		const jobId = path.split("/")[3]!;
		response = await handleUpdateJobStatus(env, request, decodeURIComponent(jobId));
	} else if (method === "GET" && /^\/v1\/jobs\/[^/]+$/.test(path)) {
		const jobId = path.split("/")[3]!;
		response = await handleGetJob(env, request, decodeURIComponent(jobId));
	} else if (method === "GET" && path === "/v1/device/health") {
		response = await handleDeviceHealth(env, request);
	} else {
		response = json(
			{ error: { code: "NOT_FOUND", message: "Route not found" } },
			404,
		);
	}

	const headers = new Headers(response.headers);
	for (const [k, v] of Object.entries(corsHeaders())) {
		headers.set(k, v);
	}
	return new Response(response.body, {
		status: response.status,
		headers,
	});
}

function corsHeaders(): Record<string, string> {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "Authorization, Content-Type",
	};
}
