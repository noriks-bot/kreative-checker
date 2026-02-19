const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3003;

// Dropbox OAuth (auto-refresh)
const DROPBOX_APP_KEY = 'h7gx1yglwenhrz2';
const DROPBOX_APP_SECRET = '3n4ebxqlqfehwkr';
const DROPBOX_REFRESH_TOKEN = '2HlTHHp3-2QAAAAAAAAAAZD8orXfKnu4Srqe6Us7JrIY_B_NKu0tXb9HWum7CBaE';
const DROPBOX_ROOT = '13547329251';
const DROPBOX_FOLDER = '/NORIKS Team Folder/TEJA - KREATIVE/FINAL CREATIVES 🔥';

let DROPBOX_TOKEN = null;
let tokenExpires = 0;

async function getToken() {
    if (DROPBOX_TOKEN && Date.now() < tokenExpires) return DROPBOX_TOKEN;
    const data = `grant_type=refresh_token&refresh_token=${DROPBOX_REFRESH_TOKEN}&client_id=${DROPBOX_APP_KEY}&client_secret=${DROPBOX_APP_SECRET}`;
    return new Promise((resolve, reject) => {
        const req = https.request({ hostname: 'api.dropboxapi.com', path: '/oauth2/token', method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length }
        }, res => {
            let body = ''; res.on('data', c => body += c);
            res.on('end', () => {
                const j = JSON.parse(body);
                if (j.access_token) { DROPBOX_TOKEN = j.access_token; tokenExpires = Date.now() + j.expires_in * 1000 - 60000; resolve(DROPBOX_TOKEN); }
                else reject(new Error('Token refresh failed'));
            });
        });
        req.on('error', reject); req.write(data); req.end();
    });
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

