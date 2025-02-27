const axios = require('axios');
const FormData = require('form-data');
const express = require('express');
const bodyParser = require('body-parser');
const mondaySdk = require('monday-sdk-js');
const PDFDocument = require('pdfkit');
const fs = require('fs');

// אתחול Express וה-Body Parser
const app = express();
app.use(bodyParser.json());

// טוען משתני סביבה מקובץ .env
require('dotenv').config();
const API_KEY = process.env.API_KEY; // קריאה למפתח ה-API מהסביבה

// אתחול SDK של Monday והגדרת הטוקן
const monday = mondaySdk();
monday.setToken(API_KEY);

// פונקציה ליצירת PDF עבור פריט מסוים
async function exportItemToPDF(itemId) {
  try {
    // 1. קריאה לנתוני הפריט מ-Monday באמצעות שאילתה GraphQL
    const query = `query {
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
    }`;
    const response = await monday.api(query);
    const itemData = response.data.items[0];
    if (!itemData) {
      console.log(`Item ${itemId} not found`);
      return;
    }
    
    // 2. יצירת קובץ PDF
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
    
    // המתנה לסיום כתיבת הקובץ ושמירתו בדיסק
    return new Promise((resolve) => {
      stream.on('finish', () => {
        console.log(`PDF created: ${filePath}`);
        resolve(filePath);
      });
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
}

// פונקציה להעלאת קובץ ה-PDF למערכת Monday (לעמודת קבצים)
// ודא שהעמודה במונדיי שבה תרצה להעלות את הקובץ נקראת "files" או שנה זאת בהתאם
async function uploadPDFToMonday(itemId, filePath, columnId = "files") {
  try {
    // כתובת ה-API של Monday להעלאת קבצים (GraphQL file endpoint)
    const url = 'https://api.monday.com/v2/file';
    
    // בונים טופס נתונים (FormData) לשליחת הקובץ
    const form = new FormData();
    const mutation = `
      mutation ($itemId: Int!, $columnId: String!, $file: File!) {
        add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) {
          id
          name
        }
      }
    `;
    form.append('query', mutation);
    form.append('variables', JSON.stringify({ itemId, columnId }));
    form.append('file', fs.createReadStream(filePath));
    
    // שולח בקשת POST ל-Monday עם כותרת Authorization המכילה את ה-API Key
    const response = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': API_KEY
      }
    });
    
    console.log('File uploaded to Monday:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error uploading file to Monday:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// הגדרת מסלול GET לאימות (Monday בודקת את הכתובת עם GET)
app.get('/monday-webhook', (req, res) => {
  res.status(200).send("OK");
});

// הגדרת מסלול POST לקבלת ה-Webhook מ-Monday
app.post('/monday-webhook', async (req, res) => {
  try {
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));
    
    // טיפול במקרה של challenge – אם Monday דורשת אימות
    if (req.body.challenge) {
      return res.json({ challenge: req.body.challenge });
    }
    
    // שליפת itemId מהנתונים (מצופה במבנה { event: { pulseId: ... } })
    const itemId = req.body.event?.pulseId;
    if (!itemId) {
      return res.status(400).send('No itemId found in webhook data');
    }
    
    // יצירת PDF עבור הפריט
    const pdfPath = await exportItemToPDF(itemId);
    
    if (pdfPath) {
      // העלאת הקובץ למערכת Monday (לעמודת קבצים)
      await uploadPDFToMonday(itemId, pdfPath, "files");
    }
    
    // החזרת תשובה ל-Monday להודיע שהכל עבר בהצלחה
    res.status(200).send('PDF generated and uploaded successfully');
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
