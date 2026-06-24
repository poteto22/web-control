const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env
dotenv.config();

// Bypass SSL certificate validation for self-signed certificates (useful for local/internal calls on the same machine)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Disable caching for APIs
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});


// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Create MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test DB Connection on startup
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Successfully connected to the database.');
    connection.release();
  } catch (error) {
    console.error('Database connection failed:', error.message);
  }
}
testConnection();

// API: Get prime candidates sorted by score descending
app.get('/api/prime-candidates', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM prime_candidates ORDER BY score DESC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching prime candidates:', error);
    res.status(500).json({ error: 'Failed to fetch prime candidates', details: error.message });
  }
});

// API: Get all areas
app.get('/api/areas', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM areas ORDER BY area_no ASC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching areas:', error);
    res.status(500).json({ error: 'Failed to fetch areas', details: error.message });
  }
});

// API: Get prime candidate scores in a specific area
app.get('/api/areas/:areaName/prime', async (req, res) => {
  try {
    const { areaName } = req.params;
    // We join prime_candidates to get colorCode and candidateImageUrl if available
    const query = `
      SELECT p.id, p.candidateId, p.candidateName, p.areaName, p.score, p.scorePercent, p.progress,
             c.colorCode, c.candidateImageUrl, c.prime_number, c.partiesName
      FROM primescore_areas p
      LEFT JOIN prime_candidates c ON p.candidateId = c.prime_id
      WHERE p.areaName = ?
      ORDER BY p.score DESC
    `;
    const [rows] = await pool.query(query, [areaName]);
    res.json(rows);
  } catch (error) {
    console.error(`Error fetching prime scores for area ${req.params.areaName}:`, error);
    res.status(500).json({ error: 'Failed to fetch area prime scores', details: error.message });
  }
});

// API: Get local candidate scores in a specific area
app.get('/api/areas/:areaName/local', async (req, res) => {
  try {
    const { areaName } = req.params;
    const [rows] = await pool.query(
      'SELECT * FROM candidatescore_areas WHERE areaName = ? ORDER BY score DESC',
      [areaName]
    );

    // Map candidateImageUrl from the filename in pic column
    const mappedRows = rows.map(row => {
      let candidateImageUrl = row.candidateImageUrl;
      if (row.pic) {
        const filename = row.pic.split(/[\\/]/).pop();
        if (filename) {
          candidateImageUrl = `/candidates/${filename}`;
        }
      }
      return {
        ...row,
        candidateImageUrl
      };
    });

    res.json(mappedRows);
  } catch (error) {
    console.error(`Error fetching local scores for area ${req.params.areaName}:`, error);
    res.status(500).json({ error: 'Failed to fetch area local scores', details: error.message });
  }
});

// API: Trigger Webhook with current scores
app.post('/api/webhook/trigger', async (req, res) => {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(400).json({ error: 'Webhook URL is not defined in .env' });
  }

  try {
    // Fetch top candidates data to send as payload
    const [candidates] = await pool.query('SELECT * FROM prime_candidates ORDER BY score DESC');
    
    // Construct payload
    const payload = {
      event: 'election_update',
      timestamp: new Date().toISOString(),
      summary: {
        total_candidates: candidates.length,
        leading_candidate: candidates[0] ? candidates[0].prime_name : null,
        top_scores: candidates.slice(0, 3).map(c => ({
          name: c.prime_name,
          party: c.partiesName,
          score: c.score,
          percent: c.scorePercent
        }))
      },
      data: candidates
    };

    // Send HTTP POST request to WEBHOOK_URL
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    res.json({
      status: response.status,
      statusText: response.statusText,
      webhookUrl: webhookUrl,
      payloadSent: payload,
      responseReceived: responseData
    });
  } catch (error) {
    console.error('Error triggering webhook:', error);
    res.status(500).json({ error: 'Failed to trigger webhook', details: error.message });
  }
});

// API: Send area name to webhook via GET request
app.get('/api/webhook/send-area', async (req, res) => {
  const { area } = req.query;
  if (!area) {
    return res.status(400).json({ error: 'Area parameter is required' });
  }
  
  const webhookUrl = process.env.WEBHOOK_URL || 'https://election69.event360plus.com/webhook/area';
  const targetUrl = `${webhookUrl}?area=${encodeURIComponent(area)}`;
  
  try {
    const response = await fetch(targetUrl, { method: 'GET' });
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }
    
    res.json({
      status: response.status,
      statusText: response.statusText,
      targetUrl: targetUrl,
      responseReceived: responseData
    });
  } catch (error) {
    console.error(`Error sending area ${area} to webhook:`, error);
    res.status(500).json({ error: 'Failed to send area to webhook', details: error.message });
  }
});

// API: Send area name to prime candidate webhook via GET request
app.get('/api/webhook/send-prime', async (req, res) => {
  const { area } = req.query;
  if (!area) {
    return res.status(400).json({ error: 'Area parameter is required' });
  }
  
  const targetUrl = `https://election69.event360plus.com/webhook/prime?area=${encodeURIComponent(area)}`;
  
  try {
    const response = await fetch(targetUrl, { method: 'GET' });
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }
    
    res.json({
      status: response.status,
      statusText: response.statusText,
      targetUrl: targetUrl,
      responseReceived: responseData
    });
  } catch (error) {
    console.error(`Error sending area ${area} to prime webhook:`, error);
    res.status(500).json({ error: 'Failed to send area to prime webhook', details: error.message });
  }
});

// Fallback to serve index.html for any frontend client-side routes (SPA support)
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
