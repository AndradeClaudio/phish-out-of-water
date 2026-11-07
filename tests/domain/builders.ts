import { DownloadAttempt, Evidence, PageObservation } from '../../src/domain/evidence.js';
import type { SensitiveData } from '../../src/domain/sensitive-data.js';
import { Brand, VisualAssessment } from '../../src/domain/visual-assessment.js';
import { WebAddress } from '../../src/domain/web-address.js';

export function landingPageAt(address: string, details: { requestedData?: SensitiveData[]; formDestinations?: string[] } = {}): PageObservation {
  return new PageObservation({
    address: WebAddress.of(address),
    title: 'Some page',
    requestedData: details.requestedData ?? [],
    formDestinations: (details.formDestinations ?? []).map(WebAddress.of),
    visibleText: '',
  });
}

export function evidenceOf(details: {
  path: string[];
  landingPage?: PageObservation | null;
  downloads?: string[];
}): Evidence {
  const navigationPath = details.path.map(WebAddress.of);
  const landingPage = details.landingPage === undefined ? landingPageAt(details.path.at(-1) as string) : details.landingPage;
  return new Evidence({
    navigationPath,
    landingPage,
    downloadAttempts: (details.downloads ?? []).map(
      (fileName) => new DownloadAttempt({ fileName, source: navigationPath.at(-1) as WebAddress, sha256: null, sizeInBytes: null }),
    ),
    screenshots: landingPage === null ? [] : [{ caption: 'Landing page', mediaType: 'image/jpeg', base64Content: '' }],
    unreachableReason: details.landingPage === null ? 'the site did not respond' : null,
  });
}

export function pageShowing(brand: { name: string; domains: string[] } | null, requestedData: SensitiveData[] = []): VisualAssessment {
  return new VisualAssessment({
    displayedBrand: brand === null ? null : new Brand(brand.name, brand.domains),
    requestedData,
    pageDescription: 'A page.',
  });
}

export const NOTHING_SEEN = pageShowing(null);
