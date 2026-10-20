const fs = require('fs');
const path = require('path');

const targetDir = 'C:/Users/uncom/Desktop/allie/buyasoul-core';
const oldPort1 = '50000';
const newPort1 = '50000';
const oldPort2 = '50001';
const newPort2 = '50001';

function remapPorts(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;

    content = content.replace(new RegExp(oldPort1, 'g'), newPort1);
    content = content.replace(new RegExp(oldPort2, 'g'), newPort2);

    if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`[PORT_REMAP] Modified: ${filePath}`);
    }
}

function walkSync(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            fileList = walkSync(filePath, fileList);
        } else {
            if (filePath.match(/\.(js|json|env)$/)) {
                fileList.push(filePath);
            }
        }
    });
    return fileList;
}

console.log(`[PORT_REMAP] Initiating port re-mapping in ${targetDir}`);
const filesToProcess = walkSync(targetDir);
filesToProcess.forEach(remapPorts);
console.log(`[PORT_REMAP] Port re-mapping complete.`);
