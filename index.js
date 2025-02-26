require('dotenv').config();       // טוען את הקובץ .env
const API_KEY = process.env.API_KEY;  // קורא את המפתח מהסביבה

const mondaySdk = require('monday-sdk-js');
const PDFDocument = require('pdfkit');
const fs = require('fs');

// Initialize the Monday SDK
const monday = mondaySdk();
monday.setToken(API_KEY);         // משתמש במפתח שקראת מהסביבה

// פונקציה לקבלת נתוני item מ-Monday.com
async function getItemData(itemId) {
  try {
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
    console.log(JSON.stringify(response, null, 2));
    return response.data.items[0];
  } catch (error) {
    console.error('Error fetching item data:', error);
    throw error;
  }
}

// פונקציה ליצירת קובץ PDF מהנתונים שהתקבלו
async function generatePDF(itemData, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(outputPath);

      stream.on('finish', () => {
        console.log(`PDF saved to ${outputPath}`);
        resolve(outputPath);
      });

      doc.pipe(stream);

      // הוספת כותרת עם שם ה-item
      doc.fontSize(20).text(`Item: ${itemData.name}`, { align: 'center' });
      doc.moveDown();

      // הוספת פרטי הלוח והקבוצה
      doc.fontSize(14).text(`Board: ${itemData.board.name}`);
      doc.fontSize(14).text(`Group: ${itemData.group.title}`);
      doc.moveDown();

      // הוספת הערכים מהעמודות
      doc.fontSize(16).text('Fields:', { underline: true });
      doc.moveDown();

      itemData.column_values.forEach(column => {
        if (column.text) {
          doc.fontSize(12).text(`${column.title}: ${column.text}`);
        }
      });

      doc.end();
    } catch (error) {
      console.error('Error generating PDF:', error);
      reject(error);
    }
  });
}

// פונקציה ראשית לייצוא ה-item לקובץ PDF
async function exportItemToPDF(itemId, outputPath = './item.pdf') {
  try {
    console.log(`Fetching data for item #${itemId}...`);
    const itemData = await getItemData(itemId);

    if (!itemData) {
      console.error('Item not found or API error occurred');
      return {
        success: false,
        message: 'Item not found or API error occurred'
      };
    }

    console.log('Generating PDF...');
    const pdfPath = await generatePDF(itemData, outputPath);

    return {
      success: true,
      message: `PDF file successfully created at ${pdfPath}`,
      pdfPath
    };
  } catch (error) {
    console.error('Error:', error.message);
    return {
      success: false,
      message: 'Failed to generate PDF',
      error: error.message
    };
  }
}

// החלף את ה-itemId למזהה המתאים (אפשר למצוא אותו מתוך הלוח ב-Monday)
const itemId = 1830844917;
const outputPath = './item.pdf';

// הרצת הפונקציה
exportItemToPDF(itemId, outputPath)
  .then(result => {
    if (result.success) {
      console.log(result.message);
    } else {
      console.error(result.message);
    }
  });
