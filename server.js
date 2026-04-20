const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// Importar express-session y session-file-store
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const createAuthRoutes = require("./routes/authRoutes");
const createFileRoutes = require("./routes/fileRoutes");
const createPatientRoutes = require("./routes/patientRoutes");

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

// Montar rutas modulares
app.use(createAuthRoutes({ pool, requireAuth }));
app.use(createFileRoutes({ upload, filesDir: FILES_DIR }));
app.use(createPatientRoutes({ pool, requireAuth }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
