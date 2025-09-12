
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { Parser } = require('json2csv');

const app = express();
const port = 3000;
const SETTINGS_FILE = './settings.json';

app.use(express.static('public'));
app.use(express.json());

const db = new sqlite3.Database('./school.db', (err) => {
  if (err) console.error(err.message);
  else console.log('Connected to the school database.');
});

db.serialize(() => {
  const tables = ['students', 'staff', 'classes', 'sections', 'bus_routes', 'bus_stops', 'fees', 'fee_structures', 'staff_roles'];
  tables.forEach(table => db.run(`DROP TABLE IF EXISTS ${table}`));

  db.run(`CREATE TABLE IF NOT EXISTS staff_roles (id INTEGER PRIMARY KEY, role_name TEXT UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS classes (id INTEGER PRIMARY KEY, name TEXT UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS sections (id INTEGER PRIMARY KEY, class_id INTEGER, section_name TEXT, teacher_id INTEGER, FOREIGN KEY (class_id) REFERENCES classes(id), FOREIGN KEY (teacher_id) REFERENCES staff(id), UNIQUE(class_id, section_name))`);
  db.run(`CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT NOT NULL, section_id INTEGER, dob TEXT, gender TEXT, phone TEXT, parent_name TEXT, parent_phone TEXT, address TEXT, bus_stop_id INTEGER, status TEXT NOT NULL DEFAULT 'Active', FOREIGN KEY (section_id) REFERENCES sections(id), FOREIGN KEY (bus_stop_id) REFERENCES bus_stops(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role_id INTEGER, phone TEXT, dob TEXT, gender TEXT, address TEXT, hire_date TEXT, qualifications TEXT, status TEXT NOT NULL DEFAULT 'Active', FOREIGN KEY (role_id) REFERENCES staff_roles(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS bus_routes (id INTEGER PRIMARY KEY, route_name TEXT NOT NULL, driver_id INTEGER, FOREIGN KEY (driver_id) REFERENCES staff(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS bus_stops (id INTEGER PRIMARY KEY, bus_route_id INTEGER NOT NULL, stop_name TEXT NOT NULL, fee_amount REAL DEFAULT 0, FOREIGN KEY (bus_route_id) REFERENCES bus_routes(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS fees (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL, due_date TEXT, fee_type TEXT, FOREIGN KEY (student_id) REFERENCES students(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS fee_structures (id INTEGER PRIMARY KEY, class_id INTEGER, fee_type TEXT NOT NULL, amount REAL NOT NULL, FOREIGN KEY (class_id) REFERENCES classes(id))`);

  const roles = ['Teacher', 'Admin', 'Principal', 'Driver'];
  const stmt = db.prepare("INSERT OR IGNORE INTO staff_roles (role_name) VALUES (?)");
  roles.forEach(role => stmt.run(role));
  stmt.finalize();

  console.log('Database tables reset and created with new schema.');
});

// Settings API
app.get('/api/settings', (req, res) => {
    fs.readFile(SETTINGS_FILE, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(JSON.parse(data));
    });
});
app.put('/api/settings', (req, res) => {
    fs.writeFile(SETTINGS_FILE, JSON.stringify(req.body, null, 2), 'utf8', (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Settings updated successfully.' });
    });
});

// Staff Roles API
app.get('/api/staff-roles', (req, res) => db.all('SELECT * FROM staff_roles', [], (err, rows) => res.json({ data: rows })));
app.post('/api/staff-roles', (req, res) => db.run('INSERT INTO staff_roles (role_name) VALUES (?)', [req.body.role_name], function(err) { res.json({ id: this.lastID }); }));
app.delete('/api/staff-roles/:id', (req, res) => db.run('DELETE FROM staff_roles WHERE id = ?', req.params.id, function(err) { res.json({ changes: this.changes }); }));

// Classes API
app.get('/api/classes', (req, res) => db.all('SELECT * FROM classes', [], (err, rows) => res.json({ data: rows })));
app.post('/api/classes', (req, res) => db.run('INSERT INTO classes (name) VALUES (?)', [req.body.name], function(err) { res.json({ id: this.lastID }); }));
app.delete('/api/classes/:id', (req, res) => db.run('DELETE FROM classes WHERE id = ?', req.params.id, function(err) { res.json({ changes: this.changes }); }));

