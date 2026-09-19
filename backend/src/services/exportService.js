import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Builder } from 'xml2js';
import { config } from '../config/env.js';
import fs from 'fs';
import path from 'path';

function safeName(name) {
  return String(name).replace(/[^a-z0-9-_]/gi, '_').toLowerCase();
}

// XML element names must start with a letter/underscore and contain only
// letters, digits, '-', '_', '.'. Data keys such as source ids ('1ST', '2ND')
// or nested Mongoose fields can violate this, so every object key is mapped to
// a legal XML name before serializing.
function xmlName(key) {
  let s = String(key).replace(/[^a-zA-Z0-9_.\-\u00C0-\uFFFF]/g, '_');
  if (!/^[a-zA-Z_]/.test(s)) s = `_${s}`;
  return s;
}

function xmlSafe(value) {
  if (Array.isArray(value)) return value.map(xmlSafe);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[xmlName(k)] = xmlSafe(v);
    return out;
  }
  return value;
}

export async function exportData({ format = 'json', fileName, title, meta, rows, sheets }) {
  const dir = config.exportDir;
  fs.mkdirSync(dir, { recursive: true });
  const base = safeName(fileName || title || 'report');
  const filePath = path.join(dir, `${base}.${format === 'xlsx' ? 'xlsx' : format}`);

  switch (format) {
    case 'csv': {
      const parser = new Parser({ flatten: true });
      fs.writeFileSync(filePath, parser.parse(rows || []));
      break;
    }
    case 'json': {
      fs.writeFileSync(filePath, JSON.stringify({ title, meta, rows, generatedAt: new Date().toISOString() }, null, 2));
      break;
    }
    case 'xml': {
      const builder = new Builder({ rootName: 'Report', renderOpts: { pretty: true } });
      const xmlObj = {
        Header: { Title: title, GeneratedAt: new Date().toISOString() },
        Summary: meta || {},
        Data: { Row: rows || [] }
      };
      if (sheets) {
        xmlObj.Sheets = {};
        for (const [sheetName, sheetRows] of Object.entries(sheets)) {
          xmlObj.Sheets[xmlName(sheetName)] = { Row: sheetRows || [] };
        }
      }
      fs.writeFileSync(filePath, builder.buildObject(xmlSafe(xmlObj)));
      break;
    }
    case 'text': {
      let content = `========================================================\n`;
      content += `Report: ${title || 'OneRecon Export'}\n`;
      content += `Generated: ${new Date().toLocaleString()}\n`;
      content += `========================================================\n\n`;
      
      if (meta) {
        content += `--- Summary ---\n`;
        for (const [k, v] of Object.entries(meta)) {
          content += `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}\n`;
        }
        content += `\n`;
      }
      
      if (rows && rows.length > 0) {
        content += `--- Data (${rows.length} records) ---\n`;
        rows.forEach((row, i) => {
          content += `Record #${i + 1}:\n`;
          for (const [k, v] of Object.entries(row)) {
            content += `  ${k}: ${v}\n`;
          }
          content += `\n`;
        });
      }
      fs.writeFileSync(filePath, content);
      break;
    }
    case 'xlsx': {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Report');
      ws.columns = [
        { header: 'Section', key: 'section', width: 30 },
        { header: 'Field', key: 'field', width: 28 },
        { header: 'Value', key: 'value', width: 70 },
      ];
      ws.addRow({ section: 'REPORT', field: 'Title', value: title });
      ws.addRow({ section: 'REPORT', field: 'Generated', value: new Date().toISOString() });
      if (meta) {
        for (const [k, v] of Object.entries(meta)) {
          ws.addRow({ section: 'META', field: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) });
        }
      }
      const detail = wb.addWorksheet('Detail');
      if (rows && rows.length) {
        detail.columns = Object.keys(rows[0]).map((k) => ({ header: k, key: k, width: 24 }));
        rows.forEach((r) => detail.addRow(r));
      }
      if (sheets) {
        for (const [sheetName, sheetRows] of Object.entries(sheets)) {
          const s = wb.addWorksheet(String(sheetName).slice(0, 31));
          if (sheetRows && sheetRows.length) {
            s.columns = Object.keys(sheetRows[0]).map((k) => ({ header: k, key: k, width: 24 }));
            sheetRows.forEach((r) => s.addRow(r));
          }
        }
      }
      await wb.xlsx.writeFile(filePath);
      break;
    }
    case 'pdf': {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);
      doc.fontSize(18).text(title || 'OneRecon Report', { underline: true });
      doc.moveDown();
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`);
      if (meta) {
        doc.moveDown();
        doc.fontSize(11).text('Summary');
        doc.moveDown(0.5);
        for (const [k, v] of Object.entries(meta)) {
          doc.fontSize(9).text(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
        }
      }
      if (rows && rows.length) {
        doc.moveDown();
        doc.fontSize(11).text('Detail');
        doc.moveDown(0.5);
        const keys = Object.keys(rows[0]);
        const colW = 500 / Math.min(keys.length, 6);
        keys.slice(0, 6).forEach((k) => doc.fontSize(7).text(`${k}`.toUpperCase(), { continued: true, width: colW }));
        doc.moveDown(0.25);
        rows.slice(0, 400).forEach((r) => {
          keys.slice(0, 6).forEach((k) => {
            const v = r[k];
            doc.fontSize(6.5).text(v == null ? '' : String(v).slice(0, 40), { continued: true, width: colW });
          });
          doc.moveDown(0.15);
        });
        if (rows.length > 400) doc.fontSize(8).text(`… ${rows.length - 400} more rows truncated in PDF (use Excel for full data)`);
      }
      doc.fontSize(7).text('\nFinal decisions rest with authorized personnel. Report generated by OneRecon.', { align: 'center' });
      doc.end();
      await new Promise((resolve) => stream.on('close', resolve));
      break;
    }
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
  return filePath;
}