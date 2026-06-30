const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const http = require("http");
const http2 = require("http2");
const { Pool } = require("pg");

const session = require("express-session");
const FileStore = require("session-file-store")(session);
const createAuthRoutes = require("./routes/authRoutes");
const createFileRoutes = require("./routes/fileRoutes");
const createPatientRoutes = require("./routes/patientRoutes");
const createPatientDocumentRoutes = require("./routes/patientDocumentRoutes");
const createTwoFactorRoutes = require("./routes/twoFactorRoutes");

const app = express();
app.use(express.json());

const ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3000;

const sessionCookieName = process.env.SESSION_COOKIE_NAME || "medvault.sid";
const sessionIdleMinutes = Number(process.env.SESSION_IDLE_MINUTES || 60);
const persistSessionCookie = process.env.SESSION_PERSIST_COOKIE === "true";
const invalidateSessionsOnRestart = process.env.SESSION_INVALIDATE_ON_RESTART !== "false";
const appBootId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

app.disable('x-powered-by');

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layout');

const upload = multer({ storage: multer.memoryStorage() });

const sessionsDir = path.join(__dirname, "sessions");
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
    secure: ENV === 'production',
    sameSite: "strict",
    ...(persistSessionCookie ? { maxAge: sessionIdleMinutes * 60 * 1000 } : {})
  }
}));

app.use((req, res, next) => {
  res.locals.sessionUser = req.session;
  next();
});

const FILES_DIR = path.join(__dirname, "files");
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

// Configuración de la conexión a PostgreSQL con TLS en producción
let dbPoolOptions = {
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "postgres"
};

if (ENV === 'production') {
  const dbCertPath = './certs/db.crt';
  if (fs.existsSync(dbCertPath)) {
    try {
      dbPoolOptions.ssl = {
        ca: fs.readFileSync(dbCertPath),
        rejectUnauthorized: true
      };
      console.log('Conexión a base de datos con TLS habilitada.');
    } catch (err) {
      console.error('Error leyendo certificado de base de datos:', err.message);
      process.exit(1);
    }
  }
}

const pool = new Pool(dbPoolOptions);

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

const requireRole = (...allowedRoles) => (req, res, next) => {
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
  if (!allowedRoles.includes(req.session.role)) {
    return res.status(403).json({ error: "Acceso no autorizado para tu rol" });
  }
  next();
};

app.use(createAuthRoutes({ pool, requireAuth, appBootId, sessionCookieName }));
app.use(createTwoFactorRoutes({ pool, requireAuth, appBootId, sessionCookieName }));
app.use(createFileRoutes({ upload, filesDir: FILES_DIR, requireAuth }));
app.use(createPatientRoutes({ pool, requireAuth, requireRole }));
app.use(createPatientDocumentRoutes({ pool, requireAuth, requireRole, upload, filesDir: FILES_DIR }));

// ============================================================================
// INICIO DEL SERVIDOR: HTTP/2 en producción, HTTP/1.1 en desarrollo
// ============================================================================

const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade"
]);

function proxyHttp2StreamToExpress(stream, headers, expressPort) {
  const requestHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith(":") || HOP_BY_HOP_HEADERS.has(name)) continue;
    requestHeaders[name] = value;
  }
  requestHeaders.host = `127.0.0.1:${expressPort}`;

  const proxyReq = http.request({
    host: "127.0.0.1",
    port: expressPort,
    method: headers[":method"],
    path: headers[":path"],
    headers: requestHeaders
  }, (proxyRes) => {
    const responseHeaders = { ":status": proxyRes.statusCode };
    for (const [name, value] of Object.entries(proxyRes.headers)) {
      if (HOP_BY_HOP_HEADERS.has(name)) continue;
      responseHeaders[name] = value;
    }
    stream.respond(responseHeaders);
    proxyRes.pipe(stream);
  });

  proxyReq.on("error", (err) => {
    console.error("Error proxying HTTP/2 request:", err);
    if (!stream.destroyed) {
      stream.respond({ ":status": 502 });
      stream.end("Bad Gateway");
    }
  });

  stream.on("error", () => proxyReq.destroy());
  stream.pipe(proxyReq);
}

if (ENV === 'production' && !process.env.SESSIONS_SECRET) {
  console.error("SESSIONS_SECRET debe estar configurado en producción.");
  process.exit(1);
}

if (ENV === 'production') {
  const certPath = process.env.SSL_CERT_PATH || '/app/certs/4104.grupo19.crt';
  const keyPath = process.env.SSL_KEY_PATH || process.env.CERTIFICATE_PRIVATE_KEY_PATH || '/app/certs/4104.grupo19.key';

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error("Certificado TLS no encontrado. Iniciando en HTTP/1.1 de todas formas.");
    http.createServer(app).listen(PORT, () => {
      console.log(`HTTP server running in ${ENV} mode on port ${PORT}`);
    });
  } else {
    try {
      const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        allowHTTP1: true
      };

      const expressServer = http.createServer(app);
      expressServer.listen(0, "127.0.0.1", () => {
        const expressPort = expressServer.address().port;
        const http2Server = http2.createSecureServer(options);

        http2Server.on("request", (req, res) => {
          if (req.httpVersionMajor === 1) {
            app(req, res);
          }
        });

        http2Server.on("stream", (stream, headers) => {
          proxyHttp2StreamToExpress(stream, headers, expressPort);
        });

        http2Server.listen(PORT, () => {
          console.log(`HTTP/2 server running in ${ENV} mode on port ${PORT}`);
        });
      });
    } catch (err) {
      console.error('No se pudo iniciar servidor HTTPS:', err.message);
      process.exit(1);
    }
  }
} else {
  http.createServer(app).listen(PORT, () => {
    console.log(`HTTP server running in ${ENV} mode on port ${PORT}`);
  });
}
