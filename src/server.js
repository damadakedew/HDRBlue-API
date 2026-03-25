import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';

import authRoutes from './routes/auth.js';
import dpsSearchRoutes from './routes/dpsSearch.js';
import criminalSearchRoutes from './routes/criminalSearch.js';
import watercraftSearchRoutes from './routes/watercraftSearch.js';
import dpsDetailRoutes from './routes/dpsDetail.js';
import criminalDetailRoutes from './routes/criminalDetail.js';
import watercraftDetailRoutes from './routes/watercraftDetail.js';
import hdrReportRoutes from './routes/hdrReport.js';
import courtViolationsRoutes from './routes/courtViolations.js';
import transactionLogRoutes from './routes/transactionLog.js';
import mvrRoutes from './routes/mvr.js';

const app = express();
const PORT = parseInt(process.env.PORT) || 5001;

// CORS — allow HDRBlue-Horizon frontend
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5174',
  credentials: true,
}));

// Parse JSON and URL-encoded request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management — stores D3 CName/Audit from session_V2 login
app.use(session({
  secret: process.env.SESSION_SECRET || 'hdrblue-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: parseInt(process.env.SESSION_TIMEOUT) || 300000,
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'HDRBlue API', version: '1.0.0' });
});

// Authentication
app.use('/api/auth', authRoutes);

// DPS/DMV Searches (via D3)
app.use('/api/search/dps', dpsSearchRoutes);

// Criminal Searches — summary via D3
app.use('/api/search/criminal', criminalSearchRoutes);

// Watercraft Searches (via WSDaveService)
app.use('/api/search/watercraft', watercraftSearchRoutes);

// Driver & Title Detail (via D3)
app.use('/api/detail', dpsDetailRoutes);

// Criminal Detail — profile + arrest (via WSDaveService)
app.use('/api/detail/criminal', criminalDetailRoutes);

// Watercraft Detail (via WSDaveService)
app.use('/api/detail/watercraft', watercraftDetailRoutes);

// HDR Report (D3 + WSDaveService watercraft append)
app.use('/api/report/hdr', hdrReportRoutes);

// Court Violations (web scraper)
app.use('/api/detail/driver/violations', courtViolationsRoutes);

// Transaction Logging (enrichment billing/analytics)
app.use('/api/transaction-log', transactionLogRoutes);

// MVR (eligibility check + request)
app.use('/api/mvr', mvrRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`HDRBlue API running on port ${PORT}`);
  console.log(`D3 Server: ${process.env.D3_HOST}:${process.env.D3_PORT}`);
  console.log(`WSDaveService: ${process.env.WS_DAVE_URL}`);
  console.log(`CORS Origin: ${process.env.CORS_ORIGIN}`);
});
