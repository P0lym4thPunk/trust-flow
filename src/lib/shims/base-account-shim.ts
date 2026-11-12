export const base = {
  id: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.base.org"] } },
};

export function createBaseAccountSDK() {
  return {
    getProvider: () => null,
    subAccount: {
      create: async () => null,
      list: async () => [],
    },
  };
}

export function getCryptoKeyAccount() {
  return null;
}

export function getPaymentStatus() {
  return null;
}

export function pay() {
  return Promise.resolve(null);
}

export function removeCryptoKey() {
  return Promise.resolve();
}

export default {
  base,
  createBaseAccountSDK,
  getCryptoKeyAccount,
  getPaymentStatus,
  pay,
  removeCryptoKey,
};
