// FREE AI API HUB — API errors (OpenAI-shaped).
// Original code for this project.

export type ApiErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "rate_limit_error"
  | "not_found_error"
  | "server_error"
  | "exhausted_error";

export interface AttemptInfo {
  provider: string;
  model: string;
  error: string;
}

/** An error that maps directly onto an OpenAI-shaped HTTP error response. */
export class ApiError extends Error {
  readonly status: number;
  readonly type: ApiErrorType;
  readonly code?: string;
  readonly attempts?: AttemptInfo[];
  /** True when the caller may retry with another candidate. */
  readonly retryable: boolean;

  constructor(
    status: number,
    type: ApiErrorType,
    message: string,
    opts: { code?: string; retryable?: boolean; attempts?: AttemptInfo[] } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.attempts = opts.attempts;
  }
}

export function invalidRequest(message: string, code?: string): ApiError {
  return new ApiError(400, "invalid_request_error", message, { code });
}

export function unauthorized(message = "Invalid API key"): ApiError {
  return new ApiError(401, "authentication_error", message);
}

export function forbidden(message: string): ApiError {
  return new ApiError(403, "authentication_error", message);
}

export function notFound(message: string): ApiError {
  return new ApiError(404, "not_found_error", message);
}

export function rateLimited(message: string, retryAfterSeconds?: number): ApiError {
  const err = new ApiError(429, "rate_limit_error", message, {
    retryable: true,
    code: "rate_limit_exceeded",
  });
  (err as unknown as { retryAfterSeconds?: number }).retryAfterSeconds =
    retryAfterSeconds;
  return err;
}

export function upstreamError(
  status: number,
  message: string,
  opts: { retryable?: boolean; code?: string } = {},
): ApiError {
  const type: ApiErrorType =
    status === 429
      ? "rate_limit_error"
      : status >= 500
        ? "server_error"
        : status === 401 || status === 403
          ? "authentication_error"
          : "invalid_request_error";
  return new ApiError(status, type, message, {
    code: opts.code,
    retryable: opts.retryable ?? (status === 429 || status >= 500),
  });
}

export function exhausted(attempts: AttemptInfo[]): ApiError {
  const summary = attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join("; ");
  return new ApiError(
    502,
    "exhausted_error",
    `All fallback candidates failed (${attempts.length} attempts): ${summary}`,
    { code: "all_candidates_failed", attempts },
  );
}

export function toErrorResponse(err: ApiError): Response {
  const body: Record<string, unknown> = {
    error: {
      message: err.message,
      type: err.type,
      ...(err.code ? { code: err.code } : {}),
      ...(err.attempts ? { attempts: err.attempts } : {}),
    },
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  const retryAfter = (err as unknown as { retryAfterSeconds?: number }).retryAfterSeconds;
  if (retryAfter !== undefined) headers["retry-after"] = String(retryAfter);
  return new Response(JSON.stringify(body), { status: err.status, headers });
}

/** Classify an unknown thrown value into an ApiError (never leaks internals). */
export function normalizeError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return upstreamError(504, "Upstream request timed out", { retryable: true });
  }
  if (err instanceof Error) {
    // Network-level fetch failures (DNS, connection refused, aborted).
    if (/fetch failed|network|ECONNREFUSED|ENOTFOUND|aborted/i.test(err.message)) {
      return upstreamError(502, `Upstream unreachable: ${err.message}`, {
        retryable: true,
      });
    }
    return new ApiError(500, "server_error", "Internal server error");
  }
  return new ApiError(500, "server_error", "Internal server error");
}