// Sections API
app.get('/api/sections', (req, res) => {
    let sql = "SELECT s.*, t.name as teacher_name, c.name as class_name FROM sections s JOIN classes c ON s.class_id = c.id LEFT JOIN staff t ON s.teacher_id = t.id";
    if (req.query.class_id) sql += " WHERE s.class_id = ?";
    db.all(sql, req.query.class_id ? [req.query.class_id] : [], (err, rows) => res.json({ data: rows }));
});
app.post('/api/sections', (req, res) => db.run('INSERT INTO sections (class_id, section_name, teacher_id) VALUES (?, ?, ?)', [req.body.class_id, req.body.section_name, req.body.teacher_id], function(err) { res.json({ id: this.lastID }); }));
app.delete('/api/sections/:id', (req, res) => db.run('DELETE FROM sections WHERE id = ?', req.params.id, function(err) { res.json({ changes: this.changes }); }));

// Fee Structures API
app.get('/api/fee-structures', (req, res) => db.all('SELECT fs.*, c.name as class_name FROM fee_structures fs JOIN classes c ON fs.class_id = c.id', [], (err, rows) => res.json({ data: rows })));
app.post('/api/fee-structures', (req, res) => db.run('INSERT INTO fee_structures (class_id, fee_type, amount) VALUES (?, ?, ?)', [req.body.class_id, req.body.fee_type, req.body.amount], function(err) { res.json({ id: this.lastID }); }));
app.delete('/api/fee-structures/:id', (req, res) => db.run('DELETE FROM fee_structures WHERE id = ?', req.params.id, function(err) { res.json({ changes: this.changes }); }));

// Students API
app.get('/api/students', (req, res) => {
    db.all("SELECT s.*, c.name || ' ' || sec.section_name as class_name FROM students s LEFT JOIN sections sec ON s.section_id = sec.id LEFT JOIN classes c ON sec.class_id = c.id WHERE s.status = 'Active'", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});
app.get('/api/students/archived', (req, res) => {
    db.all("SELECT s.*, c.name || ' ' || sec.section_name as class_name FROM students s LEFT JOIN sections sec ON s.section_id = sec.id LEFT JOIN classes c ON sec.class_id = c.id WHERE s.status = 'Left'", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});
app.post('/api/students', (req, res) => {
    const { name, section_id, dob, gender, phone, parent_name, parent_phone, address, bus_stop_id } = req.body;
    db.run('INSERT INTO students (name, section_id, dob, gender, phone, parent_name, parent_phone, address, bus_stop_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [name, section_id, dob, gender, phone, parent_name, parent_phone, address, bus_stop_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});
app.put('/api/students/:id', (req, res) => {
    const { name, section_id, dob, gender, phone, parent_name, parent_phone, address, bus_stop_id } = req.body;
    db.run('UPDATE students SET name = ?, section_id = ?, dob = ?, gender = ?, phone = ?, parent_name = ?, parent_phone = ?, address = ?, bus_stop_id = ? WHERE id = ?', [name, section_id, dob, gender, phone, parent_name, parent_phone, address, bus_stop_id, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ changes: this.changes });
    });
});
app.put('/api/students/:id/archive', (req, res) => db.run('UPDATE students SET status = ? WHERE id = ?', ['Left', req.params.id], function(err) { res.json({ changes: this.changes }); }));
app.get('/api/students/:id/fees', (req, res) => db.all('SELECT * FROM fees WHERE student_id = ?', [req.params.id], (err, rows) => res.json({ data: rows })));

// Staff API
app.get('/api/staff', (req, res) => {
    db.all('SELECT s.*, r.role_name FROM staff s JOIN staff_roles r ON s.role_id = r.id WHERE s.status = ?', ['Active'], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});
app.get('/api/staff/archived', (req, res) => {
    db.all('SELECT s.*, r.role_name FROM staff s JOIN staff_roles r ON s.role_id = r.id WHERE s.status = ?', ['Left'], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data: rows });
    });
});
app.post('/api/staff', (req, res) => {
    const { name, role_id, phone, dob, gender, address, hire_date, qualifications } = req.body;
    db.run('INSERT INTO staff (name, role_id, phone, dob, gender, address, hire_date, qualifications) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [name, role_id, phone, dob, gender, address, hire_date, qualifications], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});
app.put('/api/staff/:id', (req, res) => {
    const { name, role_id, phone, dob, gender, address, hire_date, qualifications } = req.body;
    db.run('UPDATE staff SET name = ?, role_id = ?, phone = ?, dob = ?, gender = ?, address = ?, hire_date = ?, qualifications = ? WHERE id = ?', [name, role_id, phone, dob, gender, address, hire_date, qualifications, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ changes: this.changes });
    });
});
app.put('/api/staff/:id/archive', (req, res) => db.run('UPDATE staff SET status = ? WHERE id = ?', ['Left', req.params.id], function(err) { res.json({ changes: this.changes }); }));

// Bus and other APIs...
// ...

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'SFM.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
