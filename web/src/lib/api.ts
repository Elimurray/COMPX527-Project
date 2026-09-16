import type {
  ApiError,
  BoundingBox,
  CreateReportInput,
  CreateReportResponse,
  ListReportsResponse,
} from '@derf/shared';
import { config } from './config';
import { accessToken } from './auth';

/** Error carrying the API's own code and the requestId for log correlation. */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function parseError(response: Response): Promise<ApiRequestError> {
  let code = 'UNKNOWN';
  let message = response.statusText || 'Request failed';
  let requestId: string | undefined;

  try {
    const body = (await response.json()) as Partial<ApiError> & { message?: string };
    if (body.error) {
      code = body.error.code;
      message = body.error.message;
      requestId = body.error.requestId;
    } else if (body.message) {
      // API Gateway's own rejections (e.g. the authorizer) use this shape.
      message = body.message;
      code = response.status === 401 ? 'UNAUTHORIZED' : code;
    }
  } catch {
    // Keep the status-derived message.
  }

  return new ApiRequestError(response.status, code, message, requestId);
}

/**
 * Public: reading resource status never requires an account.
 *
 * Returns the whole response rather than just the array, because `truncated`
 * has to reach the UI — a partial result rendered as a complete one is worse
 * than no result at all.
 */
export async function listReports(bbox: BoundingBox): Promise<ListReportsResponse> {
  const query = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
  const response = await fetch(
    `${config.apiBaseUrl}/reports?bbox=${encodeURIComponent(query)}`,
  );

  if (!response.ok) throw await parseError(response);

  return (await response.json()) as ListReportsResponse;
}

/** Authenticated. Returns once the report is *accepted*, not once it is stored. */
export async function createReport(
  input: CreateReportInput,
): Promise<CreateReportResponse> {
  const token = await accessToken();
  if (!token) {
    throw new ApiRequestError(401, 'NOT_SIGNED_IN', 'Sign in to submit a report');
  }

  const response = await fetch(`${config.apiBaseUrl}/reports`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) throw await parseError(response);
  return (await response.json()) as CreateReportResponse;
}
