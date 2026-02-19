const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3003;

// Dropbox OAuth config (auto-refresh token)
const DROPBOX_APP_KEY = 'h7gx1yglwenhrz2';
const DROPBOX_APP_SECRET = '3n4ebxqlqfehwkr';
const DROPBOX_REFRESH_TOKEN = '2HlTHHp3-2QAAAAAAAAAAZD8orXfKnu4Srqe6Us7JrIY_B_NKu0tXb9HWum7CBaE';
const DROPBOX_ROOT = '13547329251';
const DROPBOX_FOLDER = '/NORIKS Team Folder/TEJA - KREATIVE/FINAL CREATIVES 🔥';

// Token cache
let DROPBOX_TOKEN = null;
let tokenExpiresAt = 0;

// Refresh access token
async function refreshToken() {
    const postData = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: DROPBOX_REFRESH_TOKEN,
        client_id: DROPBOX_APP_KEY,
        client_secret: DROPBOX_APP_SECRET
    }).toString();
    
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.dropboxapi.com',
            path: '/oauth2/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.access_token) {
                        DROPBOX_TOKEN = json.access_token;
                        tokenExpiresAt = Date.now() + (json.expires_in * 1000) - 300000;
                        console.log('Token refreshed, expires in', json.expires_in, 'seconds');
                        resolve(DROPBOX_TOKEN);
                    } else {
                        reject(new Error('No access_token in response'));
                    }
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function getToken() {
    if (!DROPBOX_TOKEN || Date.now() > tokenExpiresAt) {
        await refreshToken();
    }
    return DROPBOX_TOKEN;
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Extract date from filename - FLEXIBLE parsing
function extractDateFromFilename(filename) {
    let day, month, year;
    
    // Pattern 1: ID###_DD-MM-YY_ (primary format)
    let match = filename.match(/ID\d+[_-](\d{2})-(\d{2})-(\d{2})[_-]/);
    if (match) {
        [, day, month, year] = match;
        return `20${year}-${month}-${day}`;
    }
    
    // Pattern 2: ID###_DD_MM_YY_
    match = filename.match(/ID\d+_(\d{2})_(\d{2})_(\d{2})_/);
    if (match) {
        [, day, month, year] = match;
        return `20${year}-${month}-${day}`;
    }
    
    // Pattern 3: DD-MM-YYYY
    match = filename.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (match) {
        [, day, month, year] = match;
        return `${year}-${month}-${day}`;
    }
    
    // Pattern 4: DD_MM_YYYY
    match = filename.match(/(\d{2})_(\d{2})_(\d{4})/);
    if (match) {
        [, day, month, year] = match;
        return `${year}-${month}-${day}`;
    }
    
    // Pattern 5: DD-MM-YY anywhere
    match = filename.match(/(\d{2})-(\d{2})-(\d{2})(?!\d)/);
    if (match) {
        [, day, month, year] = match;
        return `20${year}-${month}-${day}`;
    }
    
    // Pattern 6: DD_MM_YY anywhere
    match = filename.match(/(\d{2})_(\d{2})_(\d{2})(?!\d)/);
    if (match) {
        [, day, month, year] = match;
        return `20${year}-${month}-${day}`;
    }
    
    // Pattern 7: DD.MM.YY or DD.MM.YYYY
    match = filename.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
    if (match) {
        [, day, month, year] = match;
        if (year.length === 2) year = `20${year}`;
        return `${year}-${month}-${day}`;
    }
    
    return null;
}

// Creative file extensions (videos + images)
const CREATIVE_EXTENSIONS = [
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv',  // videos
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff'         // images
];

function isCreativeFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return CREATIVE_EXTENSIONS.includes(ext);
}

