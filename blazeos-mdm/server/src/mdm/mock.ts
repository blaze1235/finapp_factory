import type { EnrollResult, MdmDeviceRef, MdmProvider } from "./provider.js";

// Local dev / demo provider. No real device is touched — it just logs intent
// and returns plausible values. The DB (lockState, enrollmentStatus) is the
// source of truth for the UI; the real provider will keep that in sync with
// actual device state.
export class MockMdmProvider implements MdmProvider {
  readonly name = "mock";

  async enroll(device: MdmDeviceRef): Promise<EnrollResult> {
    this.log("enroll", device);
    return {
      abmDeviceId: `MOCK-ABM-${device.imei.slice(-6)}`,
      profileRemovalBlocked: true,
    };
  }

  async lock(device: MdmDeviceRef, message: string): Promise<void> {
    this.log("lock", device, message);
  }

  async unlock(device: MdmDeviceRef): Promise<void> {
    this.log("unlock", device);
  }

  async restrict(device: MdmDeviceRef, message: string): Promise<void> {
    this.log("restrict", device, message);
  }

  async release(device: MdmDeviceRef): Promise<void> {
    this.log("release", device);
  }

  private log(action: string, device: MdmDeviceRef, extra?: string) {
    console.log(
      `[mdm:mock] ${action} device=${device.deviceId} imei=${device.imei}` +
        (extra ? ` msg="${extra}"` : "")
    );
  }
}
