// MDM provider abstraction.
//
// BlazeOS owns the application layer; the actual Apple MDM protocol work
// (APNs push, CMS-signed commands, ABM/DEP enrollment) is done by a NanoMDM
// server we self-host. Everything in the app talks to that through this
// interface, so the rest of the codebase never depends on how locking works.
//
// - MockMdmProvider: local dev / demo. Records intent, no real device.
// - NanoMdmProvider: production. Talks to our NanoMDM server's command API.

export interface MdmDeviceRef {
  deviceId: string; // our internal Device.id
  imei: string;
  serial?: string | null;
  abmDeviceId?: string | null;
}

export interface EnrollResult {
  abmDeviceId: string;
  // "Allow MDM profile removal" = No. Set at the ADE/enrollment profile level.
  profileRemovalBlocked: boolean;
}

export interface MdmProvider {
  readonly name: string;

  /**
   * Assign the device to our ABM org and push a supervised, non-removable
   * enrollment profile. In production this is prepared via Apple Configurator
   * at point of sale; here we represent the server-side half.
   */
  enroll(device: MdmDeviceRef): Promise<EnrollResult>;

  /** Put the device into Lost Mode with a lock-screen message. */
  lock(device: MdmDeviceRef, message: string): Promise<void>;

  /** Clear Lost Mode / restrictions. Buyer regains full use. */
  unlock(device: MdmDeviceRef): Promise<void>;

  /** Partial restriction (kiosk / disable apps) short of a full lock. */
  restrict(device: MdmDeviceRef, message: string): Promise<void>;

  /**
   * Release the device from our ABM org and unenroll it — used on full
   * payoff so the buyer ends up with a clean, unmanaged phone.
   */
  release(device: MdmDeviceRef): Promise<void>;
}
