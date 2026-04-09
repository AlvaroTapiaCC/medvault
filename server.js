const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// Importar express-session y session-file-store
const session = require("express-session");
const FileStore = require("session-file-store")(session);

const app = express();
app.use(express.json());

// Configurar el motor de vistas EJS
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts); // Activamos el middleware para layouts

// Opcional: definir el layout por defecto (busca views/layout.ejs)
app.set('layout', 'layout');

// Configurar Multer para manejar archivos en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Configurar el almacenamiento de sesiones en el sistema de archivos
const sessionsDir = path.join(__dirname, "sessions");
// Asegurarse de que el directorio existe
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

app.use(session({
  store: new FileStore({ path: sessionsDir }),
  secret: process.env.SESSIONS_SECRET, // Reemplaza con una cadena secreta segura en producción
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 60 * 1000 } // Opcional: 1 hora de duración
}));

// Directorio local para almacenar archivos
const FILES_DIR = path.join(__dirname, "files");

// Asegurarse de que el directorio exista
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

// Configuración de la conexión a PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "postgres"
});

/**
 * Middleware de autenticación para proteger rutas.
 * Verifica que el usuario esté autenticado antes de acceder a rutas protegidas.
 */
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
};

/**
 * Endpoint para subir archivos al servidor local.
 * Guarda el archivo en ./files con su nombre original.
 */
app.post("/upload", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: "Upload failed", details: err.message });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = path.join(FILES_DIR, req.file.originalname);
    fs.writeFile(filePath, req.file.buffer, (err2) => {
      if (err2) return res.status(500).json({ error: "Error saving file", details: err2.message });
      res.json({ success: true, file: req.file.originalname });
    });
  });
});

/**
 * Endpoint para descargar archivos desde el servidor local.
 */
app.get("/download/:filename", (req, res) => {
  const filePath = path.join(FILES_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.download(filePath, req.params.filename, (err) => {
    if (err) {
      res.status(500).json({ error: "Error downloading file", details: err.message });
    }
  });
});

/**
 * Endpoint para listar los archivos disponibles en el directorio local.
 */
app.get("/files", (req, res) => {
  fs.readdir(FILES_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ error: "Error listing files", details: err.message });
    }
    res.json({ success: true, files });
  });
});

/**
 * Endpoint de login (POST) para validar credenciales.
 */
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ result: false, error: "Missing email or password" });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      // TODO: Aquí irá la comparación de contraseña hasheada con bcrypt
      // Por ahora, validación simple (temporal):
      if (user.password_plain === password) {
        req.session.userId = user.user_id;
        req.session.email = user.email;
        req.session.role = user.role;
        res.json({ result: true });
      } else {
        res.json({ result: false });
      }
    } else {
      res.json({ result: false });
    }
  } catch (error) {
    res.status(500).json({ result: false, error: error.message });
  }
});

app.get("/login", (req, res) => {
  // Asumiendo que el archivo se llama "login.html.ejs" en ./views.
  // Si se usa res.render('login') y el motor de vistas es ejs, por defecto se buscará "login.ejs".
  // Si deseas mantener la extensión "html.ejs", puedes invocar res.render('login.html').
  res.render("login", { title: "DocLocker Login" });
});

/**
 * Endpoint de logout (GET) para cerrar sesión.
 */
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Error closing session" });
    }
    res.redirect("/login");
  });
});

app.get("/", (req, res) => {
  res.redirect("/login");
});

/**
 * Nuevo endpoint GET /home para renderizar la vista de pruebas de la API.
 * Requiere autenticación.
 */
app.get("/home", requireAuth, (req, res) => {
  // Asumiendo que el archivo se llama "home.html.ejs" en ./views.
  res.render("home", { title: "DocLocker", user: req.session });
});

// ============================================================================
// ENDPOINTS DE PACIENTES (Gestión de Pacientes - Entrega 1.1)
// ============================================================================

/**
 * GET /patients - Listar todos los pacientes
 * Requiere autenticación.
 */
app.get("/patients", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes FROM patients ORDER BY full_name ASC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /patients - Crear nuevo paciente
 * Requiere autenticación.
 */
app.post("/patients", requireAuth, async (req, res) => {
  const { full_name, national_id, birth_date, sex, phone, address, insurance, notes } = req.body;

  // Validación básica
  if (!full_name || !national_id || !birth_date) {
    return res.status(400).json({ error: "Faltan campos requeridos: full_name, national_id, birth_date" });
  }

  try {
    // Generar un nuevo patient_id (formato P000XXX)
    const countResult = await pool.query("SELECT COUNT(*) as count FROM patients");
    const newId = `P${String(countResult.rows[0].count + 1).padStart(6, '0')}`;

    const result = await pool.query(
      `INSERT INTO patients (patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [newId, national_id, full_name, sex || 'X', birth_date, phone || null, address || null, insurance || null, notes || null]
    );

    // Crear la ficha clínica automáticamente
    await pool.query(
      "INSERT INTO clinical_files (patient_id) VALUES ($1)",
      [newId]
    );

    res.status(201).json({ success: true, patient: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ENDPOINTS DE FICHAS CLÍNICAS (Gestión de Ficha Clínica - Entrega 1.1)
// ============================================================================

/**
 * GET /patients/:id/records - Obtener historial de atenciones clínicas de un paciente
 * Requiere autenticación.
 */
app.get("/patients/:id/records", requireAuth, async (req, res) => {
  const patientId = req.params.id;

  try {
    // Obtener la ficha clínica del paciente
    const fileResult = await pool.query(
      "SELECT file_id FROM clinical_files WHERE patient_id = $1",
      [patientId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: "Ficha clínica no encontrada" });
    }

    const fileId = fileResult.rows[0].file_id;

    // Obtener todas las atenciones de esa ficha en orden cronológico
    const recordsResult = await pool.query(
      `SELECT ma.record_id, ma.visit_date, ma.diagnosis, ma.observations, ma.doctor_id, u.full_name as doctor_name
       FROM medical_atentions ma
       LEFT JOIN users u ON ma.doctor_id = u.user_id
       WHERE ma.file_id = $1
       ORDER BY ma.visit_date DESC`,
      [fileId]
    );

    res.json(recordsResult.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /patients/:id/records - Crear nueva atención clínica para un paciente
 * Requiere autenticación.
 */
app.post("/patients/:id/records", requireAuth, async (req, res) => {
  const patientId = req.params.id;
  const { visit_date, diagnosis, observations } = req.body;
  const doctorId = req.session.userId; // El doctor es el usuario autenticado

  // Validación básica
  if (!visit_date || !diagnosis) {
    return res.status(400).json({ error: "Faltan campos requeridos: visit_date, diagnosis" });
  }

  try {
    // Obtener la ficha clínica del paciente
    const fileResult = await pool.query(
      "SELECT file_id FROM clinical_files WHERE patient_id = $1",
      [patientId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: "Ficha clínica no encontrada" });
    }

    const fileId = fileResult.rows[0].file_id;

    // Insertar la nueva atención
    const result = await pool.query(
      `INSERT INTO medical_atentions (file_id, doctor_id, visit_date, diagnosis, observations)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [fileId, doctorId, visit_date, diagnosis, observations || null]
    );

    res.status(201).json({ success: true, record: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
