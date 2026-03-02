const fs = require("fs");
const path = require("path");

class EncodingFixer {
    constructor() {
        this.convertedFiles = [];
    }

    processFile(filePath) {
        try {
            // Читаем файл как байты
            const buffer = fs.readFileSync(filePath);
            let content = "";
            
            // Пробуем разные кодировки
            try {
                content = buffer.toString("utf8");
            } catch {
                try {
                    content = buffer.toString("latin1");
                } catch {
                    content = buffer.toString();
                }
            }
            
            // Убираем BOM если есть
            if (content.charCodeAt(0) === 0xFEFF) {
                content = content.substring(1);
            }
            
            // Исправляем common mojibake
            content = this.fixCommonMojibake(content);
            
            // Для HTML файлов добавляем charset если нет
            if (filePath.endsWith(".html") || filePath.endsWith(".htm")) {
                content = this.ensureMetaCharset(content);
            }
            
            // Нормализуем переводы строк
            content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            
            // Сохраняем в UTF-8 без BOM
            fs.writeFileSync(filePath, content, "utf8");
            
            this.convertedFiles.push(filePath);
            console.log(`✓ Fixed: ${path.relative(process.cwd(), filePath)}`);
            
            return true;
        } catch (error) {
            console.error(`✗ Error fixing ${filePath}:`, error.message);
            return false;
        }
    }
    
    fixCommonMojibake(text) {
        const fixes = [
            { from: /на/g, to: "на" },
            { from: /им/gi, to: "им" },
            { from: /ва/g, to: "ва" },
            { from: /ры/g, to: "ры" },
            { from: /для/g, to: "для" },
            { from: /про/gi, to: "про" },
            { from: / /g, to: " " },
            { from: /&/g, to: "&" },
            { from: /</g, to: "<" },
            { from: />/g, to: ">" },
            { from: /"/g, to: '"' },
            { from: /'/g, to: "'" }
        ];
        
        let fixed = text;
        fixes.forEach(fix => {
            fixed = fixed.replace(fix.from, fix.to);
        });
        
        return fixed;
    }
    
    ensureMetaCharset(html) {
        if (!/<meta[^>]*charset[^>]*>/i.test(html)) {
            if (html.includes("<head>")) {
                return html.replace("<head>", '<head>\n<meta charset="UTF-8">');
            }
        }
        return html;
    }
    
    processDirectory(dirPath) {
        if (!fs.existsSync(dirPath)) {
            console.log(`Directory not found: ${dirPath}`);
            return;
        }
        
        const extensions = [".html", ".htm", ".js", ".css", ".txt", ".md", ".json"];
        
        const items = fs.readdirSync(dirPath);
        items.forEach(item => {
            const fullPath = path.join(dirPath, item);
            
            try {
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    // Пропускаем системные папки
                    if (!["node_modules", ".git", ".vscode", ".idea"].includes(item)) {
                        this.processDirectory(fullPath);
                    }
                } else if (extensions.some(ext => item.toLowerCase().endsWith(ext))) {
                    this.processFile(fullPath);
                }
            } catch (error) {
                console.error(`Error accessing ${fullPath}:`, error.message);
            }
        });
    }
    
    generateReport() {
        console.log("\n" + "=".repeat(60));
        console.log("ENCODING FIX REPORT");
        console.log("=".repeat(60));
        console.log(`\nTotal files processed: ${this.convertedFiles.length}`);
        
        if (this.convertedFiles.length > 0) {
            console.log("\nFixed files:");
            this.convertedFiles.forEach((file, i) => {
                console.log(`${i + 1}. ${path.relative(process.cwd(), file)}`);
            });
        }
    }
}

// Main execution
const fixer = new EncodingFixer();

console.log("Starting encoding fix...\n");

// Process common directories
const directories = [
    ".",
    "./html",
    "./public",
    "./src"
].filter(dir => fs.existsSync(dir));

directories.forEach(dir => {
    console.log(`Processing directory: ${dir}`);
    fixer.processDirectory(dir);
});

fixer.generateReport();
console.log("\nEncoding fix completed!");
