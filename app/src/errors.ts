/**
 * User-facing errors and technical detail formatting.
 *
 * The UI shows `message` in Chinese and puts `detail` behind a copyable
 * disclosure. Never put raw stack traces in the main status line.
 */
export class UserFacingError extends Error {
    readonly detail: string;

    constructor(message: string, detail = '') {
        super(message);
        this.name = 'UserFacingError';
        this.detail = detail;
    }
}

export function formatError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}${error.stack ? '\n' + error.stack : ''}`;
    }
    return String(error);
}

export function userMessage(error: unknown): string {
    return error instanceof UserFacingError
        ? error.message
        : `转换失败：${error instanceof Error ? error.message : String(error)}`;
}

export function userDetail(error: unknown): string {
    return error instanceof UserFacingError && error.detail
        ? error.detail
        : formatError(error);
}