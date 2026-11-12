import type { EnrollResult, MdmDeviceRef, MdmProvider } from "./provider.js";

// Production provider: talks to our self-hosted NanoMDM server.
//
// NanoMDM implements the Apple MDM protocol (APNs push, checkin/connect,
// CMS-signed commands). It exposes an HTTP API to enqueue commands per device,
// keyed by the device's enrollment id. We map our internal device to that
// enrollment and send the raw MDM commands NanoMDM forwards to the phone.
//
// This is a scaffold: the exact command payloads (DeviceLock, EnableLostMode,
// DisableLostMode, RemoveProfile) and the ABM/DEP assignment calls get filled
// in during Phase 1, against a real ABM org + APNs certificate. Until then,
// MDM_PROVIDER stays "mock".

export class NanoMdmProvider implements MdmProvider {
  readonly name = "nanomdm";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {
    if (!baseUrl) {
      throw new Error(
        "NANOMDM_URL is not set. Point it at your NanoMDM server, or use MDM_PROVIDER=mock."
      );
    }
  }

  async enroll(_device: MdmDeviceRef): Promise<EnrollResult> {
    // ABM assignment + ADE profile push ("Allow MDM profile removal" = No).
    // Prepared via Apple Configurator at point of sale; the server reconciles
    // the resulting enrollment here.
    throw new NotWired("enroll");
  }

  async lock(_device: MdmDeviceRef, _message: string): Promise<void> {
    // EnableLostMode { Message, PhoneNumber } via NanoMDM command API.
    throw new NotWired("lock");
  }

  async unlock(_device: MdmDeviceRef): Promise<void> {
    // DisableLostMode.
    throw new NotWired("unlock");
  }

  async restrict(_device: MdmDeviceRef, _message: string): Promise<void> {
    // Apply a restriction profile (single-app / disabled apps).
    throw new NotWired("restrict");
  }

  async release(_device: MdmDeviceRef): Promise<void> {
    // RemoveProfile + release the serial from the ABM org.
    throw new NotWired("release");
  }

  // Helper for when the real calls are implemented.
  private async call(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }
}

class NotWired extends Error {
  constructor(op: string) {
    super(
      `NanoMDM.${op} is not wired yet — complete Phase 1 (ABM org + APNs cert + NanoMDM) before switching MDM_PROVIDER to "nanomdm".`
    );
    this.name = "NotWired";
  }
}
