const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust proxy for correct IP addresses in production
if (NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Enhanced CORS configuration for production
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        // Allow all origins for tracking pixels (needed for email clients)
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Additional middleware for production
app.use((req, res, next) => {
    // Log requests in production
    if (NODE_ENV === 'production') {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - IP: ${req.ip}`);
    }
    
    // Security headers
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    
    next();
});

// Handle preflight requests
app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.sendStatus(200);
});

// Storage for tracking data
let trackedEmails = [];
let openedEmails = [];

// File paths
const DATA_DIR = path.join(__dirname, 'data');
const TRACKED_EMAILS_FILE = path.join(DATA_DIR, 'tracked_emails.txt');
const OPENED_EMAILS_FILE = path.join(DATA_DIR, 'opened_emails.txt');

// Ensure data directory exists
async function ensureDataDirectory() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        console.log('Data directory ensured');
    } catch (error) {
        console.error('Error creating data directory:', error);
    }
}

// Load data from files
async function loadData() {
    try {
        // Load tracked emails
        try {
            const trackedData = await fs.readFile(TRACKED_EMAILS_FILE, 'utf8');
            trackedEmails = trackedData.split('\n').filter(line => line.trim()).map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            }).filter(item => item !== null);
            console.log(`Loaded ${trackedEmails.length} tracked emails`);
        } catch (error) {
            console.log('No tracked emails file found, starting fresh');
        }

        // Load opened emails
        try {
            const openedData = await fs.readFile(OPENED_EMAILS_FILE, 'utf8');
            openedEmails = openedData.split('\n').filter(line => line.trim()).map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            }).filter(item => item !== null);
            console.log(`Loaded ${openedEmails.length} opened emails`);
        } catch (error) {
            console.log('No opened emails file found, starting fresh');
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Save data to files with error handling
async function saveTrackedEmail(email) {
    try {
        const line = JSON.stringify(email) + '\n';
        await fs.appendFile(TRACKED_EMAILS_FILE, line);
    } catch (error) {
        console.error('Error saving tracked email:', error);
    }
}

async function saveOpenedEmail(email) {
    try {
        const line = JSON.stringify(email) + '\n';
        await fs.appendFile(OPENED_EMAILS_FILE, line);
    } catch (error) {
        console.error('Error saving opened email:', error);
    }
}

// Get client IP address
function getClientIP(req) {
    return req.ip ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           'Unknown';
}

// Routes

// Root route
app.get('/', (req, res) => {
    res.json({
        message: 'Firefox Mail Tracker Server',
        status: 'running',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        endpoints: {
            health: '/health',
            track: '/api/track',
            pixel: '/track/:trackingId',
            opens: '/api/opens',
            stats: '/api/stats',
            report: '/api/report'
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'Server is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: NODE_ENV,
        tracked: trackedEmails.length,
        opened: openedEmails.length
    });
});

// Store tracking information
app.post('/api/track', async (req, res) => {
    try {
        const trackingData = req.body;
        
        if (!trackingData || !trackingData.id) {
            return res.status(400).json({ success: false, error: 'Invalid tracking data' });
        }
        
        // Add server timestamp and IP
        trackingData.serverTimestamp = new Date().toISOString();
        trackingData.clientIP = getClientIP(req);
        
        trackedEmails.push(trackingData);
        await saveTrackedEmail(trackingData);
        
        console.log('Email tracking data stored:', {
            id: trackingData.id,
            recipient: trackingData.recipient,
            timestamp: trackingData.serverTimestamp
        });
        
        res.json({ success: true, trackingId: trackingData.id });
    } catch (error) {
        console.error('Error storing tracking data:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Tracking pixel endpoint - This is the key endpoint for email tracking
app.get('/track/:trackingId', async (req, res) => {
    try {
        const trackingId = req.params.trackingId;
        const userAgent = req.get('User-Agent') || 'Unknown';
        const clientIP = getClientIP(req);
        const referer = req.get('Referer') || 'Unknown';
        
        console.log(`Tracking pixel accessed: ${trackingId} from IP: ${clientIP}`);
        
        // Find the tracked email
        const trackedEmail = trackedEmails.find(email => email.id === trackingId);
        
        if (trackedEmail) {
            const openData = {
                trackingId: trackingId,
                recipient: trackedEmail.recipient,
                openedAt: new Date().toISOString(),
                userAgent: userAgent,
                ipAddress: clientIP,
                referer: referer,
                headers: {
                    'accept': req.get('Accept'),
                    'accept-language': req.get('Accept-Language'),
                    'accept-encoding': req.get('Accept-Encoding')
                }
            };
            
            // Check if already opened (avoid duplicates)
            const alreadyOpened = openedEmails.find(email => 
                email.trackingId === trackingId && 
                email.ipAddress === clientIP
            );
            
            if (!alreadyOpened) {
                openedEmails.push(openData);
                await saveOpenedEmail(openData);
                console.log('Email opened - NEW:', {
                    trackingId,
                    recipient: trackedEmail.recipient,
                    ip: clientIP,
                    userAgent: userAgent.substring(0, 50) + '...'
                });
            } else {
                console.log('Email opened - DUPLICATE:', {
                    trackingId,
                    ip: clientIP
                });
            }
        } else {
            console.log('Tracking ID not found:', trackingId);
        }
        
        // Return 1x1 transparent GIF pixel
        const pixel = Buffer.from(
            'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
            'base64'
        );
        
        res.set({
            'Content-Type': 'image/gif',
            'Content-Length': pixel.length,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*'
        });
        
        res.send(pixel);
        
    } catch (error) {
        console.error('Error serving tracking pixel:', error);
        
        // Still return a pixel even if there's an error
        const pixel = Buffer.from(
            'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
            'base64'
        );
        
        res.set({
            'Content-Type': 'image/gif',
            'Content-Length': pixel.length
        });
        
        res.send(pixel);
    }
});

// Get recent opens
app.get('/api/opens', (req, res) => {
    try {
        // Return opens from last 24 hours by default
        const hours = parseInt(req.query.hours) || 24;
        const timeAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
        
        const recentOpens = openedEmails.filter(email => 
            new Date(email.openedAt) > timeAgo
        );
        
        res.json(recentOpens);
    } catch (error) {
        console.error('Error getting opens:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all tracked emails
app.get('/api/tracked', (req, res) => {
    try {
        res.json(trackedEmails);
    } catch (error) {
        console.error('Error getting tracked emails:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get statistics
app.get('/api/stats', (req, res) => {
    try {
        const uniqueOpens = new Set(openedEmails.map(email => email.trackingId)).size;
        
        const stats = {
            totalTracked: trackedEmails.length,
            totalOpened: openedEmails.length,
            uniqueOpened: uniqueOpens,
            openRate: trackedEmails.length > 0 ? ((uniqueOpens / trackedEmails.length) * 100).toFixed(2) : 0,
            recentOpens: openedEmails.filter(email => 
                new Date(email.openedAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
            ).length,
            serverUptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Generate detailed report
app.get('/api/report', (req, res) => {
    try {
        const uniqueOpens = new Set(openedEmails.map(email => email.trackingId)).size;
        
        const report = {
            summary: {
                totalTracked: trackedEmails.length,
                totalOpened: openedEmails.length,
                uniqueOpened: uniqueOpens,
                openRate: trackedEmails.length > 0 ? ((uniqueOpens / trackedEmails.length) * 100).toFixed(2) : 0,
                generatedAt: new Date().toISOString()
            },
            trackedEmails: trackedEmails.map(email => {
                const opens = openedEmails.filter(opened => opened.trackingId === email.id);
                const firstOpen = opens.length > 0 ? opens[0] : null;
                
                return {
                    id: email.id,
                    recipient: email.recipient,
                    sentAt: email.sentAt,
                    opened: opens.length > 0,
                    openCount: opens.length,
                    firstOpenedAt: firstOpen ? firstOpen.openedAt : null,
                    lastOpenedAt: opens.length > 0 ? opens[opens.length - 1].openedAt : null,
                    openedFrom: firstOpen ? firstOpen.userAgent : null
                };
            }),
            recentActivity: openedEmails.slice(-20).reverse()
        };
        
        res.json(report);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Clear all data (for testing - consider removing in production)
app.delete('/api/clear', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        
        // Simple auth check (you can enhance this)
        if (NODE_ENV === 'production' && (!authHeader || authHeader !== 'Bearer clear-data-secret')) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        
        trackedEmails = [];
        openedEmails = [];
        
        await fs.writeFile(TRACKED_EMAILS_FILE, '');
        await fs.writeFile(OPENED_EMAILS_FILE, '');
        
        console.log('All data cleared');
        res.json({ success: true, message: 'All data cleared' });
    } catch (error) {
        console.error('Error clearing data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Start server
async function startServer() {
    try {
        await ensureDataDirectory();
        await loadData();
        
        app.listen(PORT, () => {
            console.log(`🚀 Firefox Mail Tracker Server running on port ${PORT}`);
            console.log(`📊 Tracked emails: ${trackedEmails.length}`);
            console.log(`📧 Opened emails: ${openedEmails.length}`);
            console.log(`🌍 Environment: ${NODE_ENV}`);
            console.log('\n📍 Available endpoints:');
            console.log(`   GET  / - Server info`);
            console.log(`   GET  /health - Health check`);
            console.log(`   POST /api/track - Store tracking data`);
            console.log(`   GET  /track/:trackingId - Tracking pixel (IMPORTANT!)`);
            console.log(`   GET  /api/opens - Recent opens`);
            console.log(`   GET  /api/stats - Statistics`);
            console.log(`   GET  /api/report - Detailed report`);
            
            if (NODE_ENV === 'production') {
                console.log(`\n🎯 Your tracking pixel URL format:`);
                console.log(`   https://your-domain.com/track/TRACKING_ID`);
            }
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();