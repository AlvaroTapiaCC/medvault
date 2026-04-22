const express = require("express");

module.exports = ({ pool, requireAuth, appBootId, sessionCookieName }) => {
  const router = express.Router();

  /**
   * Endpoint de login (POST) para validar credenciales.
   */
  router.post("/login", async (req, res) => {
    const email = String(req.body?.email || "").trim().normalize("NFC");
    const password = String(req.body?.password || "").trim();

    if (!email || !password) {
      return res.status(400).json({ result: false, error: "Missing email or password" });
    }

    try {
      const result = await pool.query(
        "SELECT * FROM users WHERE lower(email) = lower($1)",
        [email]
      );

      if (result.rows.length > 0) {
        const user = result.rows[0];
        // TODO: Aquí irá la comparación de contraseña hasheada con bcrypt
        // Por ahora, validación simple (temporal):
        if (user.password_plain === password) {
          req.session.regenerate((regenerateError) => {
            if (regenerateError) {
              return res.status(500).json({ result: false, error: "Unable to initialize session" });
            }

            req.session.userId = user.user_id;
            req.session.email = user.email;
            req.session.role = user.role;
            req.session.appBootId = appBootId;

            return res.json({ result: true });
          });

          return;
        }
      }

      return res.json({ result: false });
    } catch (error) {
      return res.status(500).json({ result: false, error: error.message });
    }
  });

  router.get("/login", (req, res) => {
    res.render("login", { title: "DocLocker Login" });
  });

  /**
   * Endpoint de logout (GET) para cerrar sesión.
   */
  router.get("/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Error closing session" });
      }
      res.clearCookie(sessionCookieName);
      return res.redirect("/home");
    });
  });

  router.get("/", (req, res) => {
    res.render("home", { title: "MedVault Home", user: req.session });
  });

  /**
   * GET /home - Landing pública de la aplicación.
   */
  router.get("/home", (req, res) => {
    res.render("home", { title: "MedVault Home", user: req.session });
  });

  /**
   * GET /user - Vista principal de usuario autenticado.
   * Requiere autenticación.
   */
  router.get("/user", requireAuth, (req, res) => {
    const allowedViews = req.session.role === "admin"
      ? ["menu", "patients", "users"]
      : ["menu", "patients"];
    const requestedView = req.query.view;
    const initialView = allowedViews.includes(requestedView) ? requestedView : "menu";

    res.render("user", {
      title: "Inicio de Usuario",
      user: req.session,
      initialView
    });
  });

  /**
   * GET /user/new - Vista para registrar nuevo usuario (solo admin).
   * Requiere autenticación.
   */
  router.get("/user/new", requireAuth, (req, res) => {
    if (req.session.role !== "admin") {
      return res.redirect("/user");
    }

    res.render("user-new", {
      title: "Registrar Usuario",
      user: req.session
    });
  });

  /**
   * GET /patient/new - Vista para registrar nuevo paciente.
   * Requiere autenticación.
   */
  router.get("/patient/new", requireAuth, (req, res) => {
    res.render("patient-new", {
      title: "Registrar Paciente",
      user: req.session
    });
  });

  /**
   * GET /patient/:id/new-record - Vista para registrar nueva atención.
   * Requiere autenticación.
   */
  router.get("/patient/:id/new-record", requireAuth, (req, res) => {
    res.render("patient-record-new", {
      title: "Nueva Atención",
      user: req.session,
      patientId: req.params.id
    });
  });

  /**
   * GET /patient/:id/new-document - Vista para subir documento asociado.
   * Requiere autenticación.
   */
  router.get("/patient/:id/new-document", requireAuth, (req, res) => {
    res.render("patient-document-new", {
      title: "Subir Documento",
      user: req.session,
      patientId: req.params.id
    });
  });

  /**
   * GET /patient/:id/document/:docId - Vista de contenido de documento.
   * Requiere autenticación.
   */
  router.get("/patient/:id/document/:docId", requireAuth, (req, res) => {
    res.render("document", {
      title: "Contenido de Documento",
      user: req.session,
      patientId: req.params.id,
      docId: req.params.docId
    });
  });

  /**
   * GET /patient/:id - Vista de detalle de un paciente.
   * Requiere autenticación.
   */
  router.get("/patient/:id", requireAuth, (req, res) => {
    res.render("patient", {
      title: "Detalle de Paciente",
      user: req.session,
      patientId: req.params.id
    });
  });

  // Compatibilidad: ruta antigua de patient sin id
  router.get("/patient", requireAuth, (req, res) => {
    res.redirect("/user?view=patients");
  });

  return router;
};
