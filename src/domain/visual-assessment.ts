import type { SensitiveData } from './sensitive-data.js';
import type { WebAddress } from './web-address.js';

/** A company, bank, government agency or service a page can present itself as. */
export class Brand {
  readonly name: string;
  readonly officialDomains: readonly string[];

  constructor(name: string, officialDomains: readonly string[]) {
    if (name.trim().length === 0) {
      throw new Error('A brand needs a name.');
    }
    this.name = name.trim();
    this.officialDomains = officialDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  }

  owns(address: WebAddress): boolean {
    return this.officialDomains.some((domain) => address.belongsTo(domain));
  }
}

/**
 * What a vision model sees on the page. It only describes the page;
 * deciding whether that is a scam is a domain rule, not the model's call.
 */
export class VisualAssessment {
  readonly displayedBrand: Brand | null;
  readonly requestedData: readonly SensitiveData[];
  readonly pageDescription: string;

  constructor(details: { displayedBrand: Brand | null; requestedData: readonly SensitiveData[]; pageDescription: string }) {
    this.displayedBrand = details.displayedBrand;
    this.requestedData = [...new Set(details.requestedData)];
    this.pageDescription = details.pageDescription.trim();
  }

  static unavailable(reason: string): VisualAssessment {
    return new VisualAssessment({ displayedBrand: null, requestedData: [], pageDescription: reason });
  }
}
