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
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ result: false, error: "Missing username or password" });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1 AND password = $2",
      [username, password]
    );

    if (result.rows.length > 0) {
      res.json({ result: true });
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

app.get("/", (req, res) => {
  res.redirect("/login");
});

/**
 * Nuevo endpoint GET /home para renderizar la vista de pruebas de la API.
 */
app.get("/home", (req, res) => {
  // Asumiendo que el archivo se llama "home.html.ejs" en ./views.
  res.render("home", { title: "DocLocker" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
