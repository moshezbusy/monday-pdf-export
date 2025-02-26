const express = require('express');
const bodyParser = require('body-parser');
const mondaySdk = require('monday-sdk-js');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

// אתחול ה-SDK עם המפתח שלך
const monday = mondaySdk();
require('dotenv').config();          // אם אתה משתמש ב-`.env` בפיתוח מקומי
const API_KEY = process.env.API_KEY; // נטען ממשתני הסביבה
monday.setToken(API_KEY);

// פונקציית עזר - מקבלת itemId ויוצרת PDF
async function exportItemToPDF(itemId) {
  try {
    // 1. הבאת נתוני ה-item
    const query = `
      query {
        items(ids: [${itemId}]) {
          id
          name
          column_values {
            id
            text
            value
          }
          board {
            name
          }
          group {
            title
          }
        }
      }
    `;
    const response = await monday.api(query);
    const itemData = response.data.items[0];
    if (!itemData) {
      console.log(`Item ${itemId} not found`);
      return;
    }

    // 2. יצירת PDF
    const doc = new PDFDocument();
    const filePath = `./item_${itemId}.pdf`;
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(20).text(`Item: ${itemData.name}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Board: ${itemData.board.name}`);
    doc.fontSize(14).text(`Group: ${itemData.group.title}`);
    doc.moveDown();
    doc.fontSize(16).text('Fields:', { underline: true });
    doc.moveDown();

    itemData.column_values.forEach(column => {
      if (column.text) {
        doc.fontSize(12).text(`${column.id}: ${column.text}`);
      }
    });

    doc.end();

    // מחכים שהכתיבה לקובץ תסתיים
    return new Promise((resolve) => {
      stream.on('finish', () => {
        console.log(`PDF created: ${filePath}`);
        resolve(filePath);
      });
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
  }
}

// מסלול (endpoint) שיקבל את ה-webhook מ-Monday
app.post('/monday-webhook', async (req, res) => {
  try {
    // בד"כ ב-body של הבקשה תהיה אינפורמציה על ה-item
    // במבנה כמו: { event: { pulseId: 12345, ... }, ... }
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));

    // שלוף את ה-itemId מהנתונים (pulseId = itemId)
    const itemId = req.body.event?.pulseId;
    if (!itemId) {
      return res.status(400).send('No itemId found in webhook data');
    }

    // קרא לפונקציה שיוצרת PDF
    await exportItemToPDF(itemId);

    // החזר תשובה ל-Monday שהכול בסדר
    res.status(200).send('PDF generated successfully');
  } catch (error) {
    console.error('Error in /monday-webhook:', error);
    res.status(500).send('Server error');
  }
});

// הפעלת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
