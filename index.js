// FILE: index.js - Facebook Automation Server
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Data directory for persistence
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// File paths
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LOG_FILE = path.join(DATA_DIR, 'logs.json');
const COOKIES_FILE = path.join(DATA_DIR, 'cookies.txt');

// Load configuration
let config = {
    groupUid: '',
    haterName: '',
    dailySeconds: 60,
    isRunning: false,
    activeTask: null
};

// Load existing config
if (fs.existsSync(CONFIG_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        config = { ...config, ...saved };
    } catch(e) {}
}

// Logs array
let logs = [];
if (fs.existsSync(LOG_FILE)) {
    try {
        logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    } catch(e) {}
}

// Helper: Add log
function addLog(message, type = 'info') {
    const logEntry = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        message,
        type
    };
    logs.unshift(logEntry);
    if (logs.length > 1000) logs = logs.slice(0, 1000);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Helper: Save config
function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Facebook Graph API - send message
async function sendFacebookMessage(accessToken, groupId, message) {
    try {
        const url = `https://graph.facebook.com/v18.0/${groupId}/feed`;
        const payload = {
            message: message,
            access_token: accessToken
        };
        const response = await axios.post(url, payload);
        return { success: true, data: response.data };
    } catch (error) {
        return { success: false, error: error.response?.data || error.message };
    }
}

// Extract access token from cookies (simplified - real extraction needs more logic)
function extractTokenFromCookies(cookieString) {
    // Try to find c_user and xs token pattern
    const cUserMatch = cookieString.match(/c_user=([^;]+)/);
    const xsMatch = cookieString.match(/xs=([^;]+)/);
    if (cUserMatch && xsMatch) {
        // Generate app access token pattern (simplified - real API needs proper token)
        return `EAAP${Math.random().toString(36).substring(2)}`;
    }
    return null;
}

// Parse cookies from text
function parseCookies(cookieText) {
    const cookies = [];
    const lines = cookieText.split(/\r?\n/);
    for (const line of lines) {
        if (line.trim() && !line.startsWith('#')) {
            cookies.push(line.trim());
        }
    }
    return cookies;
}

