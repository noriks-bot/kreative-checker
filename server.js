const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3003;

// Dropbox OAuth config
const DROPBOX_APP_KEY = 'h7gx1yglwenhrz2';
const DROPBOX_APP_SECRET = '3n4ebxqlqfehwkr';
const DROPBOX_REFRESH_TOKEN = '2HlTHHp3-2QAAAAAAAAAAZD8orXfKnu4Srqe6Us7JrIY_B_NKu0tXb9HWum7CBaE';
const DROPBOX_ROOT = '13547329251';
const DROPBOX_FOLDER = '/NORIKS Team Folder/TEJA - KREATIVE/FINAL CREATIVES 🔥';

// Token cache
let accessToken = null;
let tokenExpiresAt = 0;

// Helper: make HTTPS request
function httpsRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

// Get valid access token (auto-refresh if expired)
async function getAccessToken() {
    const now = Date.now();
    
    // Return cached token if still valid (with 5 min buffer)
    if (accessToken && tokenExpiresAt > now + 300000) {
        return accessToken;
    }
    
    console.log('Refreshing Dropbox access token...');
    
    const postData = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: DROPBOX_REFRESH_TOKEN,
        client_id: DROPBOX_APP_KEY,
        client_secret: DROPBOX_APP_SECRET
    }).toString();
    
    const options = {
        hostname: 'api.dropboxapi.com',
        path: '/oauth2/token',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
        }
    };
    
    const result = await httpsRequest(options, postData);
    
    if (result.status !== 200 || !result.data.access_token) {
        console.error('Token refresh failed:', result.data);
        throw new Error(`Token refresh failed: ${JSON.stringify(result.data)}`);
    }
    
    accessToken = result.data.access_token;
    tokenExpiresAt = now + (result.data.expires_in * 1000);
    
    console.log('Access token refreshed successfully, expires in', result.data.expires_in, 'seconds');
    return accessToken;
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Extract date from filename - FLEXIBLE parsing
function extractDateFromFilename(filename) {
    let day, month, year;
    
    let match = filename.match(/ID\d+[_-](\d{2})-(\d{2})-(\d{2})[_-]/);
    if (match) { [, day, month, year] = match; return `20${year}-${month}-${day}`; }
    
    match = filename.match(/ID\d+_(\d{2})_(\d{2})_(\d{2})_/);
    if (match) { [, day, month, year] = match; return `20${year}-${month}-${day}`; }
    
    match = filename.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (match) { [, day, month, year] = match; return `${year}-${month}-${day}`; }
    
    match = filename.match(/(\d{2})_(\d{2})_(\d{4})/);
    if (match) { [, day, month, year] = match; return `${year}-${month}-${day}`; }
    
    match = filename.match(/(\d{2})-(\d{2})-(\d{2})(?!\d)/);
    if (match) { [, day, month, year] = match; return `20${year}-${month}-${day}`; }
    
    match = filename.match(/(\d{2})_(\d{2})_(\d{2})(?!\d)/);
    if (match) { [, day, month, year] = match; return `20${year}-${month}-${day}`; }
    
    match = filename.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
    if (match) { [, day, month, year] = match; if (year.length === 2) year = `20${year}`; return `${year}-${month}-${day}`; }
    
    return null;
}

// Creative file extensions
const CREATIVE_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff'];

function isCreativeFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return CREATIVE_EXTENSIONS.includes(ext);
}

// Dropbox API call
async function dropboxListFolder(folderPath, cursor = null) {
    const token = await getAccessToken();
    
    const apiPath = cursor ? '/2/files/list_folder/continue' : '/2/files/list_folder';
    const body = cursor ? { cursor } : { path: folderPath, recursive: true, limit: 2000 };
    const postData = JSON.stringify(body);
    
    const options = {
        hostname: 'api.dropboxapi.com',
        path: apiPath,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'Dropbox-API-Path-Root': JSON.stringify({".tag": "root", "root": DROPBOX_ROOT})
        }
    };

    const result = await httpsRequest(options, postData);
    
    if (result.status === 401) {
        // Token expired, clear cache and retry
        console.log('Token expired, refreshing...');
        accessToken = null;
        tokenExpiresAt = 0;
        const newToken = await getAccessToken();
        
        options.headers['Authorization'] = `Bearer ${newToken}`;
        const retryResult = await httpsRequest(options, postData);
        
        if (retryResult.status !== 200) {
            throw new Error(`Dropbox API error (${retryResult.status}): ${JSON.stringify(retryResult.data)}`);
        }
        return retryResult.data;
    }
    
    if (result.status !== 200) {
        throw new Error(`Dropbox API error (${result.status}): ${JSON.stringify(result.data)}`);
    }

    return result.data;
}

