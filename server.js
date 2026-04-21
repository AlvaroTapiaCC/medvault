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
const createPatientDocumentRoutes = require("./routes/patientDocumentRoutes");

const app = express();
app.use(express.json());

const sessionCookieName = process.env.SESSION_COOKIE_NAME || "medvault.sid";
const sessionIdleMinutes = Number(process.env.SESSION_IDLE_MINUTES || 60);
const persistSessionCookie = process.env.SESSION_PERSIST_COOKIE === "true";
const invalidateSessionsOnRestart = process.env.SESSION_INVALIDATE_ON_RESTART !== "false";
const appBootId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

app.set('trust proxy', 1);

app.use(session({
  name: sessionCookieName,
  store: new FileStore({
    path: sessionsDir,
    ttl: sessionIdleMinutes * 60,
    reapInterval: 60 * 10
  }),
  secret: process.env.SESSIONS_SECRET || "dev-insecure-session-secret-change-me",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    ...(persistSessionCookie ? { maxAge: sessionIdleMinutes * 60 * 1000 } : {})
  }
}));

app.use((req, res, next) => {
  res.locals.sessionUser = req.session;
  next();
});

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
    return res.redirect("/home");
  }

  if (invalidateSessionsOnRestart && req.session.appBootId !== appBootId) {
    req.session.destroy(() => {
      res.clearCookie(sessionCookieName);
      return res.redirect("/home");
    });
    return;
  }

  next();
};

// Montar rutas modulares
app.use(createAuthRoutes({ pool, requireAuth, appBootId, sessionCookieName }));
app.use(createFileRoutes({ upload, filesDir: FILES_DIR }));
app.use(createPatientRoutes({ pool, requireAuth }));
app.use(createPatientDocumentRoutes({ pool, requireAuth, upload, filesDir: FILES_DIR }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
