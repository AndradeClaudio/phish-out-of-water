import { parse } from 'tldts';

export class InvalidWebAddressError extends Error {
  override readonly name = 'InvalidWebAddressError';
}

const WEB_PROTOCOLS = new Set(['http:', 'https:']);
/** "javascript:…" or "https://…" carry a scheme; "example.com:8080/…" is a host with a port. */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const PRIVATE_HOSTNAME_SUFFIXES = ['localhost', '.localhost', '.local', '.internal', '.home.arpa'];

/** An absolute http(s) address on the web. Immutable; cannot exist in an invalid state. */
export class WebAddress {
  private constructor(private readonly url: URL) {}

  /** Accepts what a person pastes: tolerates surrounding spaces and a missing scheme. */
  static fromUserInput(rawInput: string): WebAddress {
    const trimmed = rawInput.trim();
    if (trimmed.length === 0) {
      throw new InvalidWebAddressError('Paste a link to inspect.');
    }
    return WebAddress.of(SCHEME_PREFIX.test(trimmed) ? trimmed : `http://${trimmed}`);
  }

  static of(absoluteAddress: string): WebAddress {
    let url: URL;
    try {
      url = new URL(absoluteAddress);
    } catch {
      throw new InvalidWebAddressError(`"${absoluteAddress}" is not a valid web address.`);
    }
    if (!WEB_PROTOCOLS.has(url.protocol)) {
      throw new InvalidWebAddressError(`Only http and https links can be inspected, got "${url.protocol}".`);
    }
    if (url.hostname.length === 0) {
      throw new InvalidWebAddressError(`"${absoluteAddress}" has no host.`);
    }
    return new WebAddress(url);
  }

  static isWebAddress(candidate: string): boolean {
    try {
      WebAddress.of(candidate);
      return true;
    } catch {
      return false;
    }
  }

  get href(): string {
    return this.url.href;
  }

  get hostname(): string {
    return this.url.hostname.toLowerCase();
  }

  /** The part of the hostname a single owner controls, e.g. "itau.com.br" for "www.itau.com.br". */
  get registrableDomain(): string {
    return parse(this.url.href).domain ?? this.hostname;
  }

  isEncrypted(): boolean {
    return this.url.protocol === 'https:';
  }

  usesRawIpAddress(): boolean {
    return parse(this.url.href).isIp === true;
  }

  /** Internationalized hostnames can imitate real ones with look-alike characters. */
  usesPunycode(): boolean {
    return this.hostname.split('.').some((label) => label.startsWith('xn--'));
  }

  /** "http://yourbank.com@evil.example" reads like yourbank.com but goes to evil.example. */
  hidesRealHostBehindCredentials(): boolean {
    return this.url.username.length > 0 || this.url.password.length > 0;
  }

  belongsTo(domain: string): boolean {
    const normalizedDomain = domain.trim().toLowerCase().replace(/^\.+/, '');
    return this.hostname === normalizedDomain || this.hostname.endsWith(`.${normalizedDomain}`);
  }

  isSameSiteAs(other: WebAddress): boolean {
    return this.registrableDomain === other.registrableDomain;
  }

  pointsToPrivateNetwork(): boolean {
    const host = this.hostname.replace(/^\[|\]$/g, '');
    return (
      PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => host === suffix || host.endsWith(suffix)) ||
      isPrivateIpv4(host) ||
      isPrivateIpv6(host)
    );
  }

  equals(other: WebAddress): boolean {
    return this.href === other.href;
  }

  toString(): string {
    return this.href;
  }
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(host: string): boolean {
  if (!host.includes(':')) {
    return false;
  }
  const lower = host.toLowerCase();
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}
