const express = require("express");

module.exports = ({ pool, requireAuth }) => {
  const router = express.Router();

  /**
   * Endpoint de login (POST) para validar credenciales.
   */
  router.post("/login", async (req, res) => {
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
          return res.json({ result: true });
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
      return res.redirect("/login");
    });
  });

  router.get("/", (req, res) => {
    res.redirect("/login");
  });

  /**
   * Nuevo endpoint GET /home para renderizar la vista de pruebas de la API.
   * Requiere autenticación.
   */
  router.get("/home", requireAuth, (req, res) => {
    res.render("home", { title: "DocLocker", user: req.session });
  });

  return router;
};
