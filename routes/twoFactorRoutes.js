const express = require("express");
const { totp } = require("otplib");
const QRCode = require("qrcode");
const { auditLog } = require("../logger");

module.exports = ({ pool, requireAuth, appBootId, sessionCookieName }) => {
  const router = express.Router();

  // ============================================================================
  // RUTAS DE LOGIN CON 2FA
  // ============================================================================

  /**
   * GET /login/2fa - Página de ingreso del código TOTP.
   * Solo accesible si existe un estado pendiente de 2FA en sesión.
   */
  router.get("/login/2fa", (req, res) => {
    if (!req.session.pendingTotpUserId) {
      return res.redirect("/login");
    }
    res.render("login-2fa", { title: "Verificación en dos pasos" });
  });

  /**
   * POST /login/2fa - Verificar código TOTP y completar la sesión.
   */
  router.post("/login/2fa", auditLog("verify_2fa", "Session"), async (req, res) => {
    const pendingUserId = req.session.pendingTotpUserId;

    if (!pendingUserId) {
      return res.status(401).json({ result: false, error: "No hay autenticación pendiente" });
    }

    const token = String(req.body?.token || "").trim();

    if (!token || !/^\d{6}$/.test(token)) {
      return res.json({ result: false, error: "Código inválido: debe ser de 6 dígitos" });
    }

    try {
      const result = await pool.query(
        "SELECT totp_secret FROM users WHERE user_id = $1 AND is_active = 1",
        [pendingUserId]
      );

      if (result.rows.length === 0 || !result.rows[0].totp_secret) {
        return res.status(401).json({ result: false, error: "Configuración 2FA no encontrada" });
      }

      const isValid = totp.check(token, result.rows[0].totp_secret);

      if (!isValid) {
        return res.json({ result: false, error: "Código incorrecto o expirado" });
      }

      const email = req.session.pendingTotpEmail;
      const role = req.session.pendingTotpRole;

      req.session.userId = pendingUserId;
      req.session.email = email;
      req.session.role = role;
      req.session.appBootId = appBootId;

      delete req.session.pendingTotpUserId;
      delete req.session.pendingTotpEmail;
      delete req.session.pendingTotpRole;

      return res.json({ result: true });
    } catch (error) {
      console.error("Error en verificación 2FA:", error);
      return res.status(500).json({ result: false, error: "Error interno del servidor" });
    }
  });

  // ============================================================================
  // RUTAS DE CONFIGURACIÓN 2FA (requieren sesión completa)
  // ============================================================================

  /**
   * GET /user/setup-2fa - Página de configuración de 2FA.
   */
  router.get("/user/setup-2fa", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT totp_secret FROM users WHERE user_id = $1",
        [req.session.userId]
      );
      const has2fa = result.rows.length > 0 && !!result.rows[0].totp_secret;
      res.render("user-2fa-setup", { title: "Configurar Autenticación 2FA", user: req.session, has2fa });
    } catch (error) {
      console.error("Error al cargar estado 2FA:", error);
      return res.status(500).send("Error interno del servidor");
    }
  });

  /**
   * POST /user/setup-2fa/generate - Genera un nuevo secreto TOTP y retorna el QR.
   * El secreto se guarda temporalmente en sesión hasta que el usuario lo verifique.
   */
  router.post("/user/setup-2fa/generate", requireAuth, async (req, res) => {
    try {
      const secret = totp.generateSecret();
      const email = req.session.email;
      const otpauthUrl = `otpauth://totp/MedVault:${encodeURIComponent(email)}?secret=${secret}&issuer=MedVault`;
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

      req.session.pendingTotpSecret = secret;

      return res.json({ success: true, qrDataUrl, secret });
    } catch (error) {
      console.error("Error al generar secreto 2FA:", error);
      return res.status(500).json({ success: false, error: "Error interno del servidor" });
    }
  });

  /**
   * POST /user/setup-2fa/verify - Verifica el código TOTP y activa 2FA guardando el secreto en BD.
   */
  router.post("/user/setup-2fa/verify", requireAuth, auditLog("enable_2fa", "User"), async (req, res) => {
    const secret = req.session.pendingTotpSecret;
    const token = String(req.body?.token || "").trim();

    if (!secret) {
      return res.status(400).json({ success: false, error: "Genera el código QR primero" });
    }

    if (!token || !/^\d{6}$/.test(token)) {
      return res.json({ success: false, error: "Código inválido: debe ser de 6 dígitos" });
    }

    if (!totp.check(token, secret)) {
      return res.json({ success: false, error: "Código incorrecto o expirado" });
    }

    try {
      await pool.query(
        "UPDATE users SET totp_secret = $1 WHERE user_id = $2",
        [secret, req.session.userId]
      );
      delete req.session.pendingTotpSecret;
      return res.json({ success: true, message: "2FA activado correctamente" });
    } catch (error) {
      console.error("Error al activar 2FA:", error);
      return res.status(500).json({ success: false, error: "Error interno del servidor" });
    }
  });

  /**
   * POST /user/disable-2fa - Desactiva 2FA verificando el código actual.
   */
  router.post("/user/disable-2fa", requireAuth, auditLog("disable_2fa", "User"), async (req, res) => {
    const token = String(req.body?.token || "").trim();

    if (!token || !/^\d{6}$/.test(token)) {
      return res.json({ success: false, error: "Código inválido: debe ser de 6 dígitos" });
    }

    try {
      const result = await pool.query(
        "SELECT totp_secret FROM users WHERE user_id = $1",
        [req.session.userId]
      );

      if (result.rows.length === 0 || !result.rows[0].totp_secret) {
        return res.status(400).json({ success: false, error: "2FA no está activo" });
      }

      if (!totp.check(token, result.rows[0].totp_secret)) {
        return res.json({ success: false, error: "Código incorrecto o expirado" });
      }

      await pool.query("UPDATE users SET totp_secret = NULL WHERE user_id = $1", [req.session.userId]);
      return res.json({ success: true, message: "2FA desactivado correctamente" });
    } catch (error) {
      console.error("Error al desactivar 2FA:", error);
      return res.status(500).json({ success: false, error: "Error interno del servidor" });
    }
  });

  return router;
};