// Extract ID from filename (e.g. ID418_... -> 418)
function extractId(filename) {
    const m = filename.match(/ID(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
}

// Categorize file
function categorize(filename) {
    const u = filename.toUpperCase();
    return {
        isVideo: u.includes('VIDEO') || u.endsWith('.MP4') || u.endsWith('.MOV'),
        isSlika: u.includes('IMAGE') || u.endsWith('.PNG') || u.endsWith('.JPG') || u.endsWith('.JPEG'),
        isMajice: u.includes('SHIRT'),
        isBokserce: u.includes('BOXER'),
        isStarter: u.includes('STARTER') || u.includes('PACK'),
        isNew: u.includes('NEW') && !u.includes('MIX') && !u.includes('PIRAT'),
        isMix: u.includes('MIX'),
        isPirat: u.includes('PIRAT')
    };
}

// API endpoint to get creative stats
app.get('/api/stats', async (req, res) => {
    try {
        let allFiles = [];
        let cursor = null;
        let hasMore = true;

        while (hasMore) {
            const response = await dropboxListFolder(DROPBOX_FOLDER, cursor);
            allFiles = allFiles.concat(response.entries);
            hasMore = response.has_more;
            cursor = response.cursor;
        }

        const creativeFiles = allFiles.filter(entry => 
            entry['.tag'] === 'file' && isCreativeFile(entry.name)
        );

        // Build ID -> date map for date inference
        const idDateMap = {};
        creativeFiles.forEach(f => {
            const id = extractId(f.name);
            const date = extractDateFromFilename(f.name);
            if (id && date) idDateMap[id] = date;
        });

        // Get date for file (with inference from nearest ID ±5)
        function getDate(file) {
            let date = extractDateFromFilename(file.name);
            if (date) return date;
            const id = extractId(file.name);
            if (id) {
                let closest = null, minDiff = 6;
                for (const [k, v] of Object.entries(idDateMap)) {
                    const diff = Math.abs(parseInt(k) - id);
                    if (diff < minDiff) { minDiff = diff; closest = v; }
                }
                if (closest) return closest;
            }
            return file.server_modified ? file.server_modified.split('T')[0] : null;
        }

        // Group by date with unique ID counting for ALL categories
        const dateGroups = {};
        const totalVideoIds = new Set();
        const totalSlikaIds = new Set();
        const totalMajiceIds = new Set();
        const totalBokserceIds = new Set();
        const totalStarterIds = new Set();
        const totalNewIds = new Set();
        const totalPiratIds = new Set();
        const totalMixIds = new Set();

        creativeFiles.forEach(file => {
            const date = getDate(file);
            if (!date) return;
            
            if (!dateGroups[date]) {
                dateGroups[date] = { 
                    ids: new Set(), 
                    videoIds: new Set(),
                    slikaIds: new Set(),
                    majiceIds: new Set(),
                    bokserceIds: new Set(),
                    starterIds: new Set(),
                    newIds: new Set(),
                    piratIds: new Set(),
                    mixIds: new Set(),
                    files: []
                };
            }
            
            const id = extractId(file.name);
            if (id) dateGroups[date].ids.add(id);
            dateGroups[date].files.push(file.name);
            
            const cat = categorize(file.name);
            
            // Count ALL categories by unique ID only
            if (id) {
                if (cat.isVideo) { dateGroups[date].videoIds.add(id); totalVideoIds.add(id); }
                if (cat.isSlika) { dateGroups[date].slikaIds.add(id); totalSlikaIds.add(id); }
                if (cat.isMajice) { dateGroups[date].majiceIds.add(id); totalMajiceIds.add(id); }
                if (cat.isBokserce) { dateGroups[date].bokserceIds.add(id); totalBokserceIds.add(id); }
                if (cat.isStarter) { dateGroups[date].starterIds.add(id); totalStarterIds.add(id); }
                if (cat.isNew) { dateGroups[date].newIds.add(id); totalNewIds.add(id); }
                if (cat.isPirat) { dateGroups[date].piratIds.add(id); totalPiratIds.add(id); }
                if (cat.isMix) { dateGroups[date].mixIds.add(id); totalMixIds.add(id); }
            }
        });
        
        const totals = {
            VIDEO: totalVideoIds.size,
            SLIKA: totalSlikaIds.size,
            MAJICE: totalMajiceIds.size,
            BOKSERCE: totalBokserceIds.size,
            STARTER: totalStarterIds.size,
            NEW: totalNewIds.size,
            PIRAT: totalPiratIds.size,
            MIX: totalMixIds.size
        };

        // Calculate total unique IDs
        const allIds = new Set();
        creativeFiles.forEach(f => { const id = extractId(f.name); if (id) allIds.add(id); });

        // Build stats array - count = unique IDs, filter only 2026 dates
        const stats = Object.entries(dateGroups)
            .filter(([date]) => date.startsWith('2026'))
            .map(([date, data]) => ({
                date,
                count: data.ids.size,
                success: data.ids.size >= 10,
                format: { 
                    VIDEO: data.videoIds.size, 
                    SLIKA: data.slikaIds.size 
                },
                products: { 
                    MAJICE: data.majiceIds.size, 
                    BOKSERCE: data.bokserceIds.size, 
                    STARTER: data.starterIds.size 
                },
                version: { 
                    NEW: data.newIds.size, 
                    PIRAT: data.piratIds.size, 
                    MIX: data.mixIds.size 
                },
                files: data.files
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        res.json({
            success: true,
            isDemo: false,
            totalCreatives: allIds.size,
            totalDays: stats.length,
            totals: { format: { VIDEO: totals.VIDEO, SLIKA: totals.SLIKA }, products: { MAJICE: totals.MAJICE, BOKSERCE: totals.BOKSERCE, STARTER: totals.STARTER }, version: { NEW: totals.NEW, PIRAT: totals.PIRAT, MIX: totals.MIX } },
            stats
        });

    } catch (error) {
        console.error('Dropbox error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Kreative Checker running on port ${PORT}`);
});
