const express = require("express");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");

module.exports = ({ pool, requireAuth, appBootId, sessionCookieName }) => {
  const router = express.Router();

  const loginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { result: false, error: "Demasiados intentos de inicio de sesión. Espera 10 minutos." }
  });

  /**
   * POST /login - Validar credenciales. Si el usuario tiene 2FA activo,
   * retorna requires2fa: true en lugar de crear la sesión completa.
   */
  router.post("/login", loginLimiter, [
    body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
    body('password').notEmpty().isLength({ max: 200 }).withMessage('Contraseña requerida')
  ], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ result: false, error: errors.array()[0].msg });
    }

    const email = req.body.email;
    const password = req.body.password;

    try {
      const result = await pool.query(
        "SELECT * FROM users WHERE lower(email) = lower($1) AND is_active = 1",
        [email]
      );

      if (result.rows.length === 0) {
        return res.json({ result: false });
      }

      const user = result.rows[0];

      let passwordMatch = false;

      if (user.password_hash) {
        passwordMatch = await bcrypt.compare(password, user.password_hash);
      } else if (user.password_plain) {
        // Compatibilidad durante migración: hashear y guardar en el momento
        passwordMatch = (user.password_plain === password);
        if (passwordMatch) {
          const newHash = await bcrypt.hash(password, 12);
          await pool.query(
            "UPDATE users SET password_hash = $1, password_plain = NULL WHERE user_id = $2",
            [newHash, user.user_id]
          );
        }
      }

      if (!passwordMatch) {
        return res.json({ result: false });
      }

      // Si el usuario tiene 2FA activo, iniciar flujo pendiente
      if (user.totp_secret) {
        req.session.regenerate((err) => {
          if (err) return res.status(500).json({ result: false, error: "Error al inicializar sesión" });
          req.session.pendingTotpUserId = user.user_id;
          req.session.pendingTotpEmail = user.email;
          req.session.pendingTotpRole = user.role;
          req.session.appBootId = appBootId;
          return res.json({ result: true, requires2fa: true });
        });
        return;
      }

      // Login completo sin 2FA
      req.session.regenerate((regenerateError) => {
        if (regenerateError) {
          return res.status(500).json({ result: false, error: "Error al inicializar sesión" });
        }
        req.session.userId = user.user_id;
        req.session.email = user.email;
        req.session.role = user.role;
        req.session.appBootId = appBootId;
        return res.json({ result: true });
      });
    } catch (error) {
      console.error("Error en login:", error);
      return res.status(500).json({ result: false, error: "Error interno del servidor" });
    }
  });

  router.get("/login", (req, res) => {
    res.render("login", { title: "MedVault Login" });
  });

  router.get("/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Error al cerrar sesión" });
      }
      res.clearCookie(sessionCookieName);
      return res.redirect("/home");
    });
  });

  router.get("/", (req, res) => {
    res.render("home", { title: "MedVault Home", user: req.session });
  });

  router.get("/home", (req, res) => {
    res.render("home", { title: "MedVault Home", user: req.session });
  });

  router.get("/user", requireAuth, async (req, res) => {
    let has2fa = false;
    try {
      const result = await pool.query(
        "SELECT totp_secret FROM users WHERE user_id = $1",
        [req.session.userId]
      );
      has2fa = result.rows.length > 0 && !!result.rows[0].totp_secret;
    } catch (_) {}

    const allowedViews = req.session.role === "admin"
      ? ["menu", "patients", "users"]
      : ["menu", "patients"];
    const requestedView = req.query.view;
    const initialView = allowedViews.includes(requestedView) ? requestedView : "menu";

    res.render("user", {
      title: "Inicio de Usuario",
      user: req.session,
      initialView,
      has2fa
    });
  });

  router.get("/user/new", requireAuth, (req, res) => {
    if (req.session.role !== "admin") {
      return res.redirect("/user");
    }
    res.render("user-new", { title: "Registrar Usuario", user: req.session });
  });

  router.get("/patient/new", requireAuth, (req, res) => {
    res.render("patient-new", { title: "Registrar Paciente", user: req.session });
  });

  router.get("/patient/:id/new-record", requireAuth, (req, res) => {
    res.render("patient-record-new", {
      title: "Nueva Atención",
      user: req.session,
      patientId: req.params.id
    });
  });

  router.get("/patient/:id/new-document", requireAuth, (req, res) => {
    res.render("patient-document-new", {
      title: "Subir Documento",
      user: req.session,
      patientId: req.params.id
    });
  });

  router.get("/patient/:id/document/:docId", requireAuth, (req, res) => {
    res.render("document", {
      title: "Contenido de Documento",
      user: req.session,
      patientId: req.params.id,
      docId: req.params.docId
    });
  });

  router.get("/patient/:id", requireAuth, (req, res) => {
    res.render("patient", {
      title: "Detalle de Paciente",
      user: req.session,
      patientId: req.params.id
    });
  });

  router.get("/patient", requireAuth, (req, res) => {
    res.redirect("/user?view=patients");
  });

  return router;
};
