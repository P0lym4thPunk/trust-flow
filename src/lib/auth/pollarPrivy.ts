import { createPrivyAdapter, PrivyAdapterProvider } from "@pollar/privy-adapter";
import type { InteractiveAuthAdapter } from "@pollar/core";

export const PRIVY_APP_ID = (import.meta.env.VITE_PRIVY_APP_ID as string) || "";
export const IS_PRIVY_CONFIGURED = Boolean(
  PRIVY_APP_ID &&
  PRIVY_APP_ID.trim().length > 0 &&
  !PRIVY_APP_ID.includes("placeholder") &&
  PRIVY_APP_ID !== "YOUR_PRIVY_APP_ID"
);

export const pollarPrivyAdapter: InteractiveAuthAdapter | null = IS_PRIVY_CONFIGURED
  ? createPrivyAdapter({
      appId: PRIVY_APP_ID,
      loginMethods: ["email", "google"],
    })
  : null;

export { PrivyAdapterProvider };
