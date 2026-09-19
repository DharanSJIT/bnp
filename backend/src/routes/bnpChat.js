import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { aiCall } from '../services/aiClient.js';

const router = Router();
router.use(auth);

// POST /api/bnp-chat — general questions about BNP Paribas.
// Backed by Groq RAG over bnp_paribas_knowledge_base.txt in the AI service.
router.post('/', async (req, res) => {
  try {
    const question = String((req.body || {}).question || '').trim();
    if (!question) return res.status(400).json({ error: 'Question is required' });
    const data = await aiCall('/ai/bnp-chat', { question });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: `BNP assistant unavailable: ${err.message}` });
  }
});

export default router;