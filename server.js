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

// פונקציה לקבלת מבנה הלוח
async function getBoardStructure(boardId) {
  try {
    const query = `query {
      boards(ids: [${boardId}]) {
        columns {
          id
          title
          type
        }
      }
    }`;
    
    const response = await monday.api(query);
    console.log('Board structure:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('Error getting board structure:', error);
    return null;
  }
}

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

// פונקציה להעלאת קובץ ל-Monday עם לוגים מפורטים
async function uploadFileToMonday(itemId, filePath, fileName, boardId) {
  try {
    console.log(`Attempting to upload file: ${filePath} to item: ${itemId}`);
    
    // בדיקה שהקובץ קיים
    if (!fs.existsSync(filePath)) {
      console.error(`File does not exist at path: ${filePath}`);
      return null;
    }
    
    const fileSize = fs.statSync(filePath).size;
    console.log(`File exists. Size: ${fileSize} bytes`);
    
    // קבלת מבנה הלוח לזיהוי עמודת הקבצים
    const boardData = await getBoardStructure(boardId);
    console.log('Retrieved board structure');
    
    // חיפוש עמודת קבצים
    let fileColumnId = "files"; // ברירת מחדל
    if (boardData && boardData.boards && boardData.boards.length > 0) {
      const fileColumn = boardData.boards[0].columns.find(col => col.type === "file");
      if (fileColumn) {
        fileColumnId = fileColumn.id;
        console.log(`Found file column with ID: ${fileColumnId}`);
      } else {
        console.log("No file column found, using default 'files'");
      }
    }
    
    const formData = new FormData();
    formData.append('query', `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: "${fileColumnId}", file: $file) { id } }`);
    
    // קריאת הקובץ לזיכרון ושימוש בתוכן שלו
    const fileContent = fs.readFileSync(filePath);
    formData.append('variables[file]', fileContent, {
      filename: fileName,
      contentType: 'application/pdf',
      knownLength: fileSize
    });

    console.log('Form data prepared, sending request to Monday API...');
    
    const response = await axios({
      method: 'post',
      url: 'https://api.monday.com/v2',
      headers: {
        'Authorization': API_KEY,
        ...formData.getHeaders()
      },
      data: formData,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    console.log('Monday API response:', JSON.stringify(response.data));
    
    // בדיקה אם יש שגיאות בתשובה
    if (response.data.errors) {
      console.error('Monday API returned errors:', JSON.stringify(response.data.errors));
      return null;
    }
    
    // מחיקת הקובץ המקומי לאחר העלאה מוצלחת
    try {
      fs.unlinkSync(filePath);
      console.log(`Local file ${filePath} deleted`);
    } catch (unlinkError) {
      console.error(`Failed to delete local file: ${unlinkError.message}`);
    }
    
    return response.data;
  } catch (error) {
    console.error('Error uploading file to Monday:');
    if (error.response) {
      console.error('Response data:', JSON.stringify(error.response.data));
      console.error('Response status:', error.response.status);
    } else {
      console.error('Error details:', error.message);
    }
    throw error;
  }
}

// נתיב ל-webhook - תומך גם ב-challenge וגם בבקשות רגילות
app.post('/monday-webhook', async (req, res) => {
  try {
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));
    
    // טיפול ב-challenge של Monday.com
    if (req.body.challenge) {
      console.log('Challenge detected, responding with challenge token');
      return res.json({ challenge: req.body.challenge });
    }
    
    // שלוף את ה-itemId מהנתונים
    const itemId = req.body.event?.pulseId;
    if (!itemId) {
      console.error('No itemId found in webhook data');
      return res.status(400).send('No itemId found in webhook data');
    }
    
    console.log(`Processing webhook for item: ${itemId}`);
    
    // הפעל את הפונקציה ליצירת PDF
    const pdfResult = await exportItemToPDF(itemId);
    if (!pdfResult) {
      console.error(`Could not generate PDF for item: ${itemId}`);
      return res.status(404).send('Could not generate PDF - item not found');
    }
    
    // העלה את הקובץ ל-Monday
    console.log('PDF generated successfully, uploading to Monday...');
    await uploadFileToMonday(itemId, pdfResult.filePath, pdfResult.fileName, pdfResult.itemData.board.id);
    
    // החזר תשובה ל-Monday שהכול בסדר
    console.log('Process completed successfully');
    res.status(200).send('PDF generated and uploaded successfully');
  } catch (error) {
    console.error('Error in /monday-webhook:', error);
    res.status(500).send('Server error');
  }
});

// מסלול GET שמחזיר 200 לאימות
app.get('/monday-webhook', (req, res) => {
  console.log('Received GET request for webhook verification');
  res.status(200).send("OK");
});

// הוספת נתיב בדיקה/תקינות
app.get('/health', (req, res) => {
  res.status(200).send({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// נתיב בדיקה ליצירה והעלאה של PDF עבור פריט ספציפי
app.get('/test-pdf/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    console.log(`Testing PDF generation for item: ${itemId}`);
    
    // יצירת PDF
    const pdfResult = await exportItemToPDF(itemId);
    if (!pdfResult) {
      return res.status(404).send('Item not found');
    }
    
    // העלאת הקובץ
    await uploadFileToMonday(itemId, pdfResult.filePath, pdfResult.fileName, pdfResult.itemData.board.id);
    
    res.status(200).send({
      success: true,
      message: 'PDF created and uploaded successfully',
      item: {
        id: itemId,
        name: pdfResult.itemData.name,
        board: pdfResult.itemData.board.name
      }
    });
  } catch (error) {
    console.error('Error in test endpoint:', error);
    res.status(500).send({
      success: false,
      error: error.message
    });
  }
});

// הפעלת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});