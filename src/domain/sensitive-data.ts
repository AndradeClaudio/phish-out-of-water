/** Kinds of personal data scammers try to collect. */
export const SENSITIVE_DATA_KINDS = ['password', 'payment-card', 'one-time-code', 'national-id'] as const;

export type SensitiveData = (typeof SENSITIVE_DATA_KINDS)[number];

const PLAIN_LANGUAGE_NAMES: Record<SensitiveData, string> = {
  password: 'your password',
  'payment-card': 'your card details',
  'one-time-code': 'a verification code sent to your phone',
  'national-id': 'your ID number',
};

export function isSensitiveData(candidate: string): candidate is SensitiveData {
  return (SENSITIVE_DATA_KINDS as readonly string[]).includes(candidate);
}

export function describeSensitiveData(kinds: readonly SensitiveData[]): string {
  const names = kinds.map((kind) => PLAIN_LANGUAGE_NAMES[kind]);
  if (names.length <= 1) {
    return names.join('');
  }
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
