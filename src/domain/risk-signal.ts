export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type RiskSignalKind =
  | 'software-download'
  | 'file-download'
  | 'brand-impersonation'
  | 'credential-harvesting'
  | 'data-sent-to-another-site'
  | 'unencrypted-sensitive-form'
  | 'sensitive-data-request'
  | 'redirect-chain'
  | 'raw-ip-address'
  | 'deceptive-address';

/** One reason, in plain language, why a link may be dangerous. */
export class RiskSignal {
  readonly kind: RiskSignalKind;
  readonly severity: Severity;
  readonly explanation: string;

  constructor(kind: RiskSignalKind, severity: Severity, explanation: string) {
    if (explanation.trim().length === 0) {
      throw new Error('A risk signal must explain itself.');
    }
    this.kind = kind;
    this.severity = severity;
    this.explanation = explanation.trim();
  }

  isCritical(): boolean {
    return this.severity === 'critical';
  }

  isHigh(): boolean {
    return this.severity === 'high';
  }

  isMedium(): boolean {
    return this.severity === 'medium';
  }
}