// Main automation task
async function startAutomation() {
    if (!config.isRunning) {
        addLog('Automation task stopped by user', 'warn');
        return;
    }
    
    const messageFile = path.join(DATA_DIR, 'messages.txt');
    if (!fs.existsSync(messageFile)) {
        addLog('Message file not found. Please upload messages.txt', 'error');
        config.isRunning = false;
        saveConfig();
        return;
    }
    
    const messages = fs.readFileSync(messageFile, 'utf8').split(/\r?\n/).filter(m => m.trim().length > 0);
    if (messages.length === 0) {
        addLog('No messages found in messages.txt', 'error');
        config.isRunning = false;
        saveConfig();
        return;
    }
    
    const cookiesList = [];
    if (fs.existsSync(COOKIES_FILE)) {
        const cookieContent = fs.readFileSync(COOKIES_FILE, 'utf8');
        const parsed = parseCookies(cookieContent);
        cookiesList.push(...parsed);
    }
    
    if (cookiesList.length === 0) {
        addLog('No cookies found. Please add cookies first.', 'error');
        config.isRunning = false;
        saveConfig();
        return;
    }
    
    addLog(`Automation started | Group: ${config.groupUid} | Target: ${config.haterName} | Interval: ${config.dailySeconds}s | Cookies: ${cookiesList.length}`, 'success');
    
    let messageIndex = 0;
    
    const runLoop = async () => {
        if (!config.isRunning) {
            addLog('Automation stopped', 'info');
            return;
        }
        
        const currentMessage = messages[messageIndex % messages.length];
        const personalizedMessage = currentMessage.replace('{hater}', config.haterName).replace('{group}', config.groupUid);
        
        // Rotate through cookies
        const cookieIndex = Math.floor(Date.now() / 1000 / config.dailySeconds) % cookiesList.length;
        const cookie = cookiesList[cookieIndex];
        const token = extractTokenFromCookies(cookie);
        
        if (token) {
            addLog(`Sending message: "${personalizedMessage.substring(0, 50)}..." using cookie ${cookieIndex + 1}`, 'info');
            const result = await sendFacebookMessage(token, config.groupUid, personalizedMessage);
            if (result.success) {
                addLog(`✓ Message sent successfully! Post ID: ${result.data.id}`, 'success');
            } else {
                addLog(`✗ Failed to send: ${JSON.stringify(result.error)}`, 'error');
            }
        } else {
            addLog(`Invalid cookie format for cookie ${cookieIndex + 1}`, 'error');
        }
        
        messageIndex++;
        
        // Schedule next run
        config.activeTask = setTimeout(runLoop, config.dailySeconds * 1000);
    };
    
    runLoop();
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.get('/api/status', (req, res) => {
    res.json({
        isRunning: config.isRunning,
        config: {
            groupUid: config.groupUid,
            haterName: config.haterName,
            dailySeconds: config.dailySeconds
        },
        logsCount: logs.length
    });
});

app.post('/api/config', (req, res) => {
    const { groupUid, haterName, dailySeconds } = req.body;
    if (groupUid !== undefined) config.groupUid = groupUid;
    if (haterName !== undefined) config.haterName = haterName;
    if (dailySeconds !== undefined) config.dailySeconds = parseInt(dailySeconds);
    saveConfig();
    addLog(`Configuration updated: Group=${config.groupUid}, Hater=${config.haterName}, Interval=${config.dailySeconds}s`, 'info');
    res.json({ success: true, config });
});

app.post('/api/cookies/add', (req, res) => {
    const { cookie } = req.body;
    if (!cookie) return res.status(400).json({ error: 'Cookie required' });
    
    let existing = '';
    if (fs.existsSync(COOKIES_FILE)) {
        existing = fs.readFileSync(COOKIES_FILE, 'utf8');
    }
    const newContent = existing + (existing ? '\n' : '') + cookie;
    fs.writeFileSync(COOKIES_FILE, newContent);
    addLog(`Added new cookie`, 'success');
    res.json({ success: true });
});

app.post('/api/cookies/upload', (req, res) => {
    const { cookies } = req.body;
    if (!cookies) return res.status(400).json({ error: 'Cookies text required' });
    fs.writeFileSync(COOKIES_FILE, cookies);
    addLog(`Uploaded cookies file with ${cookies.split(/\r?\n/).length} cookies`, 'success');
    res.json({ success: true });
});

app.post('/api/messages/upload', (req, res) => {
    const { messages } = req.body;
    if (!messages) return res.status(400).json({ error: 'Messages required' });
    const messagePath = path.join(DATA_DIR, 'messages.txt');
    fs.writeFileSync(messagePath, messages);
    addLog(`Uploaded messages file with ${messages.split(/\r?\n/).length} messages`, 'success');
    res.json({ success: true });
});

app.post('/api/start', (req, res) => {
    if (config.isRunning) {
        return res.json({ success: false, error: 'Already running' });
    }
    config.isRunning = true;
    saveConfig();
    startAutomation().catch(err => {
        addLog(`Error starting automation: ${err.message}`, 'error');
        config.isRunning = false;
        saveConfig();
    });
    res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
    if (config.activeTask) {
        clearTimeout(config.activeTask);
        config.activeTask = null;
    }
    config.isRunning = false;
    saveConfig();
    addLog('Stopped by user', 'warn');
    res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json(logs.slice(0, limit));
});

app.get('/api/cookies', (req, res) => {
    if (fs.existsSync(COOKIES_FILE)) {
        const content = fs.readFileSync(COOKIES_FILE, 'utf8');
        res.json({ cookies: content });
    } else {
        res.json({ cookies: '' });
    }
});

app.get('/api/messages', (req, res) => {
    const messagePath = path.join(DATA_DIR, 'messages.txt');
    if (fs.existsSync(messagePath)) {
        const content = fs.readFileSync(messagePath, 'utf8');
        res.json({ messages: content });
    } else {
        res.json({ messages: '' });
    }
});

// Start server
app.listen(PORT, () => {
    addLog(`Server started on port ${PORT}`, 'info');
    console.log(`Server running at http://localhost:${PORT}`);
});
