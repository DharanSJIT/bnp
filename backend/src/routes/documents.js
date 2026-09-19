import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import csvParser from 'csv-parser';
import { parseStringPromise } from 'xml2js';
import ExcelJS from 'exceljs';
import { config } from '../config/env.js';
import { Document } from '../models/Document.js';
import { auth } from '../middleware/auth.js';
import { auditFor } from '../services/auditService.js';

const router = Router();
router.use(auth);

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({ dest: config.uploadDir, limits: { fileSize: 200 * 1024 * 1024 } });

// GET /api/documents
router.get('/', async (req, res, next) => {
  try {
    const query = req.user.role === 'admin' ? {} : { uploaderId: req.user._id };
    const documents = await Document.find(query).sort({ createdAt: -1 }).select('-data').lean();
    res.json({ documents });
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (req.user.role !== 'admin' && doc.uploaderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/upload
router.post('/upload', upload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  const format = ['csv', 'xls', 'xlsx', 'json', 'xml'].includes(ext) ? ext : 'csv';
  
  if (!['csv', 'xlsx', 'json', 'xml'].includes(format)) {
    return res.status(400).json({ error: `Unsupported file format: ${ext}` });
  }

  const doc = new Document({
    filename: req.file.originalname,
    originalFormat: format,
    uploaderId: req.user._id,
    uploaderRole: req.user.role,
    status: 'processing',
    data: [],
  });
  await doc.save();

  try {
    let parsedData = [];

    if (format === 'csv') {
      parsedData = await new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(req.file.path)
          .pipe(csvParser())
          .on('data', (data) => results.push(data))
          .on('end', () => resolve(results))
          .on('error', reject);
      });
    } else if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);
      const worksheet = workbook.worksheets[0];
      if (worksheet) {
        const headers = [];
        worksheet.getRow(1).eachCell((cell, colNumber) => {
          headers[colNumber] = cell.value?.toString().trim();
        });
        
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // Skip headers
          const rowData = {};
          row.eachCell((cell, colNumber) => {
            const header = headers[colNumber] || `Col_${colNumber}`;
            rowData[header] = cell.value;
          });
          parsedData.push(rowData);
        });
      }
    } else if (format === 'json') {
      const fileContent = fs.readFileSync(req.file.path, 'utf8');
      const jsonContent = JSON.parse(fileContent);
      parsedData = Array.isArray(jsonContent) ? jsonContent : [jsonContent];
    } else if (format === 'xml') {
      const fileContent = fs.readFileSync(req.file.path, 'utf8');
      const xmlResult = await parseStringPromise(fileContent, { explicitArray: false });
      
      // Attempt to find an array of items in the XML structure
      const keys = Object.keys(xmlResult);
      if (keys.length === 1 && typeof xmlResult[keys[0]] === 'object') {
        const root = xmlResult[keys[0]];
        const subKeys = Object.keys(root);
        if (subKeys.length === 1 && Array.isArray(root[subKeys[0]])) {
          parsedData = root[subKeys[0]];
        } else if (Array.isArray(root)) {
            parsedData = root;
        } else {
            parsedData = [root];
        }
      } else {
        parsedData = [xmlResult];
      }
    }

    doc.data = parsedData;
    doc.recordCount = parsedData.length;
    doc.status = 'ready';
    await doc.save();

    await auditFor(req)({ 
      action: 'document.uploaded', 
      entity: 'document', 
      entityId: doc._id.toString(), 
      after: { format, recordCount: parsedData.length } 
    });

    res.status(201).json({ document: doc });
  } catch (err) {
    doc.status = 'failed';
    doc.error = err.message;
    await doc.save();
    next(err);
  } finally {
    // Clean up uploaded file
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      console.error('Failed to delete temp file:', e);
    }
  }
});

export default router;