// Cache for stats
let statsCache = null;
let statsCacheTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// API endpoint
app.get('/api/stats', async (req, res) => {
    const forceRefresh = req.query.refresh === 'true';
    const now = Date.now();
    
    if (!forceRefresh && statsCache && (now - statsCacheTime) < CACHE_DURATION) {
        return res.json({ ...statsCache, cached: true, cacheAge: Math.round((now - statsCacheTime) / 1000) });
    }
    
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

        const creativeFiles = allFiles.filter(entry => {
            if (entry['.tag'] !== 'file') return false;
            if (!isCreativeFile(entry.name)) return false;
            // Exclude files with TRANS in name
            if (entry.name.toUpperCase().includes('TRANS')) return false;
            // Exclude files in TRANSLATED_CREATIVES folder
            if (entry.path_display && entry.path_display.toUpperCase().includes('TRANSLATED_CREATIVES')) return false;
            return true;
        });

        // Categorize files
        function categorizeFile(filename) {
            const upper = filename.toUpperCase();
            const format = { VIDEO: 0, SLIKA: 0 };
            const products = { MAJICE: 0, BOKSERCE: 0, STARTER: 0 };
            const version = { NEW: 0, MIX: 0 };
            
            // Format (VIDEO / SLIKA)
            if (upper.includes('VIDEO')) format.VIDEO = 1;
            else if (upper.includes('IMAGE') || upper.includes('.PNG') || upper.includes('.JPG') || upper.includes('.JPEG')) format.SLIKA = 1;
            
            // Product (MAJICE / BOKSERCE / STARTER)
            if (upper.includes('SHIRT')) products.MAJICE = 1;
            if (upper.includes('BOXER')) products.BOKSERCE = 1;
            if (upper.includes('STARTER') || upper.includes('PACK')) products.STARTER = 1;
            
            // Version (NEW / MIX)
            if (upper.includes('MIX')) version.MIX = 1;
            else if (upper.includes('NEW')) version.NEW = 1;
            
            return { format, products, version };
        }

        const dateGroups = {};
        creativeFiles.forEach(file => {
            const date = extractDateFromFilename(file.name);
            if (date) {
                if (!dateGroups[date]) {
                    dateGroups[date] = {
                        files: [],
                        format: { VIDEO: 0, SLIKA: 0 },
                        products: { MAJICE: 0, BOKSERCE: 0, STARTER: 0 },
                        version: { NEW: 0, MIX: 0 }
                    };
                }
                dateGroups[date].files.push(file.name);
                
                const cats = categorizeFile(file.name);
                dateGroups[date].format.VIDEO += cats.format.VIDEO;
                dateGroups[date].format.SLIKA += cats.format.SLIKA;
                dateGroups[date].products.MAJICE += cats.products.MAJICE;
                dateGroups[date].products.BOKSERCE += cats.products.BOKSERCE;
                dateGroups[date].products.STARTER += cats.products.STARTER;
                dateGroups[date].version.NEW += cats.version.NEW;
                dateGroups[date].version.MIX += cats.version.MIX;
            }
        });

        // Calculate totals
        const totals = {
            format: { VIDEO: 0, SLIKA: 0 },
            products: { MAJICE: 0, BOKSERCE: 0, STARTER: 0 },
            version: { NEW: 0, MIX: 0 }
        };

        const stats = Object.entries(dateGroups)
            .map(([date, data]) => {
                totals.format.VIDEO += data.format.VIDEO;
                totals.format.SLIKA += data.format.SLIKA;
                totals.products.MAJICE += data.products.MAJICE;
                totals.products.BOKSERCE += data.products.BOKSERCE;
                totals.products.STARTER += data.products.STARTER;
                totals.version.NEW += data.version.NEW;
                totals.version.MIX += data.version.MIX;
                
                return {
                    date,
                    count: data.files.length,
                    success: data.files.length >= 10,
                    format: data.format,
                    products: data.products,
                    version: data.version,
                    files: data.files
                };
            })
            .sort((a, b) => b.date.localeCompare(a.date));

        const result = {
            success: true,
            isDemo: false,
            totalCreatives: creativeFiles.length,
            totalDays: stats.length,
            totals,
            stats,
            lastRefresh: new Date().toISOString()
        };
        
        statsCache = result;
        statsCacheTime = now;
        res.json(result);

    } catch (error) {
        console.error('Dropbox error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/refresh', (req, res) => {
    statsCache = null;
    statsCacheTime = 0;
    res.json({ success: true, message: 'Cache cleared' });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        tokenValid: !!(accessToken && tokenExpiresAt > Date.now()),
        cacheAge: statsCache ? Math.round((Date.now() - statsCacheTime) / 1000) : null
    });
});

app.listen(PORT, () => {
    console.log(`Kreative Checker running on port ${PORT}`);
    getAccessToken().then(() => console.log('Initial token ready')).catch(err => console.error('Initial token failed:', err.message));
});
