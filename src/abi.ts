export const OracleAbi = [
  { "type": "function", "name": "submitValue", "inputs": [{ "name": "newValue", "type": "int256", "internalType": "int256" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "getTotalUserTokens", "inputs": [{ "name": "user", "type": "address", "internalType": "address" }], "outputs": [{ "type": "uint256", "internalType": "uint256" }], "stateMutability": "view" },
  { "type": "function", "name": "depositTimestamp", "inputs": [{ "name": "", "type": "address", "internalType": "address" }], "outputs": [{ "type": "uint256", "internalType": "uint256" }], "stateMutability": "view" },
  { "type": "function", "name": "WITHDRAWAL_LOCKING_PERIOD", "inputs": [], "outputs": [{ "type": "uint256", "internalType": "uint256" }], "stateMutability": "view" },
  { "type": "function", "name": "readLatestValue", "inputs": [], "outputs": [{ "type": "int256", "internalType": "int256" }], "stateMutability": "nonpayable" }
] as const;

export const ChainlinkAggregatorAbi = [
  {
    "inputs": [],
    "name": "latestRoundData",
    "outputs": [
      { "internalType": "uint80", "name": "roundId", "type": "uint80" },
      { "internalType": "int256", "name": "answer", "type": "int256" },
      { "internalType": "uint256", "name": "startedAt", "type": "uint256" },
      { "internalType": "uint256", "name": "updatedAt", "type": "uint256" },
      { "internalType": "uint80", "name": "answeredInRound", "type": "uint80" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
