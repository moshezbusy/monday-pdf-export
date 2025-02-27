const express = require('express');
const bodyParser = require('body-parser');
const mondaySdk = require('monday-sdk-js');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(bodyParser.json());

// אתחול ה-SDK עם המפתח שלך
const monday = mondaySdk();
require('dotenv').config();
const API_KEY = process.env.API_KEY;
monday.setToken(API_KEY);

// פונקציית עזר - מקבלת itemId ויוצרת PDF
async function exportItemToPDF(itemId) {
  try {
    // 1. הבאת נתוני ה-item
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
          id
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
      return null;
    }
    
    // 2. יצירת PDF
    const doc = new PDFDocument();
    const fileName = `item_${itemId}_${Date.now()}.pdf`;
    const filePath = path.join(__dirname, fileName);
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
        resolve({
          filePath,
          fileName,
          itemData
        });
      });
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
}

// פונקציה חדשה להעלאת קובץ ל-Monday
async function uploadFileToMonday(itemId, filePath, fileName) {
  try {
    const formData = new FormData();
    formData.append('query', `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: "files", file: $file) { id } }`);
    formData.append('variables[file]', fs.createReadStream(filePath), {
      filename: fileName,
      contentType: 'application/pdf'
    });

    const response = await axios({
      method: 'post',
      url: 'https://api.monday.com/v2',
      headers: {
        'Authorization': API_KEY,
        ...formData.getHeaders()
      },
      data: formData
    });

    console.log('File upload response:', response.data);
    
    // מחיקת הקובץ המקומי לאחר העלאה
    fs.unlinkSync(filePath);
    
    return response.data;
  } catch (error) {
    console.error('Error uploading file to Monday:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// נתיב ל-webhook - תומך גם ב-challenge וגם בבקשות רגילות
app.post('/monday-webhook', async (req, res) => {
  try {
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));
    
    // טיפול ב-challenge של Monday.com
    if (req.body.challenge) {
      return res.json({ challenge: req.body.challenge });
    }
    
    // שלוף את ה-itemId מהנתונים
    const itemId = req.body.event?.pulseId;
    if (!itemId) {
      return res.status(400).send('No itemId found in webhook data');
    }
    
    // הפעל את הפונקציה ליצירת PDF
    const pdfResult = await exportItemToPDF(itemId);
    if (!pdfResult) {
      return res.status(404).send('Could not generate PDF - item not found');
    }
    
    // העלה את הקובץ ל-Monday
    await uploadFileToMonday(itemId, pdfResult.filePath, pdfResult.fileName);
    
    // החזר תשובה ל-Monday שהכול בסדר
    res.status(200).send('PDF generated and uploaded successfully');
  } catch (error) {
    console.error('Error in /monday-webhook:', error);
    res.status(500).send('Server error');
  }
});

// מסלול GET שמחזיר 200 לאימות
app.get('/monday-webhook', (req, res) => {
  res.status(200).send("OK");
});

// הפעלת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});