// tools/converter.js
const fs = require('fs');
const path = require('path');

// Base directory: ../data/ relative to this script
const DATA_DIR = path.join(__dirname, '../data');

function parseTxtDatabase(filename) {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    let currentCategory = 'General Knowledge';
    const questions = [];
    
    let i = 0;
    while (i < lines.length) {
        let line = lines[i].trim();
        
        // 1. Detect Category Headers (e.g., "General Anime", "English (1-50)")
        if (line.startsWith('---')) {
            i++;
            continue;
        }
        
        if (line && !line.match(/^\d+\./) && !line.match(/^[A-D]\)/) && line.length > 3 && !line.includes('continues:')) {
            const cleanedHeader = line.replace(/\([\d\s–\-of]+\)/g, '').replace(':', '').trim();
            if (cleanedHeader && cleanedHeader.length > 2 && isNaN(cleanedHeader.charAt(0))) {
                currentCategory = cleanedHeader;
                console.log(`📂 [CONVERTER] Switched to category: "${currentCategory}"`);
                i++;
                continue;
            }
        }

        // 2. Detect Question Block starting with a number
        const questionMatch = line.match(/^(\d+)\.\s*(.+)$/);
        if (questionMatch) {
            const qText = questionMatch[2].trim();
            const options = [];
            
            let optCount = 0;
            let j = i + 1;
            while (optCount < 4 && j < lines.length) {
                const optLine = lines[j].trim();
                if (optLine.match(/^[A-D]\)/)) {
                    options.push(optLine);
                    optCount++;
                }
                j++;
            }
            
            if (options.length === 4) {
                questions.push({
                    category: currentCategory,
                    q: qText,
                    options: options
                });
                i = j - 1;
            }
        }
        i++;
    }
    
    return questions;
}

function runConversion() {
    console.log("⚡ Starting database conversion process...");

    // Convert quiz.txt
    const quizData = parseTxtDatabase('quiz.txt');
    if (quizData && quizData.length > 0) {
        const outputPath = path.join(DATA_DIR, 'quiz.js');
        const fileContent = `// quiz.js\n\nmodule.exports = ${JSON.stringify(quizData, null, 4)};\n`;
        fs.writeFileSync(outputPath, fileContent, 'utf-8');
        console.log(`✅ [QUIZ] Successfully generated quiz.js with ${quizData.length} questions.`);
        // Delete the original .txt file
        const txtPath = path.join(DATA_DIR, 'quiz.txt');
        if (fs.existsSync(txtPath)) {
            fs.unlinkSync(txtPath);
            console.log(`🗑️ [QUIZ] Deleted quiz.txt`);
        }
    } else {
        console.warn("⚠️ [QUIZ] No data found or file missing. Skipping.");
    }

    // Convert millionaire.txt
    const millionaireData = parseTxtDatabase('millionaire.txt');
    if (millionaireData && millionaireData.length > 0) {
        const outputPath = path.join(DATA_DIR, 'millionaire.js');
        const fileContent = `// millionaire.js\n\nmodule.exports = ${JSON.stringify(millionaireData, null, 4)};\n`;
        fs.writeFileSync(outputPath, fileContent, 'utf-8');
        console.log(`✅ [MILLIONAIRE] Successfully generated millionaire.js with ${millionaireData.length} questions.`);
        // Delete the original .txt file
        const txtPath = path.join(DATA_DIR, 'millionaire.txt');
        if (fs.existsSync(txtPath)) {
            fs.unlinkSync(txtPath);
            console.log(`🗑️ [MILLIONAIRE] Deleted millionaire.txt`);
        }
    } else {
        console.warn("⚠️ [MILLIONAIRE] No data found or file missing. Skipping.");
    }

    console.log("\n🎉 Database conversion complete! You can now safely delete converter.js (if desired).");
}

runConversion();