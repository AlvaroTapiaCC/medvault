const express = require("express");
const { body, validationResult } = require("express-validator");
const { auditLog } = require("../logger");

module.exports = ({ pool, requireAuth, requireRole }) => {
  const router = express.Router();

  // ============================================================================
  // GESTIÓN DE USUARIOS
  // ============================================================================

  const bcrypt = require("bcrypt");

  router.get("/users", requireRole("admin"), auditLog("list", "User"), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT user_id, email, full_name, role, is_active
         FROM users ORDER BY full_name ASC`
      );
      return res.json(result.rows);
    } catch (error) {
      console.error("Error al listar usuarios:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  router.post("/users", requireRole("admin"), [
    body("email").isEmail().normalizeEmail().withMessage("Email inválido"),
    body("full_name").trim().notEmpty().withMessage("Nombre completo requerido"),
    body("role").isIn(["doctor", "nurse", "staff", "patient"]).withMessage("Rol inválido"),
    body("password_plain").notEmpty().isLength({ min: 6, max: 100 }).withMessage("Contraseña requerida (mín. 6 caracteres)")
  ], auditLog("create", "User"), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, full_name, role, password_plain, is_active } = req.body;

    try {
      const existsResult = await pool.query(
        "SELECT user_id FROM users WHERE lower(email) = lower($1)",
        [email]
      );
      if (existsResult.rows.length > 0) {
        return res.status(400).json({ error: "Ya existe un usuario con ese email" });
      }

      const countResult = await pool.query("SELECT COUNT(*)::int as count FROM users");
      const newUserId = `U${String(countResult.rows[0].count + 1).padStart(4, "0")}`;
      const passwordHash = await bcrypt.hash(password_plain, 12);

      const insertResult = await pool.query(
        `INSERT INTO users (user_id, email, full_name, role, password_hash, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING user_id, email, full_name, role, is_active`,
        [newUserId, email, full_name, role, passwordHash, is_active ? 1 : 0]
      );

      return res.status(201).json({ success: true, user: insertResult.rows[0] });
    } catch (error) {
      console.error("Error al crear usuario:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  router.delete("/users/:id", requireRole("admin"), auditLog("delete", "User"), async (req, res) => {
    const userId = req.params.id;

    if (userId === req.session.userId) {
      return res.status(400).json({ error: "No puedes eliminar tu propio usuario" });
    }

    try {
      const targetResult = await pool.query(
        "SELECT user_id, role FROM users WHERE user_id = $1",
        [userId]
      );

      if (targetResult.rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      if (targetResult.rows[0].role === "admin") {
        return res.status(400).json({ error: "No está permitido eliminar usuarios admin" });
      }

      await pool.query("DELETE FROM users WHERE user_id = $1", [userId]);
      return res.json({ success: true });
    } catch (error) {
      console.error("Error al eliminar usuario:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  router.get("/users/doctors", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT user_id, full_name, email FROM users
         WHERE role = 'doctor' AND is_active = 1 ORDER BY full_name ASC`
      );
      return res.json(result.rows);
    } catch (error) {
      console.error("Error al listar doctores:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  // ============================================================================
  // GESTIÓN DE PACIENTES
  // Roles permitidos: admin, doctor, nurse, staff (lectura); admin, doctor (escritura)
  // ============================================================================

  router.get("/patients", requireAuth, auditLog("list", "Patient"), async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes FROM patients ORDER BY full_name ASC"
      );
      return res.json(result.rows);
    } catch (error) {
      console.error("Error al listar pacientes:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  router.get("/patients/:id", requireAuth, auditLog("read", "Patient"), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes
         FROM patients WHERE patient_id = $1`,
        [req.params.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }
      return res.json(result.rows[0]);
    } catch (error) {
      console.error("Error al obtener paciente:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  router.patch("/patients/:id/notes", requireRole("admin", "doctor"), [
    body("notes").optional().trim()
  ], auditLog("update_notes", "Patient"), async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE patients SET notes = $1, updated_at = CURRENT_TIMESTAMP
         WHERE patient_id = $2 RETURNING patient_id, notes`,
        [req.body.notes || null, req.params.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }
      return res.json({ success: true, patient: result.rows[0] });
    } catch (error) {
      console.error("Error al actualizar notas:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  router.post("/patients", requireRole("admin", "doctor"), [
    body("full_name").trim().notEmpty().withMessage("Nombre completo requerido"),
    body("national_id").trim().notEmpty().withMessage("RUT/ID requerido"),
    body("birth_date").isDate().withMessage("Fecha de nacimiento inválida"),
    body("sex").optional().isIn(["M", "F", "X"]).withMessage("Sexo inválido (M, F o X)"),
    body("phone").optional().trim(),
    body("address").optional().trim(),
    body("insurance").optional().trim(),
    body("notes").optional().trim()
  ], auditLog("create", "Patient"), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { full_name, national_id, birth_date, sex, phone, address, insurance, notes } = req.body;

    try {
      const countResult = await pool.query("SELECT COUNT(*) as count FROM patients");
      const newId = `P${String(parseInt(countResult.rows[0].count) + 1).padStart(6, "0")}`;

      const result = await pool.query(
        `INSERT INTO patients (patient_id, national_id, full_name, sex, birth_date, phone, address, insurance, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [newId, national_id, full_name, sex || "X", birth_date, phone || null, address || null, insurance || null, notes || null]
      );

      await pool.query("INSERT INTO clinical_files (patient_id) VALUES ($1)", [newId]);

      return res.status(201).json({ success: true, patient: result.rows[0] });
    } catch (error) {
      console.error("Error al crear paciente:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  // ============================================================================
  // GESTIÓN DE FICHAS CLÍNICAS
  // Roles: admin, doctor, nurse (lectura); admin, doctor (escritura)
  // ============================================================================

  router.get("/patients/:id/records", requireRole("admin", "doctor", "nurse"), auditLog("read", "ClinicalRecord"), async (req, res) => {
    try {
      const fileResult = await pool.query(
        "SELECT file_id FROM clinical_files WHERE patient_id = $1",
        [req.params.id]
      );
      if (fileResult.rows.length === 0) {
        return res.status(404).json({ error: "Ficha clínica no encontrada" });
      }

      const recordsResult = await pool.query(
        `SELECT ma.record_id, ma.visit_date, ma.diagnosis, ma.observations, ma.doctor_id, u.full_name as doctor_name
         FROM medical_atentions ma
         LEFT JOIN users u ON ma.doctor_id = u.user_id
         WHERE ma.file_id = $1 ORDER BY ma.visit_date DESC`,
        [fileResult.rows[0].file_id]
      );
      return res.json(recordsResult.rows);
    } catch (error) {
      console.error("Error al obtener registros clínicos:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  router.post("/patients/:id/records", requireRole("admin", "doctor"), [
    body("visit_date").isDate().withMessage("Fecha de visita inválida"),
    body("diagnosis").trim().notEmpty().withMessage("Diagnóstico requerido"),
    body("observations").optional().trim(),
    body("doctor_id").optional().trim()
  ], auditLog("create", "ClinicalRecord"), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { visit_date, diagnosis, observations, doctor_id } = req.body;
    const isCurrentUserDoctor = req.session.role === "doctor";
    const doctorId = isCurrentUserDoctor ? req.session.userId : doctor_id;

    if (!doctorId) {
      return res.status(400).json({ error: "Debe especificar el doctor asociado" });
    }

    try {
      const doctorResult = await pool.query(
        "SELECT user_id FROM users WHERE user_id = $1 AND role = 'doctor' AND is_active = 1",
        [doctorId]
      );
      if (doctorResult.rows.length === 0) {
        return res.status(400).json({ error: "Doctor seleccionado no válido" });
      }

      const fileResult = await pool.query(
        "SELECT file_id FROM clinical_files WHERE patient_id = $1",
        [req.params.id]
      );
      if (fileResult.rows.length === 0) {
        return res.status(404).json({ error: "Ficha clínica no encontrada" });
      }

      const result = await pool.query(
        `INSERT INTO medical_atentions (file_id, doctor_id, visit_date, diagnosis, observations)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [fileResult.rows[0].file_id, doctorId, visit_date, diagnosis, observations || null]
      );
      return res.status(201).json({ success: true, record: result.rows[0] });
    } catch (error) {
      console.error("Error al crear registro clínico:", error);
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  return router;
};
