export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Sign in required');
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
