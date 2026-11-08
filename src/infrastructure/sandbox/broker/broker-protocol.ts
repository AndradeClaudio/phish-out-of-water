/**
 * Wire format between the web app and the detonation broker over a local socket.
 * One request line ({"link": "..."}) and one response line per connection, then the connection closes.
 */
import { MAX_REPORT_BYTES } from '../docker-detonation-runner.js';

export interface DetonationRequest {
  readonly link: string;
}

export type DetonationResponse = { readonly output: string } | { readonly error: string };

export const MAX_REQUEST_BYTES = 4 * 1024;
/** The sandbox output plus JSON escaping: base64 has nothing to escape, so 2x is ample. */
export const MAX_RESPONSE_BYTES = 2 * MAX_REPORT_BYTES;

export function encodeLine(message: DetonationRequest | DetonationResponse): string {
  return `${JSON.stringify(message)}\n`;
}
