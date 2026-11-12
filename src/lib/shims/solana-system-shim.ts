export function getTransferSolInstruction() {
  throw new Error("Solana operations are not supported in TrustFlow (Stellar native)");
}

export default {
  getTransferSolInstruction,
};
