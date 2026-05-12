import { ethers } from "ethers";
import axios from "axios";
import * as dotenv from "dotenv";
import { OracleAbi, ChainlinkAggregatorAbi } from "./abi.js";
import { calculateMedianAndNormalize } from "./aggregator.js";

dotenv.config();

// Configuration
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS;
const FEED_URL = process.env.FEED_URL || "https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd";
const CHAINLINK_FEED_ADDRESS = process.env.CHAINLINK_FEED_ADDRESS;
const CHAINLINK_RPC_URL = process.env.CHAINLINK_RPC_URL || RPC_URL;
const PYTH_PRICE_ID = process.env.PYTH_PRICE_ID || "0x2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d"; // ADA/USD Default

const UPDATE_INTERVAL_MS = parseInt(process.env.UPDATE_INTERVAL_MS || "60000"); // Default 1 min
const MIN_STAKE_REQUIRED = ethers.parseUnits(process.env.MIN_STAKE_REQUIRED || "10", 18); 

if (!PRIVATE_KEY || !ORACLE_ADDRESS) {
    console.error("Missing required environment variables: PRIVATE_KEY or ORACLE_ADDRESS");
    process.exit(1);
}

// Setup Provider & Wallet
const provider = new ethers.JsonRpcProvider(RPC_URL);
const chainlinkProvider = new ethers.JsonRpcProvider(CHAINLINK_RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// We cast to any to bypass strict typechecking on the un-typed ABI interface
const oracleContract = new ethers.Contract(ORACLE_ADDRESS, OracleAbi, wallet) as any;

// Data fetching strategies
async function fetchCoinGeckoPrice(): Promise<number | null> {
    try {
        const response = await axios.get(FEED_URL);
        const rawPrice: number = response.data.cardano.usd; 
        console.log(`[Data Source] CoinGecko: $${rawPrice}`);
        return rawPrice;
    } catch (e: any) {
        console.warn(`[Data Source] CoinGecko feed failed: ${e.message}`);
        return null;
    }
}

async function fetchChainlinkPrice(): Promise<number | null> {
    if (!CHAINLINK_FEED_ADDRESS) return null;
    try {
        const chainlinkContract = new ethers.Contract(CHAINLINK_FEED_ADDRESS, ChainlinkAggregatorAbi, chainlinkProvider) as any;
        const decimals = await chainlinkContract.decimals();
        const roundData = await chainlinkContract.latestRoundData();
        // Convert to standard float
        const price = Number(roundData.answer) / Math.pow(10, Number(decimals));
        console.log(`[Data Source] Chainlink: $${price}`);
        return price;
    } catch (e: any) {
        console.warn(`[Data Source] Chainlink feed failed: ${e.message}`);
        return null;
    }
}

async function fetchPythPrice(): Promise<number | null> {
    try {
        const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_PRICE_ID}`;
        const response = await axios.get(url);
        const priceData = response.data.parsed?.[0]?.price;
        if (!priceData) throw new Error("Missing price data in Pyth response");
        
        const price = Number(priceData.price) * Math.pow(10, priceData.expo);
        console.log(`[Data Source] Pyth Network: $${price}`);
        return price;
    } catch (e: any) {
        console.warn(`[Data Source] Pyth feed failed: ${e.message}`);
        return null;
    }
}

// Normalization & Aggregation function
async function fetchAndNormalizePrice(): Promise<bigint> {
    // Fetch from all sources concurrently
    const [coingeckoPrice, chainlinkPrice, pythPrice] = await Promise.all([
        fetchCoinGeckoPrice(),
        fetchChainlinkPrice(),
        fetchPythPrice()
    ]);

    const normalizedPrice = calculateMedianAndNormalize([coingeckoPrice, chainlinkPrice, pythPrice]);
    console.log(`[Aggregation] Calculated and Normalized Median Price.`);
    
    return normalizedPrice;
}

// Stake Verification
async function verifyStake(): Promise<boolean> {
    try {
        const totalStake: bigint = await oracleContract.getTotalUserTokens(wallet.address);
        console.log(`[Stake Verifier] Current stake: ${ethers.formatUnits(totalStake, 18)} Tokens`);
        return totalStake >= MIN_STAKE_REQUIRED;
    } catch (error) {
        console.error("Failed to verify stake:", error);
        return false;
    }
}

// Smart Triggers (Reward vs Gas optimization)
async function checkSmartTriggers(): Promise<boolean> {
    try {
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 0n;
        
        // Example safety threshold: If gas price spikes beyond acceptable operator limits, skip submission
        const maxGasPrice = ethers.parseUnits("100", "gwei");
        if (gasPrice > maxGasPrice) {
            console.warn(`[Smart Trigger] Gas price too high (${ethers.formatUnits(gasPrice, "gwei")} gwei). Skipping to save costs and maximize net reward.`);
            return false;
        }

        // TODO: Advanced Mode - Monitor the vault balances (ETH/ERC20) of those reading the feeds
        // calculate potential reward from the contract vs expected gas cost, and only submit if net-positive.
        // E.g.: return estimatedReward > (gasCost * currentEthTokenPrice)

        console.log(`[Smart Trigger] Conditions optimal for submission. Network Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
        return true;
    } catch (e: any) {
        console.error(`[Smart Trigger] Error computing trigger conditions: ${e.message}`);
        // Default to true if we fail to fetch gas stats to guarantee liveness
        return true;
    }
}

// Automated Submissions
async function submitPrice() {
    console.log(`\n--- Starting submission cycle at ${new Date().toISOString()} ---`);
    try {
        const hasStake = await verifyStake();
        if (!hasStake) {
            console.warn(`[Pre-flight Check] Insufficient stake. Required: ${ethers.formatUnits(MIN_STAKE_REQUIRED, 18)}. Skipping submission.`);
            return;
        }

        // Check if gas/reward ratios are optimal
        const shouldExecute = await checkSmartTriggers();
        if (!shouldExecute) {
            console.log(`--- Cycle Skipped (Sub-optimal Net Reward) ---`);
            return;
        }

        const price = await fetchAndNormalizePrice();

        console.log(`[Tx Builder] Submitting normalized price: ${price}`);

        // Construct & Execute transaction
        const tx = await oracleContract.submitValue(price);
        console.log(`[Tx Builder] Transaction submitted. Hash: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait();
        console.log(`[Tx Success] Block Number: ${receipt.blockNumber}, Gas Used: ${receipt.gasUsed.toString()}`);
    } catch (error) {
        console.error("[Tx Builder] Submission error:", error);
    }
    console.log(`--- Cycle Complete ---`);
}

// Background Worker Loop
const startWorker = async () => {
    console.log(`Starting Orb Oracle Poster worker...`);
    console.log(`Oracle Address: ${ORACLE_ADDRESS}`);
    console.log(`Interval: ${UPDATE_INTERVAL_MS / 1000} seconds`);

    // Run immediately, then interval
    await submitPrice();
    setInterval(submitPrice, UPDATE_INTERVAL_MS);
};

startWorker().catch(console.error);
