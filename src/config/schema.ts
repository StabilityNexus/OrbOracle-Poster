import { z } from 'zod';

export const PostingPolicySchema = z.object({
  heartbeatIntervalMs: z.number().int().positive(),
  deviationThresholdBps: z.number().int().positive(),
  maxRetries: z.number().int().positive(),
  backoffMultiplier: z.number().positive(),
  staleAfterMs: z.number().int().positive().default(120000),
  gasCeilingGwei: z.number().positive().optional(),
});

export const OracleTargetSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  chainId: z.number().int().positive(),
  rpcUrl: z.string().url(),
  pricePair: z.string(),
  policy: PostingPolicySchema,
  minStake: z.string().regex(/^\d+$/).default("0"),
});

export const PosterConfigSchema = z.object({
  oracles: z.array(OracleTargetSchema).min(1),
  priceSources: z.array(z.string()).min(1),
  walletKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid private key").optional(),
  pollingIntervalMs: z.number().int().positive().default(10000),
  dryRun: z.boolean().default(false),
  stateFilePath: z.string().min(1).default('.orb-poster-state.json'),
});

export type PostingPolicy = z.infer<typeof PostingPolicySchema>;
export type OracleTarget = z.infer<typeof OracleTargetSchema>;
export type PosterConfig = z.infer<typeof PosterConfigSchema>;
