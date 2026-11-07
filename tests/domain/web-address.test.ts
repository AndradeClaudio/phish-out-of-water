import { describe, expect, it } from 'vitest';
import { InvalidWebAddressError, WebAddress } from '../../src/domain/web-address.js';

describe('WebAddress', () => {
  it('accepts a pasted link without scheme', () => {
    expect(WebAddress.fromUserInput('  bit.ly/abc  ').href).toBe('http://bit.ly/abc');
  });

  it('keeps a port when the scheme is missing', () => {
    expect(WebAddress.fromUserInput('example.com:8080/x').href).toBe('http://example.com:8080/x');
  });

  it('explains that only web links are supported', () => {
    expect(() => WebAddress.fromUserInput('javascript:alert(1)')).toThrow('Only http and https links');
  });

  it.each(['', '   ', 'javascript:alert(1)', 'ftp://files.example.com', 'not a link at all'])('rejects "%s"', (input) => {
    expect(() => WebAddress.fromUserInput(input)).toThrow(InvalidWebAddressError);
  });

  it('knows the registrable domain of multi-part public suffixes', () => {
    expect(WebAddress.of('https://login.secure.itau.com.br/x').registrableDomain).toBe('itau.com.br');
  });

  it('belongs to a domain and its subdomains, not to look-alikes', () => {
    expect(WebAddress.of('https://www.paypal.com').belongsTo('paypal.com')).toBe(true);
    expect(WebAddress.of('https://paypal.com.account-verify.ru').belongsTo('paypal.com')).toBe(false);
    expect(WebAddress.of('https://mypaypal.com').belongsTo('paypal.com')).toBe(false);
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://10.1.2.3',
    'http://172.20.0.1',
    'http://192.168.0.1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://printer.local',
  ])('flags %s as a private network address', (address) => {
    expect(WebAddress.of(address).pointsToPrivateNetwork()).toBe(true);
  });

  it('does not flag public addresses as private', () => {
    expect(WebAddress.of('http://8.8.8.8').pointsToPrivateNetwork()).toBe(false);
    expect(WebAddress.of('https://example.com').pointsToPrivateNetwork()).toBe(false);
  });

  it('detects deceptive address tricks', () => {
    expect(WebAddress.of('http://mybank.com@evil.example/login').hidesRealHostBehindCredentials()).toBe(true);
    expect(WebAddress.of('https://аpple.com').usesPunycode()).toBe(true);
    expect(WebAddress.of('http://203.0.113.9/pay').usesRawIpAddress()).toBe(true);
  });
});
