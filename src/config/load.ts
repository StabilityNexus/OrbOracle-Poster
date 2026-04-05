import { PosterConfigSchema, PosterConfig } from './schema';
import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';

export function loadConfig(configPath: string = path.resolve(process.cwd(), 'orb-poster.config.json')): PosterConfig {
  try {
    const configRaw = fs.readFileSync(configPath, 'utf-8');
    const rawConfig = JSON.parse(configRaw);
    const parsed = PosterConfigSchema.parse(rawConfig);
    logger.info({ event: 'CONFIG_LOADED', msg: 'Configuration loaded and validated successfully' });
    return parsed;
  } catch (err: any) {
    logger.fatal({ event: 'CONFIG_ERROR', err }, 'Failed to load configuration');
    throw err;
  }
}
