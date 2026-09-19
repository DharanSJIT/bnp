import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// override: the checked-in .env (or your own copy) is authoritative even if
// ambient environment variables set the same keys (e.g. a shared CI profile).
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/onerecon',
  jwtSecret: process.env.JWT_SECRET || 'onerecon-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
  maApiBaseUrl: process.env.MA_API_BASE_URL || 'http://127.0.0.1:5000',
  uploadDir: path.resolve(__dirname, '../../uploads'),
  exportDir: path.resolve(__dirname, '../../exports'),
  defaultRulesFile: path.resolve(__dirname, '../../uploads/business_rules.txt'),
  rootDir: path.resolve(__dirname, '../..'),
};