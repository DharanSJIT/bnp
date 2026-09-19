import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { connectDb } from './config/db.js';
import { config } from './config/env.js';
import { aiStatus } from './services/aiClient.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.js';
import workflowRoutes from './routes/workflows.js';
import sourceRoutes from './routes/sources.js';
import validationRoutes from './routes/validation.js';
import mappingRoutes from './routes/mappings.js';
import previewRoutes from './routes/preview.js';
import runRoutes from './routes/runs.js';
import breakRoutes from './routes/breaks.js';
import reportRoutes from './routes/reports.js';
import auditRoutes from './routes/audit.js';
import userRoutes from './routes/users.js';
import documentRoutes from './routes/documents.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '200mb' }));
app.use(morgan('dev'));

app.get('/api/health', async (req, res) => {
  const ai = await aiStatus();
  res.json({ status: 'ok', service: 'onerecon-backend', ai, mongo: 'connected' });
});

app.use('/api/auth', authRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/workflows', sourceRoutes);
app.use('/api/workflows', validationRoutes);
app.use('/api/workflows', mappingRoutes);
app.use('/api/workflows', previewRoutes);
app.use('/api/runs', runRoutes);
app.use('/api/breaks', breakRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/users', userRoutes);
app.use('/api/documents', documentRoutes);

app.use(notFound);
app.use(errorHandler);

async function main() {
  await connectDb();
  app.listen(config.port, () => {
    console.log(`[server] OneRecon backend listening on http://127.0.0.1:${config.port}`);
  });
}

main().catch((err) => {
  console.error('[server] fatal startup error', err);
  process.exit(1);
});