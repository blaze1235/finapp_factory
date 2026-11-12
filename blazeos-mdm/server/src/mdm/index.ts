import { config } from "../config.js";
import { MockMdmProvider } from "./mock.js";
import { NanoMdmProvider } from "./nanomdm.js";
import type { MdmProvider } from "./provider.js";

let instance: MdmProvider | null = null;

export function mdm(): MdmProvider {
  if (instance) return instance;
  instance =
    config.mdmProvider === "nanomdm"
      ? new NanoMdmProvider(config.nanomdm.url, config.nanomdm.apiKey)
      : new MockMdmProvider();
  return instance;
}

export type { MdmProvider } from "./provider.js";