// Dropbox API call with team folder access
async function dropboxListFolder(folderPath, cursor = null) {
    const token = await getToken();
    
    const url = cursor 
        ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
        : 'https://api.dropboxapi.com/2/files/list_folder';
    
    const body = cursor 
        ? { cursor }
        : { path: folderPath, recursive: true, limit: 2000 };

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Dropbox-API-Path-Root': JSON.stringify({".tag": "root", "root": DROPBOX_ROOT})
    };

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Dropbox API error (${response.status}): ${errorText}`);
    }

    return response.json();
}

// API endpoint to get creative stats
app.get('/api/stats', async (req, res) => {
    try {
        let allFiles = [];
        let cursor = null;
        let hasMore = true;

        // Fetch all files from Dropbox (handle pagination)
        while (hasMore) {
            const response = await dropboxListFolder(DROPBOX_FOLDER, cursor);
            allFiles = allFiles.concat(response.entries);
            hasMore = response.has_more;
            cursor = response.cursor;
        }

        // Filter creative files, exclude 'translated'
        const creativeFiles = allFiles.filter(entry => 
            entry['.tag'] === 'file' && 
            isCreativeFile(entry.name) &&
            !entry.name.toLowerCase().includes('translated')
        );

        // Extract ID from filename
        function extractId(name) {
            const m = name.match(/ID(\d+)/i);
            return m ? parseInt(m[1], 10) : null;
        }

        // Build ID→date map
        const idDateMap = {};
        creativeFiles.forEach(f => {
            const id = extractId(f.name);
            const date = extractDateFromFilename(f.name);
            if (id && date) idDateMap[id] = date;
        });

        // Get date for file (infer from nearest ID ±5 if missing)
        function getDate(file) {
            let date = extractDateFromFilename(file.name);
            if (date) return date;
            
            const id = extractId(file.name);
            if (!id) return file.server_modified ? file.server_modified.split('T')[0] : null;
            
            // Find nearest ID within ±5
            let closest = null, minDiff = 6;
            for (const [k, v] of Object.entries(idDateMap)) {
                const diff = Math.abs(parseInt(k) - id);
                if (diff < minDiff) { minDiff = diff; closest = v; }
            }
            return closest || (file.server_modified ? file.server_modified.split('T')[0] : null);
        }

        // Categorize file: PIRAT, MIX, or Main
        function getCategory(name) {
            const upper = name.toUpperCase();
            if (upper.includes('PIRAT')) return 'PIRAT';
            if (upper.includes('MIX')) return 'MIX';
            return 'Main';
        }

        // Group by date, track unique IDs per category
        const dateGroups = {};
        const dateIds = {};
        const dateCategories = {}; // {date: {Main: Set, PIRAT: Set, MIX: Set}}
        
        creativeFiles.forEach(file => {
            const date = getDate(file);
            if (!date) return;
            if (!dateGroups[date]) { 
                dateGroups[date] = []; 
                dateIds[date] = new Set();
                dateCategories[date] = { Main: new Set(), PIRAT: new Set(), MIX: new Set() };
            }
            dateGroups[date].push(file.name);
            const id = extractId(file.name);
            if (id) {
                dateIds[date].add(id);
                const cat = getCategory(file.name);
                dateCategories[date][cat].add(id);
            }
        });

        // Stats: count = unique IDs, include categories
        const stats = Object.entries(dateGroups)
            .map(([date, files]) => {
                const cats = dateCategories[date] || { Main: new Set(), PIRAT: new Set(), MIX: new Set() };
                return {
                    date,
                    count: dateIds[date] ? dateIds[date].size : files.length,
                    success: (dateIds[date] ? dateIds[date].size : files.length) >= 10,
                    categories: {
                        Main: cats.Main.size,
                        PIRAT: cats.PIRAT.size,
                        MIX: cats.MIX.size
                    },
                    files
                };
            })
            .sort((a, b) => b.date.localeCompare(a.date));

        const allIds = new Set();
        creativeFiles.forEach(f => { const id = extractId(f.name); if (id) allIds.add(id); });

        res.json({
            success: true,
            isDemo: false,
            totalCreatives: allIds.size,
            totalDays: stats.length,
            stats
        });

    } catch (error) {
        console.error('Dropbox error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Kreative Checker running on port ${PORT}`);
});
