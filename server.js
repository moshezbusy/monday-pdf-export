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

// פונקציה להעלאת קובץ ל-Monday
async function uploadFileToMonday(itemId, filePath, fileName) {
  try {
    console.log(`Attempting to upload file: ${filePath} to item: ${itemId}`);
    
    // בדיקה שהקובץ קיים
    if (!fs.existsSync(filePath)) {
      console.error(`File does not exist at path: ${filePath}`);
      return null;
    }
    
    const fileSize = fs.statSync(filePath).size;
    console.log(`File exists. Size: ${fileSize} bytes`);
    
    const formData = new FormData();
    formData.append('query', `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: "files", file: $file) { id } }`);
    
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