export const ErrorCode = {
  InternalError: 'InternalError',
  Rejected: 'Rejected',
  InvalidRequest: 'InvalidRequest',
  PermissionRejected: 'PermissionRejected',
  Disconnected: 'Disconnected',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class GsdApiError extends Error {
  readonly type = 'DAppConnectorAPIError' as const;
  readonly code: ErrorCode;
  readonly reason: string;

  constructor(code: ErrorCode, reason: string) {
    super(`[${code}] ${reason}`);
    this.code = code;
    this.reason = reason;
  }

  toJSON() {
    return { code: this.code, reason: this.reason };
  }
}
