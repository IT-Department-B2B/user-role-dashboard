// routes/authRoutes.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const USERS_FILE = path.join(__dirname, '../users.json');

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

  const user = users.find(u => u.username === username && u.password === password);

  if (user) {
    req.session.loggedIn = true;
    req.session.username = user.username;
    req.session.role = user.role;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'Invalid credentials' });
  }
});

router.get('/signup', (req, res) => {
  res.render('signup');
});

router.post('/register', (req, res) => {
  const { username, password, role } = req.body;
  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

  if (users.some(u => u.username === username)) {
    return res.send('Username already exists');
  }

  users.push({ username, password, role });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.redirect('/login');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;