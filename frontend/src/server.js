const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const app = express();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;