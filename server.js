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

        // Filter creative files (videos + images), exclude 'translated' in name
        const creativeFiles = allFiles.filter(entry => 
            entry['.tag'] === 'file' && 
            isCreativeFile(entry.name) &&
            !entry.name.toLowerCase().includes('translated')
        );

        // Extract ID from filename (e.g., ID418_... -> 418)
        function extractId(filename) {
            const match = filename.match(/ID(\d+)/i);
            return match ? parseInt(match[1], 10) : null;
        }

        // Build ID → date map from files that have dates
        const idDateMap = {};
        creativeFiles.forEach(file => {
            const id = extractId(file.name);
            const date = extractDateFromFilename(file.name);
            if (id && date) {
                idDateMap[id] = date;
            }
        });

        // Find date for file: use filename date, or infer from nearest ID (±5)
        function getDateForFile(file) {
            // First try direct date extraction
            const directDate = extractDateFromFilename(file.name);
            if (directDate) return directDate;

            // No date in filename - find nearest ID that has a date
            const fileId = extractId(file.name);
            if (!fileId) {
                // Fallback to server_modified date
                if (file.server_modified) {
                    return file.server_modified.split('T')[0];
                }
                return null;
            }

            // Check IDs ±5 nearby
            const idsWithDates = Object.keys(idDateMap).map(Number);
            let closestId = null;
            let minDiff = Infinity;
            for (const id of idsWithDates) {
                const diff = Math.abs(id - fileId);
                if (diff <= 5 && diff < minDiff) {
                    minDiff = diff;
                    closestId = id;
                }
            }

            if (closestId) return idDateMap[closestId];
            
            // Fallback to server_modified
            if (file.server_modified) {
                return file.server_modified.split('T')[0];
            }
            return null;
        }

        // Group by date with UNIQUE ID counting
        const dateGroups = {};
        const dateUniqueIds = {}; // Track unique IDs per date
        
        creativeFiles.forEach(file => {
            const date = getDateForFile(file);
            if (date) {
                if (!dateGroups[date]) {
                    dateGroups[date] = [];
                    dateUniqueIds[date] = new Set();
                }
                dateGroups[date].push(file.name);
                
                // Track unique IDs (ID418_SK and ID418_HR count as 1)
                const id = extractId(file.name);
                if (id) {
                    dateUniqueIds[date].add(id);
                }
            }
        });

        // Convert to array and sort by date descending
        // Use UNIQUE ID count for success check (10 unique creatives per day)
        const stats = Object.entries(dateGroups)
            .map(([date, files]) => {
                const uniqueCount = dateUniqueIds[date] ? dateUniqueIds[date].size : 0;
                return {
                    date,
                    count: uniqueCount,  // Unique ID count
                    fileCount: files.length,  // Raw file count
                    success: uniqueCount >= 10,
                    files: files,
                    uniqueIds: dateUniqueIds[date] ? Array.from(dateUniqueIds[date]).sort((a,b) => a-b) : []
                };
            })
            .sort((a, b) => b.date.localeCompare(a.date));

        // Calculate total unique IDs
        const allUniqueIds = new Set();
        creativeFiles.forEach(file => {
            const id = extractId(file.name);
            if (id) allUniqueIds.add(id);
        });

        res.json({
            success: true,
            isDemo: false,
            totalCreatives: allUniqueIds.size,  // Unique creative count
            totalFiles: creativeFiles.length,   // Raw file count
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
