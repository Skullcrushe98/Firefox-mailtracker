const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false
}));

app.use(express.json());

const trackingData = new Map();
const openedEmails = new Map();

// Root route handler
app.get("/", (req, res) => {
  res.json({
    message: "Firefox Mail Tracker Server is running",
    endpoints: {
      trackingPixel: "/track/:trackingId",
      checkStatus: "/api/tracking/:trackingId",
      healthCheck: "/health"
    }
  });
});

// Serve tracking pixel
app.get("/track/:trackingId", (req, res) => {
    const { trackingId } = req.params;
    const timestamp = Date.now();
    const userAgent = req.get("User-Agent") || "";
    const ip = req.headers["x-forwarded-for"] || req.connection?.remoteAddress;

    // Log the open event
    if (!openedEmails.has(trackingId)) {
        openedEmails.set(trackingId, {
            trackingId,
            openedAt: timestamp,
            userAgent,
            ipAddress: ip
        });
    }

    // Return 1x1 transparent GIF
    const pixel = Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 
        0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 
        0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 
        0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x04, 
        0x01, 0x00, 0x3b
    ]);

    res.set({
        "Content-Type": "image/gif",
        "Content-Length": pixel.length,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    });

    res.send(pixel);
});

// API to check if email was opened
app.get("/api/tracking/:trackingId", (req, res) => {
    const { trackingId } = req.params;
    const opened = openedEmails.get(trackingId);

    res.json({
        trackingId,
        opened: !!opened,
        openedAt: opened?.openedAt,
        userAgent: opened?.userAgent,
        ipAddress: opened?.ipAddress
    });
});

// API to get all opened emails
app.get("/api/opens", (req, res) => {
    const opens = Array.from(openedEmails.values());
    res.json(opens);
});

// API to store tracking data
app.post("/api/track", (req, res) => {
    const data = req.body;
    trackingData.set(data.id, data);
    res.json({ status: "success" });
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
});

app.listen(PORT, () => {
    console.log(`🚀 Tracking server running on http://localhost:${PORT}`);
});
