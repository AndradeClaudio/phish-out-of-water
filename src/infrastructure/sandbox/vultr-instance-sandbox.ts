import type { Sandbox } from '../../application/ports.js';
import type { Evidence } from '../../domain/evidence.js';
import type { WebAddress } from '../../domain/web-address.js';

export class ParanoidModeUnavailableError extends Error {
  override readonly name = 'ParanoidModeUnavailableError';

  constructor() {
    super('Paranoid mode (one disposable Vultr instance per link) is designed but not implemented yet. See docs/paranoid-mode.md.');
  }
}

/**
 * PARANOID MODE — design concept, intentionally not implemented. See docs/paranoid-mode.md.
 *
 * Same contract as DockerSandbox, but each link is opened on its own short-lived Vultr Cloud Compute
 * instance, so the boundary between the suspicious page and our infrastructure becomes a hypervisor
 * instead of gVisor. Because it implements the same `Sandbox` port, enabling it means wiring this
 * adapter in main.ts: the domain and use cases do not change.
 *
 * Planned lifecycle of `detonate(link)`:
 *
 *  1. Provision: POST https://api.vultr.com/v2/instances
 *       - `snapshot_id`: a hardened image with the detonator pre-installed (Chromium + Playwright,
 *         egress to private ranges and 169.254.169.254 blocked by iptables at boot, no SSH keys,
 *         no agent credentials of any kind)
 *       - no VPC attached, so the instance shares no private network with the app
 *       - `firewall_group_id`: a group that allows no inbound traffic
 *       - `user_data`: the link plus a one-time callback URL and token, nothing else
 *       - `tags: ["pootw-detonation"]`, label with the inspection id, smallest plan available
 *
 *  2. Detonate: cloud-init runs the same detonator as the container version and POSTs its
 *     DetonationReport to the callback URL, authenticated by the one-time token. The token is
 *     invalidated on first use, so a compromised instance cannot submit twice or call anything else.
 *
 *  3. Destroy: DELETE https://api.vultr.com/v2/instances/{id} as soon as the report arrives,
 *     on failure, or when the time budget (~4 min including boot) runs out, whichever comes first.
 *
 *  4. Reap: a periodic job lists instances tagged "pootw-detonation" and deletes any older than the
 *     time budget, so a crash of the app can never leave a detonation instance running.
 *
 * Why it is not the default: it adds 1–2 minutes of boot time per link and costs one instance-hour
 * per inspection. The intended use is escalation: links the container run could not judge, or that
 * crashed the browser in the container, get re-detonated here.
 */
export class VultrInstanceSandbox implements Sandbox {
  async detonate(_link: WebAddress): Promise<Evidence> {
    throw new ParanoidModeUnavailableError();
  }
}
